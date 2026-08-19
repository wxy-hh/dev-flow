/**
 * 只读状态查询模块单测（node:test，零新增依赖——计划 §6 T8 判据）
 *
 * 覆盖：摘要字段投影（活跃/挂起/连败/治理/宣称/最近验收四字段/更新时间）、
 * 事件尾截取（>10 只留尾 10、自定义 limit、0 条）、空状态/损坏 state fail-open
 * （损坏/缺失 → "无状态"摘要而非报错）、events 坏行跳过、真实落盘 IO 链路、
 * 输出体积上限（token 面收敛红线：渲染恒 ≤ MAX_STATUS_CHARS，超限丢最旧事件行保头部）、
 * 事件摘要行只含压缩字段（t+text）。
 *
 * 链路：test/*.test.ts → esbuild bundle 成 .cjs → `node --test`（scripts/build.mjs --test）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildStatusSummary,
  EVENT_SUMMARY_LIMIT,
  loadStatusSummary,
  MAX_STATUS_CHARS,
  renderStatusSummary,
  type EventSummaryLine,
  type StatusSummary,
} from '../src/lib/status.js'
import { appendEvent, type DevFlowEvent } from '../src/lib/events.js'
import { defaultState, loadState, writeState } from '../src/lib/state.js'
import { applyEvents, rebuildState } from '../src/lib/rebuild.js'
import { readEvents } from '../src/lib/events.js'

/** 建独立临时状态根（每个用例互不污染），用毕清理 */
function tempRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-status-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// —— 事件构造器（测试数据面；时间戳用 ISO，真实链路 appendEvent 也是 toISOString） ——
function sessionStart(t: string): DevFlowEvent {
  return { type: 'session.start', t, mainlineId: '', sessionId: 's1', source: 'startup' }
}
function intentDeclared(t: string, mainlineId: string, summary: string): DevFlowEvent {
  return {
    type: 'intent.declared',
    t,
    mainlineId,
    requirementId: null,
    summary,
    verifyCommand: 'npm test',
    risk: null,
    files: [],
  }
}
function fileChanged(t: string, mainlineId: string, path: string): DevFlowEvent {
  return { type: 'file.changed', t, mainlineId, tool: 'Write', path }
}
function writeBlocked(t: string, mainlineId: string, path: string): DevFlowEvent {
  return { type: 'write.blocked', t, mainlineId, tool: 'Write', path, rule: 'sensitive-path' }
}
function verifyFailed(
  t: string,
  mainlineId: string,
  exitReason: DevFlowEvent extends infer _ ? 'timeout' | 'killed' | 'nonzero' | 'unknown' | null : never,
  exitCode: number | null = 1,
  command = 'npm test',
): DevFlowEvent {
  return {
    type: 'verify.failed',
    t,
    mainlineId,
    requirementId: null,
    exitCode,
    command,
    durationMs: null,
    outputTail: [],
    exitReason,
  }
}
function verifyPassed(t: string, mainlineId: string, command = 'npm test'): DevFlowEvent {
  return {
    type: 'verify.passed',
    t,
    mainlineId,
    requirementId: null,
    exitCode: 0,
    command,
    durationMs: 120,
  }
}
function doneRejected(t: string, mainlineId: string, reason: string): DevFlowEvent {
  return { type: 'done.rejected', t, mainlineId, reason }
}
function mainlineSwitch(t: string, from: string | null, to: string, name: string | null): DevFlowEvent {
  return { type: 'mainline.switch', t, mainlineId: '', from, to, name }
}

/** 构造主场景事件流（m1 挂起 + m2 活跃，覆盖全部摘要字段） */
function fullFixtureEvents(): DevFlowEvent[] {
  return [
    sessionStart('2026-08-19T09:00:00.000Z'),
    intentDeclared('2026-08-19T09:01:00.000Z', 'm1', '修复登录页'),
    fileChanged('2026-08-19T09:10:00.000Z', 'm1', 'src/login.ts'),
    writeBlocked('2026-08-19T09:11:00.000Z', 'm1', '.env'), // 治理强度升到 1
    verifyFailed('2026-08-19T09:20:00.000Z', 'm1', 'nonzero', 1, 'npm test'),
    doneRejected('2026-08-19T09:21:00.000Z', 'm1', '验收未过：测试失败'), // 连败 +1
    mainlineSwitch('2026-08-19T09:30:00.000Z', 'm1', 'm2', '修标签页'),
    intentDeclared('2026-08-19T09:31:00.000Z', 'm2', '做标签功能'),
    fileChanged('2026-08-19T09:40:00.000Z', 'm2', 'src/tags.ts'),
    verifyPassed('2026-08-19T09:50:00.000Z', 'm2', 'npm test'),
  ]
}

test('摘要字段投影：活跃/挂起/连败/治理/宣称/最近验收/更新时间 全对', () => {
  const events = fullFixtureEvents()
  const state = rebuildState(events)
  const s = buildStatusSummary(state, events)
  assert.equal(s.ok, true)
  assert.equal(s.failure, null)
  // 活跃主线 m2（软单主线；名称来自 mainline.switch 的 name）
  assert.equal(s.activeMainline!.id, 'm2')
  assert.equal(s.activeMainline!.name, '修标签页')
  assert.equal(s.activeMainline!.status, 'active')
  assert.equal(s.activeMainline!.claimedAt, null)
  assert.equal(s.activeMainline!.lastWriteAt, '2026-08-19T09:40:00.000Z')
  // 挂起列表：m1（名称回退到需求摘要）
  assert.equal(s.suspendedMainlines.length, 1)
  assert.equal(s.suspendedMainlines[0].id, 'm1')
  assert.equal(s.suspendedMainlines[0].name, '修复登录页')
  assert.equal(s.suspendedMainlines[0].status, 'suspended')
  assert.equal(s.suspendedMainlines[0].rejectedAt, '2026-08-19T09:21:00.000Z')
  // 计数与状态
  assert.equal(s.loseStreak, 1) // done.rejected 一次
  assert.equal(s.governanceStrength, 1) // write.blocked 升级
  assert.equal(s.doneClaimed, false) // 无 done.claimed
  // 最近验收：时间/命令/退出码/退出原因 四字段原样投影
  assert.equal(s.lastVerification!.at, '2026-08-19T09:50:00.000Z')
  assert.equal(s.lastVerification!.command, 'npm test')
  assert.equal(s.lastVerification!.exitCode, 0)
  assert.equal(s.lastVerification!.exitReason, null)
  assert.equal(s.lastVerification!.durationMs, 120)
  // 更新时间 = 最后折叠事件时间
  assert.equal(s.updatedAt, '2026-08-19T09:50:00.000Z')
  // 渲染文本：中文标签、短行、含各字段
  const text = s.text
  assert.ok(text.includes('活跃主线「修标签页」'), `应含活跃主线，实际：${text}`)
  assert.ok(text.includes('挂起：修复登录页'))
  assert.ok(text.includes('连败 1'))
  assert.ok(text.includes('治理 1'))
  assert.ok(text.includes('验收：通过 npm test（09:50:00）'))
  assert.ok(text.includes('宣称：未宣称'))
  assert.ok(text.includes('更新：09:50:00'))
  assert.ok(text.includes('最近事件：'))
  assert.ok(text.length <= MAX_STATUS_CHARS)
})

test('事件尾截取：多于 10 条只留尾 10；自定义 limit 与 0 生效', () => {
  const events = Array.from({ length: 15 }, (_, i) =>
    fileChanged(`2026-08-19T09:${String(i).padStart(2, '0')}:00.000Z`, 'm1', `src/f${i}.ts`),
  )
  const s = buildStatusSummary(defaultState(), events)
  assert.equal(s.recentEvents.length, EVENT_SUMMARY_LIMIT)
  // 尾 10 条，append 序（因果序）不重排：首条 = 原第 6 条，末条 = 原最后一条
  assert.equal(s.recentEvents[0].text, '改动：src/f5.ts')
  assert.equal(s.recentEvents[EVENT_SUMMARY_LIMIT - 1].text, '改动：src/f14.ts')
  // 自定义 limit
  const s3 = buildStatusSummary(defaultState(), events, { eventLimit: 3 })
  assert.equal(s3.recentEvents.length, 3)
  assert.equal(s3.recentEvents[0].text, '改动：src/f12.ts')
  // limit 0 = 不要事件摘要（slice(-0) 会取全量，须显式空数组）
  const s0 = buildStatusSummary(defaultState(), events, { eventLimit: 0 })
  assert.equal(s0.recentEvents.length, 0)
  assert.ok(!s0.text.includes('最近事件：'))
})

test('token 面收敛：事件摘要行只含压缩字段（t+text），不返回事件全量', () => {
  const events = [
    fileChanged('2026-08-19T09:00:00.000Z', 'm1', 'src/a.ts'),
    verifyPassed('2026-08-19T09:01:00.000Z', 'm1'),
  ]
  const s = buildStatusSummary(defaultState(), events)
  assert.equal(s.recentEvents.length, 2)
  assert.deepEqual(Object.keys(s.recentEvents[0]), ['t', 'text'])
  assert.equal(s.recentEvents[0].text, '改动：src/a.ts')
  assert.equal(s.recentEvents[1].text, '验收通过：npm test')
})

test('空状态：纯函数返回"无状态"文本（零仪式，非故障）', () => {
  const s = buildStatusSummary(defaultState(), [])
  assert.equal(s.ok, true)
  assert.equal(s.activeMainline, null)
  assert.equal(s.suspendedMainlines.length, 0)
  assert.equal(s.loseStreak, 0)
  assert.equal(s.lastVerification, null)
  assert.equal(s.text, '无状态：尚无主线（流程未开始）')
  // 仅会话开始（无主线）：不显示"无状态"，仍给出事件摘要
  const s2 = buildStatusSummary(defaultState(), [sessionStart('2026-08-19T09:00:00.000Z')])
  assert.ok(!s2.text.includes('无状态'))
  assert.ok(s2.text.includes('会话开始（s1，startup）'))
})

test('loadStatusSummary：首次运行（无 .dev-flow）→ 无状态摘要、ok=true（非故障）', (t) => {
  const dir = tempRoot(t)
  const s = loadStatusSummary(dir)
  assert.equal(s.ok, true)
  assert.equal(s.failure, null)
  assert.equal(s.text, '无状态：尚无主线（流程未开始）')
})

test('loadStatusSummary：损坏 state.json → fail-open（ok=false + 故障行，不抛错）', (t) => {
  const dir = tempRoot(t)
  mkdirSync(join(dir, '.dev-flow'), { recursive: true })
  writeFileSync(join(dir, '.dev-flow/state.json'), '{ 损坏', 'utf8')
  const s = loadStatusSummary(dir)
  assert.equal(s.ok, false)
  assert.ok(s.failure!.includes('state.json 损坏'))
  assert.equal(s.activeMainline, null) // 空状态放行
  assert.ok(s.text.includes('状态不可用'))
  assert.ok(s.text.includes('fail-open'))
  assert.ok(s.text.includes('doctor'))
  // 顶层非对象同样 fail-open
  writeFileSync(join(dir, '.dev-flow/state.json'), '[1,2,3]', 'utf8')
  const s2 = loadStatusSummary(dir)
  assert.equal(s2.ok, false)
  assert.ok(s2.failure!.includes('invalid'))
})

test('loadStatusSummary：events 坏行 → 跳过并告警，好行照常呈现（fail-open）', (t) => {
  const dir = tempRoot(t)
  const root = join(dir, '.dev-flow')
  appendEvent(root, { type: 'file.changed', mainlineId: 'm1', tool: 'Write', path: 'src/a.ts' })
  appendEvent(root, { type: 'verify.passed', mainlineId: 'm1', exitCode: 0, command: 'npm test' })
  appendFileSync(join(root, 'events.jsonl'), '{"type":"file.changed","mainlineId":"m1",', 'utf8') // 崩溃截断半行
  const s = loadStatusSummary(dir)
  assert.equal(s.ok, false)
  assert.ok(s.failure!.includes('跳过 1 行'))
  assert.equal(s.recentEvents.length, 2) // 好行不丢
  assert.ok(s.text.includes('验收通过：npm test'))
})

test('loadStatusSummary：真实落盘 state+events（hook 写路径）→ 完整摘要', (t) => {
  const dir = tempRoot(t)
  const root = join(dir, '.dev-flow')
  // 用现成写路径构造真实状态：appendEvent → 折叠 → writeState（与 hook 一致）
  appendEvent(root, { type: 'intent.declared', mainlineId: 'm1', summary: '修登录', verifyCommand: 'npm test' })
  appendEvent(root, { type: 'file.changed', mainlineId: 'm1', tool: 'Write', path: 'src/login.ts' })
  appendEvent(root, { type: 'verify.passed', mainlineId: 'm1', exitCode: 0, command: 'npm test' })
  appendEvent(root, {
    type: 'done.claimed',
    mainlineId: 'm1',
    requirementId: null,
    channel: 'tool',
  })
  const { state } = loadState(root)
  writeState(root, applyEvents(state, readEvents(root).events))
  const s = loadStatusSummary(dir)
  assert.equal(s.ok, true)
  assert.equal(s.activeMainline!.id, 'm1')
  assert.equal(s.activeMainline!.name, '修登录')
  assert.equal(s.doneClaimed, true) // done.claimed → doneLock
  assert.equal(s.lastVerification!.exitCode, 0)
  assert.ok(s.text.includes('已宣称'))
  assert.ok(s.text.includes('验收：通过 npm test'))
  assert.ok(s.text.length <= MAX_STATUS_CHARS)
})

test('渲染：最近验收退出原因四分类可区分（超时/被杀/非零/未知，T6 要求）', () => {
  const cases: Array<['timeout' | 'killed' | 'nonzero' | 'unknown', number | null, string]> = [
    ['timeout', null, '超时'],
    ['killed', null, '被杀'],
    ['nonzero', 2, 'exit 2'],
    ['unknown', null, '原因未知'],
  ]
  for (const [reason, code, label] of cases) {
    const ev = verifyFailed('2026-08-19T09:00:00.000Z', 'm1', reason, code, 'npm test')
    const s = buildStatusSummary(defaultState(), [ev])
    assert.ok(s.recentEvents[0].text.includes('验收失败'), `应含验收失败：${s.recentEvents[0].text}`)
    assert.ok(s.recentEvents[0].text.includes(label), `${reason} 应渲染 ${label}，实际：${s.recentEvents[0].text}`)
  }
  // 最近验收投影：最后一条折叠生效，四字段原样带出
  const state = rebuildState(
    cases.map(([reason, code]) => verifyFailed('2026-08-19T09:00:00.000Z', 'm1', reason, code, 'npm test')),
  )
  const s2 = buildStatusSummary(state, [])
  assert.equal(s2.lastVerification!.exitReason, 'unknown')
  assert.equal(s2.lastVerification!.exitCode, null)
  assert.equal(s2.lastVerification!.command, 'npm test')
  assert.ok(s2.text.includes('验收：失败 npm test（原因未知，09:00:00）'))
})

test('输出体积上限：长名称/长命令/12 事件下渲染恒 ≤ MAX_STATUS_CHARS，保头部丢最旧', () => {
  const longCmd = 'npm test -- --runInBand --coverage --ci --verbose --maxWorkers 1 '.repeat(4)
  const events = Array.from({ length: 12 }, (_, i) =>
    verifyFailed(
      `2026-08-19T09:${String(i).padStart(2, '0')}:00.000Z`,
      'm1',
      'nonzero',
      1,
      `${longCmd}${i}`,
    ),
  )
  const state = defaultState()
  state.activeMainlineId = 'm1'
  state.mainlines['m1'] = {
    id: 'm1',
    name: '超长主线名称'.repeat(20),
    status: 'active',
    createdAt: '',
    updatedAt: '',
    claimedAt: null,
    rejectedAt: null,
    lastWriteAt: '2026-08-19T09:10:00.000Z',
  }
  state.lastVerification = {
    at: '2026-08-19T09:14:00.000Z',
    exitCode: null,
    command: longCmd,
    durationMs: 9999,
    exitReason: 'timeout',
  }
  state.updatedAt = '2026-08-19T09:14:00.000Z'
  const s = buildStatusSummary(state, events)
  // 结构化面：尾截取仍给足 10 条（token 收敛在渲染面执行）
  assert.equal(s.recentEvents.length, EVENT_SUMMARY_LIMIT)
  assert.ok(s.text.length <= MAX_STATUS_CHARS, `渲染超限：${s.text.length} 字符`)
  // 预算让步：头部行恒在，最新事件行在，最旧事件行被丢
  // 注意：子串断言必须带行前缀全串（'09:09:00' 含子串 '09:00'，裸 '09:00' 会误判）
  assert.ok(s.text.includes('活跃主线「'))
  assert.ok(s.text.includes('验收：失败'))
  assert.ok(s.text.includes('09:11:00 验收失败')) // 最新事件（分钟 11）在
  assert.ok(!s.text.includes('09:00:00 验收失败')) // 最旧事件（分钟 0）已被预算丢弃
  // renderStatusSummary 独立调用同样守上限（maxChars 参数覆盖默认值）
  const small = renderStatusSummary(s, 300)
  assert.ok(small.length <= 300)
})

test('渲染：事件行换行压平（摘要/命令/原话含换行不破坏"每条一行"）', () => {
  const ev = intentDeclared('2026-08-19T09:00:00.000Z', 'm1', '第一行\n第二行')
  const s = buildStatusSummary(defaultState(), [ev])
  assert.equal(s.recentEvents[0].text, '声明意图：第一行 第二行')
  // 原始嵌入换行不在渲染文本中存活（行分隔符是渲染自身 join 的 \n）
  assert.ok(!s.text.includes('第一行\n第二行'))
  // 渲染文本每行至多一条事件：除行分隔符外无额外裸换行
  assert.equal(s.text.split('\n').filter((l) => l.includes('声明意图')).length, 1)
})
