/**
 * PostToolUse hook（T6 验收事件记账 + T7 文件改动记账，注册 matcher=Bash|Write|Edit|MultiEdit）
 *
 * 职责（计划 §3.1 PostToolUse 行：证据链记账「文件改动、验收结果」）：
 * 1. Bash（验收结果）：命令匹配当前主线的 verify 声明（state.verifyDeclarations，
 *    T4 已在写门禁时把意图块第四要素提取落账，声明演进"后者覆盖前者"由 rebuild
 *    折叠落实）→ 按退出结果记 verify.passed（exit 0）/ verify.failed（退出原因
 *    三分支：超时/被杀/非零退出码，坑 N-4/8-12-10b）。匹配不上就不记（宁严勿宽）。
 * 2. Write/Edit/MultiEdit（文件改动，T7）：记 file.changed（工具名/项目相对路径/
 *    主线 id/时间）——自动提交的清单来源（§3.6）；Bash 的 file.changed 由写门禁
 *    启发式在 PreToolUse 补（write-gate.ts），两路共一条证据链。
 *
 * 快路径（性能生死线 P95 ≤30ms，计划 §4）：Bash 读 state 一次（fail-open，~0.3ms）
 * → 无活跃主线/无声明/声明是 verify:none/命令不匹配 → 立即 exit 0，不读 events
 * 不读 config 不读 transcript；匹配才进记账路径（append + 增量折叠 + 原子写）。
 *
 * 宿主载荷实证（2026-08-19，见 sandbox/mcp-probe）：Bash 成功走 PostToolUse，
 * tool_response={stdout,stderr,interrupted,isImage,noOutputExpected}；失败走
 * PostToolUseFailure，error="Exit code N\n<输出>" 或含 "Command timed out after"
 * （超时），is_interrupt 标记 abort。2026-08-20 补实证（2.1.234 sdk-cli）：Bash
 * 超时不走 PostToolUseFailure，而是命令转后台走 PostToolUse 成功路径，
 * tool_response 带 timedOutAfterMs/backgroundTaskId。MCP 工具事件也触发本类 hook，
 * 但 matcher 不含 MCP 工具名（done 的 claimed/rejected 由 MCP server 自写，不经本 hook）。
 *
 * fail-open：任何异常 → audit + 放行（PostToolUse 不阻塞工具结果，记账失败绝
 * 不影响开发；验收缺口由 done 的时序双检查兜住——没记上验收 done 就驳回；
 * file.changed 缺口由「宁漏勿误收」兜住——漏记最多是不自动提交，不误收）。
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendEvent, auditWarning, type DevFlowEvent } from '../lib/events.js'
import { loadState, writeState } from '../lib/state.js'
import { applyEvents } from '../lib/rebuild.js'
import { buildVerifyEvent, commandMatchesDeclaration, isVerifyNone } from '../lib/verify.js'
import { buildFileChangedEvent } from '../lib/write-gate.js'

declare const DEV_FLOW_VERSION: string

/** 解析 stdin 载荷；非法输入返回 null（no-op 放行） */
function parseStdinPayload(): Record<string, unknown> | null {
  try {
    const raw = readFileSync(0, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * 写一行触发证据到 ${CLAUDE_PROJECT_DIR}/.dev-flow-debug/post-tool-use.log
 * （sandbox 端到端断言 hook 判定：记没记、记成什么）。记事实不记内容：
 * 只记命令（截断 200）与判定结论，命令输出由事件链承载（sanitize 红线）。
 */
function logTrigger(
  payload: Record<string, unknown> | null,
  opts: {
    matched: boolean
    recorded: boolean
    eventType: string | null
    exitReason: string | null
    declaration: string | null
    command: string
  },
): void {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const logDir = join(projectDir, '.dev-flow-debug')
  mkdirSync(logDir, { recursive: true })
  appendFileSync(
    join(logDir, 'post-tool-use.log'),
    JSON.stringify({
      t: new Date().toISOString(),
      hook_event_name: 'PostToolUse',
      session_id: payload?.session_id ?? null,
      tool_use_id: payload?.tool_use_id ?? null,
      dev_flow_version: DEV_FLOW_VERSION,
      matched: opts.matched,
      recorded: opts.recorded,
      event_type: opts.eventType,
      exit_reason: opts.exitReason,
      declaration: opts.declaration,
      command: opts.command.slice(0, 200),
    }) + '\n',
  )
}

/**
 * Write/Edit/MultiEdit 文件改动记账（薄壳，纯函数在 lib/write-gate.ts）：
 * 载荷缺 file_path / 无活跃主线 / 越界路径 → 静默不记（fail-open：宁漏勿误收）；
 * 记完增量折叠 state（lastWriteAt 缓存与 done 时序双检查同源，保持缓存一致）。
 * 异常 → audit + 放行（PostToolUse 不阻塞工具结果）。
 */
function recordWriteChange(
  payload: Record<string, unknown>,
  toolName: string,
  projectDir: string,
  root: string,
): void {
  try {
    const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : null
    if (filePath === null || filePath === '') return
    const { state } = loadState(root)
    const mainlineId = state.activeMainlineId
    if (mainlineId === null) return
    const now = new Date().toISOString()
    const ev = buildFileChangedEvent({ tool: toolName, filePath, cwd: projectDir, mainlineId, now })
    if (ev === null) return
    appendEvent(root, ev, now)
    writeState(root, applyEvents(state, [ev]))
  } catch (err) {
    auditWarning(root, `PostToolUse 文件改动记账异常：${String(err)}，已 fail-open 放行`, 'post-tool-use')
  }
}

function main(): void {
  const payload = parseStdinPayload()
  if (!payload) process.exit(0)
  const toolName = payload.tool_name
  if (toolName !== 'Bash' && toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') {
    process.exit(0)
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const root = join(projectDir, '.dev-flow')
  // Write/Edit/MultiEdit：文件改动记账（§3.1 PostToolUse「文件改动」行；T7 自动提交
  // 的 file.changed 来源——Bash 的 file.changed 由写门禁启发式在 PreToolUse 补）
  if (toolName !== 'Bash') {
    recordWriteChange(payload, toolName, projectDir, root)
    process.exit(0)
  }
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''
  if (command === '') process.exit(0)
  try {
    // fail-open 读 state：损坏 → 空状态 + 审计（loadState 内部处理），无声明 → 不记
    const { state } = loadState(root)
    const mainlineId = state.activeMainlineId
    if (mainlineId === null) process.exit(0)
    const declaration = state.verifyDeclarations[mainlineId]
    if (declaration === undefined || declaration.trim() === '') process.exit(0)
    // verify:none：无验收命令，任何命令都不匹配（免验收声明不产生验收事件）
    if (isVerifyNone(declaration)) process.exit(0)
    if (!commandMatchesDeclaration(command, declaration)) {
      logTrigger(payload, { matched: false, recorded: false, eventType: null, exitReason: null, declaration, command })
      process.exit(0)
    }
    // 匹配 → 按退出结果记账（退出原因三分支在 buildVerifyEvent 收口）
    const now = new Date().toISOString()
    const event: DevFlowEvent = buildVerifyEvent({
      hookEventName: payload.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse',
      command,
      mainlineId,
      now,
      toolResponse:
        payload.tool_response && typeof payload.tool_response === 'object'
          ? (payload.tool_response as Record<string, unknown>)
          : null,
      error: typeof payload.error === 'string' ? payload.error : null,
      isInterrupt: typeof payload.is_interrupt === 'boolean' ? payload.is_interrupt : null,
      durationMs: typeof payload.duration_ms === 'number' ? payload.duration_ms : null,
    })
    appendEvent(root, event, now)
    writeState(root, applyEvents(state, [event]))
    logTrigger(payload, {
      matched: true,
      recorded: true,
      eventType: event.type,
      exitReason: event.type === 'verify.failed' ? event.exitReason : null,
      declaration,
      command,
    })
  } catch (err) {
    // fail-open：记账故障绝不阻塞工具结果；缺口由 done 时序双检查兜住（fail-visible）
    auditWarning(root, `PostToolUse 验收记账异常：${String(err)}，已 fail-open 放行`, 'post-tool-use')
  }
}

main()
process.exit(0)
