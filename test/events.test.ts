/**
 * 事件模块单测（node:test，零新增依赖——计划 §6 T2 判据）
 *
 * 覆盖：sanitizeEvent 白名单提取与截断规则（用户原话 500 字符、命令输出
 * 尾部 20 行、行内截断、永不记文件内容、字段类型校验）；fitLine 超长降级；
 * appendEvent→readEvents 往返；崩溃截断半行 JSONL 跳过；畸形载荷审计；
 * auditWarning 系统事件。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendEvent,
  auditWarning,
  fitLine,
  readEvents,
  sanitizeEvent,
  MAX_LINE_BYTES,
  type DevFlowEvent,
  type SanitizeResult,
} from '../src/lib/events.js'

/** 建独立临时状态根（每个用例互不污染），用毕清理 */
function tempRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-events-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 断言 sanitize 成功并按 type 判别收窄到精确成员类型（测试类型守卫） */
function expectEvent<T extends DevFlowEvent['type']>(
  r: SanitizeResult,
  type: T,
): Extract<DevFlowEvent, { type: T }> {
  if (!r.ok) {
    throw new Error(`sanitize 应成功但被拒：${r.reason}`)
  }
  assert.equal(r.event.type, type)
  return r.event as Extract<DevFlowEvent, { type: T }>
}

test('sanitizeEvent：合法载荷白名单透传，未声明字段（文件内容）被丢弃', () => {
  const r = sanitizeEvent(
    {
      type: 'write.allowed',
      t: 'T0',
      mainlineId: 'm1',
      tool: 'Write',
      path: 'src/a.ts',
      rule: null,
      // 红线场景：payload 里混入内容类字段，必须被白名单丢弃
      content: '敏感文件内容',
      tool_response: '{"stdout":"秘密"}',
    },
    'NOW',
  )
  const e = expectEvent(r, 'write.allowed')
  assert.equal(e.t, 'T0')
  assert.equal(e.mainlineId, 'm1')
  assert.equal('content' in e, false)
  assert.equal('tool_response' in e, false)
})

test('sanitizeEvent：缺 t 用 now 兜底（纯函数确定性由调用方注入时间）', () => {
  const r = sanitizeEvent({ type: 'session.start', sessionId: 's1' }, 'NOW-1')
  const e = expectEvent(r, 'session.start')
  assert.equal(e.t, 'NOW-1')
  assert.equal(e.mainlineId, '')
})

test('sanitizeEvent：未知事件类型 → 拒绝（预算封顶，类型白名单外一律丢弃）', () => {
  const r = sanitizeEvent({ type: 'fake.event', t: 'T0' }, 'NOW')
  assert.equal(r.ok, false)
  assert.match(r.reason, /未知事件类型/)
})

test('sanitizeEvent：非对象载荷（数组/标量/null）→ 拒绝', () => {
  assert.equal(sanitizeEvent(null, 'NOW').ok, false)
  assert.equal(sanitizeEvent([1, 2], 'NOW').ok, false)
  assert.equal(sanitizeEvent('str', 'NOW').ok, false)
})

test('sanitizeEvent：用户原话截断 500 字符（红线）', () => {
  const r = sanitizeEvent(
    { type: 'escape.used', mainlineId: 'm1', quote: 'a'.repeat(600) },
    'NOW',
  )
  const e = expectEvent(r, 'escape.used')
  assert.equal(e.quote.length, 500)
})

test('sanitizeEvent：mainline.switch 带 name（T5 新主线名，additive 字段）', () => {
  const r = sanitizeEvent(
    { type: 'mainline.switch', mainlineId: 'ml-1', from: null, to: 'ml-1', name: '登录问题' },
    'NOW',
  )
  const e = expectEvent(r, 'mainline.switch')
  assert.equal(e.name, '登录问题')
  assert.equal(e.from, null)
  assert.equal(e.to, 'ml-1')
  // 缺 name → null（旧事件兼容）
  const r2 = sanitizeEvent({ type: 'mainline.switch', mainlineId: 'm2', from: 'm1', to: 'm2' }, 'NOW')
  const e2 = expectEvent(r2, 'mainline.switch')
  assert.equal(e2.name, null)
  // 非字符串 name → null（类型校验）
  const r3 = sanitizeEvent(
    { type: 'mainline.switch', mainlineId: 'm2', from: 'm1', to: 'm2', name: 42 },
    'NOW',
  )
  const e3 = expectEvent(r3, 'mainline.switch')
  assert.equal(e3.name, null)
})

test('sanitizeEvent：verify.failed 的 backgroundTaskId 透传、非字符串回退 null（additive 字段）', () => {
  // 字符串 → 透传（宿主后台任务 id，事实字段）
  const r = sanitizeEvent(
    { type: 'verify.failed', mainlineId: 'm1', command: 'node hang.js', exitReason: 'timeout', output: 'x', backgroundTaskId: 'bmbru41ng' },
    'NOW',
  )
  const e = expectEvent(r, 'verify.failed')
  assert.equal(e.backgroundTaskId, 'bmbru41ng')
  // 非字符串 → null（类型校验，不崩溃）
  const r2 = sanitizeEvent(
    { type: 'verify.failed', mainlineId: 'm1', command: 'node hang.js', output: 'x', backgroundTaskId: 42 },
    'NOW',
  )
  const e2 = expectEvent(r2, 'verify.failed')
  assert.equal(e2.backgroundTaskId, null)
  // 缺失 → null（旧事件兼容，additive-only）
  const r3 = sanitizeEvent({ type: 'verify.failed', mainlineId: 'm1', command: 'node check.js', output: 'x' }, 'NOW')
  const e3 = expectEvent(r3, 'verify.failed')
  assert.equal(e3.backgroundTaskId, null)
})

test('sanitizeEvent：命令输出只留尾部 20 行、行内截断（红线）', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
  const longLine = 'x'.repeat(500)
  const r = sanitizeEvent(
    { type: 'verify.failed', mainlineId: 'm1', exitCode: 1, command: 'npm test', output: [...lines.slice(0, 29), longLine] },
    'NOW',
  )
  const e = expectEvent(r, 'verify.failed')
  assert.equal(e.outputTail.length, 20)
  assert.equal(e.outputTail[0], 'line-10') // 尾部 20 行 = line-10..line-28, 长行
  assert.equal(e.outputTail[19], 'x'.repeat(200)) // 行内截到 200 字符
})

// 回归（2026-08-20 修）：产出方 buildVerifyEvent 的字段名是 outputTail（数组），
// sanitize 曾误读 o.output 导致落账永远为空
test('sanitizeEvent：verify.failed 的 outputTail 数组（产出方形状）透传并截尾', () => {
  const lines = Array.from({ length: 25 }, (_, i) => `tail-${i}`)
  const r = sanitizeEvent(
    { type: 'verify.failed', mainlineId: 'm1', command: 'npm test', outputTail: lines },
    'NOW',
  )
  const e = expectEvent(r, 'verify.failed')
  assert.equal(e.outputTail.length, 20)
  assert.equal(e.outputTail[0], 'tail-5')
})

test('sanitizeEvent：命令输出接收整段字符串（按行切分后取尾部）', () => {
  const r = sanitizeEvent(
    { type: 'verify.failed', mainlineId: 'm1', command: 'npm test', output: 'l1\nl2\nl3' },
    'NOW',
  )
  const e = expectEvent(r, 'verify.failed')
  assert.deepEqual(e.outputTail, ['l1', 'l2', 'l3'])
})

test('sanitizeEvent：字段类型校验——exitCode 非数字 → null，不崩溃', () => {
  const r = sanitizeEvent(
    { type: 'verify.failed', mainlineId: 'm1', exitCode: 'oops', command: 'npm t', output: 'x' },
    'NOW',
  )
  const e = expectEvent(r, 'verify.failed')
  assert.equal(e.exitCode, null)
})

test('fitLine：正常事件原样返回；超长事件先丢输出、再丢自由文本；仍超 → null', () => {
  // 正常事件：不降级
  const ok = sanitizeEvent({ type: 'session.start', sessionId: 's1' }, 'NOW')
  assert.ok(ok.ok)
  if (ok.ok) assert.equal(fitLine(ok.event), JSON.stringify(ok.event))

  // 超大输出（20 行 × 200 字符）→ 第一级降级丢掉 outputTail
  const big = sanitizeEvent(
    {
      type: 'verify.failed',
      mainlineId: 'm1',
      command: 'npm test',
      output: Array.from({ length: 20 }, () => 'y'.repeat(200)),
    },
    'NOW',
  )
  assert.ok(big.ok)
  if (big.ok) {
    const line = fitLine(big.event)
    assert.ok(line !== null)
    assert.ok(line!.length <= MAX_LINE_BYTES)
    assert.ok(!line!.includes('outputTail')) // 降级丢掉了输出细节
  }

  // 极端超长路径（事实字段不可丢）→ 降级后仍超 → null
  const extreme = sanitizeEvent(
    { type: 'write.allowed', mainlineId: 'm1', tool: 'Write', path: 'p'.repeat(2000), rule: null },
    'NOW',
  )
  assert.ok(extreme.ok)
  if (extreme.ok) assert.equal(fitLine(extreme.event), null)
})

test('appendEvent→readEvents 往返：事件顺序保留、逐行合法 JSON', (t) => {
  const dir = tempRoot(t)
  const a = appendEvent(dir, { type: 'session.start', sessionId: 's1' })
  const b = appendEvent(dir, { type: 'intent.declared', mainlineId: 'm1', summary: '修登录' })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.ok(a.bytes! > 0)
  const { events, skipped } = readEvents(dir)
  assert.equal(skipped, 0)
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'session.start')
  assert.equal(events[1].type, 'intent.declared')
  assert.equal(events[1].mainlineId, 'm1')
  // 每行都是合法 JSON（append 原语保证行完整性）
  const raw = readFileSync(join(dir, 'events.jsonl'), 'utf8')
  for (const line of raw.trimEnd().split('\n')) {
    assert.doesNotThrow(() => JSON.parse(line))
  }
})

test('appendEvent：畸形载荷（未知类型）→ 不写业务事件 + audit.warning 审计', (t) => {
  const dir = tempRoot(t)
  const r = appendEvent(dir, { type: 'fake.event', t: 'T0' })
  assert.equal(r.ok, false)
  assert.ok(r.reason)
  const { events, skipped } = readEvents(dir)
  assert.equal(events.length, 0)
  assert.equal(skipped, 0)
  assert.match(readFileSync(join(dir, 'events.jsonl'), 'utf8'), /audit\.warning/)
})

test('readEvents：崩溃截断的半行 JSONL → 跳过计数，其余保留（fail-open）', (t) => {
  const dir = tempRoot(t)
  appendEvent(dir, { type: 'session.start', sessionId: 's1' })
  appendEvent(dir, { type: 'file.changed', mainlineId: 'm1', tool: 'Write', path: 'a.ts' })
  // 模拟崩溃截断：最后一行是半截 JSON（无换行、parse 失败）
  appendFileSync(join(dir, 'events.jsonl'), '{"type":"verify.passed","t":"2026","mainli', 'utf8')
  const { events, skipped } = readEvents(dir)
  assert.equal(skipped, 1)
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'session.start')
  assert.equal(events[1].type, 'file.changed')
})

test('readEvents：空行/空白行跳过，不计数', (t) => {
  const dir = tempRoot(t)
  appendEvent(dir, { type: 'session.start', sessionId: 's1' })
  appendFileSync(join(dir, 'events.jsonl'), '\n   \n', 'utf8') // 空行与空白行
  const { events, skipped } = readEvents(dir)
  assert.equal(events.length, 1)
  assert.equal(skipped, 0)
})

test('auditWarning：写一行审计警告，readEvents 忽略（系统事件不入业务流）', (t) => {
  const dir = tempRoot(t)
  auditWarning(dir, '测试警告', 'test')
  const raw = readFileSync(join(dir, 'events.jsonl'), 'utf8')
  const parsed = JSON.parse(raw.trim())
  assert.equal(parsed.type, 'audit.warning')
  assert.equal(parsed.source, 'test')
  assert.equal(parsed.detail, '测试警告')
  const { events, skipped } = readEvents(dir)
  assert.equal(events.length, 0)
  assert.equal(skipped, 0)
})
