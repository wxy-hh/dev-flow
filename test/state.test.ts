/**
 * 状态模块单测（node:test，零新增依赖——计划 §6 T2 判据）
 *
 * 覆盖：parseState 合法/非法/缺字段默认/未知字段容忍；原子写 tmp+rename
 * 不残留；fail-open 读（损坏 JSON → 空状态 + audit.warning 警告事件；
 * 文件缺失静默）；状态根 .gitignore 自创建（内容 `*`）、不覆盖已有。
 *
 * 链路：test/*.test.ts → esbuild bundle 成 .cjs → `node --test`（scripts/build.mjs --test）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultState, loadState, parseState, writeState } from '../src/lib/state.js'
import { ensureStateRoot, readEvents } from '../src/lib/events.js'

/** 建独立临时状态根（每个用例互不污染），用毕清理 */
function tempRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-state-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('parseState：合法完整 JSON 解析出各字段', () => {
  const raw = JSON.stringify({
    version: 1,
    updatedAt: '2026-08-19T10:00:00.000Z',
    activeMainlineId: 'm1',
    mainlines: {
      m1: {
        id: 'm1',
        name: '修登录',
        status: 'active',
        createdAt: '2026-08-19T09:00:00.000Z',
        updatedAt: '2026-08-19T10:00:00.000Z',
        claimedAt: null,
        rejectedAt: null,
        lastWriteAt: '2026-08-19T09:59:00.000Z',
      },
    },
    requirements: [
      {
        id: 'r1',
        mainlineId: 'm1',
        summary: '修复登录页',
        verifyCommand: 'npm test',
        status: 'declared',
        createdAt: '2026-08-19T09:00:00.000Z',
        blockedAt: null,
        blockedReason: null,
        doneAt: null,
      },
    ],
    governanceStrength: 1,
    loseStreak: 2,
    doneLock: true,
    lastVerification: {
      at: '2026-08-19T09:59:00.000Z',
      exitCode: 0,
      command: 'npm test',
      durationMs: 123,
    },
    verifyDeclarations: { m1: 'npm test' },
  })
  const r = parseState(raw)
  assert.equal(r.ok, true)
  const s = r.state
  assert.equal(s.version, 1)
  assert.equal(s.updatedAt, '2026-08-19T10:00:00.000Z')
  assert.equal(s.activeMainlineId, 'm1')
  assert.equal(s.mainlines['m1'].name, '修登录')
  assert.equal(s.mainlines['m1'].status, 'active')
  assert.equal(s.mainlines['m1'].lastWriteAt, '2026-08-19T09:59:00.000Z')
  assert.equal(s.requirements.length, 1)
  assert.equal(s.requirements[0].summary, '修复登录页')
  assert.equal(s.requirements[0].verifyCommand, 'npm test')
  assert.equal(s.governanceStrength, 1)
  assert.equal(s.loseStreak, 2)
  assert.equal(s.doneLock, true)
  assert.equal(s.lastVerification?.exitCode, 0)
  assert.equal(s.lastVerification?.command, 'npm test')
  assert.equal(s.verifyDeclarations['m1'], 'npm test')
  assert.deepEqual(s.extra, {})
})

test('parseState：非法 JSON → 判为损坏（corrupt），返回空状态（fail-open）', () => {
  const r = parseState('{ 这不是 JSON')
  assert.equal(r.ok, false)
  assert.equal(r.failure?.kind, 'corrupt')
  assert.ok(r.failure?.detail.includes('JSON'))
  assert.deepEqual(r.state, defaultState())
})

test('parseState：顶层非对象（数组/标量）→ invalid，返回空状态', () => {
  for (const bad of ['[1,2]', '"str"', '42', 'null', 'true']) {
    const r = parseState(bad)
    assert.equal(r.ok, false, `应为 invalid：${bad}`)
    assert.equal(r.failure?.kind, 'invalid')
    assert.deepEqual(r.state, defaultState())
  }
})

test('parseState：缺字段给默认值、未知字段容忍保留（additive-only 读端）', () => {
  const r = parseState(JSON.stringify({ foo: { bar: 1 }, loseStreak: 5 }))
  assert.equal(r.ok, true)
  const s = r.state
  assert.equal(s.version, 1)
  assert.equal(s.updatedAt, null)
  assert.equal(s.activeMainlineId, null)
  assert.equal(s.loseStreak, 5)
  assert.equal(s.governanceStrength, 0)
  assert.equal(s.doneLock, false)
  assert.equal(s.lastVerification, null)
  assert.deepEqual(s.mainlines, {})
  assert.deepEqual(s.requirements, [])
  assert.deepEqual(s.verifyDeclarations, {})
  assert.deepEqual(s.extra, { foo: { bar: 1 } })
})

test('parseState：字段级宽容——非法类型值回退默认、非法项丢弃', () => {
  const r = parseState(
    JSON.stringify({
      loseStreak: '不是数字',
      doneLock: 1,
      governanceStrength: -3,
      mainlines: { bad: '字符串', ok: { status: 'weird', claimedAt: 42 } },
      requirements: [null, { id: 'r1', mainlineId: 'm1', status: 'suspended' }],
      verifyDeclarations: { m1: 'npm test', m2: 42 },
    }),
  )
  assert.equal(r.ok, true)
  const s = r.state
  assert.equal(s.loseStreak, 0)
  assert.equal(s.doneLock, false)
  assert.equal(s.governanceStrength, 0) // 负值不信任，回退默认
  assert.deepEqual(Object.keys(s.mainlines), ['ok'])
  assert.equal(s.mainlines['ok'].status, 'active') // 非法 status 回退默认
  assert.equal(s.mainlines['ok'].claimedAt, null)
  assert.equal(s.requirements.length, 1)
  assert.equal(s.requirements[0].status, 'declared')
  assert.deepEqual(s.verifyDeclarations, { m1: 'npm test' })
})

test('additive-only 写回：未知字段经 writeState→loadState 循环不丢', (t) => {
  const dir = tempRoot(t)
  const s = defaultState()
  s.extra = { futureField: { a: 1 }, another: 'x' }
  writeState(dir, s)
  const loaded = loadState(dir)
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.state.extra, { futureField: { a: 1 }, another: 'x' })
})

test('writeState 原子写：state.json 就位、不残留 tmp（覆盖写亦然）', (t) => {
  const dir = tempRoot(t)
  const s = defaultState()
  s.activeMainlineId = 'm1'
  writeState(dir, s)
  assert.equal(existsSync(join(dir, 'state.json')), true)
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), [])
  // 覆盖写：旧值被替换、仍无 tmp 残留
  const s2 = defaultState()
  s2.loseStreak = 3
  writeState(dir, s2)
  assert.equal(existsSync(join(dir, 'state.json')), true)
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), [])
  const loaded = loadState(dir)
  assert.equal(loaded.state.loseStreak, 3)
  assert.equal(loaded.state.activeMainlineId, null)
})

test('writeState 覆盖残留 tmp（上次崩溃遗留）后不残留', (t) => {
  const dir = tempRoot(t)
  writeFileSync(join(dir, 'state.json.tmp'), '旧残留', 'utf8')
  writeState(dir, defaultState())
  assert.equal(existsSync(join(dir, 'state.json')), true)
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), [])
})

test('loadState：文件不存在（首次运行）→ 空状态、静默不写审计', (t) => {
  const dir = tempRoot(t)
  const r = loadState(dir)
  assert.equal(r.ok, true)
  assert.deepEqual(r.state, defaultState())
  assert.equal(existsSync(join(dir, 'events.jsonl')), false) // 非故障，无警告事件
})

test('loadState：损坏 JSON → 空状态放行 + audit.warning 警告事件（fail-open）', (t) => {
  const dir = tempRoot(t)
  writeFileSync(join(dir, 'state.json'), '{ 损坏', 'utf8')
  const r = loadState(dir)
  assert.equal(r.ok, false)
  assert.equal(r.failure?.kind, 'corrupt')
  assert.deepEqual(r.state, defaultState()) // 空状态放行，绝不阻塞
  const raw = readFileSync(join(dir, 'events.jsonl'), 'utf8')
  assert.match(raw, /audit\.warning/)
  assert.match(raw, /state\.json 损坏/)
  // 警告事件是系统事件，不被 readEvents 当业务事件
  const { events, skipped } = readEvents(dir)
  assert.equal(events.length, 0)
  assert.equal(skipped, 0)
})

test('loadState：顶层非对象 → 空状态放行 + 审计（invalid）', (t) => {
  const dir = tempRoot(t)
  writeFileSync(join(dir, 'state.json'), '[1,2,3]', 'utf8')
  const r = loadState(dir)
  assert.equal(r.ok, false)
  assert.equal(r.failure?.kind, 'invalid')
  assert.deepEqual(r.state, defaultState())
  assert.match(readFileSync(join(dir, 'events.jsonl'), 'utf8'), /state\.json 损坏/)
})

test('状态根自创建 .gitignore（内容 `*`），已有时不覆盖', (t) => {
  const dir = tempRoot(t)
  ensureStateRoot(dir)
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), '*\n')
  // 已存在（如用户手改）→ 绝不覆盖
  writeFileSync(join(dir, '.gitignore'), 'keep\n', 'utf8')
  ensureStateRoot(dir)
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'keep\n')
})
