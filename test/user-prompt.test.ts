/**
 * UserPromptSubmit 识别模块单测（node:test，零新增依赖——计划 §6 T5 判据）
 *
 * 覆盖：
 * - 识别器模式表：每通道精确命中；近义误伤用例（抱怨/疑问句/事实陈述不误判，
 *   零注入）；模糊语义只温和注入不写事件；宁漏勿误判（模式表外零注入）；
 * - 主线切换：指向/前缀提取新主线名、提取回退（截断原话占位）、同名重激活、
 *   新主线确定性编号、重申当前线零注入；
 * - 完成确认两跳状态机：第一跳置位、第二跳精确确认才推进、中间插入无关
 *   prompt 不推进也不污染、切换主线后待确认状态休眠；
 * - 事件形状与 T4 消费端契约对齐（escape/unlock 的 mainlineId、quote/context
 *   字段、hasUnconsumedUnlock 放行）；mainline.switch 的 from/to/name；
 * - sanitize 往返：upsEvents 产物经 sanitize 白名单后字段完整。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractSwitchName,
  nextPendingDoneConfirm,
  recognizeUserPrompt,
  renderUpsInjection,
  upsEvents,
  type RecognizeOptions,
  type UpsAction,
} from '../src/lib/user-prompt.js'
import { hasUnconsumedUnlock } from '../src/lib/write-gate.js'
import { appendEvent, readEvents, sanitizeEvent, type DevFlowEvent } from '../src/lib/events.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 识别器默认入参：无主线、无待确认 */
function opts(overrides: Partial<RecognizeOptions> = {}): RecognizeOptions {
  return { pendingMainlineId: null, activeMainlineId: null, mainlines: {}, ...overrides }
}

/** 断言识别结果的动作类型 */
function recognize(prompt: string, o: RecognizeOptions = opts()): UpsAction {
  return recognizeUserPrompt(prompt, o)
}

const NONE = { kind: 'none' } as const

// —— 逃生门（§5.5）——

test('逃生门：明确短语命中 → escape 动作（写事件 + 注入放行）', () => {
  for (const p of ['急，直接改', '直接改，我授权', '我授权你执行', '别拦了，直接改', '这个直接放行']) {
    const a = recognize(p)
    assert.equal(a.kind, 'escape', `应命中逃生门：${p}`)
  }
})

test('逃生门：抱怨/疑问/否定句不误判（零注入）', () => {
  for (const p of ['怎么又不行', '为什么又被拦', '怎么还没好', '不要直接改', '帮我把文案改一下']) {
    assert.deepEqual(recognize(p), NONE, `不应命中：${p}`)
  }
})

// —— 用户终裁解锁（§4.6）——

test('解锁：决策短语命中 → unlock 动作（含用户上下文原话）', () => {
  for (const p of ['算过', '算它过', '通过', '通过吧', '算过吧', '解锁', '放行', '放行吧', '我认可', '认可']) {
    assert.equal(recognize(p).kind, 'unlock', `应命中解锁：${p}`)
  }
})

test('解锁：事实陈述/汇报不算裁定（"算过了"/"测试通过了"零注入）', () => {
  for (const p of ['算过了', '测试通过了', '通过了', '这次验证通过了', '测试通过']) {
    assert.deepEqual(recognize(p), NONE, `事实陈述不应命中：${p}`)
  }
})

test('解锁：疑问/抱怨不误判', () => {
  for (const p of ['怎么又不行', '为什么还没通过', '解锁了吗']) {
    assert.deepEqual(recognize(p), NONE, `不应命中：${p}`)
  }
})

// —— 主线切换（§5.7）——

test('主线切换：指向短语（"先弄那个 X"）提取新主线名', () => {
  const a = recognize('先弄那个登录问题', opts())
  assert.equal(a.kind, 'switch')
  if (a.kind === 'switch') {
    assert.equal(a.name, '登录问题')
    assert.equal(a.from, null)
    assert.equal(a.to, 'ml-1')
  }
})

test('主线切换：前缀短语（"先做 X"）提取新主线名', () => {
  for (const [p, name] of [
    ['先做性能优化', '性能优化'],
    ['先弄登录', '登录'],
    ['先改那个配置', '配置'],
    ['转做登录', '登录'],
    ['我想先弄那个登录', '登录'],
    ['先做登录吧', '登录'],
  ] as const) {
    const a = recognize(p, opts())
    assert.equal(a.kind, 'switch', `应命中切换：${p}`)
    if (a.kind === 'switch') assert.equal(a.name, name, `主线名：${p}`)
  }
})

test('主线切换：提取不出名字 → 截断原话占位（§5.7 回退）', () => {
  const a = recognize('先弄那个', opts())
  assert.equal(a.kind, 'switch')
  if (a.kind === 'switch') assert.equal(a.name, '先弄那个')
  const b = recognize('先做那个吧', opts())
  assert.equal(b.kind, 'switch')
  if (b.kind === 'switch') assert.equal(b.name, '先做那个吧')
})

test('主线切换：非切换表述不误判（完成语/辅语开头/疑问）', () => {
  for (const p of ['先做完这个', '先做一下', '先做个原型', '先弄个目录', '先改一下', '先做那个呢']) {
    assert.deepEqual(recognize(p), NONE, `不应命中切换：${p}`)
  }
})

test('主线切换：同名已有主线 → 重激活（软单主线多线跳回）', () => {
  const mainlines = {
    'ml-1': { id: 'ml-1', name: '登录问题', status: 'suspended', createdAt: '', updatedAt: '', claimedAt: null, rejectedAt: null, lastWriteAt: null },
    'ml-2': { id: 'ml-2', name: '性能优化', status: 'active', createdAt: '', updatedAt: '', claimedAt: null, rejectedAt: null, lastWriteAt: null },
  }
  const a = recognize('先弄那个登录问题', opts({ activeMainlineId: 'ml-2', mainlines }))
  assert.equal(a.kind, 'switch')
  if (a.kind === 'switch') {
    assert.equal(a.to, 'ml-1', '同名挂起主线重激活（回到原 id）')
    assert.equal(a.from, 'ml-2')
  }
})

test('主线切换：重申当前活跃主线 → 零注入（无事可做不写事件）', () => {
  const mainlines = {
    'ml-1': { id: 'ml-1', name: '登录问题', status: 'active', createdAt: '', updatedAt: '', claimedAt: null, rejectedAt: null, lastWriteAt: null },
  }
  assert.deepEqual(recognize('先弄那个登录问题', opts({ activeMainlineId: 'ml-1', mainlines })), NONE)
})

test('主线切换：新主线确定性编号（ml-<count+1>）', () => {
  const mainlines = {
    'ml-1': { id: 'ml-1', name: '登录问题', status: 'suspended', createdAt: '', updatedAt: '', claimedAt: null, rejectedAt: null, lastWriteAt: null },
  }
  const a = recognize('先弄那个性能优化', opts({ activeMainlineId: 'ml-1', mainlines }))
  assert.equal(a.kind, 'switch')
  if (a.kind === 'switch') assert.equal(a.to, 'ml-2')
})

// —— 完成确认两跳（§6.3 用户通道）——

test('第一跳："好了"类命中 → doneHop1（不写事件，仅置中间态+注入）', () => {
  for (const p of ['好了', '完成了', '做完了', '改好了', '搞定了', '可以了', '收工', '先做完了']) {
    assert.equal(recognize(p).kind, 'doneHop1', `应命中第一跳：${p}`)
  }
})

test('第一跳：疑问句不误判（"好了吗"是问句不是完成宣称）', () => {
  for (const p of ['好了吗', '还没好', '怎么还没好', '写完了没', '完成了吗', '搞定了呢']) {
    assert.deepEqual(recognize(p), NONE, `不应命中第一跳：${p}`)
  }
})

test('第二跳：仅当中间态置位（属当前活跃主线）且精确确认短语 → doneHop2', () => {
  // 置位（无主线全局待确认）
  const armed = opts({ pendingMainlineId: '' })
  for (const p of ['确认', '确认。', '确认吧', '好的', '可以', '可以了', 'ok']) {
    assert.equal(recognize(p, armed).kind, 'doneHop2', `应命中第二跳：${p}`)
  }
  // 置位（归属主线 m1）
  const armedM1 = opts({ pendingMainlineId: 'm1', activeMainlineId: 'm1' })
  assert.equal(recognize('确认', armedM1).kind, 'doneHop2')
})

test('第二跳：中间态未置位 → "确认"零注入（防止无第一跳直接触发）', () => {
  assert.deepEqual(recognize('确认'), NONE)
  assert.deepEqual(recognize('好的'), NONE)
})

test('第二跳：待确认主线已切换（休眠态）→ 确认不推进', () => {
  const dormant = opts({ pendingMainlineId: 'm1', activeMainlineId: 'm2' })
  assert.deepEqual(recognize('确认', dormant), NONE, '切换后的活跃主线不继承待确认态')
})

test('两跳状态机：置位 → 无关 prompt 不推进不污染 → 精确确认才清空', () => {
  // 第一跳：置位（'' = 无活跃主线的全局待确认）
  let pending: string | null = null
  const hop1 = recognize('好了', opts({ pendingMainlineId: pending }))
  pending = nextPendingDoneConfirm(pending, hop1, null)
  assert.equal(pending, '')
  // 中间插入无关 prompt：不推进也不污染（保持置位）
  const idle = recognize('继续做', opts({ pendingMainlineId: pending }))
  assert.deepEqual(idle, NONE)
  pending = nextPendingDoneConfirm(pending, idle, null)
  assert.equal(pending, '', '无关 prompt 不推进')
  // 第二跳：精确确认才推进（清空）
  const hop2 = recognize('确认', opts({ pendingMainlineId: pending }))
  assert.equal(hop2.kind, 'doneHop2')
  pending = nextPendingDoneConfirm(pending, hop2, null)
  assert.equal(pending, null, '第二跳后清空（一次确认即完成，防重复触发）')
})

// —— 模糊语义（只温和注入，不写事件）——

test('模糊语义：只做温和注入（fuzzy 动作），不写事件', () => {
  for (const [p, channel] of [
    ['别拦我', 'escape'],
    ['换条线吧', 'switch'],
    ['切到生产环境验证下', 'switch'],
    ['差不多了', 'done'],
    ['通融一下', 'unlock'],
  ] as const) {
    const a = recognize(p)
    assert.equal(a.kind, 'fuzzy', `应温和注入：${p}`)
    if (a.kind === 'fuzzy') assert.equal(a.channel, channel)
  }
  // 模糊注入文本确实存在（注入面）
  const f = recognize('换条线吧')
  if (f.kind === 'fuzzy') assert.match(renderUpsInjection(f) ?? '', /切换/)
})

// —— 注入渲染 ——

test('注入渲染：零注入返回 null；各命中通道返回对应注入文本', () => {
  assert.equal(renderUpsInjection(NONE), null)
  assert.match(renderUpsInjection(recognize('急，直接改')) ?? '', /逃生门/)
  assert.match(renderUpsInjection(recognize('算过')) ?? '', /终裁解锁/)
  assert.match(renderUpsInjection(recognize('先弄那个登录')) ?? '', /切换主线/)
  assert.match(renderUpsInjection(recognize('好了')) ?? '', /待完成摘要/)
  assert.match(
    renderUpsInjection(recognize('确认', opts({ pendingMainlineId: '' }))) ?? '',
    /调用 done 工具/,
  )
})

// —— 事件形状（与 T4 消费端契约对齐）——

test('事件形状：escape.used 归属活跃主线、quote 记用户原话；T4 消费端放行', () => {
  const events = upsEvents({ kind: 'escape', quote: '急，直接改' }, 'm1', 'T')
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'escape.used')
  if (events[0].type === 'escape.used') {
    assert.equal(events[0].mainlineId, 'm1')
    assert.equal(events[0].quote, '急，直接改')
  }
  // T4 写门禁消费端契约：未消费 escape.used → 放行
  assert.equal(hasUnconsumedUnlock(events, 'm1'), true)
  // 无活跃主线 → mainlineId 空串（与门禁扫描 id 一致）
  const events2 = upsEvents({ kind: 'escape', quote: '直接改' }, null, 'T')
  if (events2[0].type === 'escape.used') assert.equal(events2[0].mainlineId, '')
  assert.equal(hasUnconsumedUnlock(events2, ''), true)
})

test('事件形状：unlock 归属活跃主线、context 记用户上下文；T4 消费端放行', () => {
  const events = upsEvents({ kind: 'unlock', context: '环境有问题，算过' }, 'm1', 'T')
  assert.equal(events[0].type, 'unlock')
  if (events[0].type === 'unlock') {
    assert.equal(events[0].mainlineId, 'm1')
    assert.equal(events[0].context, '环境有问题，算过')
  }
  assert.equal(hasUnconsumedUnlock(events, 'm1'), true)
})

test('事件形状：mainline.switch 的 from/to/name 与 mainlineId=to 一致', () => {
  const events = upsEvents({ kind: 'switch', from: 'm1', to: 'ml-2', name: '性能优化', quote: '先弄那个性能优化' }, 'm1', 'T')
  assert.equal(events[0].type, 'mainline.switch')
  if (events[0].type === 'mainline.switch') {
    assert.equal(events[0].mainlineId, 'ml-2', '事件归属新主线（写入归活跃主线）')
    assert.equal(events[0].from, 'm1')
    assert.equal(events[0].to, 'ml-2')
    assert.equal(events[0].name, '性能优化')
  }
})

test('事件形状：第一跳/第二跳不产生事件（hook 不翻转状态，attestation）', () => {
  assert.deepEqual(upsEvents({ kind: 'doneHop1' }, null, 'T'), [])
  assert.deepEqual(upsEvents({ kind: 'doneHop2' }, null, 'T'), [])
  assert.deepEqual(upsEvents({ kind: 'fuzzy', channel: 'done', quote: '差不多了' }, null, 'T'), [])
})

test('sanitize 往返：upsEvents 产物经白名单后字段完整（append → read）', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-ups-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ev = upsEvents({ kind: 'switch', from: null, to: 'ml-1', name: '登录问题', quote: '先弄那个登录问题' }, null, 'T')[0]
  const r = sanitizeEvent(ev, 'T')
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.event.type, 'mainline.switch')
    if (r.event.type === 'mainline.switch') {
      assert.equal(r.event.name, '登录问题')
      assert.equal(r.event.to, 'ml-1')
    }
  }
  const ok = appendEvent(dir, ev)
  assert.equal(ok.ok, true)
  const { events } = readEvents(dir)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'mainline.switch')
})

test('extractSwitchName：清理指向词/标点/语气词；空回退', () => {
  assert.equal(extractSwitchName(' 登录问题 ', '占位'), '登录问题')
  assert.equal(extractSwitchName('，登录', '占位'), '登录')
  assert.equal(extractSwitchName('那个性能优化', '占位'), '性能优化')
  assert.equal(extractSwitchName('登录吧。', '占位'), '登录')
  assert.equal(extractSwitchName('  ', '占位'), '占位')
})
