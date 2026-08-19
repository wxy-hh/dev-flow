/**
 * 重建模块：events → state 折叠（计划 §2.3：events 是事实源，state 是缓存）。
 *
 * - rebuildState 为纯函数：不修改输入 events，每次从 defaultState() 重新折叠
 *   （同输入同输出、无外部副作用）；内部原地构建返回全新对象；
 * - 折叠按事件行序（JSONL append 序 = 因果序），不按时间戳排序——
 *   乱序时间戳（时钟偏差/延迟）不重排因果，一致性测试有乱序用例；
 * - 结构性事实（主线/需求/声明/连败/锁）从事件恢复；治理强度等缓存类字段
 *   从事件近似推导（缓存可丢，事实不丢），精确值由后续 hook 行为重新积累；
 * - done 验收时序校验（T3/T6）以 events 反向扫为准，不依赖本函数产物。
 */

import {
  auditWarning,
  ensureStateRoot,
  readEvents,
  type DevFlowEvent,
} from './events.js'
import { defaultState, type DevFlowState, type Mainline, type Requirement } from './state.js'

/** 更新或创建主线（事件首见即创建；首个主线自动成为活跃主线，软单主线语义） */
function upsertMainline(state: DevFlowState, id: string, t: string): Mainline {
  const existing = state.mainlines[id]
  if (existing) {
    existing.updatedAt = t
    return existing
  }
  const m: Mainline = {
    id,
    name: '',
    status: 'active',
    createdAt: t,
    updatedAt: t,
    claimedAt: null,
    rejectedAt: null,
    lastWriteAt: null,
  }
  state.mainlines[id] = m
  if (state.activeMainlineId === null) state.activeMainlineId = id
  return m
}

/** 需求 id 缺省时按主线内序号生成（确定性：同输入同输出） */
function nextRequirementId(state: DevFlowState, mainlineId: string): string {
  const n = state.requirements.filter((r) => r.mainlineId === mainlineId).length + 1
  return `${mainlineId}@r${n}`
}

/** 更新或创建需求（有 id 按 id，无 id 视为该主线单条需求） */
function upsertRequirement(
  state: DevFlowState,
  mainlineId: string,
  t: string,
  opts: { id: string | null; summary: string; verifyCommand: string | null },
): Requirement {
  const existing = opts.id
    ? state.requirements.find((r) => r.id === opts.id)
    : undefined
  if (existing) {
    existing.summary = opts.summary
    if (opts.verifyCommand !== null) existing.verifyCommand = opts.verifyCommand
    return existing
  }
  const r: Requirement = {
    id: opts.id ?? nextRequirementId(state, mainlineId),
    mainlineId,
    summary: opts.summary,
    verifyCommand: opts.verifyCommand,
    status: 'declared',
    createdAt: t,
    blockedAt: null,
    blockedReason: null,
    doneAt: null,
  }
  state.requirements.push(r)
  return r
}

/** 该主线最后一个需求（intent.blocked 无需求 id 时的归属） */
function lastRequirement(state: DevFlowState, mainlineId: string): Requirement | null {
  for (let i = state.requirements.length - 1; i >= 0; i--) {
    if (state.requirements[i].mainlineId === mainlineId) return state.requirements[i]
  }
  return null
}

/** 单事件折叠（事件 → 状态变更；事件类型 → state 效果的映射表）。 */
function fold(state: DevFlowState, ev: DevFlowEvent): DevFlowState {
  state.updatedAt = ev.t
  const m = ev.mainlineId === '' ? null : upsertMainline(state, ev.mainlineId, ev.t)
  switch (ev.type) {
    case 'session.start':
      // 会话痕迹只进 events（审计面），不折叠进 state 内容面
      break
    case 'intent.declared': {
      const r = upsertRequirement(state, ev.mainlineId, ev.t, {
        id: ev.requirementId,
        summary: ev.summary,
        verifyCommand: ev.verifyCommand,
      })
      r.status = 'declared' // 重新声明 = 解除 blocked
      r.blockedAt = null
      r.blockedReason = null
      // 声明演进：意图块第四要素 verify 命令入声明表（后者覆盖前者，§3.3）
      if (ev.verifyCommand !== null) state.verifyDeclarations[ev.mainlineId] = ev.verifyCommand
      break
    }
    case 'intent.blocked': {
      const r =
        lastRequirement(state, ev.mainlineId) ??
        upsertRequirement(state, ev.mainlineId, ev.t, {
          id: ev.requirementId,
          summary: '（被拦截的意图，未留摘要）',
          verifyCommand: null,
        })
      r.status = 'blocked'
      r.blockedAt = ev.t
      r.blockedReason = ev.reason
      break
    }
    case 'write.allowed':
    case 'file.changed':
      if (m) m.lastWriteAt = ev.t
      // 治理强度只升不降（§3.4 升级语义）：带命中规则名的放行 = 敏感路径已声明
      if (ev.type === 'write.allowed' && ev.rule !== null) {
        state.governanceStrength = Math.max(state.governanceStrength, 1)
      }
      break
    case 'write.blocked':
      if (m) m.lastWriteAt = ev.t
      state.governanceStrength = Math.max(state.governanceStrength, 1) // 有拦截即治理生效（T4 细化升级）
      break
    case 'verify.passed':
    case 'verify.failed': {
      state.lastVerification = {
        at: ev.t,
        exitCode: ev.exitCode,
        command: ev.command,
        durationMs: ev.durationMs,
        exitReason: ev.type === 'verify.failed' ? ev.exitReason : null,
      }
      // 声明演进：后者覆盖前者（§3.3 改命令场景）
      state.verifyDeclarations[ev.mainlineId] = ev.command
      if (ev.requirementId) {
        const r = state.requirements.find((x) => x.id === ev.requirementId)
        if (r) r.verifyCommand = ev.command
      }
      break
    }
    case 'done.claimed':
      if (m) m.claimedAt = ev.t
      // 连败清零（§9：连败=连续"宣称被驳回"次数；一次宣称通过即破连败，T6 规格 B）
      state.loseStreak = 0
      if (ev.requirementId) {
        const r = state.requirements.find((x) => x.id === ev.requirementId)
        if (r) {
          r.status = 'done'
          r.doneAt = ev.t
        }
      }
      state.doneLock = true
      break
    case 'done.rejected':
      if (m) m.rejectedAt = ev.t
      state.doneLock = false
      state.loseStreak += 1 // 连续宣称被驳回计数（§9 连败定义；TDD 红灯不计 T6 细化）
      break
    case 'escape.used':
      // 逃生门痕迹只在 events（审计面），不折叠进 state 内容面
      break
    case 'unlock':
      state.doneLock = false // 用户终裁解锁（§3.7）
      break
    case 'mainline.switch': {
      if (ev.from && state.mainlines[ev.from]) {
        state.mainlines[ev.from].status = 'suspended'
      }
      const to = upsertMainline(state, ev.to, ev.t)
      to.status = 'active'
      // 主线名只在创建时写入（重激活保留既有名；旧事件/手造事件无 name 兼容）
      if (ev.name && to.name === '') to.name = ev.name
      state.activeMainlineId = ev.to
      break
    }
  }
  return state
}

/**
 * 从事件序列重建状态（纯函数）。空 events → 空状态。
 * 输入不被修改；结果为全新 state 对象。
 * 折叠按事件行序（append 序 = 因果序），时间戳不参与排序。
 */
export function rebuildState(events: DevFlowEvent[]): DevFlowState {
  const state = defaultState()
  for (const ev of events) {
    fold(state, ev)
  }
  return state
}

/**
 * 增量折叠（纯函数）：把一段新事件应用进已有 state（原地修改并返回同一对象）。
 * 同步 hook 的写端路径（T4 起）：loadState → appendEvent → applyEvents → writeState，
 * state 只作为缓存随事件推进，折叠规则与 rebuildState 单一来源（不重造）。
 */
export function applyEvents(state: DevFlowState, events: DevFlowEvent[]): DevFlowState {
  for (const ev of events) {
    fold(state, ev)
  }
  return state
}

export interface RebuildFromFileResult {
  state: DevFlowState
  /** 跳过的损坏行数（半行截断/非法行；已审计） */
  skipped: number
  /** events.jsonl 读取故障（fail-open：已审计并返回空状态） */
  readError: string | null
}

/**
 * 薄壳：读 events.jsonl → 重建状态（doctor 重建的数据基础）。
 * fail-open：坏行跳过并审计；读取故障返回空状态并审计；绝不阻塞。
 */
export function rebuildFromFile(root: string): RebuildFromFileResult {
  ensureStateRoot(root)
  const { events, skipped, readError } = readEvents(root)
  if (skipped > 0) {
    auditWarning(root, `events.jsonl 有 ${skipped} 行损坏/截断记录，重建已跳过（fail-open）`, 'rebuild')
  }
  if (readError !== null) {
    auditWarning(root, `events.jsonl 读取故障：${readError}，重建返回空状态（fail-open）`, 'rebuild')
  }
  return { state: rebuildState(events), skipped, readError }
}
