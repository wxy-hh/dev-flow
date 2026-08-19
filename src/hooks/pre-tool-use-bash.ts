/**
 * PreToolUse matcher=Bash 入口壳（计划 §3.1，T4）
 *
 * 职责：① 拦不可逆操作（push/删表/发版/rm -rf 高危）；② 启发式检出写入目标
 * （`>`/`>>`/`tee`/`sed -i`/`cp`/`mv`）→ 命中敏感路径表按升级语义处理，无论
 * 是否敏感都记 file.changed（补证据链与自动 commit 覆盖缺口）；解释器任意写入
 * （python -c 等）为明示残余风险，不做检测。
 *
 * 性能生死线（P95 ≤30ms 含 node 冷启动）——代码内快路径：
 * 不可逆 + 写入两个正则对命令快筛，无命中立即 exit 0，不读任何文件；
 * 命中才进完整路径（读 config/state/events + 词法分析 + 决策 + 落账）。
 * Bash 命令在 tool_input.command（spike 实测载荷无顶层 command，兜底兼容）。
 */

import { readFileSync } from 'node:fs'
import { IRREVERSIBLE_HINT_RE, WRITE_HINT_RE } from '../lib/bash-gate.js'
import { runGate } from '../lib/gate-runner.js'
import { decideBashWrite } from '../lib/write-gate.js'
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
  if (payload.tool_name !== 'Bash') process.exit(0)
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>
  const command =
    (typeof toolInput.command === 'string' ? toolInput.command : '') ||
    (typeof payload.command === 'string' ? payload.command : '')
  if (command === '') process.exit(0)

  // ★ 快路径：正则无命中立即 exit 0（高频事件性能生死线，不读任何文件）
  if (!IRREVERSIBLE_HINT_RE.test(command) && !WRITE_HINT_RE.test(command)) {
    process.exit(0)
  }

  const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : null
  const cwd =
    typeof payload.cwd === 'string'
      ? payload.cwd
      : (process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
  const { decision, reason } = runGate((ctx) => {
    const transcript = readTranscriptIntent(transcriptPath)
    return decideBashWrite({
      command,
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
