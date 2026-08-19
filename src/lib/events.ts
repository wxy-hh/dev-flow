/**
 * 事件模块：事件类型（13 个判别联合）、sanitizeEvent 纯函数（红线执行点）、
 * events.jsonl 的 append/读取壳。
 *
 * 计划 §2.3 / §3.5：
 * - events.jsonl 是事实源（state 只是缓存），所有 hook 同步 append（<1KiB/行，微秒级）；
 * - 记事实不记内容（红线）：载荷只记 路径/工具名/退出码/时间戳/主线 id/命中规则名/
 *   用户原话（截断 500 字符）；永不记文件内容（content 类字段在白名单外，白名单
 *   提取天然丢弃）；命令输出只留尾部 ≤20 行、行内防御截断；
 * - 读 fail-open：坏行（含崩溃截断的半行）跳过计数不阻塞，交调用方审计。
 *
 * 状态根初始化（ensureStateRoot）也在此：append 是一切 hook 的公共写前置，
 * 状态根自包含隔离（.dev-flow/.gitignore 内容 `*`），绝不碰业务仓 .gitignore。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 事件类型白名单（12+1 预算封顶，§3.5；新增必答三问，超预算先砍） */
export const EVENT_TYPES = [
  'session.start',
  'intent.declared',
  'intent.blocked',
  'write.allowed',
  'write.blocked',
  'file.changed',
  'verify.passed',
  'verify.failed',
  'done.claimed',
  'done.rejected',
  'escape.used',
  'unlock',
  'mainline.switch',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** 事件共同字段：时间戳 + 归属主线（缺失给 ''，重建时忽略空 id） */
export interface EventBase {
  /** ISO 时间戳（载荷缺失时由 sanitize 用传入的 now 兜底） */
  t: string
  /** 归属主线 id；未知/无主线时为空串 */
  mainlineId: string
}

/** 证据链事件（13 个判别联合，§3.5 事件清单；载荷字段即白名单） */
export type DevFlowEvent =
  | (EventBase & {
      type: 'session.start'
      sessionId: string
      source: string | null
    })
  | (EventBase & {
      type: 'intent.declared'
      requirementId: string | null
      /** 做什么（用户/模型原话，截断 500 字符） */
      summary: string
      /** 验收命令声明（verify 第四要素） */
      verifyCommand: string | null
      /** 风险标签（截断 500 字符） */
      risk: string | null
      /** 预计动哪些文件（路径清单，防御上限 20 项） */
      files: string[]
    })
  | (EventBase & {
      type: 'intent.blocked'
      requirementId: string | null
      /** 拦截理由/模板（截断 500 字符） */
      reason: string
      /** 命中规则名（事实字段） */
      rule: string
    })
  | (EventBase & {
      type: 'write.allowed'
      tool: string
      path: string
      rule: string | null
    })
  | (EventBase & { type: 'write.blocked'; tool: string; path: string; rule: string })
  | (EventBase & { type: 'file.changed'; tool: string; path: string })
  | (EventBase & {
      type: 'verify.passed'
      requirementId: string | null
      exitCode: number
      command: string
      durationMs: number | null
    })
  | (EventBase & {
      type: 'verify.failed'
      requirementId: string | null
      exitCode: number | null
      command: string
      durationMs: number | null
      /** 命令输出尾部 ≤20 行（红线：不记完整输出） */
      outputTail: string[]
      /**
       * 退出原因（T6，坑 N-4/8-12-10b）：超时/被杀/非零退出码分开记账，
       * 超时挂死绝不被归一为普通失败。timeout=宿主超时杀掉（error 含
       * "Command timed out"）；killed=用户中断/abort（is_interrupt 或
       * tool_response.interrupted）；nonzero=命令正常退出但退出码非 0；
       * unknown=宿主没给退出码也没给超时标记（如无法启动 shell）。
       */
      exitReason: 'timeout' | 'killed' | 'nonzero' | 'unknown' | null
    })
  | (EventBase & {
      type: 'done.claimed'
      requirementId: string | null
      /** 宣称通道：tool / user / resume（T3/T6 定值） */
      channel: string | null
    })
  | (EventBase & { type: 'done.rejected'; reason: string })
  | (EventBase & { type: 'escape.used'; quote: string })
  | (EventBase & { type: 'unlock'; context: string })
  | (EventBase & {
      type: 'mainline.switch'
      from: string | null
      to: string
      /** 新主线名（T5：来源=用户原话提取，提不出用截断原话占位；additive 字段） */
      name: string | null
    })

/** 审计警告事件：系统内部事件，不占 12+1 业务预算（fail-open 故障记录通道） */
export interface AuditWarningEvent {
  type: 'audit.warning'
  t: string
  /** 告警来源（state / append / rebuild 等） */
  source: string
  /** 内部构造的短消息（非用户/模型内容，可安全入链） */
  detail: string
}

/** 用户原话/自由文本截断上限（§3.5 红线：500 字符） */
export const MAX_QUOTE_LEN = 500
/** 命令输出尾部保留行数（§3.5 红线：≤20 行） */
export const MAX_OUTPUT_LINES = 20
/** 输出行内防御截断（配合 1KiB/行约束，防单行输出爆掉行预算） */
export const MAX_OUTPUT_LINE_LEN = 200
/** 意图块文件清单防御上限 */
export const MAX_FILES = 20
/** events.jsonl 单行字节上限（§2.3 <1KiB/行；超长逐级降级，见 fitLine） */
export const MAX_LINE_BYTES = 1024

/** 自由文本键：超长降级时可安全丢弃的冗余字段（事实字段永远保留） */
const FREE_TEXT_KEYS = new Set([
  'summary',
  'reason',
  'quote',
  'context',
  'risk',
  'command',
  'outputTail',
  'requirementId',
  'sessionId',
  'source',
])

/** 只接受 string 值；其余类型视为缺失返回 null（白名单提取不转类型，防内容混入） */
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** 截断到 n 字符（超长直接切尾；500 字符红线的执行点） */
function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s
}

/** string 字段 + 截断（缺失 → null） */
function strCut(v: unknown, n: number): string | null {
  const s = str(v)
  return s === null ? null : cut(s, n)
}

/** 数组字段防御：只取 string 项，超上限截尾 */
function strArray(v: unknown, maxItems: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item === 'string') out.push(item)
    if (out.length >= maxItems) break
  }
  return out
}

/**
 * 命令输出归一：接收 string（整段输出）或 string[]（已分行），
 * 取尾部 ≤MAX_OUTPUT_LINES 行、每行保留开头 ≤MAX_OUTPUT_LINE_LEN 字符
 * （§3.5 红线：命令输出只留尾部 ≤20 行）。
 */
function outputTail(v: unknown): string[] {
  const lines: string[] = []
  if (typeof v === 'string') {
    lines.push(...v.split('\n'))
  } else if (Array.isArray(v)) {
    for (const item of v) if (typeof item === 'string') lines.push(item)
  }
  const tail = lines.length > MAX_OUTPUT_LINES ? lines.slice(-MAX_OUTPUT_LINES) : lines
  return tail.map((l) => cut(l, MAX_OUTPUT_LINE_LEN))
}

/** 退出原因白名单（T6）：只接受四个枚举值，其余（含缺失/畸形）→ null（宽容，不崩溃） */
function exitReasonOf(v: unknown): 'timeout' | 'killed' | 'nonzero' | 'unknown' | null {
  return v === 'timeout' || v === 'killed' || v === 'nonzero' || v === 'unknown' ? v : null
}

export type SanitizeResult =
  | { ok: true; event: DevFlowEvent }
  | { ok: false; reason: string }

/**
 * 事件清洗纯函数（写 events.jsonl 前的强制关卡，红线执行点）：
 * 白名单字段提取（未声明字段一律丢弃 → 永不记文件内容）+ 截断规则 + 类型校验。
 * 畸形载荷（非对象/未知类型/字段类型错）→ ok:false，调用方记审计、不阻塞。
 * now 为时间戳兜底（载荷无 t 时用），由调用方注入，保持纯函数确定性。
 */
export function sanitizeEvent(raw: unknown, now: string): SanitizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: '载荷不是对象' }
  }
  const o = raw as Record<string, unknown>
  const type = o.type
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: `未知事件类型：${String(type)}` }
  }
  const t = str(o.t) ?? now
  const mainlineId = str(o.mainlineId) ?? ''
  const requirementId = str(o.requirementId) ?? null

  switch (type as EventType) {
    case 'session.start':
      return {
        ok: true,
        event: {
          type: 'session.start',
          t,
          mainlineId,
          sessionId: str(o.sessionId) ?? '',
          source: str(o.source) ?? null,
        },
      }
    case 'intent.declared':
      return {
        ok: true,
        event: {
          type: 'intent.declared',
          t,
          mainlineId,
          requirementId,
          summary: strCut(o.summary, MAX_QUOTE_LEN) ?? '',
          verifyCommand: str(o.verifyCommand) ?? null,
          risk: strCut(o.risk, MAX_QUOTE_LEN),
          files: strArray(o.files, MAX_FILES),
        },
      }
    case 'intent.blocked':
      return {
        ok: true,
        event: {
          type: 'intent.blocked',
          t,
          mainlineId,
          requirementId,
          reason: strCut(o.reason, MAX_QUOTE_LEN) ?? '',
          rule: str(o.rule) ?? '',
        },
      }
    case 'write.allowed':
      return {
        ok: true,
        event: {
          type: 'write.allowed',
          t,
          mainlineId,
          tool: str(o.tool) ?? '',
          path: str(o.path) ?? '',
          rule: str(o.rule) ?? null,
        },
      }
    case 'write.blocked':
      return {
        ok: true,
        event: {
          type: 'write.blocked',
          t,
          mainlineId,
          tool: str(o.tool) ?? '',
          path: str(o.path) ?? '',
          rule: str(o.rule) ?? '',
        },
      }
    case 'file.changed':
      return {
        ok: true,
        event: {
          type: 'file.changed',
          t,
          mainlineId,
          tool: str(o.tool) ?? '',
          path: str(o.path) ?? '',
        },
      }
    case 'verify.passed':
      return {
        ok: true,
        event: {
          type: 'verify.passed',
          t,
          mainlineId,
          requirementId,
          exitCode: typeof o.exitCode === 'number' ? o.exitCode : 0,
          command: str(o.command) ?? '',
          durationMs: typeof o.durationMs === 'number' ? o.durationMs : null,
        },
      }
    case 'verify.failed':
      return {
        ok: true,
        event: {
          type: 'verify.failed',
          t,
          mainlineId,
          requirementId,
          exitCode: typeof o.exitCode === 'number' ? o.exitCode : null,
          command: str(o.command) ?? '',
          durationMs: typeof o.durationMs === 'number' ? o.durationMs : null,
          outputTail: outputTail(o.output),
          exitReason: exitReasonOf(o.exitReason),
        },
      }
    case 'done.claimed':
      return {
        ok: true,
        event: {
          type: 'done.claimed',
          t,
          mainlineId,
          requirementId,
          channel: str(o.channel) ?? null,
        },
      }
    case 'done.rejected':
      return {
        ok: true,
        event: {
          type: 'done.rejected',
          t,
          mainlineId,
          reason: strCut(o.reason, MAX_QUOTE_LEN) ?? '',
        },
      }
    case 'escape.used':
      return {
        ok: true,
        event: {
          type: 'escape.used',
          t,
          mainlineId,
          quote: strCut(o.quote, MAX_QUOTE_LEN) ?? '',
        },
      }
    case 'unlock':
      return {
        ok: true,
        event: {
          type: 'unlock',
          t,
          mainlineId,
          context: strCut(o.context, MAX_QUOTE_LEN) ?? '',
        },
      }
    case 'mainline.switch':
      return {
        ok: true,
        event: {
          type: 'mainline.switch',
          t,
          mainlineId,
          from: str(o.from) ?? null,
          to: str(o.to) ?? '',
          name: strCut(o.name, MAX_QUOTE_LEN),
        },
      }
  }
}

/**
 * 事件行适配（纯函数）：序列化后超 1KiB 时逐级降级——
 * ① 丢命令输出细节（outputTail）② 丢自由文本字段（用户原话/命令等，
 * 路径/工具名/退出码/时间戳/主线 id 等事实字段保留）；仍超返回 null（调用方审计丢弃）。
 */
export function fitLine(event: DevFlowEvent): string | null {
  const base = JSON.stringify(event)
  if (base.length <= MAX_LINE_BYTES) return base
  if ('outputTail' in event) {
    const { outputTail: _dropped, ...rest } = event
    const slim = JSON.stringify(rest)
    if (slim.length <= MAX_LINE_BYTES) return slim
  }
  const minimal: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(event)) {
    if (FREE_TEXT_KEYS.has(k)) continue
    minimal[k] = v
  }
  const min = JSON.stringify(minimal)
  return min.length <= MAX_LINE_BYTES ? min : null
}

export interface AppendResult {
  ok: boolean
  /** sanitize 拒绝原因（ok=false 时） */
  reason?: string
  /** 实际写入字节数（含换行） */
  bytes?: number
  /** 是否发生超长降级（丢输出/自由文本） */
  degraded?: boolean
}

/**
 * 同步 append 一条事件（薄壳：sanitize → fitLine → appendFileSync）。
 * sanitize 拒绝 → 写 audit.warning 审计，不写业务事件、不阻塞。
 * 超长 → fitLine 逐级降级；降无可降 → audit 丢弃。
 */
export function appendEvent(
  root: string,
  raw: unknown,
  now = new Date().toISOString(),
): AppendResult {
  ensureStateRoot(root)
  const r = sanitizeEvent(raw, now)
  if (!r.ok) {
    auditWarning(root, `事件被 sanitize 拒绝（${r.reason}），未写入证据链`, 'append')
    return { ok: false, reason: r.reason }
  }
  const full = JSON.stringify(r.event)
  const line = full.length <= MAX_LINE_BYTES ? full : fitLine(r.event)
  if (line === null) {
    auditWarning(
      root,
      `事件（${r.event.type}）超长且降级后仍超 ${MAX_LINE_BYTES}B，已丢弃`,
      'append',
    )
    return { ok: false, reason: '超长且不可适配' }
  }
  appendFileSync(join(root, 'events.jsonl'), line + '\n', 'utf8')
  return { ok: true, bytes: line.length + 1, degraded: full.length > MAX_LINE_BYTES }
}

export interface ReadEventsResult {
  /** 干净的业务事件（坏行/非业务行已跳过） */
  events: DevFlowEvent[]
  /** 损坏行数（parse 失败，含崩溃截断的半行）——fail-open，不阻塞 */
  skipped: number
  /** 非 ENOENT 的读取故障（fail-open：返回空并交调用方审计） */
  readError: string | null
}

/**
 * 读取 events.jsonl（薄壳）：逐行 parse，坏行（半行截断/非法 JSON）跳过计数；
 * 未知类型/审计行忽略（宽容：未来事件类型不阻塞旧 reader，且 audit 不参与重建）。
 */
export function readEvents(root: string): ReadEventsResult {
  ensureStateRoot(root)
  let raw: string
  try {
    raw = readFileSync(join(root, 'events.jsonl'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], skipped: 0, readError: null }
    }
    return { events: [], skipped: 0, readError: String(err) }
  }
  const events: DevFlowEvent[] = []
  let skipped = 0
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    const type = (parsed as { type?: unknown }).type
    if (typeof type === 'string' && (EVENT_TYPES as readonly string[]).includes(type)) {
      events.push(parsed as DevFlowEvent)
    }
    // 其余（audit.warning、未来类型）：宽容忽略，不参与重建
  }
  return { events, skipped, readError: null }
}

/**
 * 审计警告事件（系统内部事件，不占业务预算）：fail-open 故障的记录通道。
 * detail 为内部构造的短消息（非用户/模型内容），可安全入链。
 */
export function auditWarning(root: string, detail: string, source = 'state'): void {
  ensureStateRoot(root)
  const ev: AuditWarningEvent = {
    type: 'audit.warning',
    t: new Date().toISOString(),
    source,
    detail,
  }
  appendFileSync(join(root, 'events.jsonl'), JSON.stringify(ev) + '\n', 'utf8')
}

/**
 * 单主线事实投影（SessionStart 恢复播报 / done 兜底检测的数据面，§3.1/§3.3）：
 * 从 events 尾扫提取。events 是事实源、state 是缓存——时序事实（最后写入/最近
 * 验收/宣称痕迹）一律以 events 为准，不读 state 缓存字段（§3.3"以 events 反向扫为准"）。
 */
export interface MainlineFacts {
  /** 最后写入事件时间（write.allowed / write.blocked / file.changed） */
  lastWriteAt: string | null
  /** 最近一次 verify.passed 时间 */
  lastVerifyPassedAt: string | null
  /**
   * 最近一次完成宣称痕迹（T6，C 项时间序语义）：claimed=最近是宣称通过
   * （已关闭，抑制播报与兜底）；rejected=最近是驳回（未关闭，兜底可触发）；
   * null=无痕迹。反向扫"先到者即最新"，后到不覆盖（foldFact 只填 null 位）。
   */
  lastClaimOrReject: 'claimed' | 'rejected' | null
  /** 最近一次 verify.failed（播报"还差什么"用；含退出码与命令） */
  lastVerifyFailed: { t: string; exitCode: number | null; command: string } | null
  /** 最后一条"进展"事件（意图/写入/验收），播报"做到哪一步"的来源 */
  lastProgress: { type: string; t: string } | null
}

/** 空事实（无事件主线 / 扫描起始值） */
export function emptyFacts(): MainlineFacts {
  return {
    lastWriteAt: null,
    lastVerifyPassedAt: null,
    lastClaimOrReject: null,
    lastVerifyFailed: null,
    lastProgress: null,
  }
}

/** 进展事件类型（构成"做到哪一步"的事实；session.start/escape/mainline.switch 等不算进展） */
const PROGRESS_TYPES = new Set([
  'intent.declared',
  'intent.blocked',
  'write.allowed',
  'write.blocked',
  'file.changed',
  'verify.passed',
  'verify.failed',
])

/** 尾扫必要事实集齐即停（性能 §3.3：反向扫 + 早退） */
function factsComplete(facts: MainlineFacts): boolean {
  return (
    facts.lastWriteAt !== null &&
    facts.lastVerifyPassedAt !== null &&
    facts.lastClaimOrReject !== null &&
    facts.lastProgress !== null
  )
}

/**
 * 单事件折叠进事实（纯函数；反向扫语义：先到者即最新，故只填 null 位，后到不覆盖）。
 */
export function foldFact(facts: MainlineFacts, ev: DevFlowEvent): void {
  switch (ev.type) {
    case 'write.allowed':
    case 'write.blocked':
    case 'file.changed':
      if (facts.lastWriteAt === null) facts.lastWriteAt = ev.t
      break
    case 'verify.passed':
      if (facts.lastVerifyPassedAt === null) facts.lastVerifyPassedAt = ev.t
      break
    case 'verify.failed':
      if (facts.lastVerifyFailed === null) {
        facts.lastVerifyFailed = { t: ev.t, exitCode: ev.exitCode, command: ev.command }
      }
      break
    case 'done.claimed':
      if (facts.lastClaimOrReject === null) facts.lastClaimOrReject = 'claimed'
      break
    case 'done.rejected':
      if (facts.lastClaimOrReject === null) facts.lastClaimOrReject = 'rejected'
      break
    default:
      // 其余类型不构成主线进展事实（session.start/escape/mainline.switch 等）
  }
  if (PROGRESS_TYPES.has(ev.type) && facts.lastProgress === null) {
    facts.lastProgress = { type: ev.type, t: ev.t }
  }
}

/**
 * 纯函数：事件数组反向扫，提取单主线事实（早退：必需事实集齐即停）。
 * 他主线事件不计入；无该主线事件 → 空事实。
 */
export function scanMainlineFacts(events: DevFlowEvent[], mainlineId: string): MainlineFacts {
  const facts = emptyFacts()
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.mainlineId !== mainlineId) continue
    foldFact(facts, ev)
    if (factsComplete(facts)) break
  }
  return facts
}

export interface ScanTailResult {
  facts: MainlineFacts
  /** 损坏行数（parse 失败，含崩溃截断的半行）——fail-open，不阻塞 */
  skipped: number
  /** 非 ENOENT 的读取故障（fail-open：返回空事实并交调用方审计） */
  readError: string | null
}

/**
 * IO 薄壳：读 events.jsonl 尾扫（反向早退，性能 §3.3；state 只读一次、events 尾扫）。
 * fail-open：坏行跳过并审计、读取故障返回空事实并审计、文件缺失静默（首次运行）——绝不阻塞。
 */
export function scanEventsTail(root: string, mainlineId: string): ScanTailResult {
  ensureStateRoot(root)
  let raw: string
  try {
    raw = readFileSync(join(root, 'events.jsonl'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { facts: emptyFacts(), skipped: 0, readError: null }
    }
    const detail = String(err)
    auditWarning(root, `events.jsonl 尾扫读取故障：${detail}，已按空事实放行`, 'scan')
    return { facts: emptyFacts(), skipped: 0, readError: detail }
  }
  const facts = emptyFacts()
  let skipped = 0
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    const type = (parsed as { type?: unknown }).type
    if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) continue
    const ev = parsed as DevFlowEvent
    if (ev.mainlineId !== mainlineId) continue
    foldFact(facts, ev)
    if (factsComplete(facts)) break
  }
  if (skipped > 0) {
    auditWarning(root, `events.jsonl 尾扫跳过 ${skipped} 行损坏/截断记录（fail-open）`, 'scan')
  }
  return { facts, skipped, readError: null }
}

/**
 * 确保状态根存在 + 首次运行自创建 .gitignore（内容 `*`）。
 * 自包含隔离（§2.3）：.dev-flow/ 独立 gitignore 自己，绝不写业务仓 .gitignore；
 * 已有 .gitignore 时绝不覆盖（尊重手改）。
 */
export function ensureStateRoot(root: string): void {
  mkdirSync(root, { recursive: true })
  const gitignorePath = join(root, '.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n', 'utf8')
  }
}
