/**
 * PreToolUse 写门禁主决策模块（计划 §3.1/§3.2/§3.4/§3.7，T4 本批最重拦截机制）
 *
 * 主通道"一拦二放+审计"（spike L1-2 裁决落定）：
 * - 本主线首次写入且无意图块声明 → deny（理由附四要素模板，fail-visible）；
 * - 模型重试（同主线有未被消费的 intent.blocked）→ 放行，记 intent.blocked
 *   重试标注 + write.allowed。重试通行证是一次性的（P1 修复"一次拦截终身
 *   放行"语义漂移）：被拦后的放行只覆盖紧接着的那一次重试（写入事件落账即
 *   消费），且跨会话边界作废（session.start 后首次写入重新要求意图块）——
 *   要堵的是"从未声明却一路放行"；已声明主线上的后续写入放行是设计本意，
 *   不受会话边界影响；
 * - transcript 检测为放行加分项（限定 assistant text 块，见 transcript.ts），
 *   命中记 intent.declared（尽力提取 verify 命令，声明演进后者覆盖前者）；
 * - 读不到/解析失败不影响主通道（不把拦截押在实时 transcript 上）。
 *
 * 隐式主线（P0 修复"无主线自锁死链"）：主线只由 UserPromptSubmit 窄短语切换
 * 创建，真实用户直接下任务从不命中 → 全程无主线（verify 零记账、file.changed
 * 不记、done 必驳回、恢复播报为空）。assignImplicitMainline 在事件落账前把
 * 无活跃主线时的首条 intent.declared 归入自动生成的主线 id
 * （ml-<时间戳>-<进程唯一后缀>，同毫秒并发进程 id 必不同），事件流仍是事实源，
 * rebuild 天然确定可重放（确定性靠 id 烘焙进事件，不靠同 now 同 id）。
 *
 * 敏感路径升级语义（§3.4）：写敏感路径 ∧ 已声明该路径（事件声明 files ∪
 * transcript 声明 files 覆盖目标）→ 放行 + write.allowed 带命中规则名
 * （governanceStrength 只升不降，折叠层处理）；未声明 → deny（理由=声明模板
 * + "或用户一句话放行"）。
 *
 * 用户一句话放行出口（§3.7，T4 先写消费端）：events 尾有未被消费的
 * unlock/escape.used（其后无 write.allowed/write.blocked/file.changed）→ 放行，
 * 该事件被消费（消费事实由后续事件序隐含，无独立标记）。
 *
 * 全部判断为纯函数（events/state/config/transcript 由调用方注入）；本模块无 IO。
 * Bash 入口复用本模块：逐解析目标判定，任一 deny 则整命令 deny。
 */

import {
  declaredFilesCoverPath,
  matchSensitivePath,
  resolveWritePath,
  type SensitiveRule,
} from './sensitive-paths.js'
import { analyzeBashCommand } from './bash-gate.js'
import { isAbsolute, join, relative } from 'node:path'
import type { DevFlowConfig } from './config.js'
import type { DevFlowEvent } from './events.js'
import type { DevFlowState } from './state.js'
import type { TranscriptIntent } from './transcript.js'

/** 门禁工具名（PreToolUse 三类写工具 + Bash） */
export type GateTool = 'Write' | 'Edit' | 'MultiEdit' | 'Bash'

/** 四要素模板（首拦理由，fail-visible：模型据模板改正，spike L3 实证） */
export const INTENT_GATE_TEMPLATE = `未检测到意图块。第一次写入前必须先输出意图块（以「#意图块」开头，2-3 行）：
做什么 / 预计动哪些文件 / 敏感路径与风险标签 / verify 命令（怎么算完成）。
verify 命令写可原样执行的单条命令（如 pnpm test），不要反引号、不要自然语言描述。
输出意图块后重试本次写入即可。`

/** 敏感路径拦截理由（声明模板 + 用户一句话放行双出口） */
export function sensitiveDenyReason(path: string, rule: string): string {
  return `写入目标 ${path} 命中敏感路径（规则：${rule}）。请先输出意图块声明它（以「#意图块」开头：做什么 / 预计动哪些文件 / 敏感路径与风险标签 / verify 命令），声明后重试即可；或由用户一句话放行（如"直接改，我授权"）。`
}

/** 不可逆操作拦截理由（防线③：需用户亲自执行或一句话授权） */
export function irreversibleDenyReason(rule: string): string {
  return `命令属于不可逆操作（${rule}），需用户亲自执行或用户一句话授权（如"我授权你执行"）。`
}

/** 单路径门禁的上下文（Write/Edit/MultiEdit 与 Bash 逐目标共用） */
export interface GateContext {
  tool: GateTool
  /** 写入目标（Write 的 file_path / Bash 解析目标；未归一化原文） */
  rawPath: string
  /** Bash 原始命令（审计/理由用；非 Bash 为 null） */
  command: string | null
  mainlineId: string
  cwd: string
  pluginRoot: string | null
  state: DevFlowState
  events: DevFlowEvent[]
  config: DevFlowConfig
  transcript: TranscriptIntent | null
  now: string
}

export interface GateResult {
  decision: 'allow' | 'deny'
  reason: string | null
  /** 待 append 的事件（append 序 = 因果序） */
  events: DevFlowEvent[]
}

/** 主线意图扫描结果（反向扫，各自取最新一条） */
interface IntentScan {
  declared: { exists: boolean; files: string[]; verifyCommand: string | null }
  /**
   * 重试通行证（P1：一次性语义）——最近一次 intent.blocked 之后无写入事件
   * （未被消费）且未跨会话边界（session.start 后作废）。只覆盖被拦后紧接着
   * 的那一次重试，不是后续所有写入的永久通行证。
   */
  blockedRetry: boolean
}

/**
 * 反向扫主线意图痕迹（events 是事实源；state 是缓存，不参与判定）。
 * 声明（declared）与重试通行证（blockedRetry）独立判定：
 * - declared 不受会话边界影响——已声明主线上的后续写入放行是设计本意，
 *   compact/新会话不重新要求意图块；
 * - blockedRetry 遇写入事件（已消费）或 session.start（会话边界，跨主线生效）
 *   即结清——"从未声明却一路放行"是语义漂移，必须堵住。
 */
function scanIntent(events: DevFlowEvent[], mainlineId: string): IntentScan {
  let declared: IntentScan['declared'] = { exists: false, files: [], verifyCommand: null }
  let blockedRetry = false
  let retrySettled = false // 通行证已判定（反向扫到首个相关痕迹即定，更早的不追溯）
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    // session.start 主线字段恒为 ''（记账时不归属任何主线），会话边界跨主线生效
    if (ev.type === 'session.start') {
      retrySettled = true
      continue
    }
    if (ev.mainlineId !== mainlineId) continue
    if (ev.type === 'intent.declared') {
      if (!declared.exists) {
        declared = { exists: true, files: ev.files, verifyCommand: ev.verifyCommand }
      }
      // 声明晚于被拦：通行证归零（本就走声明放行分支，这里只为结清）
      retrySettled = true
      continue
    }
    if (retrySettled) continue
    if (ev.type === 'write.allowed' || ev.type === 'write.blocked' || ev.type === 'file.changed') {
      retrySettled = true // 被拦后已有写入落账 → 通行证已被那次重试消费
    } else if (ev.type === 'intent.blocked') {
      blockedRetry = true // 最新痕迹是被拦且无写入在后 → 紧接着的重试放行一次
      retrySettled = true
    }
  }
  return { declared, blockedRetry }
}

/**
 * 用户一句话放行消费端：反向扫，最近的 unlock/escape.used 之后（更晚方向）无
 * 任何 write.allowed/write.blocked/file.changed → 未消费 → 放行（该事件被消费）。
 */
export function hasUnconsumedUnlock(events: DevFlowEvent[], mainlineId: string): boolean {
  let sawWrite = false
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.mainlineId !== mainlineId) continue
    if (ev.type === 'write.allowed' || ev.type === 'write.blocked' || ev.type === 'file.changed') {
      sawWrite = true
    } else if (ev.type === 'unlock' || ev.type === 'escape.used') {
      return !sawWrite
    }
  }
  return false
}

function writeAllowedEvent(ctx: GateContext, rule: SensitiveRule | null): DevFlowEvent {
  return {
    type: 'write.allowed',
    t: ctx.now,
    mainlineId: ctx.mainlineId,
    tool: ctx.tool,
    path: ctx.rawPath,
    rule,
  }
}

function writeBlockedEvent(ctx: GateContext, path: string, rule: string): DevFlowEvent {
  return {
    type: 'write.blocked',
    t: ctx.now,
    mainlineId: ctx.mainlineId,
    tool: ctx.tool,
    path,
    rule,
  }
}

function intentDeclaredEvent(ctx: GateContext, ti: TranscriptIntent): DevFlowEvent {
  return {
    type: 'intent.declared',
    t: ctx.now,
    mainlineId: ctx.mainlineId,
    requirementId: null,
    summary: ti.summary ?? '',
    verifyCommand: ti.verifyCommand,
    risk: ti.risk,
    files: ti.files,
  }
}

function intentBlockedEvent(ctx: GateContext, reason: string): DevFlowEvent {
  return {
    type: 'intent.blocked',
    t: ctx.now,
    mainlineId: ctx.mainlineId,
    requirementId: null,
    reason,
    rule: 'first-write-gate',
  }
}

/** 隐式主线 id 前缀（P0：首条 intent.declared 自动建线）。显式主线（user-prompt.ts
 * resolveSwitchTarget 的 ml-<递增编号>）同以 'ml-' 开头但格式不同：显式是纯数字短
 * id（ml-1、ml-2…，编号从 1 起），隐式是 ml-<毫秒时间戳>-<进程唯一后缀>——时间戳
 * 至少 14 位，与显式编号的数值域不重叠，两类 id 不会撞。语义同一（主线 id 前缀）
 * 但生成策略各异，跨模块为一个前缀建共享常量不值，此处注释互相指引即可。 */
export const IMPLICIT_MAINLINE_PREFIX = 'ml-'

/**
 * 隐式主线唯一性后缀（gate-runner 壳层调用，注入进程唯一片段）：pid 隔离不同
 * hook 进程（宿主每个 hook 独立进程），随机数兜底同进程多次调用（同毫秒两次建线）。
 * 事件流里两个同毫秒的隐式主线因此 id 必不同——若 id 只取时间戳，并发写者会撞 id，
 * 两条不同意图合并进一条主线（requirement/verifyDeclarations 互相覆盖）。
 */
export function implicitMainlineSuffix(): string {
  return `${process.pid}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 隐式主线指派（纯函数，P0 修复"无主线自锁死链"，落账前调用）：
 * 无活跃主线且本批含空主线 intent.declared → 生成主线 id（ml-<now 时间戳>-<suffix>，
 * suffix 为调用方注入的进程唯一片段，同毫秒并发进程 id 必不同），同批空主线事件
 * 一并归入新线。id 随事件入链，rebuild 重放确定性由「id 烘焙进事件」保证，不依赖
 * 「同 now 同 id」。折叠层 upsertMainline 会把首个主线置为活跃主线，
 * requirement/verifyDeclarations 随之挂到该线，后续事件经 gate-runner 自动带上——
 * verify 记账、done、恢复播报全链路解锁。
 * 其余情况（已有活跃主线 / 批内无声明）原样返回。
 */
export function assignImplicitMainline(
  events: DevFlowEvent[],
  activeMainlineId: string | null,
  now: string,
  suffix: string,
): DevFlowEvent[] {
  if (activeMainlineId !== null) return events
  if (!events.some((e) => e.type === 'intent.declared' && e.mainlineId === '')) return events
  const id = `${IMPLICIT_MAINLINE_PREFIX}${now.replace(/\D/g, '')}-${suffix}`
  return events.map((e) => (e.mainlineId === '' ? { ...e, mainlineId: id } : e))
}

export interface PathGateOpts {
  /** 重试放行时是否记 intent.blocked 审计标注（Bash 多目标只标一次） */
  emitRetryMark?: boolean
  /**
   * 重试通行证预计算值（Bash 多目标：一次工具调用 = 同一次写入意图，逐目标
   * 判定共用批前扫描结果——否则批内先放行目标的 write.allowed 会把通行证
   * 误消费掉，导致后续目标被误拦）。undefined = 按 ctx.events 现场扫描。
   */
  retryAllowed?: boolean
  /**
   * 预计算的主线意图扫描结果（Bash 多目标共用：scanIntent 在 decideBashWrite
   * 入口算一次，逐目标复用 blockedRetry 避免 O(n×m) 重复反向扫——n=events 数量，
   * m=目标数；声明检查仍用 ctx.events（working 数组），确保批内新声明不重复落账）。
   */
  intentScan?: IntentScan
}

/**
 * 单路径写门禁（纯函数）：unlock 消费 → 敏感硬门禁 → 意图块强制层。
 * events 参数为"工作事件列表"（调用方累积，如 Bash 逐目标判定时已落账的事件），
 * 保证声明落账后后续目标不再重复声明/重复标记。
 */
export function decidePathWrite(ctx: GateContext, opts: PathGateOpts = {}): GateResult {
  const { emitRetryMark = true } = opts
  const resolved = resolveWritePath(ctx.rawPath, ctx.cwd)
  const sens = matchSensitivePath(resolved, ctx.config.sensitivePaths, ctx.pluginRoot)
  // 声明检查用 working 数组（ctx.events 含批内已累积事件）：确保批内先目标
  // 落账的 intent.declared 不被后目标重复落账。
  // 重试通行证用预计算的 intentScan（blockedRetry 不受 write.allowed 影响，
  // 复用避免 O(n×m) 重复反向扫）。
  const intentForDeclaration = scanIntent(ctx.events, ctx.mainlineId)
  const blockedRetry = opts.retryAllowed ?? opts.intentScan?.blockedRetry ?? intentForDeclaration.blockedRetry

  // 0. 用户一句话放行出口（unlock/escape.used 未消费）——最高优先
  if (hasUnconsumedUnlock(ctx.events, ctx.mainlineId)) {
    return { decision: 'allow', reason: null, events: [writeAllowedEvent(ctx, sens.rule)] }
  }

  // 声明覆盖判定：事件声明 files ∪ transcript 声明 files 是否覆盖目标路径。
  // 声明文件为项目相对写法（'.env'/'src/'），目标同时以绝对（resolved）与
  // 原始相对（rawPath）两种形态比对，兼容声明习惯。
  const transcriptDeclared = ctx.transcript !== null && ctx.transcript.declared
  const coversPath = (files: string[]): boolean =>
    declaredFilesCoverPath(files, resolved) || declaredFilesCoverPath(files, ctx.rawPath)
  const declaredCovers =
    (intentForDeclaration.declared.exists && coversPath(intentForDeclaration.declared.files)) ||
    (transcriptDeclared && coversPath(ctx.transcript!.files))

  // 1. 敏感硬门禁（§3.4：已声明放行+治理升级，未声明 deny）
  if (sens.matched) {
    if (declaredCovers) {
      const events: DevFlowEvent[] = []
      // transcript 声明尚未落账 → 补 intent.declared（verify 声明进证据链/state）
      if (!intentForDeclaration.declared.exists && transcriptDeclared) {
        events.push(intentDeclaredEvent(ctx, ctx.transcript!))
      }
      events.push(writeAllowedEvent(ctx, sens.rule))
      return { decision: 'allow', reason: null, events }
    }
    return {
      decision: 'deny',
      reason: sensitiveDenyReason(ctx.rawPath, sens.rule),
      events: [writeBlockedEvent(ctx, ctx.rawPath, sens.rule)],
    }
  }

  // 2. 意图块强制层（非敏感，主通道一拦二放）
  if (intentForDeclaration.declared.exists) {
    return { decision: 'allow', reason: null, events: [writeAllowedEvent(ctx, null)] }
  }
  if (transcriptDeclared) {
    return {
      decision: 'allow',
      reason: null,
      events: [intentDeclaredEvent(ctx, ctx.transcript!), writeAllowedEvent(ctx, null)],
    }
  }
  if (blockedRetry) {
    const events: DevFlowEvent[] = [writeAllowedEvent(ctx, null)]
    if (emitRetryMark) {
      events.unshift(intentBlockedEvent(ctx, '首次写入被拦后模型重试，按一拦二放放行（审计标注，通行证一次性）'))
    }
    return { decision: 'allow', reason: null, events }
  }
  // 首次写入：deny + 四要素模板（fail-visible）
  return {
    decision: 'deny',
    reason: INTENT_GATE_TEMPLATE,
    events: [intentBlockedEvent(ctx, INTENT_GATE_TEMPLATE)],
  }
}

/** 命令截断（write.blocked.path 承载审计用的命令原文，红线 500 字符） */
function truncateCommand(cmd: string): string {
  return cmd.length > 500 ? cmd.slice(0, 500) : cmd
}

export interface BashGateArgs {
  command: string
  mainlineId: string
  cwd: string
  pluginRoot: string | null
  state: DevFlowState
  events: DevFlowEvent[]
  config: DevFlowConfig
  transcript: TranscriptIntent | null
  now: string
}

/**
 * Bash 门禁（纯函数，分析 + 逐目标判定）：
 * - 不可逆操作（防线③）→ deny（unlock/escape.used 未消费可放行=用户一句话授权）；
 * - 启发式写入目标逐个过 decidePathWrite（敏感升级语义同 Write）；
 *   任一 deny → 整命令 deny；全部放行 → 每个目标补 file.changed（证据链与
 *   自动 commit 覆盖缺口，§3.5）；解析不出目标 → 放行不拦（宁漏勿误拦）。
 */
export function decideBashWrite(args: BashGateArgs): GateResult {
  const analysis = analyzeBashCommand(args.command)

  // 不可逆操作
  if (analysis.irreversible.matched) {
    if (hasUnconsumedUnlock(args.events, args.mainlineId)) {
      return { decision: 'allow', reason: null, events: [] }
    }
    return {
      decision: 'deny',
      reason: irreversibleDenyReason(analysis.irreversible.rule),
      events: [
        writeBlockedEvent(
          { tool: 'Bash', rawPath: '', command: args.command, mainlineId: args.mainlineId, cwd: args.cwd, pluginRoot: args.pluginRoot, state: args.state, events: args.events, config: args.config, transcript: args.transcript, now: args.now },
          truncateCommand(args.command),
          analysis.irreversible.rule,
        ),
      ],
    }
  }

  // 解析不出写入目标 → 放行不拦
  if (analysis.writeTargets.length === 0) {
    return { decision: 'allow', reason: null, events: [] }
  }

  // 逐目标判定（工作事件累积：声明只落账一次、重试标注只标一次；
  // 重试通行证按批前事件预计算——一次工具调用是同一次写入意图，批内
  // 先放行目标的 write.allowed 不许把通行证误消费掉）
  const intentScan = scanIntent(args.events, args.mainlineId)
  const retryAllowed = intentScan.blockedRetry
  const working = [...args.events]
  const outEvents: DevFlowEvent[] = []
  for (let i = 0; i < analysis.writeTargets.length; i++) {
    const target = analysis.writeTargets[i]
    const ctx: GateContext = {
      tool: 'Bash',
      rawPath: target,
      command: args.command,
      mainlineId: args.mainlineId,
      cwd: args.cwd,
      pluginRoot: args.pluginRoot,
      state: args.state,
      events: working,
      config: args.config,
      transcript: args.transcript,
      now: args.now,
    }
    const r = decidePathWrite(ctx, { emitRetryMark: i === 0, retryAllowed, intentScan })
    if (r.decision === 'deny') {
      return { decision: 'deny', reason: r.reason, events: [...outEvents, ...r.events] }
    }
    outEvents.push(...r.events)
    working.push(...r.events)
  }

  // 全部放行：每个目标补 file.changed（无论是否敏感——Bash 写入的证据链来源）
  for (const target of analysis.writeTargets) {
    outEvents.push({
      type: 'file.changed',
      t: args.now,
      mainlineId: args.mainlineId,
      tool: 'Bash',
      path: target,
    })
  }
  return { decision: 'allow', reason: null, events: outEvents }
}

/**
 * Write/Edit/MultiEdit 的 file.changed 事件构造（纯函数，PostToolUse 记账用——
 * 计划 §3.1 PostToolUse「文件改动」行；Bash 的 file.changed 由 decideBashWrite
 * 启发式补，两路共一条证据链，都是自动 commit 的清单来源 §3.6）：
 * 路径归一为项目相对（绝对/相对 → 相对 cwd + NFC，坑 N-5 同源）。不做 symlink
 * 目标解析（那是敏感匹配的职责；提交路径按用户实际写入的相对形态走，git add
 * 对该形态直接可用——若用 realpath 归一，项目根本身是 symlink 时（如 macOS
 * /var、/tmp）relative 会产出 `../…` 被误丢）。越界路径（相对化出 `..`）与
 * 空路径/空主线 → null：未知归属的写入绝不进自动 commit（宁漏勿误收，与
 * planAutoCommit.normalizePath 同语义）。
 */
export function buildFileChangedEvent(opts: {
  tool: string
  filePath: string
  cwd: string
  mainlineId: string
  now: string
}): DevFlowEvent | null {
  if (opts.filePath.trim() === '' || opts.mainlineId.trim() === '') return null
  const abs = isAbsolute(opts.filePath) ? opts.filePath : join(opts.cwd, opts.filePath)
  const rel = relative(opts.cwd, abs).normalize('NFC')
  if (rel === '' || rel.startsWith('..')) return null
  return {
    type: 'file.changed',
    t: opts.now,
    mainlineId: opts.mainlineId,
    tool: opts.tool,
    path: rel,
  }
}

export interface ToolGateArgs {
  tool: 'Write' | 'Edit' | 'MultiEdit'
  filePath: string | null
  mainlineId: string
  cwd: string
  pluginRoot: string | null
  state: DevFlowState
  events: DevFlowEvent[]
  config: DevFlowConfig
  transcript: TranscriptIntent | null
  now: string
}

/** Write/Edit/MultiEdit 门禁（薄纯函数：空路径异常载荷放行不拦，其余走单路径门禁） */
export function decideToolWrite(args: ToolGateArgs): GateResult {
  if (args.filePath === null || args.filePath === '') {
    return { decision: 'allow', reason: null, events: [] }
  }
  return decidePathWrite(
    {
      tool: args.tool,
      rawPath: args.filePath,
      command: null,
      mainlineId: args.mainlineId,
      cwd: args.cwd,
      pluginRoot: args.pluginRoot,
      state: args.state,
      events: args.events,
      config: args.config,
      transcript: args.transcript,
      now: args.now,
    },
    {},
  )
}
