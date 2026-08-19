/**
 * 重建模块单测（node:test，零新增依赖——计划 §6 T2 判据）
 *
 * 覆盖：rebuildState 折叠正确性（空 events、完整生命周期、乱序时间戳按行序、
 * 连败计数、主线切换、声明覆盖、unlock 解锁）；rebuildFromFile 半行截断
 * 跳过 + 审计警告（doctor 重建的数据基础）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rebuildFromFile, rebuildState } from '../src/lib/rebuild.js'
import { defaultState } from '../src/lib/state.js'
import { appendEvent, type DevFlowEvent } from '../src/lib/events.js'

/** 建独立临时状态根（每个用例互不污染），用毕清理 */
function tempRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-rebuild-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('rebuildState：空 events → 空状态', () => {
  assert.deepEqual(rebuildState([]), defaultState())
})

test('rebuildState：完整生命周期折叠（主线/需求/验收/宣称）', () => {
  const events: DevFlowEvent[] = [
    { type: 'session.start', t: 'T0', mainlineId: '', sessionId: 's1', source: 'startup' },
    {
      type: 'intent.declared',
      t: 'T1',
      mainlineId: 'm1',
      requirementId: null,
      summary: '修登录页',
      verifyCommand: 'npm test',
      risk: null,
      files: ['src/a.ts'],
    },
    { type: 'write.allowed', t: 'T2', mainlineId: 'm1', tool: 'Write', path: 'src/a.ts', rule: null },
    { type: 'file.changed', t: 'T3', mainlineId: 'm1', tool: 'Write', path: 'src/a.ts' },
    {
      type: 'verify.passed',
      t: 'T4',
      mainlineId: 'm1',
      requirementId: null,
      exitCode: 0,
      command: 'npm test',
      durationMs: 100,
    },
    { type: 'done.claimed', t: 'T5', mainlineId: 'm1', requirementId: null, channel: 'tool' },
  ]
  const s = rebuildState(events)
  assert.equal(s.updatedAt, 'T5')
  assert.equal(s.activeMainlineId, 'm1')
  assert.equal(s.mainlines['m1'].claimedAt, 'T5')
  assert.equal(s.mainlines['m1'].lastWriteAt, 'T3')
  assert.equal(s.requirements.length, 1)
  assert.equal(s.requirements[0].id, 'm1@r1') // 无 id 需求：确定性自动编号
  assert.equal(s.requirements[0].summary, '修登录页')
  assert.equal(s.requirements[0].verifyCommand, 'npm test')
  assert.equal(s.lastVerification?.exitCode, 0)
  assert.equal(s.lastVerification?.command, 'npm test')
  assert.equal(s.verifyDeclarations['m1'], 'npm test')
  assert.equal(s.doneLock, true)
  assert.equal(s.loseStreak, 0)
})

test('rebuildState：乱序时间戳按行序折叠（时间戳不重排因果）', () => {
  const events: DevFlowEvent[] = [
    {
      type: 'verify.passed',
      t: 'T2', // 时间戳更晚
      mainlineId: 'm1',
      requirementId: null,
      exitCode: 0,
      command: 'npm test',
      durationMs: null,
    },
    {
      type: 'done.claimed',
      t: 'T1', // 时间戳更早但行序在后：宣称发生在验收之后（行序 = 因果序）
      mainlineId: 'm1',
      requirementId: null,
      channel: 'user',
    },
  ]
  const s = rebuildState(events)
  assert.equal(s.doneLock, true)
  assert.equal(s.lastVerification?.command, 'npm test') // 按行序，验收先折叠
  assert.equal(s.updatedAt, 'T1') // 最后折叠的事件 t
})

test('rebuildState：连败计数（claimed 清零、rejected 累加——§9：连败=连续驳回次数）', () => {
  const events: DevFlowEvent[] = [
    { type: 'done.claimed', t: 'T1', mainlineId: 'm1', requirementId: null, channel: 'user' },
    { type: 'done.rejected', t: 'T2', mainlineId: 'm1', reason: '验收未过' },
    { type: 'done.claimed', t: 'T3', mainlineId: 'm1', requirementId: null, channel: 'user' },
    { type: 'done.rejected', t: 'T4', mainlineId: 'm1', reason: '仍缺测试' },
  ]
  const s = rebuildState(events)
  // claimed 恒清零：T1→0、T2→1、T3→0、T4→1（一次宣称通过即破连败，T6 规格 B）
  assert.equal(s.loseStreak, 1)
  assert.equal(s.doneLock, false)
  assert.equal(s.mainlines['m1'].rejectedAt, 'T4')
  // 连续驳回累加
  const s2 = rebuildState([
    { type: 'done.rejected', t: 'T1', mainlineId: 'm1', reason: 'a' },
    { type: 'done.rejected', t: 'T2', mainlineId: 'm1', reason: 'b' },
  ])
  assert.equal(s2.loseStreak, 2)
})

test('rebuildState：主线切换（from 挂起、to 激活、活跃线更新）', () => {
  const events: DevFlowEvent[] = [
    {
      type: 'intent.declared',
      t: 'T1',
      mainlineId: 'm1',
      requirementId: null,
      summary: 'A',
      verifyCommand: null,
      risk: null,
      files: [],
    },
    { type: 'mainline.switch', t: 'T2', mainlineId: '', from: 'm1', to: 'm2', name: null },
  ]
  const s = rebuildState(events)
  assert.equal(s.activeMainlineId, 'm2')
  assert.equal(s.mainlines['m1'].status, 'suspended')
  assert.equal(s.mainlines['m2'].status, 'active')
  // 切回 m1
  const s2 = rebuildState([
    ...events,
    { type: 'mainline.switch', t: 'T3', mainlineId: '', from: 'm2', to: 'm1', name: null },
  ])
  assert.equal(s2.activeMainlineId, 'm1')
  assert.equal(s2.mainlines['m1'].status, 'active')
  assert.equal(s2.mainlines['m2'].status, 'suspended')
})

test('rebuildState：mainline.switch 创建时写入主线名，重激活保留既有名（T5）', () => {
  const events: DevFlowEvent[] = [
    { type: 'mainline.switch', t: 'T1', mainlineId: 'ml-1', from: null, to: 'ml-1', name: '登录问题' },
    { type: 'mainline.switch', t: 'T2', mainlineId: 'ml-2', from: 'ml-1', to: 'ml-2', name: '性能优化' },
    { type: 'mainline.switch', t: 'T3', mainlineId: 'ml-1', from: 'ml-2', to: 'ml-1', name: '换个叫法' },
  ]
  const s = rebuildState(events)
  assert.equal(s.mainlines['ml-1'].name, '登录问题', '重激活不改名（保留创建时名）')
  assert.equal(s.mainlines['ml-2'].name, '性能优化')
  assert.equal(s.activeMainlineId, 'ml-1')
  assert.equal(s.mainlines['ml-2'].status, 'suspended')
})

test('rebuildState：verify 声明后者覆盖前者（声明演进，§3.3）', () => {
  const events: DevFlowEvent[] = [
    {
      type: 'intent.declared',
      t: 'T1',
      mainlineId: 'm1',
      requirementId: 'r1',
      summary: 'A',
      verifyCommand: 'npm test',
      risk: null,
      files: [],
    },
    {
      type: 'verify.failed',
      t: 'T2',
      mainlineId: 'm1',
      requirementId: null,
      exitCode: 1,
      command: 'npm run test:unit && npm run lint',
      durationMs: null,
      outputTail: [],
    },
  ]
  const s = rebuildState(events)
  assert.equal(s.verifyDeclarations['m1'], 'npm run test:unit && npm run lint')
  assert.equal(s.requirements[0].verifyCommand, 'npm test') // 需求级声明仍来自 intent.declared
  assert.equal(s.lastVerification?.exitCode, 1)
})

test('rebuildState：unlock 解开完成宣称锁（用户终裁，§3.7）', () => {
  const s = rebuildState([
    { type: 'done.claimed', t: 'T1', mainlineId: 'm1', requirementId: null, channel: 'tool' },
    { type: 'unlock', t: 'T2', mainlineId: 'm1', context: '用户终裁：这次通过' },
  ])
  assert.equal(s.doneLock, false)
})

test('rebuildState：intent.blocked 标记需求为 blocked（带理由），重新声明解除', () => {
  const events: DevFlowEvent[] = [
    {
      type: 'intent.declared',
      t: 'T1',
      mainlineId: 'm1',
      requirementId: 'r1',
      summary: '改 schema',
      verifyCommand: null,
      risk: null,
      files: [],
    },
    {
      type: 'intent.blocked',
      t: 'T2',
      mainlineId: 'm1',
      requirementId: 'r1',
      reason: '未声明敏感路径（migrations/）',
      rule: 'sensitive-path',
    },
  ]
  const s = rebuildState(events)
  assert.equal(s.requirements[0].status, 'blocked')
  assert.equal(s.requirements[0].blockedReason, '未声明敏感路径（migrations/）')
  assert.equal(s.governanceStrength, 0) // intent.blocked 不升治理强度（拦截语义 T4 细化）
})

test('rebuildState：write.blocked 升治理强度、记 lastWriteAt', () => {
  const s = rebuildState([
    { type: 'write.blocked', t: 'T1', mainlineId: 'm1', tool: 'Write', path: '.env', rule: 'secrets' },
  ])
  assert.equal(s.governanceStrength, 1)
  assert.equal(s.mainlines['m1'].lastWriteAt, 'T1')
})

test('rebuildFromFile：半行截断跳过 + audit 警告，其余正常重建（fail-open）', (t) => {
  const dir = tempRoot(t)
  appendEvent(dir, { type: 'intent.declared', mainlineId: 'm1', summary: '修登录' })
  // 模拟崩溃截断的半行 JSONL
  appendFileSync(join(dir, 'events.jsonl'), '{"type":"done.claimed","t":"2026",', 'utf8')
  const r = rebuildFromFile(dir)
  assert.equal(r.skipped, 1)
  assert.equal(r.readError, null)
  assert.equal(r.state.activeMainlineId, 'm1')
  assert.equal(r.state.requirements.length, 1)
  assert.match(readFileSync(join(dir, 'events.jsonl'), 'utf8'), /audit\.warning/)
})

test('rebuildFromFile：events.jsonl 不存在（首次运行）→ 空状态、无审计', (t) => {
  const dir = tempRoot(t)
  const r = rebuildFromFile(dir)
  assert.equal(r.skipped, 0)
  assert.equal(r.readError, null)
  assert.deepEqual(r.state, defaultState())
  // events.jsonl 仍不存在（无故障，不写审计）
  assert.equal(existsSync(join(dir, 'events.jsonl')), false)
})
