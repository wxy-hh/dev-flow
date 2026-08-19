/**
 * done 完成宣称校验模块（计划 §3.3，T6 咽喉逻辑的纯函数面）
 *
 * done 是状态翻转的唯一咽喉：验收未过必驳回且理由说清缺什么，过了必成。
 * 本文件全部为纯函数（state + facts → 裁决），IO 与事件落账在 MCP server 壳
 * （src/hooks/mcp-server.ts）。
 *
 * 硬校验 = 时序双检查（§3.3）：
 * ① 存在验收事件退出码 0（verify.passed）② 其晚于最后一次写入事件（代码变则
 * 验收失效，与"代码变结论失效"同源）。读 events 尾反向扫（facts 由调用方
 * scanMainlineFacts 提供，微秒级）。
 *
 * verify:none 显式声明（§3.3）：意图块声明 verify:none 的主线 done 免验收，
 * 但要求声明存在（声明进证据链——intent.declared 事件承载）；缺省无声明 = 驳回
 * （fail-visible 给声明模板）。宽容的是内容，不是动作。
 *
 * done 不自己执行命令（MCP 超时 + 重复跑测试成本）——验收事件由 PostToolUse
 * hook 记账（src/lib/verify.ts），done 只读不跑。
 *
 * 连败计数（§9）：驳回记 done.rejected + 连败 +1、通过记 done.claimed + 连败
 * 清零，均由调用方按 applyEvents 折叠（第一批只计数展示，无锁定动作）。
 */

import { activeMainline, laterThan, mainlineName } from './briefing.js'
import type { MainlineFacts } from './events.js'
import { isVerifyNone } from './verify.js'
import type { DevFlowState } from './state.js'

/** 裁决：ok=true 通过（可记 done.claimed）；ok=false 驳回（reason 即 fail-visible 理由） */
export type DoneVerdict = { ok: true; reason: null } | { ok: false; reason: string }

/** 无验收声明的驳回理由（fail-visible：给声明模板） */
export const NO_DECLARATION_REASON =
  '无验收声明：请先输出意图块声明 verify 命令（以「#意图块」开头：做什么 / 预计动哪些文件 / 敏感路径与风险标签 / verify 命令），声明后重试；无验收项的可显式声明 verify: none。'

/**
 * done 裁决（纯函数）：state（活跃主线 + verify 声明缓存）+ facts（events 尾扫
 * 投影）→ 通过/驳回。时序事实一律以 events 为准（facts 由调用方从 events 扫出，
 * 不读 state 的 lastWriteAt 等缓存字段，§3.3"以 events 反向扫为准"）。
 */
export function evaluateDone(state: DevFlowState, facts: MainlineFacts): DoneVerdict {
  const m = activeMainline(state)
  if (m === null) {
    return { ok: false, reason: '无活跃主线：请先切换主线（如"先弄那个 X"）或由用户一句话开启，再宣称完成。' }
  }
  const declaration = state.verifyDeclarations[m.id]
  // 缺省无声明 = 驳回（fail-visible 给声明模板）
  if (declaration === undefined || declaration.trim() === '') {
    return { ok: false, reason: NO_DECLARATION_REASON }
  }
  // verify:none 显式声明 → 免验收（声明存在性已由声明表保证，证据链在 intent.declared）
  if (isVerifyNone(declaration)) {
    return { ok: true, reason: null }
  }
  // 时序双检查 ①：存在验收事件退出码 0
  if (facts.lastVerifyPassedAt === null) {
    return {
      ok: false,
      reason: `无验收通过记录：请先运行 verify 命令「${declaration}」且退出码为 0（验收由系统自动记账），再调用 done。`,
    }
  }
  // 时序双检查 ②：验收晚于最后一次写入（代码变则验收失效；无写入视为恒晚）
  if (!laterThan(facts.lastVerifyPassedAt, facts.lastWriteAt)) {
    return {
      ok: false,
      reason: `验收已失效：最后一次代码写入晚于验收通过（代码变则结论失效），请重新运行 verify 命令「${declaration}」后重试。`,
    }
  }
  return { ok: true, reason: null }
}

/** 成功消息（含主线名，token 面收敛：一句话） */
export function doneSuccessMessage(state: DevFlowState, facts: MainlineFacts): string {
  const m = activeMainline(state)
  const name = m !== null ? mainlineName(state, m.id) : '当前主线'
  return `done 完成：主线「${name}」验收通过，已关闭。`
}
