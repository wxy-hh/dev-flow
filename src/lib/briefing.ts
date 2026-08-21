/**
 * SessionStart 播报模块（计划 §3.1/§3.2/§3.3、方向合同 §5.6）
 *
 * 三件事的纯函数面（入口壳只做 stdin 解析 + 调用 + 写输出，本文件不含任何 IO）：
 * 1. 意图块规则常驻注入：INTENT_RULE_TEXT（≤5 行；空状态也注入——规则是常驻
 *    约定，不是仪式，§3.2 注入点①）；
 * 2. 恢复播报：buildBriefing（未关闭主线 → "你昨天在做X，做到Y，还差Z"；
 *    空状态 → null，零仪式——没什么可说的就什么都不说，§5.6 恢复是流程义务）；
 * 3. done 兜底检测：doneFallbackMessage（四条件写死：存在未关闭主线 ∧ 有
 *    verify.passed ∧ 其晚于最后写入事件 ∧ 无 done.claimed；命中才注入"验收已过、
 *    只差确认完成"；hook 永不自行完成宣称——attestation 原则 §6.3）。
 *
 * 数据面：state（活跃主线/名称/需求，读一次）+ facts（events 尾扫投影，见 events.ts
 * scanEventsTail——时序事实一律以 events 为准）。第一批不读 git status（§3.1 要快）。
 */

import { type DevFlowState, type Mainline } from './state.js'
import { type MainlineFacts } from './events.js'

/**
 * 意图块规则全文（常驻注入，≤5 行）。措辞短：它是每会话固定的 token 成本。
 * 四要素：做什么 / 预计动哪些文件 / 敏感路径与风险标签 / verify 命令。
 * 附两条必答：verify 命令须可原样执行（单条命令，无反引号/自然语言）；完成宣称
 * 走 MCP done 工具（P1 实证根因：模型从不调用 done——注入从没告知它的存在，
 * 而 done.claimed/rejected 全仓库唯一产出点是 mcp-server.ts 的 done 工具）。
 * 注意：文本含「#意图块」字样是设计使然（§3.2 注入点①），T4 检测须限定
 * assistant 消息 text 块防自注入污染（spike L3 坑）。
 */
export const INTENT_RULE_TEXT = `第一次写文件前先输出意图块（以「#意图块」开头，2-3 行）：
做什么 / 预计动哪些文件 / 敏感路径与风险标签 / verify 命令。
verify 命令写可原样执行的单条命令（如 pnpm test），不要反引号、不要自然语言描述。
verify 通过后调用 mcp__plugin_dev-flow_df__done 完成宣称；未过验收会被驳回。`

/** 活跃主线（软单主线 §5.7）：state 无活跃主线或主线缺失（损坏数据）→ null */
export function activeMainline(state: DevFlowState): Mainline | null {
  const id = state.activeMainlineId
  if (id === null) return null
  return state.mainlines[id] ?? null
}

/** 主线名：state 名（T5 起有值）→ 最后一条需求摘要回退 → 兜底占位 */
export function mainlineName(state: DevFlowState, id: string): string {
  const m = state.mainlines[id]
  if (m && m.name !== '') return m.name
  for (let i = state.requirements.length - 1; i >= 0; i--) {
    const r = state.requirements[i]
    if (r.mainlineId === id && r.summary !== '') return r.summary
  }
  return '未命名主线'
}

/** 时序比较：a 晚于 b 才真；b 缺失（从未写入）视为恒晚；时间戳不可解析 → false（fail-safe 不命中） */
export function laterThan(a: string | null, b: string | null): boolean {
  if (a === null) return false
  if (b === null) return true
  return Date.parse(a) > Date.parse(b)
}

/**
 * 时间桶（播报"你昨天在做"的粗粒度时间词）。now 由调用方注入，保持纯函数确定性；
 * 不可解析/未来时间戳 → "之前"（宽容，不崩溃）。
 */
export function timeAgoLabel(now: string, t: string | null): string {
  if (t === null) return '之前'
  const diff = Date.parse(now) - Date.parse(t)
  if (Number.isNaN(diff) || diff < 0) return '之前'
  const hours = diff / 3_600_000
  if (hours < 1) return '刚才'
  if (hours < 24) return '今天'
  if (hours < 48) return '昨天'
  return `${Math.floor(hours / 24)} 天前`
}

interface StageGap {
  stage: string
  gap: string
}

/** 从最后进展事件推"阶段 / 还差什么"（状态折叠的呈现面，§5.6 播报形状） */
function stageGap(facts: MainlineFacts): StageGap {
  switch (facts.lastProgress?.type) {
    case 'intent.declared':
      return { stage: '刚声明意图', gap: '实现与验证' }
    case 'intent.blocked':
      return { stage: '意图被拦截', gap: '处理拦截原因后重新声明' }
    case 'write.allowed':
    case 'write.blocked':
    case 'file.changed':
      return { stage: '做到写代码阶段', gap: '验证' }
    case 'verify.failed':
      return { stage: '做到验证阶段（上次未过）', gap: '修复后重验' }
    case 'verify.passed':
      // 防御分支：正常路径下"验证通过且是最后进展"即触发兜底（本函数不展示）；
      // 仅当兜底条件未全中（如已被宣称）时才可能走到这里，给出保守表述。
      return { stage: '做到验证阶段', gap: '确认验收是否仍有效' }
    default:
      // 主线存在但无任何进展事件（如刚切换过来）→ 不编造阶段，只报还差什么
      return { stage: '', gap: '实现与验证' }
  }
}

/**
 * 恢复播报（§5.6）：存在未关闭主线（活跃 ∧ 最近宣称痕迹不是 claimed）→ 一句播报；
 * 否则 null（空状态/已关闭 → 零仪式，什么都不说）。
 * 形状："你{昨天}在做「{主线名}」，{阶段}，还差{什么}。"
 * 时间序语义（T6 C 项）：最近 claimed/rejected 谁晚——claimed 晚=已关闭不播报，
 * rejected 晚=未关闭（驳回后重验通过的主线兜底/播报可恢复）。
 */
export function buildBriefing(state: DevFlowState, facts: MainlineFacts, now: string): string | null {
  const m = activeMainline(state)
  if (m === null || facts.lastClaimOrReject === 'claimed') return null
  const name = mainlineName(state, m.id)
  // 时间锚点：最后进展事件时间；无进展则用主线创建时间
  const bucket = timeAgoLabel(now, facts.lastProgress?.t ?? m.createdAt)
  const { stage, gap } = stageGap(facts)
  const parts = [`你${bucket}在做「${name}」`]
  if (stage !== '') parts.push(stage)
  parts.push(`还差${gap}`)
  return parts.join('，') + '。'
}

/**
 * done 兜底检测（§3.3 硬规格，四条件写死，命中才注入；hook 永不自行完成宣称）：
 * ① 存在未关闭主线（活跃主线存在）② 有 verify.passed ③ 其晚于最后写入事件
 * ④ 最近宣称痕迹不是 claimed（时间序语义 T6 C 项：claimed 晚=已关闭抑制；
 * rejected 晚=未关闭，驳回后重验通过的主线兜底恢复触发）。任一不中 → null——
 * 只播报或零注入，兜底绝不变成空会话的仪式。
 */
export function doneFallbackMessage(state: DevFlowState, facts: MainlineFacts): string | null {
  // 条件 ①：存在未关闭主线（未关闭的判定由条件 ④ 承担，此处只查主线存在）
  const m = activeMainline(state)
  if (m === null) return null
  // 条件 ②：有 verify.passed
  if (facts.lastVerifyPassedAt === null) return null
  // 条件 ③：其晚于最后写入事件（代码变则验收失效；无写入视为恒晚）
  if (!laterThan(facts.lastVerifyPassedAt, facts.lastWriteAt)) return null
  // 条件 ④：最近宣称痕迹不是 claimed（claimed→rejected→重验 passed → 可触发）
  if (facts.lastClaimOrReject === 'claimed') return null
  return `主线「${mainlineName(state, m.id)}」验收已过、只差确认完成，请向用户展示摘要并确认。`
}

export interface SessionStartContext {
  rule: string
  briefing: string | null
  doneFallback: string | null
}

/**
 * 组装本次会话的注入内容（纯函数）：规则恒注入；兜底命中时优先于播报
 * （"条件不命中就只播报或零注入"，§3.3——兜底与播报互斥，不叠加）。
 */
export function buildSessionStartContext(
  state: DevFlowState,
  facts: MainlineFacts,
  now = new Date().toISOString(),
): SessionStartContext {
  return {
    rule: INTENT_RULE_TEXT,
    briefing: buildBriefing(state, facts, now),
    doneFallback: doneFallbackMessage(state, facts),
  }
}

/** 渲染注入文本（additionalContext 载荷）：规则 + （兜底消息 | 播报 | 无），换行分隔 */
export function renderAdditionalContext(ctx: SessionStartContext): string {
  const parts = [ctx.rule]
  if (ctx.doneFallback !== null) parts.push(ctx.doneFallback)
  else if (ctx.briefing !== null) parts.push(ctx.briefing)
  return parts.join('\n')
}
