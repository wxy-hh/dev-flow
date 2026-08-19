/**
 * 只读状态查询模块（计划 §6 T8；方向合同 §8.5 测量仪先于干预——状态可见性是
 * 服务调试与阈值校准的第一前提）
 *
 * 一句话定位：给开发者/调试者回答"现在流程走到哪了"——活跃主线、挂起列表、
 * 连败计数、最近验收（时间/命令/退出码/退出原因）、完成宣称状态、治理强度、
 * 最近 N 条事件摘要。
 *
 * token 面收敛（红线，§2.2/§4）：返回摘要不返回全量——state 只投影关键字段、
 * 事件每条压缩成一行、默认最近 10 条、渲染总输出默认 ≤ MAX_STATUS_CHARS 字符
 * （超限先丢最旧事件行，保头部/验收/宣称行）。
 *
 * 纯函数纪律（§4）：buildStatusSummary / renderStatusSummary 零 IO（同输入同输出）；
 * loadStatusSummary 只是薄壳：读 state + 读 events 尾扫，fail-open（§4.6）——
 * 损坏/缺失 → 返回"无状态"摘要而非报错（门卫晕倒不锁楼；只报警不自修复）。
 *
 * 报警面选择：本模块是只读查询工具，故障报警面 = 输出文本本身（ok/failure/text
 * 三字段），不写 audit.warning——只读工具不污染证据链（写审计是 hook 写端职责）；
 * 重建仍只走 doctor 手动触发。读路径复用 readEvents（其 ensureStateRoot 幂等，
 * 与全库只读路径一致）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readEvents, type DevFlowEvent } from './events.js'
import {
  defaultState,
  parseState,
  type DevFlowState,
  type Mainline,
  type VerificationRecord,
} from './state.js'
import { activeMainline, mainlineName } from './briefing.js'

/** 事件摘要默认条数（token 面收敛：最近 10 条，不返回全量；options.eventLimit 可覆盖） */
export const EVENT_SUMMARY_LIMIT = 10
/** 渲染总输出默认上限（token 面收敛红线，~500 字符量级；超限先丢最旧事件行） */
export const MAX_STATUS_CHARS = 500
/** 事件摘要行内文本截断长度（压缩一行格式） */
const LINE_TEXT_LEN = 48

/** 事件摘要行（token 面收敛：只留 时间 + 压缩描述，无完整载荷） */
export interface EventSummaryLine {
  /** ISO 时间戳（原样保留） */
  t: string
  /** 压缩描述（中文标签，一行） */
  text: string
}

/** 主线投影（state 只投影关键字段，不暴露全量——§4 token 面收敛） */
export interface MainlineView {
  id: string
  /** 主线名（state 名 → 需求摘要回退 → 占位，复用 briefing.mainlineName） */
  name: string
  status: 'active' | 'suspended'
  /** 最近一次完成宣称时间 */
  claimedAt: string | null
  /** 最近一次完成宣称被驳回时间 */
  rejectedAt: string | null
  /** 最后一次写入时间 */
  lastWriteAt: string | null
}

/** 结构化摘要（"摘要不返回全量"的形状；text 为渲染好的紧凑文本） */
export interface StatusSummary {
  /** 数据面是否正常（false=state/events 损坏或读取故障；空状态不是故障，恒 true） */
  ok: boolean
  /** 故障原因（ok=false 时；null=正常） */
  failure: string | null
  /** 状态最后更新时间（state 投影） */
  updatedAt: string | null
  /** 活跃主线（软单主线 §9 术语；null=尚无主线） */
  activeMainline: MainlineView | null
  /** 挂起主线清单（按 state 表序稳定输出） */
  suspendedMainlines: MainlineView[]
  /** 连败计数（§9：连续"宣称完成被验收驳回"次数） */
  loseStreak: number
  /** 治理强度（0=未升级） */
  governanceStrength: number
  /** 完成宣称状态（doneLock 投影：true=宣称已通过/锁定中） */
  doneClaimed: boolean
  /** 最近验收（时间/命令/退出码/退出原因，VerificationRecord 原样投影） */
  lastVerification: VerificationRecord | null
  /** 最近 N 条事件摘要（默认 10，超限取尾；append 序 = 因果序，不重排） */
  recentEvents: EventSummaryLine[]
  /** 渲染好的紧凑文本（短行、中文标签、无多余装饰，≤maxChars） */
  text: string
}

export interface StatusOptions {
  /** 事件摘要条数（默认 EVENT_SUMMARY_LIMIT；0 = 不要事件摘要） */
  eventLimit?: number
  /** 渲染总输出字符上限（默认 MAX_STATUS_CHARS；token 面收敛红线） */
  maxChars?: number
  /**
   * 数据面故障信息（默认 null=正常）。loadStatusSummary 传入（损坏/读取故障）；
   * 纯函数调用方一般不传。注入后 ok=false 且渲染首行为故障行。
   */
  failure?: string | null
}

/** 文本截断 + 换行压平（红线 §3.5 防内容污染布局：摘要/命令/原话可含换行，压成一行） */
function cutText(s: string, n = LINE_TEXT_LEN): string {
  const flat = s.replace(/\r?\n/g, ' ')
  return flat.length > n ? flat.slice(0, n) + '…' : flat
}

/** 时间字段 → 终端短时间（ISO 取 HH:MM:SS；非 ISO 截断原样，宽容不崩溃） */
function timeOfDay(t: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t) ? t.slice(11, 19) : cutText(t, 19)
}

/** 退出原因标签（T6 四分类：超时/被杀/非零/未知，不得归一为普通失败——坑 N-4/8-12-10b） */
function exitReasonLabel(reason: VerificationRecord['exitReason'], exitCode: number | null): string {
  switch (reason) {
    case 'timeout':
      return '超时'
    case 'killed':
      return '被杀'
    case 'nonzero':
      return `exit ${exitCode ?? '?'}`
    case 'unknown':
      return '原因未知'
    default:
      return `exit ${exitCode ?? '?'}`
  }
}

/** 最近验收的紧凑行（时间/命令/退出码/退出原因 的呈现面） */
function verificationLabel(v: VerificationRecord): string {
  const when = v.at !== '' ? timeOfDay(v.at) : ''
  if (v.exitReason === null) return `通过 ${cutText(v.command, 40)}${when !== '' ? `（${when}）` : ''}`
  return `失败 ${cutText(v.command, 40)}（${exitReasonLabel(v.exitReason, v.exitCode)}${
    when !== '' ? `，${when}` : ''
  }）`
}

/** 单事件压缩为一行（token 面收敛：只留 时间+中文标签+关键事实，无完整载荷） */
function summarizeEvent(ev: DevFlowEvent): string {
  switch (ev.type) {
    case 'session.start':
      return `会话开始（${cutText(ev.sessionId, 24) || '?'}${
        ev.source !== null ? `，${cutText(ev.source, 24)}` : ''
      }）`
    case 'intent.declared':
      return `声明意图：${cutText(ev.summary)}`
    case 'intent.blocked':
      return `意图被拦：${cutText(ev.reason)}`
    case 'write.allowed':
      return `放行写入：${cutText(ev.path)}`
    case 'write.blocked':
      return `拦写入：${cutText(ev.path)}（${cutText(ev.rule, 24)}）`
    case 'file.changed':
      return `改动：${cutText(ev.path)}`
    case 'verify.passed':
      return `验收通过：${cutText(ev.command)}`
    case 'verify.failed':
      return `验收失败：${cutText(ev.command)}（${exitReasonLabel(ev.exitReason, ev.exitCode)}）`
    case 'done.claimed':
      return `宣称完成（${cutText(ev.channel ?? '?', 16)}）`
    case 'done.rejected':
      return `宣称驳回：${cutText(ev.reason)}`
    case 'escape.used':
      return `逃生门：${cutText(ev.quote)}`
    case 'unlock':
      return `解锁：${cutText(ev.context)}`
    case 'mainline.switch':
      return `主线切换：${cutText(ev.from ?? '∅', 24)}→${cutText(ev.to, 24)}`
  }
}

/** 主线 → 投影视图（名称解析复用 briefing.mainlineName：state 名 → 需求摘要 → 占位） */
function toView(state: DevFlowState, m: Mainline): MainlineView {
  return {
    id: m.id,
    name: mainlineName(state, m.id),
    status: m.status,
    claimedAt: m.claimedAt,
    rejectedAt: m.rejectedAt,
    lastWriteAt: m.lastWriteAt,
  }
}

/**
 * 渲染紧凑文本（纯函数）：短行、中文标签、无多余装饰。
 * 固定行（故障/头部/验收/宣称）恒保留；事件区最新在前，预算耗尽即停（丢最旧）。
 * 极端输入（固定行本身超限）防御性硬截断。
 */
export function renderStatusSummary(s: StatusSummary, maxChars = MAX_STATUS_CHARS): string {
  const fixed: string[] = []
  if (s.failure !== null) {
    fixed.push(`状态不可用：${s.failure}（fail-open 放行，重建走 doctor）`)
  } else if (
    s.activeMainline === null &&
    s.suspendedMainlines.length === 0 &&
    s.recentEvents.length === 0
  ) {
    fixed.push('无状态：尚无主线（流程未开始）')
  }
  if (s.activeMainline !== null || s.suspendedMainlines.length > 0) {
    const head: string[] = []
    head.push(
      s.activeMainline !== null ? `活跃主线「${cutText(s.activeMainline.name, 24)}」` : '活跃主线：无',
    )
    if (s.suspendedMainlines.length > 0) {
      head.push(`挂起：${s.suspendedMainlines.map((m) => cutText(m.name, 16)).join('、')}`)
    }
    head.push(`连败 ${s.loseStreak}`, `治理 ${s.governanceStrength}`)
    fixed.push(head.join('｜'))
  }
  if (s.lastVerification !== null) {
    fixed.push(`验收：${verificationLabel(s.lastVerification)}`)
  }
  if (s.updatedAt !== null || s.activeMainline !== null) {
    const claimAt = s.activeMainline?.claimedAt ?? null
    const parts = [
      `宣称：${s.doneClaimed ? '已宣称' : '未宣称'}${
        claimAt !== null ? `（${timeOfDay(claimAt)}）` : ''
      }`,
    ]
    if (s.updatedAt !== null) parts.push(`更新：${timeOfDay(s.updatedAt)}`)
    fixed.push(parts.join('｜'))
  }
  const base = fixed.join('\n')
  if (base.length > maxChars) return base.slice(0, maxChars - 1) + '…' // 防御：固定行超长（极端名称/命令）
  // 事件区：最新在前（终端阅读习惯），预算耗尽即停（丢最旧）；标记仅在至少一条时出现
  const eventLines = [...s.recentEvents].reverse().map((e) => `${timeOfDay(e.t)} ${e.text}`)
  let shown = 0
  let text = base
  while (shown < eventLines.length) {
    const block = [...fixed, '最近事件：', ...eventLines.slice(0, shown + 1)].join('\n')
    if (block.length > maxChars) break
    text = block
    shown += 1
  }
  return text
}

/**
 * 构建状态摘要（纯函数，零 IO）：投影 state 关键字段 + 事件尾截取压缩 + 渲染文本。
 * state/events 由调用方给定（loadStatusSummary 从文件读出；纯函数调用方可直接传）。
 * events 为空或 state 为空 → 同样返回结构化摘要（空字段 + "无状态"文本），不抛错。
 */
export function buildStatusSummary(
  state: DevFlowState,
  events: DevFlowEvent[],
  options?: StatusOptions,
): StatusSummary {
  const limit =
    options?.eventLimit === undefined || !Number.isFinite(options.eventLimit) || options.eventLimit < 0
      ? EVENT_SUMMARY_LIMIT
      : Math.floor(options.eventLimit)
  const maxChars =
    options?.maxChars === undefined || !Number.isFinite(options.maxChars) || options.maxChars <= 0
      ? MAX_STATUS_CHARS
      : Math.floor(options.maxChars)
  const active = activeMainline(state)
  const suspended: MainlineView[] = []
  for (const m of Object.values(state.mainlines)) {
    if (m.status === 'suspended') suspended.push(toView(state, m))
  }
  // 事件尾截取：默认最近 10 条（append 序 = 因果序，取尾不重排，§2.3）；
  // slice(-0) 会取全量，limit=0 时显式空数组
  const tail = limit === 0 ? [] : events.slice(-limit)
  const recentEvents: EventSummaryLine[] = tail.map((ev) => ({ t: ev.t, text: summarizeEvent(ev) }))
  const failure = options?.failure ?? null
  const summary: StatusSummary = {
    ok: failure === null,
    failure,
    updatedAt: state.updatedAt,
    activeMainline: active !== null ? toView(state, active) : null,
    suspendedMainlines: suspended,
    loseStreak: state.loseStreak,
    governanceStrength: state.governanceStrength,
    doneClaimed: state.doneLock,
    lastVerification: state.lastVerification,
    recentEvents,
    text: '',
  }
  summary.text = renderStatusSummary(summary, maxChars)
  return summary
}

/**
 * 薄壳：读 state + events 尾扫 → 状态摘要（fail-open，§4.6）。
 * - state.json 缺失 = 首次运行，静默（非故障）；损坏/读取故障 → 空状态 + 故障信息；
 * - events 坏行跳过计数、读取故障 → 并入故障信息；
 * - 损坏/缺失一律返回"无状态"摘要而非报错；只报警不自修复（重建走 doctor）。
 * 不复用 loadState：那是 hook 写端路径（损坏会写 audit.warning），本模块是只读
 * 查询工具，不改证据链（报警面 = 输出文本的 ok/failure/text）。
 */
export function loadStatusSummary(projectDir: string, options?: StatusOptions): StatusSummary {
  const root = join(projectDir, '.dev-flow')
  let state = defaultState()
  const problems: string[] = []
  try {
    const raw = readFileSync(join(root, 'state.json'), 'utf8')
    const parsed = parseState(raw)
    if (parsed.ok) {
      state = parsed.state
    } else {
      const f = parsed.failure!
      problems.push(`state.json 损坏（${f.kind}）：${f.detail}`)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push(`state.json 读取故障：${String(err)}`)
    }
  }
  const { events, skipped, readError } = readEvents(root)
  if (readError !== null) problems.push(`events.jsonl 读取故障：${readError}`)
  if (skipped > 0) problems.push(`events.jsonl 跳过 ${skipped} 行损坏/截断记录（fail-open）`)
  return buildStatusSummary(state, events, {
    ...options,
    failure: problems.join('；') || null,
  })
}
