/**
 * 门禁 IO 编排单测（node:test，零新增依赖）
 *
 * 覆盖（P0 修复"无主线自锁死链"的端到端面）：
 * - 无活跃主线时首条 intent.declared 落账 → 隐式主线建成并置活跃、需求挂线、
 *   verifyDeclarations 以真实主线 id 为键、events.jsonl 与 state.json 一致；
 * - rebuild 确定性：同一 events 序列全量重放 == 增量折叠产物（== 再重放）；
 * - 已有活跃主线 → 不另建线；首拦 deny 批次（无声明）→ 不建线；
 * - fail-open：决策回调抛异常 → 放行 + audit.warning 落账，不建线不崩。
 *
 * runGate 的状态根定位走 CLAUDE_PROJECT_DIR 环境变量，用例各自指向独立
 * 临时目录（mkdtempSync + t.after 清理），用毕恢复原环境。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGate } from '../src/lib/gate-runner.js'
import { readEvents, type DevFlowEvent } from '../src/lib/events.js'
import { loadState } from '../src/lib/state.js'
import { rebuildFromFile } from '../src/lib/rebuild.js'
import type { GateResult } from '../src/lib/write-gate.js'

/** 建独立临时项目根并把 CLAUDE_PROJECT_DIR 指过去（用毕恢复 + 清理） */
function tempProject(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-gate-runner-test-'))
  const prev = process.env.CLAUDE_PROJECT_DIR
  process.env.CLAUDE_PROJECT_DIR = dir
  t.after(() => {
    if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR
    else process.env.CLAUDE_PROJECT_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/** 模拟"transcript 声明命中"的决策回调产出（空主线 intent.declared + write.allowed） */
function declaredBatch(mainlineId: string): DevFlowEvent[] {
  return [
    {
      type: 'intent.declared',
      t: 'T1',
      mainlineId,
      requirementId: null,
      summary: '加标签功能',
      verifyCommand: 'npm test',
      risk: null,
      files: ['src/tags.ts'],
    },
    { type: 'write.allowed', t: 'T1', mainlineId, tool: 'Write', path: 'src/tags.ts', rule: null },
  ]
}

test('P0①：无活跃主线 → 首条 intent.declared 落账自动建隐式主线并置活跃', (t) => {
  const dir = tempProject(t)
  const out = runGate(() => ({ decision: 'allow', reason: null, events: declaredBatch('') }))
  assert.equal(out.decision, 'allow')

  const { state } = loadState(join(dir, '.dev-flow'))
  assert.ok(state.activeMainlineId !== null, '隐式主线已置为活跃主线')
  assert.match(state.activeMainlineId!, /^ml-\d+-\w+$/, '隐式主线 id 形如 ml-<时间戳>-<进程唯一后缀>')
  const id = state.activeMainlineId!
  assert.ok(state.mainlines[id], '主线已建')
  assert.equal(state.mainlines[id].status, 'active')
  // 需求挂到该主线（不再是 ''）
  assert.equal(state.requirements.length, 1)
  assert.equal(state.requirements[0].mainlineId, id)
  assert.equal(state.requirements[0].verifyCommand, 'npm test')
  // verifyDeclarations 用真实主线 id 作键（PostToolUse 验收匹配的数据面）
  assert.equal(state.verifyDeclarations[id], 'npm test')
  assert.equal(state.verifyDeclarations[''], undefined, '不再出现空主线键')
  // 事件流（事实源）里的归属也是新主线 id
  const { events } = readEvents(join(dir, '.dev-flow'))
  assert.ok(events.length >= 2)
  assert.ok(events.every((e) => e.mainlineId === id), '同批事件全部归入隐式主线')
})

test('P0②：rebuild 确定性——全量重放 == 增量折叠 == 再重放', (t) => {
  const dir = tempProject(t)
  runGate(() => ({ decision: 'allow', reason: null, events: declaredBatch('') }))
  const root = join(dir, '.dev-flow')
  const { state: incremental } = loadState(root)
  const { state: rebuilt1 } = rebuildFromFile(root)
  const { events } = readEvents(root)
  const rebuilt2 = rebuildFromFile(root).state
  assert.deepEqual(rebuilt1, incremental, '全量重放与增量折叠一致')
  assert.deepEqual(rebuilt2, rebuilt1, '同一 events 序列重放结果确定')
  assert.equal(rebuilt1.activeMainlineId, incremental.activeMainlineId)
  assert.equal(events.length >= 2, true)
})

test('P0③：已有活跃主线 → 后续落账沿用该线，不另建线', (t) => {
  const dir = tempProject(t)
  runGate(() => ({ decision: 'allow', reason: null, events: declaredBatch('') }))
  const root = join(dir, '.dev-flow')
  const id = loadState(root).state.activeMainlineId!
  // 第二次门禁：决策回调拿到 ctx.mainlineId（= 活跃主线），事件归该线
  const out = runGate((ctx) => ({
    decision: 'allow',
    reason: null,
    events: [
      { type: 'write.allowed', t: 'T2', mainlineId: ctx.mainlineId, tool: 'Edit', path: 'src/tags.ts', rule: null },
    ],
  }))
  assert.equal(out.decision, 'allow')
  const { state } = loadState(root)
  assert.equal(state.activeMainlineId, id, '活跃主线不变')
  assert.equal(Object.keys(state.mainlines).length, 1, '没有多建主线')
  const { events } = readEvents(root)
  assert.ok(events.every((e) => e.mainlineId === id), '后续事件自动带上该主线')
})

test('P0④：首拦 deny 批次（无 intent.declared）→ 不建线，状态保持无主线', (t) => {
  const dir = tempProject(t)
  const result: GateResult = {
    decision: 'deny',
    reason: '模板',
    events: [
      { type: 'intent.blocked', t: 'T1', mainlineId: '', requirementId: null, reason: '模板', rule: 'first-write-gate' },
    ],
  }
  const out = runGate(() => result)
  assert.equal(out.decision, 'deny')
  const { state } = loadState(join(dir, '.dev-flow'))
  assert.equal(state.activeMainlineId, null, '被拦痕迹不建主线')
  const { events } = readEvents(join(dir, '.dev-flow'))
  assert.equal(events.length, 1)
  assert.equal(events[0].mainlineId, '')
})

test('fail-open：决策回调抛异常 → 放行 + audit.warning 落账，不建线不崩', (t) => {
  const dir = tempProject(t)
  const out = runGate(() => {
    throw new Error('决策模块炸了的模拟')
  })
  assert.equal(out.decision, 'allow', '门禁自身故障绝不阻塞开发')
  assert.equal(out.reason, null)
  const raw = readFileSync(join(dir, '.dev-flow', 'events.jsonl'), 'utf8')
  assert.match(raw, /audit\.warning/)
  assert.match(raw, /决策模块炸了的模拟/)
  const { state } = loadState(join(dir, '.dev-flow'))
  assert.equal(state.activeMainlineId, null)
})
