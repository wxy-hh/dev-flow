/**
 * done 完成宣称校验单测（node:test，T6 判据：时序双检查、verify:none、连败）
 *
 * 覆盖：evaluateDone 全分支——无活跃主线 / 无声明（fail-visible 模板）/ 声明
 * none 免验收 / 无 verify.passed / 验收早于最后写入（失效）/ 验收晚于最后写入
 * （通过）/ 无写入恒晚 / 同时刻不通过（严格大于）；连败计数累加与清零
 * （rebuildState 折叠：claimed 恒清零、rejected 累加）；verify 声明演进后者
 * 覆盖前者（rebuild 已落实，done 读现行声明）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateDone, NO_DECLARATION_REASON } from '../src/lib/done.js'
import { emptyFacts, scanMainlineFacts, type DevFlowEvent } from '../src/lib/events.js'
import { defaultState } from '../src/lib/state.js'
import { applyEvents, rebuildState } from '../src/lib/rebuild.js'
import { activeMainline } from '../src/lib/briefing.js'

// —— 事件构造器（与 briefing.test 同风格；时间戳用 ISO 可解析值） ——
function intentDeclared(t: string, verifyCommand: string | null, mainlineId = 'm1'): DevFlowEvent {
  return {
    type: 'intent.declared',
    t,
    mainlineId,
    requirementId: null,
    summary: '做功能',
    verifyCommand,
    risk: null,
    files: ['src/a.ts'],
  }
}
function fileChanged(t: string, mainlineId = 'm1'): DevFlowEvent {
  return { type: 'file.changed', t, mainlineId, tool: 'Write', path: 'src/a.ts' }
}
function verifyPassed(t: string, command: string, mainlineId = 'm1'): DevFlowEvent {
  return {
    type: 'verify.passed',
    t,
    mainlineId,
    requirementId: null,
    exitCode: 0,
    command,
    durationMs: null,
  }
}
function doneRejected(t: string, reason: string, mainlineId = 'm1'): DevFlowEvent {
  return { type: 'done.rejected', t, mainlineId, reason }
}
function doneClaimed(t: string, mainlineId = 'm1'): DevFlowEvent {
  return { type: 'done.claimed', t, mainlineId, requirementId: null, channel: 'tool' }
}

/** 折叠出 state + facts 的标准组合（校验函数入参） */
function build(events: DevFlowEvent[], mainlineId = 'm1'): { state: ReturnType<typeof rebuildState>; facts: ReturnType<typeof scanMainlineFacts> } {
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, mainlineId)
  return { state, facts }
}

test('evaluateDone：无活跃主线 → 驳回（无宣称目标）', () => {
  const r = evaluateDone(defaultState(), emptyFacts())
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /无活跃主线/)
})

test('evaluateDone：无验收声明 → 驳回 + fail-visible 声明模板', () => {
  const { state, facts } = build([intentDeclared('T1', null)])
  const r = evaluateDone(state, facts)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, NO_DECLARATION_REASON)
  // 声明为空串同样视为无声明
  const s2 = rebuildState([intentDeclared('T1', '')])
  const r2 = evaluateDone(s2, scanMainlineFacts([intentDeclared('T1', '')], 'm1'))
  assert.equal(r2.ok, false)
})

test('evaluateDone：verify:none 显式声明 → 免验收通过（声明存在性由声明表保证）', () => {
  const { state, facts } = build([intentDeclared('T1', 'none')])
  const r = evaluateDone(state, facts)
  assert.equal(r.ok, true)
  // 无任何写入/验收事件也能过（文案类 XS：免验收）
  assert.equal(evaluateDone(rebuildState([intentDeclared('T1', 'none')]), emptyFacts()).ok, true)
})

test('evaluateDone：有声明但无 verify.passed → 驳回（理由指明先跑 verify）', () => {
  const { state, facts } = build([intentDeclared('T1', 'node check.js'), fileChanged('T2')])
  const r = evaluateDone(state, facts)
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.match(r.reason, /无验收通过记录/)
    assert.ok(r.reason.includes('node check.js')) // fail-visible：给出现行声明
  }
})

test('evaluateDone：验收早于最后写入（代码变则验收失效）→ 驳回', () => {
  const { state, facts } = build([
    intentDeclared('2026-08-19T08:00:00.000Z', 'node check.js'),
    verifyPassed('2026-08-19T08:10:00.000Z', 'node check.js'),
    fileChanged('2026-08-19T08:20:00.000Z'), // 验收后改代码
  ])
  const r = evaluateDone(state, facts)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /验收已失效/)
})

test('evaluateDone：验收晚于最后写入 → 通过（时序双检查全过）', () => {
  const { state, facts } = build([
    intentDeclared('2026-08-19T08:00:00.000Z', 'node check.js'),
    fileChanged('2026-08-19T08:10:00.000Z'),
    verifyPassed('2026-08-19T08:20:00.000Z', 'node check.js'),
  ])
  assert.equal(evaluateDone(state, facts).ok, true)
})

test('evaluateDone：从未写入（verify 恒晚于无写入）→ 通过', () => {
  const { state, facts } = build([
    intentDeclared('2026-08-19T08:00:00.000Z', 'node check.js'),
    verifyPassed('2026-08-19T08:10:00.000Z', 'node check.js'),
  ])
  assert.equal(evaluateDone(state, facts).ok, true)
})

test('evaluateDone：同时刻（严格大于）→ 不通过（fail-safe 边界）', () => {
  const { state, facts } = build([
    intentDeclared('T1', 'node check.js'),
    fileChanged('2026-08-19T09:00:00.000Z'),
    verifyPassed('2026-08-19T09:00:00.000Z'), // 与写入同时刻
  ])
  assert.equal(evaluateDone(state, facts).ok, false)
})

test('evaluateDone：声明演进后者覆盖前者（§3.3，done 读现行声明）', () => {
  // intent 声明 npm test，之后 verify 事件声明 node check.js → 现行声明是后者
  const events = [
    intentDeclared('2026-08-19T08:00:00.000Z', 'npm test'),
    fileChanged('2026-08-19T08:10:00.000Z'),
    verifyPassed('2026-08-19T08:20:00.000Z', 'node check.js'),
  ]
  const { state, facts } = build(events)
  const r = evaluateDone(state, facts)
  assert.equal(r.ok, true)
  // 驳回理由里的声明应是现行声明（后者）
  const r2 = evaluateDone(state, { ...facts, lastVerifyPassedAt: null })
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.ok(r2.reason.includes('node check.js'))
})

test('evaluateDone：已关闭主线（claimed 后无新写入）→ 时序双检查仍过（验收未失效）', () => {
  // claimed 后再 done：verify.passed 仍晚于最后写入 → 通过（spec：验收过了必成）
  const { state, facts } = build([
    intentDeclared('2026-08-19T08:00:00.000Z', 'node check.js'),
    fileChanged('2026-08-19T08:10:00.000Z'),
    verifyPassed('2026-08-19T08:20:00.000Z', 'node check.js'),
    doneClaimed('2026-08-19T08:21:00.000Z'),
  ])
  assert.equal(evaluateDone(state, facts).ok, true)
})

test('连败计数：rebuild 折叠——claimed 恒清零、rejected 累加（§9 + T6 规格 B）', () => {
  // 单次驳回 → 1
  const s1 = rebuildState([doneRejected('T1', '验收未过')])
  assert.equal(s1.loseStreak, 1)
  // 连续两次驳回 → 2
  const s2 = rebuildState([doneRejected('T1', 'a'), doneRejected('T2', 'b')])
  assert.equal(s2.loseStreak, 2)
  // 驳回后通过 → 清零（一次宣称通过即破连败）
  const s3 = rebuildState([doneRejected('T1', 'a'), doneClaimed('T2')])
  assert.equal(s3.loseStreak, 0)
  // 驳回 → 通过 → 再驳回 → 1
  const s4 = rebuildState([doneRejected('T1', 'a'), doneClaimed('T2'), doneRejected('T3', 'b')])
  assert.equal(s4.loseStreak, 1)
  // 纯通过序列 → 0
  const s5 = rebuildState([doneClaimed('T1'), doneClaimed('T2')])
  assert.equal(s5.loseStreak, 0)
  // 主线关闭标记同步
  assert.equal(s3.mainlines['m1'].rejectedAt, 'T1')
  assert.equal(s3.mainlines['m1'].claimedAt, 'T2')
  assert.equal(s3.doneLock, true)
})

test('applyEvents 增量折叠与 rebuildState 连败语义一致（done MCP 写端路径）', () => {
  const events = [doneRejected('T1', 'a')]
  const state = rebuildState(events)
  assert.equal(state.loseStreak, 1)
  // 增量应用 done.claimed → 清零
  applyEvents(state, [doneClaimed('T2')])
  assert.equal(state.loseStreak, 0)
  assert.equal(activeMainline(state)?.claimedAt, 'T2')
})
