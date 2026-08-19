/**
 * UserPromptSubmit 识别模块（计划 §3.1/§3.7、方向合同 §4.6/§5.5/§5.7/§6.3，T5）
 *
 * 四件事一个注册点，全部识别/渲染/事件构造为纯函数（prompt + 状态 → 决策），
 * 模式表数据驱动（本文件即"宽窄"审查点——摩擦与误判的平衡，§3.7）：
 *
 * 1. 逃生门（§5.5）："急，直接改"/"我授权" 类 → escape.used 记账（记用户原话
 *    截断）+ 注入"已放行并记账"。信任但记账，事后审计可见。
 * 2. 主线切换（§5.7）："先弄那个 X"/"先做 X" 类 → mainline.switch（from/to/name）；
 *    新主线名来源=用户原话提取（提不出用截断原话占位）；同名已有主线重激活。
 * 3. 用户通道完成确认（§6.3 三通道之一，全流程两跳）：
 *    - "好了"类 → 置 pendingDoneConfirm（state 中间态）+ 注入"请展示待完成摘要
 *      并向用户确认"——hook 不翻转状态（attestation 原则，done 工具 T6 才是咽喉）；
 *    - 下一轮精确确认短语（仅当中间态置位）→ 注入"请执行验收并调 done 工具"。
 * 4. 用户终裁解锁（§4.6）："算过"/"通过吧"/"解锁" 类 → unlock 记账（含用户给的
 *    上下文原话）。T4 写门禁消费端已就绪（未消费 unlock/escape.used → 放行）。
 *
 * 识别纪律（§3.7，违反=回到旧版死循环）：
 * - 状态翻转只信精确短语匹配：窄模式表，匹配才写事件；开放式/模糊语义 → 只做
 *   温和注入（"听起来你想 X，确认吗"，模型多问一句=提示级成本），不写事件；
 *   模式表外一律零注入（宁漏勿误判——漏的成本是提示级，误判的成本是状态污染）。
 * - 抱怨/疑问句全局阻断：连败/卡点场景的原话可能是抱怨不是指令
 *   （"怎么又不行" ≠ 解锁）；疑问句（"好了吗"）不是完成宣称。
 * - 绝不 block、绝不改写用户 prompt，只追加 additionalContext。
 *
 * 状态推进（nextPendingDoneConfirm）与事件构造（upsEvents）也在本文件——
 * 入口壳只做 stdin 解析 + IO + 写输出，保持薄。
 */

import type { DevFlowEvent } from './events.js'
import { MAX_QUOTE_LEN } from './events.js'
import type { Mainline } from './state.js'

/** 用户通道（四件事 → 四通道） */
export type UpsChannel = 'escape' | 'switch' | 'done' | 'unlock'

/** 识别决策（判别联合） */
export type UpsAction =
  | { kind: 'none' }
  | { kind: 'fuzzy'; channel: UpsChannel; quote: string }
  | { kind: 'escape'; quote: string }
  | { kind: 'unlock'; context: string }
  | { kind: 'switch'; from: string | null; to: string; name: string; quote: string }
  | { kind: 'doneHop1' }
  | { kind: 'doneHop2' }

/** 识别器入参（状态缓存面，UPS 不读 events——30s 预算内零重 IO，§3.1） */
export interface RecognizeOptions {
  /** 完成确认中间态（state.pendingDoneConfirm；null=未置位） */
  pendingMainlineId: string | null
  /** 当前活跃主线 id（无主线 = null） */
  activeMainlineId: string | null
  /** 主线表（新主线 id 生成与同名重激活判定） */
  mainlines: Record<string, Mainline>
}

/** 短语规则：exact=整句精确（归一化后）；includes=包含匹配 */
interface PhraseRule {
  phrase: string
  mode: 'exact' | 'includes'
}

// —— 窄模式表（事件门：匹配才写事件；每通道几个明确短语，宁窄勿宽）——

/** 逃生门（§5.5）：短语含"急，直接改"内核与 deny 模板回话（"直接改，我授权"） */
const ESCAPE_TABLE: PhraseRule[] = [
  { phrase: '直接改', mode: 'includes' },
  { phrase: '我授权', mode: 'includes' },
  { phrase: '授权你', mode: 'includes' },
  { phrase: '别拦了', mode: 'includes' },
  { phrase: '直接放行', mode: 'includes' },
]

/**
 * 用户终裁解锁（§4.6）：决策短语才记账；事实陈述不算（"算过了"/"测试通过了"
 * 是汇报不是裁定，故 '算过'/'通过' 仅整句精确匹配）。
 */
const UNLOCK_TABLE: PhraseRule[] = [
  { phrase: '算过', mode: 'exact' },
  { phrase: '算它过', mode: 'exact' },
  { phrase: '通过', mode: 'exact' },
  { phrase: '通过吧', mode: 'includes' },
  { phrase: '算过吧', mode: 'includes' },
  { phrase: '解锁', mode: 'includes' },
  { phrase: '放行', mode: 'exact' },
  { phrase: '放行吧', mode: 'includes' },
  { phrase: '直接放行', mode: 'includes' },
  { phrase: '我认可', mode: 'includes' },
  { phrase: '认可', mode: 'exact' },
]

/** 完成确认第一跳（"好了"类；疑问句/抱怨已被全局阻断） */
const DONE_HOP1_TABLE: PhraseRule[] = [
  { phrase: '好了', mode: 'includes' },
  { phrase: '可以了', mode: 'includes' },
  { phrase: '完成了', mode: 'includes' },
  { phrase: '做完了', mode: 'includes' },
  { phrase: '搞定了', mode: 'includes' },
  { phrase: '搞定', mode: 'includes' },
  { phrase: '完事了', mode: 'includes' },
  { phrase: '弄完了', mode: 'includes' },
  { phrase: '写完了', mode: 'includes' },
  { phrase: '收工', mode: 'includes' },
]

/** 完成确认第二跳：仅当中间态置位（pendingDoneConfirm）时的精确确认短语 */
const DONE_HOP2_EXACT = [
  '确认',
  '确认吧',
  '确认完成',
  '确认了',
  '可以',
  '可以了',
  '好的',
  'ok',
  'OK',
]

/** 主线切换指向短语（"先弄那个 X"：明确指认新主线） */
const SWITCH_POINTERS = ['先弄那个', '先弄这个', '先做那个', '先做这个', '先改那个', '先改这个']

/** 主线切换前缀短语（"先做 X"：X 即新主线名；余部须满足名提取规则） */
const SWITCH_PREFIXES = ['先弄', '先做', '先改', '转做']

/** 前缀命中后余部以这些字开头 = 不是切换（"先做完"是继续当前线，不是换线） */
const SWITCH_NON_NAME_START = ['完', '好', '成', '一', '下', '来', '个', '吧', '了']

/**
 * 模糊语义表（只做温和注入，不写事件——模型多问一句，提示级成本 §4.6）。
 * 比事件表宽一档但同样限域：只收"明显指向该通道、但没说到精确短语"的表述。
 */
export const UPS_FUZZY_TABLE: Record<UpsChannel, string[]> = {
  escape: ['别拦', '绕过流程', '别走流程', '别整流程', '赶时间', '来不及'],
  switch: ['切到', '换到', '换条线', '换线', '换个方向'],
  done: ['差不多了', '基本完成', '先这样吧'],
  unlock: ['通融', '网开一面', '睁只眼', '高抬贵手'],
}

/** 抱怨词阻断（宁漏勿误判：连败/卡点场景的原话常是抱怨不是指令）。
 * 否定词只针对逃生短语（"不要直接改"不是授权），不做全局阻断——
 * 全局"不要"会误伤"不要只输出描述"类正常表述与"不要拦我"类真实逃生请求。 */
const UPS_BLOCK_RE =
  /怎么|为什么|为何|咋|还没|还不行|卡住|卡在|怎么回事|搞不定|失败|报错|不行了|不要直接改|[?？]/

/** 疑问句尾（"好了吗"/"搞定没"是问句，不是完成宣称） */
const UPS_QUESTION_TAIL_RE = /(没|么|吗|呢|啊|呀)$/

/** 归一化（精确短语比较用）：去首尾空白 + 去尾部标点 */
function normalizeExact(s: string): string {
  return s.trim().replace(/[。！？!?、，,.;；:：]+$/, '')
}

/** 用户原话截断（红线 §3.5：500 字符） */
function cutQuote(s: string): string {
  return s.length > MAX_QUOTE_LEN ? s.slice(0, MAX_QUOTE_LEN) : s
}

/** 短语表匹配：includes 对原文，exact 对归一化整句 */
function matchTable(text: string, normalized: string, rules: PhraseRule[]): boolean {
  for (const r of rules) {
    if (r.mode === 'includes') {
      if (text.includes(r.phrase)) return true
    } else if (normalized === r.phrase) {
      return true
    }
  }
  return false
}

/**
 * 新主线名提取（§5.7）：截余部 → 去指向词/标点/语气词 → 空则回退截断原话占位。
 */
export function extractSwitchName(remainder: string, fallback: string): string {
  let name = remainder
  name = name.replace(/^[\s,，。！？!?、;；:：.]+/, '') // 前导空白/标点
  name = name.replace(/^那个|^这个/, '') // 指向词（"先弄那个 XX" → "XX"）
  name = name.replace(/[\s,，。！？!?、;；:：.]+$/, '') // 尾部空白/标点
  name = name.replace(/[吧了哈啊呀]+$/, '') // 句末语气词
  name = name.slice(0, MAX_QUOTE_LEN)
  return name === '' ? fallback : name
}

/**
 * 主线切换匹配（纯函数）：指向短语优先，前缀短语次之（余部须过名提取前置规则）。
 * 返回 { remainder } 或 null（未命中）。
 */
function matchSwitch(prompt: string): { remainder: string } | null {
  for (const p of SWITCH_POINTERS) {
    const idx = prompt.indexOf(p)
    if (idx !== -1) return { remainder: prompt.slice(idx + p.length) }
  }
  for (const p of SWITCH_PREFIXES) {
    const idx = prompt.indexOf(p)
    if (idx !== -1) {
      const remainder = prompt.slice(idx + p.length)
      if (remainder.trim() === '') continue
      const first = remainder.trimStart()[0] ?? ''
      if (SWITCH_NON_NAME_START.includes(first)) continue
      return { remainder }
    }
  }
  return null
}

/**
 * 新主线 id 判定：同名已有主线 → 重激活（软单主线多线跳回，§5.7）；
 * 否则确定性编号（主线不删除，id 不复用）。返回 null = 目标即当前活跃主线
 * （用户重申当前线，无事可做——零注入，不写无意义事件）。
 */
function resolveSwitchTarget(
  name: string,
  mainlines: Record<string, Mainline>,
  activeMainlineId: string | null,
): string | null {
  for (const m of Object.values(mainlines)) {
    if (m.name === name) return m.id === activeMainlineId ? null : m.id
  }
  const id = `ml-${Object.keys(mainlines).length + 1}`
  return id === activeMainlineId ? null : id
}

/** 模糊语义匹配（只做温和注入） */
function matchFuzzy(prompt: string): UpsChannel | null {
  const channels = Object.keys(UPS_FUZZY_TABLE) as UpsChannel[]
  for (const channel of channels) {
    for (const phrase of UPS_FUZZY_TABLE[channel]) {
      if (prompt.includes(phrase)) return channel
    }
  }
  return null
}

/**
 * 识别器（纯函数，识别纪律 §3.7 的唯一执行点）：
 * 阻断 → 第二跳 → 逃生 → 解锁 → 主线切换 → 第一跳 → 模糊 → 零注入。
 * 多通道并存时取表中靠前通道（如"解锁，直接改" → 逃生优先：紧急语义最高）。
 */
export function recognizeUserPrompt(prompt: string, opts: RecognizeOptions): UpsAction {
  const normalized = normalizeExact(prompt)
  if (normalized === '') return { kind: 'none' }
  // 抱怨/疑问句全局阻断（宁漏勿误判：不把抱怨误判成指令、不把问句误判成宣称）
  if (UPS_BLOCK_RE.test(prompt) || UPS_QUESTION_TAIL_RE.test(normalized)) {
    return { kind: 'none' }
  }
  const quote = cutQuote(prompt)

  // 第二跳：仅当完成确认中间态置位且属当前活跃主线 + 精确确认短语（状态翻转
  // 只信精确匹配——中间插入无关 prompt 不推进也不污染，见 nextPendingDoneConfirm）
  const armed =
    opts.pendingMainlineId !== null &&
    opts.pendingMainlineId === (opts.activeMainlineId ?? '')
  if (armed && DONE_HOP2_EXACT.includes(normalized)) {
    return { kind: 'doneHop2' }
  }

  if (matchTable(prompt, normalized, ESCAPE_TABLE)) return { kind: 'escape', quote }
  if (matchTable(prompt, normalized, UNLOCK_TABLE)) return { kind: 'unlock', context: quote }

  const sw = matchSwitch(prompt)
  if (sw !== null) {
    const name = extractSwitchName(sw.remainder, quote)
    const to = resolveSwitchTarget(name, opts.mainlines, opts.activeMainlineId)
    if (to !== null) return { kind: 'switch', from: opts.activeMainlineId, to, name, quote }
  }

  if (matchTable(prompt, normalized, DONE_HOP1_TABLE)) return { kind: 'doneHop1' }

  const channel = matchFuzzy(prompt)
  if (channel !== null) return { kind: 'fuzzy', channel, quote }

  return { kind: 'none' }
}

/**
 * 完成确认中间态推进（纯函数，两跳状态机）：
 * 第一跳置位（归属当前活跃主线，''=无主线全局待确认）、第二跳清空、
 * 其余动作保持原样（中间插入无关 prompt 不推进也不污染）。
 */
export function nextPendingDoneConfirm(
  prev: string | null,
  action: UpsAction,
  activeMainlineId: string | null,
): string | null {
  switch (action.kind) {
    case 'doneHop1':
      return activeMainlineId ?? ''
    case 'doneHop2':
      return null
    default:
      return prev
  }
}

/**
 * 事件构造（纯函数，与 T4 消费端契约对齐——escape.used/unlock 的 mainlineId
 * 必须等于门禁扫描的活跃主线，见 write-gate.hasUnconsumedUnlock）：
 * escape.used{quote} / unlock{context} / mainline.switch{from,to,name,mainlineId=to}。
 * 第一跳/第二跳不产生事件（hook 不翻转状态，attestation §6.3）。
 */
export function upsEvents(
  action: UpsAction,
  activeMainlineId: string | null,
  now: string,
): DevFlowEvent[] {
  switch (action.kind) {
    case 'escape':
      return [
        {
          type: 'escape.used',
          t: now,
          mainlineId: activeMainlineId ?? '',
          quote: action.quote,
        },
      ]
    case 'unlock':
      return [
        { type: 'unlock', t: now, mainlineId: activeMainlineId ?? '', context: action.context },
      ]
    case 'switch':
      return [
        {
          type: 'mainline.switch',
          t: now,
          mainlineId: action.to,
          from: action.from,
          to: action.to,
          name: action.name,
        },
      ]
    default:
      return []
  }
}

/** 温和注入文案（模糊语义，不写事件——模型多问一句，提示级成本） */
function fuzzyInjection(channel: UpsChannel, quote: string): string {
  switch (channel) {
    case 'escape':
      return `（提示：用户原话「${quote}」听起来想绕过流程直接修改，但表述不明确。请与用户确认是否放行直接改，确认后再执行。）`
    case 'switch':
      return `（提示：用户原话「${quote}」听起来想切换任务主线。请与用户确认要切到哪条线，确认后再开始新主线工作。）`
    case 'done':
      return `（提示：用户原话「${quote}」听起来像在说工作已完成。请与用户确认；若已完成，请展示待完成摘要并请求确认。）`
    case 'unlock':
      return `（提示：用户原话「${quote}」听起来像要对本次流程做终裁。请与用户确认其裁定后再继续。）`
  }
}

/**
 * 注入渲染（纯函数，hookSpecificOutput.additionalContext 载荷）：
 * 零注入（模式表外）返回 null；命中返回 channel 专属注入文本。
 */
export function renderUpsInjection(action: UpsAction): string | null {
  switch (action.kind) {
    case 'none':
      return null
    case 'doneHop1':
      return '用户表示当前工作已完成。请向用户展示本次改动的待完成摘要（改了什么、验证结果），并明确询问是否确认完成；用户确认前不要自行宣称完成。'
    case 'doneHop2':
      return '用户已确认完成。请执行验收（运行 verify 命令并确认通过），验收通过后调用 done 工具完成本次任务。'
    case 'escape':
      return `用户已通过逃生门放行（escape.used 已记账：「${action.quote}」）。按用户指示直接执行修改，无需再输出意图块声明。`
    case 'unlock':
      return `用户已终裁解锁（unlock 事件已记账：「${action.context}」）。按用户裁定继续执行，不再以流程原因为由驳回。`
    case 'switch':
      return `用户要求切换主线到「${action.name}」（mainline.switch 已记账）。当前活跃主线已切换，后续写入与治理归属新主线。`
    case 'fuzzy':
      return fuzzyInjection(action.channel, action.quote)
  }
}
