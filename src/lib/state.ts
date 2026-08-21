/**
 * 状态模块：state.json 的 schema、默认值、解析与读写（纯函数 + 薄 IO 壳）。
 *
 * 计划 §2.3：
 * - state.json 写者 6 处（gate-runner / UPS / post-tool-use×2 / MCP×2），真实
 *   并发：宿主并行派发工具调用（每个 hook 独立进程）+ MCP server 常驻进程。
 *   写原语 = 唯一 tmp 名 + rename 原子替换（不上锁：唯一名隔离写-写冲突，
 *   rename 有界重试吸收瞬时干扰；读-写时序的丢失更新不自愈——events 是事实源，
 *   缓存可重建，见 writeState 注释与 docs 并发说明）；
 * - 读 fail-open：非法 JSON/文件损坏 = 系统故障 → 警告 + 审计 + 空状态放行，
 *   绝不阻塞、绝不自修复（重建只走 doctor 手动触发）；
 * - additive-only 自律（§2.3）：字段只增、带默认值；读端对缺失字段给默认、
 *   对未知字段容忍保留（存 extra，写回时原样带回，不丢数据）。
 */

import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { auditWarning, ensureStateRoot } from './events.js'

/** 状态 schema 版本（首个稳定版 1；additive-only 演进，未知版本宽容） */
export const STATE_VERSION = 1

/** 主线（任务线）：软单主线，同一时间只有一条活跃（§9 术语） */
export interface Mainline {
  id: string
  /** 主线名称（来源 T5 演进，当前为空串占位） */
  name: string
  status: 'active' | 'suspended'
  createdAt: string
  updatedAt: string
  /** 最近一次完成宣称时间（T3 兜底检测参考；精确校验以 events 反向扫为准） */
  claimedAt: string | null
  /** 最近一次完成宣称被驳回时间 */
  rejectedAt: string | null
  /** 最后一次写入事件时间（缓存；T6 done 时序校验以 events 为准） */
  lastWriteAt: string | null
}

/** 需求条目（意图块按需求编号组织时的条目） */
export interface Requirement {
  id: string
  mainlineId: string
  /** 需求摘要（写入端截断 500 字符，红线 §3.5） */
  summary: string
  /** 验收命令声明（verify 声明；由 intent.declared / verify 事件维护） */
  verifyCommand: string | null
  status: 'declared' | 'blocked' | 'done'
  createdAt: string
  blockedAt: string | null
  blockedReason: string | null
  doneAt: string | null
}

/** 最近一次验收记录 */
export interface VerificationRecord {
  at: string
  exitCode: number | null
  command: string
  durationMs: number | null
  /** 退出原因（T6；verify.failed 时区分 timeout/killed/nonzero/unknown，passed 为 null） */
  exitReason: 'timeout' | 'killed' | 'nonzero' | 'unknown' | null
}

/** 状态根对象（additive-only：字段只增，旧状态缺字段一律给默认） */
export interface DevFlowState {
  version: number
  /** 状态最后更新时间（最后折叠的事件时间；空状态为 null） */
  updatedAt: string | null
  /** 活跃主线 id（软单主线；null = 尚无主线） */
  activeMainlineId: string | null
  mainlines: Record<string, Mainline>
  requirements: Requirement[]
  /** 治理强度缓存（0=未升级；升级语义 T4 细化，从事件近似重建） */
  governanceStrength: number
  /** 连败计数：连续"宣称完成被验收驳回"次数（§9；TDD 红灯不计的语义 T6 细化） */
  loseStreak: number
  /** 完成宣称锁（第一批无锁定动作，字段先落位，T6 启用） */
  doneLock: boolean
  /** 最近验收 */
  lastVerification: VerificationRecord | null
  /** 主线 id → 验收命令声明（声明演进：后者覆盖前者，§3.3） */
  verifyDeclarations: Record<string, string>
  /**
   * 用户通道完成确认中间态（T5，additive-only 新字段）：
   * 非事件派生（瞬态，events 重建不恢复——丢失无害）；写者仅 UPS hook。
   * null=未置位；''=无活跃主线场景的全局待确认；否则=待确认的主线 id。
   * 置位 → 下一轮精确确认短语才触发"请执行验收并调 done"（§3.3 两跳）。
   */
  pendingDoneConfirm: string | null
  /** 未知顶层字段容忍保留（additive-only：未来字段在旧 reader 上不丢） */
  extra: Record<string, unknown>
}

/** 空状态（默认值）。新字段在此给默认，保证 additive-only 读端契约。 */
export function defaultState(): DevFlowState {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    activeMainlineId: null,
    mainlines: {},
    requirements: [],
    governanceStrength: 0,
    loseStreak: 0,
    doneLock: false,
    lastVerification: null,
    verifyDeclarations: {},
    pendingDoneConfirm: null,
    extra: {},
  }
}

/** 已声明的顶层键（其余一律视为未知字段进 extra） */
const KNOWN_KEYS = new Set([
  'version',
  'updatedAt',
  'activeMainlineId',
  'mainlines',
  'requirements',
  'governanceStrength',
  'loseStreak',
  'doneLock',
  'lastVerification',
  'verifyDeclarations',
  'pendingDoneConfirm',
])

/** 宽容解析主线表：非法项丢弃，字段级缺省给默认 */
function parseMainlines(v: unknown): Record<string, Mainline> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, Mainline> = {}
  for (const [k, val] of Object.entries(v)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue
    const o = val as Record<string, unknown>
    out[k] = {
      id: k,
      name: typeof o.name === 'string' ? o.name : '',
      status: o.status === 'suspended' ? 'suspended' : 'active',
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
      claimedAt: typeof o.claimedAt === 'string' ? o.claimedAt : null,
      rejectedAt: typeof o.rejectedAt === 'string' ? o.rejectedAt : null,
      lastWriteAt: typeof o.lastWriteAt === 'string' ? o.lastWriteAt : null,
    }
  }
  return out
}

/** 宽容解析需求表：非法项丢弃，字段级缺省给默认 */
function parseRequirements(v: unknown): Requirement[] {
  if (!Array.isArray(v)) return []
  const out: Requirement[] = []
  for (const val of v) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue
    const o = val as Record<string, unknown>
    out.push({
      id: typeof o.id === 'string' ? o.id : '',
      mainlineId: typeof o.mainlineId === 'string' ? o.mainlineId : '',
      summary: typeof o.summary === 'string' ? o.summary : '',
      verifyCommand: typeof o.verifyCommand === 'string' ? o.verifyCommand : null,
      status: o.status === 'blocked' || o.status === 'done' ? o.status : 'declared',
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      blockedAt: typeof o.blockedAt === 'string' ? o.blockedAt : null,
      blockedReason: typeof o.blockedReason === 'string' ? o.blockedReason : null,
      doneAt: typeof o.doneAt === 'string' ? o.doneAt : null,
    })
  }
  return out
}

/** 宽容解析最近验收记录：非对象 → null */
function parseVerification(v: unknown): VerificationRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  return {
    at: typeof o.at === 'string' ? o.at : '',
    exitCode: typeof o.exitCode === 'number' ? o.exitCode : null,
    command: typeof o.command === 'string' ? o.command : '',
    durationMs: typeof o.durationMs === 'number' ? o.durationMs : null,
    exitReason:
      o.exitReason === 'timeout' || o.exitReason === 'killed' || o.exitReason === 'nonzero' || o.exitReason === 'unknown'
        ? o.exitReason
        : null,
  }
}

/** 宽容解析字符串表：非字符串值跳过 */
function parseStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val
  }
  return out
}

export interface ParseStateResult {
  ok: boolean
  state: DevFlowState
  /** 解析失败详情（ok=false 时）：调用方记审计后按空状态放行 */
  failure?: { kind: 'corrupt' | 'invalid'; detail: string }
}

/**
 * 解析 state.json 文本（纯函数）：合法 → 宽容解析（缺字段默认、未知字段保留）；
 * 非法 JSON → corrupt；顶层非对象 → invalid。失败均返回空状态（fail-open）。
 */
export function parseState(raw: string): ParseStateResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      ok: false,
      state: defaultState(),
      failure: { kind: 'corrupt', detail: `JSON 解析失败：${String(err)}` },
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      state: defaultState(),
      failure: { kind: 'invalid', detail: '顶层不是 JSON 对象' },
    }
  }
  const o = parsed as Record<string, unknown>
  const state = defaultState()
  if (typeof o.version === 'number') state.version = o.version
  if (typeof o.updatedAt === 'string') state.updatedAt = o.updatedAt
  if (typeof o.activeMainlineId === 'string') state.activeMainlineId = o.activeMainlineId
  state.mainlines = parseMainlines(o.mainlines)
  state.requirements = parseRequirements(o.requirements)
  // 非负校验：损坏数据（负数）不污染状态，回退默认
  if (typeof o.governanceStrength === 'number' && o.governanceStrength >= 0) {
    state.governanceStrength = o.governanceStrength
  }
  if (typeof o.loseStreak === 'number' && o.loseStreak >= 0) {
    state.loseStreak = o.loseStreak
  }
  if (typeof o.doneLock === 'boolean') state.doneLock = o.doneLock
  const v = parseVerification(o.lastVerification)
  if (v !== null) state.lastVerification = v
  state.verifyDeclarations = parseStringMap(o.verifyDeclarations)
  state.pendingDoneConfirm = typeof o.pendingDoneConfirm === 'string' ? o.pendingDoneConfirm : null
  // additive-only：未知顶层字段容忍保留（写回时原样带回，不丢数据）
  for (const [k, val] of Object.entries(o)) {
    if (!KNOWN_KEYS.has(k)) state.extra[k] = val
  }
  return { ok: true, state }
}

/**
 * 序列化状态（纯函数）：未知字段（extra）展开回顶层原位置，
 * 已知字段覆盖同名冲突——未来版本的字段在旧 reader 写回时不丢。
 */
function serializeState(state: DevFlowState): string {
  const { extra, ...known } = state
  return JSON.stringify({ ...extra, ...known }, null, 2) + '\n'
}

/** 残留 tmp 匹配：旧版固定名（state.json.tmp）+ 本版唯一名（state.json.<pid>.<n>.<rand>.tmp） */
const STALE_TMP_RE = /^state\.json(\..*)?\.tmp$/

/** 残留 tmp 视为崩溃遗留的 mtime 年龄阈值：write→rename 窗口是微秒级，超过该阈值
 * 不可能是并发写者的在途 tmp，只可能是崩溃/中断留下的孤儿 */
const STALE_TMP_AGE_MS = 10_000

/**
 * 每次写清理一次历史残留（崩溃遗留/旧版固定名）。只清「老的」：mtime 超过
 * STALE_TMP_AGE_MS 才算残留；并发写者刚 writeFileSync、还没 rename 的在途 tmp
 * mtime 是新的，绝不误删——返修：先前清光全部匹配 tmp，会把并发进程的在途 tmp
 * 删掉，重新制造本修复要消灭的 rename ENOENT。best-effort：失败静默，绝不抛错。
 */
function sweepStaleTmp(root: string): void {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    if (!STALE_TMP_RE.test(name)) continue
    try {
      const st = statSync(join(root, name))
      if (now - st.mtimeMs <= STALE_TMP_AGE_MS) continue // 在途/刚写完：不动
      rmSync(join(root, name), { force: true })
    } catch {
      // 尽力清理：并发写者可能已自己清掉/正在 rename，失败不抛新错
    }
  }
}

/** 进程内 tmp 名计数（配合 pid/随机数，同进程多次写与重试也互不重名） */
let tmpCounter = 0

/** 唯一 tmp 名：pid 隔离跨进程写者，进程内计数 + 随机数隔离同进程多次写 */
function uniqueTmpPath(root: string): string {
  tmpCounter += 1
  const rand = Math.random().toString(36).slice(2, 10)
  return join(root, `state.json.${process.pid}.${tmpCounter}.${rand}.tmp`)
}

/** 写原语重试上限：初始 1 次 + 最多 2 次重建重试（有界，失败仍抛错由调用方 fail-open 兜底） */
const MAX_RENAME_ATTEMPTS = 3

/**
 * 原子写 state.json（唯一 tmp 名 + rename；同目录 rename 为原子操作）。
 *
 * 并发写者现实（P0 实证：24 条 rename ENOENT，与并行 Bash 工具调用簇重叠）：
 * - 旧版固定 tmp 名在并发下互踩：P1 rename 吃掉 tmp 后，P2 rename 同名即 ENOENT。
 *   本版 tmp 名带进程唯一后缀（pid + 计数 + 随机），并发写者互不干扰；
 * - rename 失败有界重试（重建 tmp 再 rename，上限 MAX_RENAME_ATTEMPTS）；
 * - 写前 best-effort 清理历史残留 tmp（旧版固定名 + 本版唯一名，失败不抛错）；
 * - 重试耗尽 → 尽力清理自己的 tmp（失败不抛新错）后抛错——语义不变：同步、
 *   抛错给上层 catch（fail-open 由调用方兜底，如 gate-runner/mcp-server）。
 *
 * 崩溃窗口只剩两种：写完 tmp 未 rename（残留由下次写清理）、rename 已完成
 * （状态为新值）。注：读-写时序的丢失更新（P2 基于旧 state 折叠覆盖 P1）在本版
 * 不修——events 是事实源、state 是缓存，折叠丢失可由 doctor 以 events 重建兜底。
 */
export function writeState(root: string, state: DevFlowState): void {
  ensureStateRoot(root)
  sweepStaleTmp(root)
  const targetPath = join(root, 'state.json')
  const payload = serializeState(state)
  let tmpPath = uniqueTmpPath(root)
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= MAX_RENAME_ATTEMPTS; attempt++) {
    try {
      writeFileSync(tmpPath, payload, 'utf8')
      renameSync(tmpPath, targetPath)
      return
    } catch (err) {
      lastErr = err
      // 本轮失败：清掉自己的 tmp（尽力），重建后重试（rename 失败多为并发瞬时干扰）
      try {
        rmSync(tmpPath, { force: true })
      } catch {
        // 尽力清理，失败不抛新错
      }
      if (attempt < MAX_RENAME_ATTEMPTS) tmpPath = uniqueTmpPath(root)
    }
  }
  throw lastErr
}

export interface LoadStateResult {
  state: DevFlowState
  /** true=正常（含文件不存在的首次运行）；false=系统故障（已写审计） */
  ok: boolean
  failure?: { kind: 'corrupt' | 'invalid' | 'unreadable'; detail: string }
}

/**
 * fail-open 读 state.json（薄壳）：
 * - 文件不存在 → 空状态，静默（首次运行，非故障，不写审计）；
 * - 文件损坏/非法 → 空状态 + audit.warning 审计事件，放行不阻塞，绝不自修复；
 * - 合法 → 宽容解析结果。
 */
export function loadState(root: string): LoadStateResult {
  ensureStateRoot(root)
  let raw: string
  try {
    raw = readFileSync(join(root, 'state.json'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: defaultState(), ok: true }
    }
    const detail = String(err)
    auditWarning(root, `state.json 读取故障（unreadable）：${detail}，已按空状态放行`, 'state')
    return { state: defaultState(), ok: false, failure: { kind: 'unreadable', detail } }
  }
  const parsed = parseState(raw)
  if (!parsed.ok) {
    const failure = parsed.failure!
    auditWarning(
      root,
      `state.json 损坏（${failure.kind}）：${failure.detail}，已按空状态放行（不自修复，重建走 doctor）`,
      'state',
    )
    return { state: defaultState(), ok: false, failure }
  }
  return { state: parsed.state, ok: true }
}
