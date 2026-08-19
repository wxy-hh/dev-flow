/**
 * 写门禁公共 IO 编排（入口壳的薄壳，T4 两个 PreToolUse 入口共用）
 *
 * 职责（全部 fail-open，绝不因门禁自身故障阻塞开发）：
 * 1. 状态根定位（CLAUDE_PROJECT_DIR 优先，进程 cwd 兜底）；
 * 2. 读 config（可选，容错）/ state（fail-open）/ events（fail-open）；
 * 3. 调决策纯函数（write-gate）；
 * 4. 落账：事件 append events.jsonl（sanitize 关卡），增量折叠进 state 并原子写回
 *    （state 是缓存、events 是事实源——折叠规则与 rebuildState 单一来源）；
 * 5. 任何异常 → audit.warning + 放行，绝不 deny。
 *
 * 注意：transcript 读取（IO）也在壳层做——决策纯函数只收 TranscriptIntent | null。
 */

import { join } from 'node:path'
import { auditWarning, appendEvent, readEvents } from './events.js'
import { loadState, writeState } from './state.js'
import { applyEvents } from './rebuild.js'
import { loadConfig } from './config.js'
import type { DevFlowState } from './state.js'
import type { DevFlowEvent } from './events.js'
import type { DevFlowConfig } from './config.js'
import type { GateResult } from './write-gate.js'

/** 门禁运行时上下文（决策回调的入参；cwd/pluginRoot 由各入口壳按载荷注入） */
export interface GateRunContext {
  root: string
  config: DevFlowConfig
  state: DevFlowState
  mainlineId: string
  events: DevFlowEvent[]
  cwd: string
  pluginRoot: string | null
  now: string
}

export interface GateRunOutcome {
  decision: 'allow' | 'deny'
  reason: string | null
}

/** 项目状态根（hook 进程环境：CLAUDE_PROJECT_DIR 是宿主注入的项目根） */
export function stateRoot(): string {
  return join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.dev-flow')
}

/**
 * 执行一次门禁的公共编排。run 回调必须是纯函数（决策），本函数负责全部 IO 与落账。
 * 异常兜底：audit.warning + 放行（fail-open——门禁自身故障绝不让用户被拦）。
 */
export function runGate(run: (ctx: GateRunContext) => GateResult): GateRunOutcome {
  try {
    const root = stateRoot()
    const config = loadConfig(root)
    const { state } = loadState(root)
    const mainlineId = state.activeMainlineId ?? ''
    const { events, readError } = readEvents(root)
    if (readError !== null) {
      auditWarning(root, `events.jsonl 读取故障：${readError}，门禁按空事件判定（fail-open）`, 'gate')
    }
    const now = new Date().toISOString()
    const result = run({
      root,
      config,
      state,
      mainlineId,
      events,
      cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
      pluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null,
      now,
    })
    if (result.events.length > 0) {
      for (const ev of result.events) appendEvent(root, ev, now)
      // state 是缓存：事件落账后增量折叠（写者=同步 hook，tmp+rename 原子替换）
      writeState(root, applyEvents(state, result.events))
    }
    return { decision: result.decision, reason: result.reason }
  } catch (err) {
    auditWarning(stateRoot(), `PreToolUse 门禁处理异常：${String(err)}，已按 fail-open 放行`, 'gate')
    return { decision: 'allow', reason: null }
  }
}
