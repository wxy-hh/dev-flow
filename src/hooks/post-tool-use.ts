/**
 * PostToolUse hook（T6 验收事件记账，新注册点 matcher=Bash）
 *
 * 职责：命令匹配当前主线的 verify 声明（state.verifyDeclarations，T4 已在
 * 写门禁时把意图块第四要素提取落账，声明演进"后者覆盖前者"由 rebuild 折叠
 * 落实）→ 按退出结果记 verify.passed（exit 0）/ verify.failed（退出原因
 * 三分支：超时/被杀/非零退出码，坑 N-4/8-12-10b）。匹配不上就不记（宁严勿宽）。
 *
 * 快路径（性能生死线 P95 ≤30ms，计划 §4）：读 state 一次（fail-open，~0.3ms）
 * → 无活跃主线/无声明/声明是 verify:none/命令不匹配 → 立即 exit 0，不读 events
 * 不读 config 不读 transcript；匹配才进记账路径（append + 增量折叠 + 原子写）。
 *
 * 宿主载荷实证（2026-08-19，见 sandbox/mcp-probe）：Bash 成功走 PostToolUse，
 * tool_response={stdout,stderr,interrupted,isImage,noOutputExpected}；失败走
 * PostToolUseFailure，error="Exit code N\n<输出>" 或含 "Command timed out after"
 * （超时），is_interrupt 标记 abort。MCP 工具事件也触发本类 hook，但 matcher=Bash
 * 天然隔离（done 的 claimed/rejected 由 MCP server 自写，不经本 hook）。
 *
 * fail-open：任何异常 → audit + 放行（PostToolUse 不阻塞工具结果，记账失败绝
 * 不影响开发；缺口由 done 的时序双检查兜住——没记上验收 done 就驳回）。
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendEvent, auditWarning, type DevFlowEvent } from '../lib/events.js'
import { loadState, writeState } from '../lib/state.js'
import { applyEvents } from '../lib/rebuild.js'
import { buildVerifyEvent, commandMatchesDeclaration, isVerifyNone } from '../lib/verify.js'

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

function main(): void {
  const payload = parseStdinPayload()
  if (!payload) process.exit(0)
  if (payload.tool_name !== 'Bash') process.exit(0)
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''
  if (command === '') process.exit(0)
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const root = join(projectDir, '.dev-flow')
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
