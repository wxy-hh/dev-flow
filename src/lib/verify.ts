/**
 * 验收事件记账模块（计划 §3.1/§3.3，T6）
 *
 * PostToolUse hook 的纯函数面（本文件无 IO）：
 * 1. 命令归一化与声明匹配（宁严勿宽，§A：空白/参数序的宽容匹配别过头——
 *    归一化 = 剥首尾包裹外壳（反引号/单双引号，Markdown 惯用写法；只剥
 *    「整串首尾同一字符包裹」与「整 token 首尾同一字符包裹」两层，命令中间
 *    的引号语义不动）+ 去首尾空白 + 空白折叠 + 按空白分词；匹配 = 命令 token
 *    序列以声明 token 序列为前缀；匹配不上就不记）；
 * 2. 退出原因判定（坑 N-4/8-12-10b，硬要求）：
 *    - PostToolUse（成功路径）→ verify.passed（有退出码 0 实证才可记通过）；
 *      但 tool_response.interrupted=true（用户中断/被杀）→ verify.failed
 *      + exitReason=killed（绝不被归一为通过）；
 *      tool_response.timedOutAfterMs 是 number（宿主超时转后台，2026-08-20
 *      实证）→ verify.failed + exitReason=timeout，exitCode=null，带
 *      backgroundTaskId；无 timedOutAfterMs 但 backgroundTaskId 非空（模型
 *      主动 run_in_background 转后台，命令无退出码实证）→ verify.failed
 *      + exitReason=unknown——转后台的命令没有完成证据，绝不可记通过；
 *    - PostToolUseFailure（失败路径）→ verify.failed，exitReason 判定优先级：
 *      is_interrupt=true → killed；error 含 "Command timed out after" → timeout
 *      （宿主超时杀掉，挂死/长跑最终归宿）；error 首行 "Exit code N" → nonzero；
 *      其余 → unknown（如宿主无法启动 shell）。
 *
 * 宿主能力边界（实证结论，见 verify-t6.sh 报告）：非零退出码 / 超时 / 中断在
 * PostToolUse 系列事件载荷里可区分；"挂死 vs 长跑"在宿主层面不可区分（都表现为
 * duration_ms 长 + 未超时），挂死最终以超时分支收口——这是本模块能记到的最细粒度。
 * 2026-08-20 实证：Claude Code 2.1.234（sdk-cli）下 Bash 超时不再走
 * PostToolUseFailure，而是把命令转入后台走 PostToolUse 成功路径，tool_response
 * 带 timedOutAfterMs/backgroundTaskId；旧 PostToolUseFailure "Command timed
 * out after" 分支保留兜底（别的模式/版本可能仍出现）。
 */

import type { DevFlowEvent } from './events.js'

/** verify:none 显式声明的归一化判定值（§3.3：宽容的是内容，不是动作——只认 none） */
export const VERIFY_NONE = 'none'

/** 包裹字符：反引号/单引号/双引号（Markdown 代码惯用；只对首尾同一字符成对包裹剥壳） */
const WRAP_CHARS = new Set(['`', '"', "'"])

/** 整条命令被同一包裹字符首尾包裹（如 `` `pnpm test` ``）→ 剥外壳；否则原样 */
function stripOuterWrapper(cmd: string): string {
  if (cmd.length < 2) return cmd
  const first = cmd[0]
  const last = cmd[cmd.length - 1]
  if (first === last && WRAP_CHARS.has(first)) return cmd.slice(1, -1)
  return cmd
}

/** 单个 token 被同一包裹字符首尾包裹（如 `"msg"`）→ 剥壳；否则原样（中间引号不动） */
function stripTokenWrapper(token: string): string {
  if (token.length < 2) return token
  const first = token[0]
  const last = token[token.length - 1]
  if (first === last && WRAP_CHARS.has(first)) return token.slice(1, -1)
  return token
}

/**
 * 命令归一化（宁严勿宽）：剥首尾包裹外壳（先整条命令级、再逐 token 级，只剥
 * 「同一字符成对包裹」）→ 去首尾空白 + 空白序列折叠为单空格 + 按空白分词。
 * 实证：模型常按 Markdown 习惯把 verify 命令写成 `` `pnpm test` ``（反引号包裹），
 * 不剥外壳则 token 变成 `` `pnpm ``，前缀匹配对真实命令 `pnpm test` 永远 false
 * （最自然的书写方式恰好永不匹配，机制静默失效）。
 */
export function normalizeCommand(cmd: string): string[] {
  const stripped = stripOuterWrapper(cmd.trim())
  return stripped
    .split(/\s+/)
    .map((t) => stripTokenWrapper(t))
    .filter((t) => t !== '')
}

/**
 * 命令匹配声明（纯函数）：声明 token 序列是命令 token 序列的前缀。
 * 带参数跑同一命令（`node check.js --verbose`）算匹配；改命令（`node check`）、
 * 换位置（`check.js node`）、声明不是命令开头 → 不匹配（宁严勿宽，匹配不上就不记）。
 * 空声明 / 空命令 → false。
 */
export function commandMatchesDeclaration(command: string, declaration: string): boolean {
  const cmdTokens = normalizeCommand(command)
  const decTokens = normalizeCommand(declaration)
  if (cmdTokens.length === 0 || decTokens.length === 0) return false
  if (decTokens.length > cmdTokens.length) return false
  for (let i = 0; i < decTokens.length; i++) {
    if (cmdTokens[i] !== decTokens[i]) return false
  }
  return true
}

/** verify:none 判定（纯函数）：归一化后 === 'none'（大小写不敏感；内容宽容边界） */
export function isVerifyNone(declaration: string): boolean {
  return declaration.trim().toLowerCase() === VERIFY_NONE
}

/** 退出原因枚举（事件字段值；additive 白名单在 events.ts sanitize 侧） */
export type ExitReason = 'timeout' | 'killed' | 'nonzero' | 'unknown'

/** 宿主超时标记（实证：Bash 超时被杀时 error 含该行，官方文档同源） */
const TIMEOUT_MARKER = /Command timed out after/

/** 退出码首行解析（实证：Bash 失败 error 首行为 "Exit code N"） */
const EXIT_CODE_RE = /^Exit code (\d+)/m

/** 从宿主失败文本提取退出码；解析不到 → null（unknown 分支） */
export function parseExitCode(error: string | null): number | null {
  if (!error) return null
  const m = EXIT_CODE_RE.exec(error)
  if (!m) return null
  const n = Number(m[1])
  return Number.isInteger(n) ? n : null
}

/**
 * 退出原因判定（纯函数，优先级实证确定）：
 * 1. is_interrupt=true → killed（失败以 abort 形式到达宿主）；
 * 2. error 含 "Command timed out after" → timeout（超时先于退出码判定——
 *    实证超时载荷 error 首行仍是 "Exit code 143"，不能把超时误判为普通失败）；
 * 3. error 首行 "Exit code N" → nonzero（普通失败）；
 * 4. 其余 → unknown（宿主没给退出码也没给超时标记）。
 */
export function classifyExitReason(
  error: string | null,
  isInterrupt: boolean | null,
): ExitReason {
  if (isInterrupt === true) return 'killed'
  if (error !== null && TIMEOUT_MARKER.test(error)) return 'timeout'
  if (error !== null && EXIT_CODE_RE.test(error)) return 'nonzero'
  return 'unknown'
}

export interface VerifyEventInput {
  /** 宿主事件名（PostToolUse=成功路径；PostToolUseFailure=失败路径） */
  hookEventName: string
  command: string
  mainlineId: string
  now: string
  /** PostToolUse.tool_response（成功路径；Bash 形状 {stdout,stderr,interrupted,...}） */
  toolResponse: Record<string, unknown> | null
  /** PostToolUseFailure.error（失败路径；Bash 为 "Exit code N\n<输出>" 或 "Command timed out"） */
  error: string | null
  /** PostToolUseFailure.is_interrupt */
  isInterrupt: boolean | null
  /** PostToolUse.duration_ms / PostToolUseFailure.duration_ms */
  durationMs: number | null
}

/**
 * 构造验收事件（纯函数）：宿主事件载荷 → verify.passed / verify.failed。
 * 退出原因判定在此收口（含转后台判定：timedOutAfterMs/backgroundTaskId）；
 * 命令输出只留尾部 ≤20 行交给 sanitizeEvent（output 字段传整段，红线执行点
 * 在 sanitize——本函数不自行截断，保持单点）。
 */
export function buildVerifyEvent(input: VerifyEventInput): DevFlowEvent {
  const { hookEventName, command, mainlineId, now, toolResponse, error, isInterrupt, durationMs } = input
  // 成功路径（PostToolUse）：interrupted=true 是"被杀"（用户中断），绝不为通过
  if (hookEventName === 'PostToolUse') {
    const interrupted = toolResponse?.interrupted === true
    if (interrupted) {
      return {
        type: 'verify.failed',
        t: now,
        mainlineId,
        requirementId: null,
        exitCode: null,
        command,
        durationMs,
        outputTail: outputTailFromToolResponse(toolResponse),
        exitReason: 'killed',
        backgroundTaskId: null,
      }
    }
    // 转后台判定（2026-08-20 实证）：转后台的命令没有退出码实证，绝不记 verify.passed
    const backgroundTaskId =
      typeof toolResponse?.backgroundTaskId === 'string' && toolResponse.backgroundTaskId !== ''
        ? toolResponse.backgroundTaskId
        : null
    // timedOutAfterMs 是 number = 宿主超时转后台（2.1.234 sdk-cli 实测载荷形状）
    if (typeof toolResponse?.timedOutAfterMs === 'number') {
      return {
        type: 'verify.failed',
        t: now,
        mainlineId,
        requirementId: null,
        exitCode: null,
        command,
        durationMs,
        outputTail: outputTailFromToolResponse(toolResponse),
        exitReason: 'timeout',
        backgroundTaskId,
      }
    }
    // 仅 backgroundTaskId 非空 = 模型主动 run_in_background，无完成证据
    if (backgroundTaskId !== null) {
      return {
        type: 'verify.failed',
        t: now,
        mainlineId,
        requirementId: null,
        exitCode: null,
        command,
        durationMs,
        outputTail: outputTailFromToolResponse(toolResponse),
        exitReason: 'unknown',
        backgroundTaskId,
      }
    }
    return {
      type: 'verify.passed',
      t: now,
      mainlineId,
      requirementId: null,
      exitCode: 0,
      command,
      durationMs,
    }
  }
  // 失败路径（PostToolUseFailure）：超时/被杀/非零退出码分开记账
  return {
    type: 'verify.failed',
    t: now,
    mainlineId,
    requirementId: null,
    exitCode: parseExitCode(error),
    command,
    durationMs,
    outputTail: error !== null ? error.split('\n') : [],
    exitReason: classifyExitReason(error, isInterrupt),
    backgroundTaskId: null,
  }
}

/** 成功路径被杀时尽量留输出尾部（stdout/stderr 合并；红线截断在 sanitize） */
function outputTailFromToolResponse(toolResponse: Record<string, unknown> | null): string[] {
  if (toolResponse === null) return []
  const parts: string[] = []
  for (const k of ['stdout', 'stderr']) {
    if (typeof toolResponse[k] === 'string' && toolResponse[k] !== '') parts.push(toolResponse[k])
  }
  if (parts.length === 0) return []
  return parts.join('\n').split('\n')
}
