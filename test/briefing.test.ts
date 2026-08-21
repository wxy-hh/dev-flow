/**
 * SessionStart 播报模块单测（node:test，零新增依赖——计划 §6 T3 判据）
 *
 * 覆盖：意图块规则文本 ≤5 行断言（含 done 工具全名、verify 命令书写要求）；
 * 恢复播报生成（空状态 → null、有主线 →
 * 含主线名/阶段/还差什么、已宣称不播报、时间桶）；done 兜底四条件判定
 * （四条件各缺一条的排列、时间序严格比较、done.claimed 抑制、无写入视为恒晚）；
 * scanMainlineFacts 反向扫语义（最新值、他主线隔离）；scanEventsTail IO
 * （损坏行跳过+审计、文件缺失空事实）；注入文本组装（兜底优先于播报）。
 *
 * 链路：test/*.test.ts → esbuild bundle 成 .cjs → `node --test`（scripts/build.mjs --test）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildBriefing,
  buildSessionStartContext,
  doneFallbackMessage,
  INTENT_RULE_TEXT,
  mainlineName,
  renderAdditionalContext,
  timeAgoLabel,
} from '../src/lib/briefing.js'
import {
  appendEvent,
  emptyFacts,
  scanEventsTail,
  scanMainlineFacts,
  type DevFlowEvent,
} from '../src/lib/events.js'
import { defaultState } from '../src/lib/state.js'
import { rebuildState } from '../src/lib/rebuild.js'

/** 建独立临时状态根（每个用例互不污染），用毕清理 */
function tempRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-briefing-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// —— 事件构造器（测试数据面；时间戳用 ISO，真实链路 appendEvent 也是 toISOString） ——
function sessionStart(t: string): DevFlowEvent {
  return { type: 'session.start', t, mainlineId: '', sessionId: 's1', source: 'startup' }
}
function intentDeclared(t: string, summary: string, mainlineId = 'm1'): DevFlowEvent {
  return {
    type: 'intent.declared',
    t,
    mainlineId,
    requirementId: null,
    summary,
    verifyCommand: 'npm test',
    risk: null,
    files: ['src/tags.ts'],
  }
}
function fileChanged(t: string, path = 'src/tags.ts', mainlineId = 'm1'): DevFlowEvent {
  return { type: 'file.changed', t, mainlineId, tool: 'Write', path }
}
function verifyPassed(t: string, mainlineId = 'm1'): DevFlowEvent {
  return {
    type: 'verify.passed',
    t,
    mainlineId,
    requirementId: null,
    exitCode: 0,
    command: 'npm test',
    durationMs: null,
  }
}
function verifyFailed(t: string, mainlineId = 'm1'): DevFlowEvent {
  return {
    type: 'verify.failed',
    t,
    mainlineId,
    requirementId: null,
    exitCode: 1,
    command: 'npm test',
    durationMs: null,
    outputTail: [],
    exitReason: 'nonzero',
  }
}
function doneClaimed(t: string, mainlineId = 'm1'): DevFlowEvent {
  return { type: 'done.claimed', t, mainlineId, requirementId: null, channel: 'tool' }
}
function doneRejected(t: string, reason = '验收未过', mainlineId = 'm1'): DevFlowEvent {
  return { type: 'done.rejected', t, mainlineId, reason }
}

const NOW = '2026-08-19T12:00:00.000Z'

test('意图块规则文本 ≤5 行且含「#意图块」标记（常驻注入的 token 成本预算）', () => {
  const lines = INTENT_RULE_TEXT.split('\n').filter((l) => l.trim() !== '')
  assert.ok(lines.length <= 5, `规则应为 ≤5 行，实际 ${lines.length} 行`)
  assert.match(INTENT_RULE_TEXT, /#意图块/)
})

test('意图块规则告知 done 工具全名与 verify 命令书写要求（P1：模型从不调用 done 的根因修复）', () => {
  // done 工具全名（plugin dev-flow + MCP server df + 工具 done）必须出现在常驻注入里
  assert.ok(INTENT_RULE_TEXT.includes('mcp__plugin_dev-flow_df__done'))
  // verify 命令书写要求：可原样执行的单条命令
  assert.ok(INTENT_RULE_TEXT.includes('可原样执行的单条命令'))
  // 文案自身不违反书写要求：不出现反引号（避免示范错误写法）
  assert.ok(!INTENT_RULE_TEXT.includes('`'), '注入文案不应含反引号')
  // 未过验收会被驳回的后果告知
  assert.ok(INTENT_RULE_TEXT.includes('未过验收会被驳回'))
})

test('空状态：播报 null、兜底 null、注入仅常驻规则（零仪式，§4.1）', () => {
  const ctx = buildSessionStartContext(defaultState(), emptyFacts(), NOW)
  assert.equal(ctx.briefing, null)
  assert.equal(ctx.doneFallback, null)
  assert.equal(renderAdditionalContext(ctx), INTENT_RULE_TEXT) // 规则是常驻约定，不是仪式
})

test('恢复播报：未关闭主线 → 含主线名/阶段/还差什么（§5.6 形状）', () => {
  const events = [sessionStart('T0'), intentDeclared('T1', '做标签功能'), fileChanged('T2')]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  const b = buildBriefing(state, facts, NOW)
  assert.ok(b !== null)
  assert.ok(b!.includes('做标签功能')) // 主线名（state 名空时回退需求摘要）
  assert.ok(b!.includes('写代码')) // 阶段
  assert.ok(b!.includes('还差验证')) // 还差什么
})

test('恢复播报：验证未过 → 阶段含"验证"、还差修复后重验', () => {
  const events = [
    sessionStart('T0'),
    intentDeclared('T1', '做标签功能'),
    fileChanged('T2'),
    verifyFailed('T3'),
  ]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  const b = buildBriefing(state, facts, NOW)
  assert.ok(b !== null)
  assert.ok(b!.includes('验证'))
  assert.ok(b!.includes('修复后重验'))
})

test('恢复播报：主线已 done.claimed（已关闭）→ null（没什么可说的就什么都不说）', () => {
  const events = [
    sessionStart('T0'),
    intentDeclared('T1', '做标签功能'),
    fileChanged('T2'),
    verifyPassed('T3'),
    doneClaimed('T4'),
  ]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  assert.equal(buildBriefing(state, facts, NOW), null)
})

test('恢复播报：主线无名称无需求 → 兜底占位名；无进展 → 不编造阶段', () => {
  const state = rebuildState([
    { type: 'mainline.switch', t: '2026-08-18T10:00:00.000Z', mainlineId: '', from: null, to: 'm1' },
  ])
  const b = buildBriefing(state, emptyFacts(), NOW)
  assert.ok(b !== null)
  assert.ok(b!.includes('未命名主线'))
  assert.ok(b!.includes('还差实现与验证'))
})

test('timeAgoLabel 时间桶（刚才/今天/昨天/N 天前；不可解析 → 之前）', () => {
  const now = '2026-08-19T12:00:00.000Z'
  assert.equal(timeAgoLabel(now, '2026-08-19T11:59:00.000Z'), '刚才')
  assert.equal(timeAgoLabel(now, '2026-08-19T10:00:00.000Z'), '今天')
  assert.equal(timeAgoLabel(now, '2026-08-18T10:00:00.000Z'), '昨天')
  assert.equal(timeAgoLabel(now, '2026-08-15T10:00:00.000Z'), '4 天前')
  assert.equal(timeAgoLabel(now, null), '之前')
  assert.equal(timeAgoLabel(now, '不是时间'), '之前') // 宽容，不崩溃
})

test('mainlineName：state 名优先，其次需求摘要回退，最后占位', () => {
  const state = rebuildState([intentDeclared('T1', '做标签功能')])
  assert.equal(mainlineName(state, 'm1'), '做标签功能')
  // state 名有值 → 优先于需求摘要
  const named = rebuildState([intentDeclared('T1', '做标签功能')])
  named.mainlines['m1'].name = '标签功能二期'
  assert.equal(mainlineName(named, 'm1'), '标签功能二期')
  // 未知主线 → 占位
  assert.equal(mainlineName(state, 'nope'), '未命名主线')
})

test('done 兜底：四条件全中 → 注入确认提示（含主线名与"确认"）', () => {
  const events = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    fileChanged('2026-08-19T08:20:00.000Z'),
    verifyPassed('2026-08-19T08:30:00.000Z'),
  ]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  const msg = doneFallbackMessage(state, facts)
  assert.ok(msg !== null)
  assert.ok(msg!.includes('做标签功能'))
  assert.ok(msg!.includes('只差确认完成'))
  assert.ok(msg!.includes('请向用户展示摘要并确认'))
  // 兜底命中时注入 = 规则 + 兜底（播报被吸收，不叠加）
  const ctx = buildSessionStartContext(state, facts, NOW)
  const rendered = renderAdditionalContext(ctx)
  assert.ok(rendered.startsWith(INTENT_RULE_TEXT))
  assert.ok(rendered.includes(msg!))
})

test('done 兜底：四条件各缺一条 → null', () => {
  const base = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    fileChanged('2026-08-19T08:20:00.000Z'),
    verifyPassed('2026-08-19T08:30:00.000Z'),
  ]
  // 缺条件①（无未关闭主线）：空状态 + 任意事实 → null
  assert.equal(doneFallbackMessage(defaultState(), scanMainlineFacts(base, 'm1')), null)
  // 缺条件②（无 verify.passed）→ null
  const noVerify = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    fileChanged('2026-08-19T08:20:00.000Z'),
  ]
  assert.equal(
    doneFallbackMessage(rebuildState(noVerify), scanMainlineFacts(noVerify, 'm1')),
    null,
  )
  // 缺条件③（verify.passed 早于最后写入——代码变则验收失效）→ null
  const staleVerify = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    verifyPassed('2026-08-19T08:20:00.000Z'),
    fileChanged('2026-08-19T08:30:00.000Z'),
  ]
  assert.equal(
    doneFallbackMessage(rebuildState(staleVerify), scanMainlineFacts(staleVerify, 'm1')),
    null,
  )
  // 缺条件④（有 done.claimed → 抑制）→ null
  const claimed = [...base, doneClaimed('2026-08-19T08:31:00.000Z')]
  assert.equal(
    doneFallbackMessage(rebuildState(claimed), scanMainlineFacts(claimed, 'm1')),
    null,
  )
})

test('done 兜底：时间序边界——同时刻不命中（严格大于）、无写入视为恒晚', () => {
  // verify.passed 与最后写入同时刻（同毫秒）→ 不晚于 → null
  const same = [
    sessionStart('T0'),
    intentDeclared('T1', '做标签功能'),
    fileChanged('2026-08-19T09:00:00.000Z'),
    verifyPassed('2026-08-19T09:00:00.000Z'),
  ]
  assert.equal(
    doneFallbackMessage(rebuildState(same), scanMainlineFacts(same, 'm1')),
    null,
  )
  // 从未写入（文案类 verify:none 场景）→ verify.passed 晚于"无写入" → 命中
  const noWrite = [sessionStart('T0'), intentDeclared('T1', '改文案'), verifyPassed('T2')]
  const msg = doneFallbackMessage(rebuildState(noWrite), scanMainlineFacts(noWrite, 'm1'))
  assert.ok(msg !== null)
  assert.ok(msg!.includes('改文案'))
})

test('scanMainlineFacts：反向扫取最新值；他主线事件不计入', () => {
  const events = [
    sessionStart('T0'),
    intentDeclared('T1', '做标签功能'),
    fileChanged('T2'), // m1 写入 T2
    verifyPassed('T3'), // m1 验收 T3
    fileChanged('T4', 'src/b.ts', 'm2'), // 他主线
    verifyPassed('T5', 'm2'), // 他主线
    fileChanged('T6'), // m1 再写入 T6（验证已过期）
  ]
  const facts = scanMainlineFacts(events, 'm1')
  assert.equal(facts.lastWriteAt, 'T6') // 最新写入（反向扫语义，非首见）
  assert.equal(facts.lastVerifyPassedAt, 'T3')
  assert.equal(facts.lastProgress?.type, 'file.changed')
  assert.equal(facts.lastClaimOrReject, null)
  assert.equal(facts.lastVerifyFailed, null)
  // 他主线（m2）事实独立
  const m2 = scanMainlineFacts(events, 'm2')
  assert.equal(m2.lastVerifyPassedAt, 'T5')
  // 无该主线事件 → 空事实
  assert.deepEqual(scanMainlineFacts(events, 'ghost'), emptyFacts())
})

test('播报与兜底只针对活跃主线（软单主线 §5.7）', () => {
  const events = [
    sessionStart('T0'),
    intentDeclared('T1', '登录 bug', 'm1'),
    fileChanged('T2', 'src/login.ts', 'm1'),
    verifyPassed('T3', 'm1'),
    { type: 'mainline.switch' as const, t: 'T4', mainlineId: '', from: 'm1', to: 'm2' },
    intentDeclared('T5', '标签功能', 'm2'),
  ]
  const state = rebuildState(events)
  // 活跃主线 m2：无 verify.passed → 兜底不命中
  assert.equal(doneFallbackMessage(state, scanMainlineFacts(events, 'm2')), null)
  // 播报报活跃主线 m2，不报挂起的 m1
  const b = buildBriefing(state, scanMainlineFacts(events, 'm2'), NOW)
  assert.ok(b !== null)
  assert.ok(b!.includes('标签功能'))
  assert.ok(!b!.includes('登录 bug'))
})

test('renderAdditionalContext：兜底命中优先于播报；空状态仅规则', () => {
  const events = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    fileChanged('2026-08-19T08:20:00.000Z'),
    verifyPassed('2026-08-19T08:30:00.000Z'),
  ]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  const ctx = buildSessionStartContext(state, facts, NOW)
  assert.ok(ctx.doneFallback !== null)
  assert.ok(ctx.briefing !== null)
  const rendered = renderAdditionalContext(ctx)
  assert.ok(rendered.includes(ctx.doneFallback!))
  assert.ok(!rendered.includes(ctx.briefing!)) // 兜底吸收播报，不叠加
  // 空状态组合：仅规则
  assert.equal(
    renderAdditionalContext({ rule: INTENT_RULE_TEXT, briefing: null, doneFallback: null }),
    INTENT_RULE_TEXT,
  )
})

test('done 兜底：时间序语义（T6 C 项）——claimed→rejected→重验 passed → 兜底恢复触发', () => {
  // 曾宣称通过（claimed）→ 被驳回（rejected，用户发现验收其实没过/重开）→ 修复后重验
  // 通过：最近宣称痕迹是 rejected → 未关闭 → 兜底应触发（旧的"任一 claimed 即抑制"会误判）
  const events = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    fileChanged('2026-08-19T08:20:00.000Z'),
    verifyPassed('2026-08-19T08:30:00.000Z'),
    doneClaimed('2026-08-19T08:31:00.000Z'),
    doneRejected('2026-08-19T08:32:00.000Z', '验收失效：代码变更'),
    fileChanged('2026-08-19T08:33:00.000Z'), // 重开后的新写入
    verifyPassed('2026-08-19T08:40:00.000Z'), // 重验通过（晚于新写入）
  ]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  assert.equal(facts.lastClaimOrReject, 'rejected') // 最近痕迹是驳回 → 未关闭
  const msg = doneFallbackMessage(state, facts)
  assert.ok(msg !== null)
  assert.ok(msg!.includes('只差确认完成'))
  // 播报侧同步恢复（rejected 晚 → 未关闭 → 播报可触发）
  const b = buildBriefing(state, facts, NOW)
  assert.ok(b !== null)
})

test('done 兜底：时间序语义（T6 C 项）——claimed→rejected→claimed → 不触发（已关闭）', () => {
  const events = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    fileChanged('2026-08-19T08:20:00.000Z'),
    verifyPassed('2026-08-19T08:30:00.000Z'),
    doneClaimed('2026-08-19T08:31:00.000Z'),
    doneRejected('2026-08-19T08:32:00.000Z'),
    verifyPassed('2026-08-19T08:40:00.000Z'),
    doneClaimed('2026-08-19T08:41:00.000Z'), // 再次宣称通过 → 已关闭
  ]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  assert.equal(facts.lastClaimOrReject, 'claimed')
  assert.equal(doneFallbackMessage(state, facts), null)
  assert.equal(buildBriefing(state, facts, NOW), null)
})

test('done 兜底：时间序语义——rejected 后未重验 → 条件②缺失 → null', () => {
  const events = [
    sessionStart('2026-08-19T08:00:00.000Z'),
    intentDeclared('2026-08-19T08:01:00.000Z', '做标签功能'),
    fileChanged('2026-08-19T08:20:00.000Z'),
    verifyPassed('2026-08-19T08:30:00.000Z'),
    doneClaimed('2026-08-19T08:31:00.000Z'),
    doneRejected('2026-08-19T08:32:00.000Z'),
    fileChanged('2026-08-19T08:33:00.000Z'), // 又改了代码（验收失效）
  ]
  const state = rebuildState(events)
  const facts = scanMainlineFacts(events, 'm1')
  assert.equal(facts.lastClaimOrReject, 'rejected')
  assert.equal(doneFallbackMessage(state, facts), null) // 无新 verify.passed → 不触发
})

test('scanEventsTail：尾扫损坏行跳过+审计；文件缺失 → 空事实（fail-open）', (t) => {
  const dir = tempRoot(t)
  appendEvent(dir, { type: 'file.changed', mainlineId: 'm1', tool: 'Write', path: 'a.ts' })
  appendEvent(dir, { type: 'verify.passed', mainlineId: 'm1', exitCode: 0, command: 'npm test' })
  appendFileSync(join(dir, 'events.jsonl'), '{"type":"verify.passed","mainlineId":"m1",', 'utf8') // 崩溃截断半行
  const r = scanEventsTail(dir, 'm1')
  assert.equal(r.skipped, 1)
  assert.equal(r.readError, null)
  assert.ok(r.facts.lastWriteAt !== null)
  assert.ok(r.facts.lastVerifyPassedAt !== null)
  assert.match(readFileSync(join(dir, 'events.jsonl'), 'utf8'), /audit\.warning/) // 已审计
  // 文件缺失（新目录）→ 空事实、静默（首次运行非故障）
  const empty = scanEventsTail(join(dir, 'sub'), 'm1')
  assert.equal(empty.readError, null)
  assert.equal(empty.skipped, 0)
  assert.deepEqual(empty.facts, emptyFacts())
})
