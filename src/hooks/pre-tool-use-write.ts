/**
 * PreToolUse matcher=Write|Edit|MultiEdit 入口壳（计划 §3.1，T4）
 *
 * 职责：首写入门禁强制层 + 敏感路径硬门禁 + 行为信号采集（write.allowed/
 * write.blocked/intent.* 落账，全部在 write-gate 决策 + gate-runner 编排）。
 * 本文件只做：stdin 载荷解析 → 取 file_path → 调决策 → deny 时输出 hookSpecificOutput。
 *
 * 硬约束（spike §4）：决策字段必须在 hookSpecificOutput（顶层被静默忽略=deny
 * fail-open）；输出用 writeHookOutput（fs.writeSync 同步写）；异常 fail-open
 * （gate-runner 兜底）——门禁自身故障绝不让用户被拦。
 * 性能：Write/Edit 是低频事件（一次调用一次判断），无快路径要求；全部判断
 * 在纯函数层，壳内无业务逻辑。
 */

import { readFileSync } from 'node:fs'
import { runGate } from '../lib/gate-runner.js'
import { decideToolWrite, type GateTool } from '../lib/write-gate.js'
import { readTranscriptIntent } from '../lib/transcript.js'
import { writeHookOutput } from '../lib/output.js'

/** 解析 stdin 载荷；非法输入返回 null（放行，读 fail-open） */
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

function main(): void {
  const payload = parseStdinPayload()
  if (!payload) process.exit(0)
  const toolName = payload.tool_name
  if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') {
    process.exit(0)
  }
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : null
  // 异常载荷（无 file_path）→ 放行不拦（fail-open，决策层同样兜底）
  const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : null
  const cwd =
    typeof payload.cwd === 'string'
      ? payload.cwd
      : (process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
  const { decision, reason } = runGate((ctx) => {
    const transcript = readTranscriptIntent(transcriptPath)
    return decideToolWrite({
      tool: toolName as GateTool,
      filePath,
      mainlineId: ctx.mainlineId,
      cwd,
      pluginRoot: ctx.pluginRoot,
      state: ctx.state,
      events: ctx.events,
      config: ctx.config,
      transcript,
      now: ctx.now,
    })
  })
  if (decision === 'deny') {
    writeHookOutput('PreToolUse', {
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    })
  }
}

main()
process.exit(0)
