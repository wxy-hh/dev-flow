/**
 * SessionStart hook（T3 真逻辑）
 *
 * 三件事一个注册点（计划 §3.1/§3.2，零新增注册点）：
 * 1. 记账：append session.start 事件（session_id/source/时间戳，载荷里来，§3.5）；
 * 2. 意图块规则常驻注入（hookSpecificOutput.additionalContext，空状态也注入）；
 * 3. 恢复播报（§5.6）+ done 兜底四条件检测（§3.3）。
 *
 * 硬约束（spike 实测，违反=静默失效，§0）：
 * - 输出一律 hookSpecificOutput 格式 + fs.writeSync(1,…) 同步写（src/lib/output.ts）；
 * - 全部判断逻辑下沉纯函数（src/lib/briefing.ts），入口壳只做 stdin 解析+调用+写输出，
 *   行数有预算意识；
 * - 任何异常 fail-open：警告+审计，照常注入规则，绝不阻塞会话启动；
 * - 性能：state 一次读、events 尾扫（反向早退），第一批不读 git status（§3.1 要快）。
 *
 * 版本注入：DEV_FLOW_VERSION 由构建脚本 esbuild --define 注入
 * （版本单源 package.json，plugin.json 永不写 version，计划 §2.2）。
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendEvent, auditWarning, emptyFacts, scanEventsTail } from '../lib/events.js'
import { loadState } from '../lib/state.js'
import {
  buildSessionStartContext,
  INTENT_RULE_TEXT,
  renderAdditionalContext,
} from '../lib/briefing.js'
import { writeHookOutput } from '../lib/output.js'

declare const DEV_FLOW_VERSION: string

/** 解析 stdin 载荷；非法输入返回 null（hook no-op 放行，读 fail-open） */
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
 * 写一行触发证据到 ${CLAUDE_PROJECT_DIR}/.dev-flow-debug/。
 * T1 验证环断言此日志存在（verify.sh）；T3 起附加本次注入内容留痕
 * （additional_context，供 sandbox 端到端断言注入是否生效——规则/播报/兜底都可见）。
 * 记事实不记内容（payload 不落盘，只记来源/会话/版本 + 注入文本）。
 */
function logTrigger(payload: Record<string, unknown> | null, contextText: string): void {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const logDir = join(projectDir, '.dev-flow-debug')
  mkdirSync(logDir, { recursive: true })
  appendFileSync(
    join(logDir, 'session-start.log'),
    JSON.stringify({
      t: new Date().toISOString(),
      hook_event_name: 'SessionStart',
      source: payload?.source ?? null,
      session_id: payload?.session_id ?? null,
      dev_flow_version: DEV_FLOW_VERSION,
      plugin_root: process.env.CLAUDE_PLUGIN_ROOT ?? null,
      additional_context: contextText,
    }) + '\n',
  )
}

function main(): void {
  const payload = parseStdinPayload()
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const root = join(projectDir, '.dev-flow')
  try {
    // 记账：session.start（sanitize 白名单提取，畸形字段自动丢弃；先记账后扫描）
    appendEvent(root, {
      type: 'session.start',
      sessionId: payload?.session_id ?? null,
      source: payload?.source ?? null,
    })
    // fail-open 读：state 损坏 → 空状态 + 审计（loadState 内部处理），规则照常注入
    const { state } = loadState(root)
    // events 尾扫（反向早退）：时序事实以 events 为准；无活跃主线 → 空事实
    const facts =
      state.activeMainlineId !== null
        ? scanEventsTail(root, state.activeMainlineId).facts
        : emptyFacts()
    const contextText = renderAdditionalContext(
      buildSessionStartContext(state, facts, new Date().toISOString()),
    )
    logTrigger(payload, contextText)
    writeHookOutput('SessionStart', { additionalContext: contextText })
  } catch (err) {
    // fail-open：任何异常（state 损坏、events 缺失等）→ 警告+审计，常驻规则照常注入
    auditWarning(
      root,
      `SessionStart 处理异常：${String(err)}，已按 fail-open 注入常驻规则放行`,
      'session-start',
    )
    writeHookOutput('SessionStart', { additionalContext: INTENT_RULE_TEXT })
  }
}

main()
process.exit(0)
