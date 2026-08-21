/**
 * 写门禁主决策单测（node:test，零新增依赖——计划 §4 T4 判据）
 *
 * 覆盖：一拦二放状态机（首拦 deny+模板 / 重试放行 / 已声明不拦）；重试通行证
 * 一次性语义（P1：写入落账即消费、session.start 会话边界作废、声明主线不误伤）；
 * 隐式主线指派（P0：无活跃主线时首条 intent.declared 自动建唯一主线 id，同毫秒
 * 并发进程 id 必不同；rebuild 确定性靠 id 烘焙进事件，不靠同 now 同 id）；
 * 敏感路径升级语义（未声明 deny 带规则名 / 已声明放行带规则名 + 治理升级）；
 * unlock/escape.used 消费端（未消费放行、已消费回到正常门禁）；transcript 声明
 * 放行加分项（intent.declared 落账 + verify 声明）；Bash 逐目标判定（任一 deny
 * 整命令 deny、多目标声明只落账一次、批前预计算通行证、file.changed 补记）；
 * applyEvents 折叠（治理强度只升不降、verifyDeclarations 后者覆盖前者）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assignImplicitMainline,
  buildFileChangedEvent,
  decideBashWrite,
  decidePathWrite,
  decideToolWrite,
  hasUnconsumedUnlock,
  IMPLICIT_MAINLINE_PREFIX,
  INTENT_GATE_TEMPLATE,
  type GateContext,
} from '../src/lib/write-gate.js'
import { defaultState, type DevFlowState } from '../src/lib/state.js'
import { defaultConfig } from '../src/lib/config.js'
import { applyEvents } from '../src/lib/rebuild.js'
import type { DevFlowEvent } from '../src/lib/events.js'

/** 构造单路径门禁上下文（默认：非敏感路径、空事件、无主线） */
function mkCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    tool: 'Write',
    rawPath: 'src/foo.js',
    command: null,
    mainlineId: '',
    cwd: '/proj',
    pluginRoot: null,
    state: defaultState(),
    events: [],
    config: defaultConfig(),
    transcript: null,
    now: 'T',
    ...overrides,
  }
}

/** 便捷构造事件（mainlineId 默认当前主线） */
function ev(type: string, extra: Record<string, unknown> = {}): DevFlowEvent {
  return { type, t: 'T', mainlineId: '', ...extra } as DevFlowEvent
}

const intentBlockedEv = (): DevFlowEvent =>
  ev('intent.blocked', { requirementId: null, reason: 'x', rule: 'first-write-gate' })
const intentDeclaredEv = (files: string[] = ['src/foo.js'], verify = 'npm test'): DevFlowEvent =>
  ev('intent.declared', { requirementId: null, summary: 's', verifyCommand: verify, risk: null, files })
const writeAllowedEv = (): DevFlowEvent => ev('write.allowed', { tool: 'Write', path: 'src/foo.js', rule: null })
const unlockEv = (): DevFlowEvent => ev('unlock', { context: '我授权' })

// —— 一拦二放状态机 ——

test('一拦二放①：首次写入无声明 → deny + 四要素模板 + intent.blocked', () => {
  const r = decidePathWrite(mkCtx())
  assert.equal(r.decision, 'deny')
  assert.equal(r.reason, INTENT_GATE_TEMPLATE)
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].type, 'intent.blocked')
  assert.equal((r.events[0] as { rule: string }).rule, 'first-write-gate')
})

test('一拦二放②：已记 intent.blocked → 重试放行（审计标注 + write.allowed）', () => {
  const r = decidePathWrite(mkCtx({ events: [intentBlockedEv()] }))
  assert.equal(r.decision, 'allow')
  assert.equal(r.events.length, 2)
  assert.equal(r.events[0].type, 'intent.blocked')
  assert.equal(r.events[1].type, 'write.allowed')
})

test('一拦二放③：已有 intent.declared → 直接放行（不再记声明）', () => {
  const r = decidePathWrite(mkCtx({ events: [intentDeclaredEv()] }))
  assert.equal(r.decision, 'allow')
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].type, 'write.allowed')
})

test('一拦二放④：transcript 声明 → 放行 + intent.declared 落账（含 verify 声明）', () => {
  const r = decidePathWrite(
    mkCtx({
      transcript: { declared: true, summary: '改标签', verifyCommand: 'npm run check', risk: null, files: ['src/foo.js'] },
    }),
  )
  assert.equal(r.decision, 'allow')
  assert.equal(r.events.length, 2)
  assert.equal(r.events[0].type, 'intent.declared')
  const d = r.events[0] as { verifyCommand: string | null; files: string[] }
  assert.equal(d.verifyCommand, 'npm run check')
  assert.deepEqual(d.files, ['src/foo.js'])
  assert.equal(r.events[1].type, 'write.allowed')
})

test('一拦二放⑤：主线隔离——他主线已声明不影响本主线判定', () => {
  const other = intentDeclaredEv()
  const r = decidePathWrite(mkCtx({ mainlineId: 'm1', events: [ev('intent.declared', { mainlineId: 'm2', requirementId: null, summary: 's', verifyCommand: null, risk: null, files: [] })] }))
  assert.equal(r.decision, 'deny', '他主线声明不算本主线声明')
})

// —— 重试通行证一次性语义（P1 修复"一次拦截终身放行"漂移）——

const sessionStartEv = (source = 'compact'): DevFlowEvent =>
  ev('session.start', { sessionId: 's1', source })

test('通行证一次性①：被拦后紧接着的重试仍放行（语义不回归）', () => {
  const r = decidePathWrite(mkCtx({ events: [intentBlockedEv()] }))
  assert.equal(r.decision, 'allow')
  assert.deepEqual(r.events.map((e) => e.type), ['intent.blocked', 'write.allowed'])
})

test('通行证一次性②：重试已放行（write.allowed 落账）→ 后续写入重新拦截', () => {
  // 漂移场景：一次 intent.blocked 后所有写入都走重试放行 → 现在第二张写入被拦
  const r = decidePathWrite(mkCtx({ events: [intentBlockedEv(), writeAllowedEv()] }))
  assert.equal(r.decision, 'deny')
  assert.equal(r.reason, INTENT_GATE_TEMPLATE)
  assert.equal(r.events[0].type, 'intent.blocked')
})

test('通行证一次性③：file.changed 落账同样消费通行证 → 重新拦截', () => {
  const r = decidePathWrite(mkCtx({ events: [intentBlockedEv(), writeAllowedEv(), ev('file.changed', { tool: 'Write', path: 'src/foo.js' })] }))
  assert.equal(r.decision, 'deny')
})

test('会话边界①：compact/新会话（session.start）后通行证作废 → 重新要求意图块', () => {
  const r = decidePathWrite(mkCtx({ events: [intentBlockedEv(), sessionStartEv()] }))
  assert.equal(r.decision, 'deny', 'session.start 后的首次写入重新拦截')
})

test('会话边界②：session.start 早于被拦 → 通行证有效（边界只往前作废）', () => {
  const r = decidePathWrite(mkCtx({ events: [sessionStartEv('startup'), intentBlockedEv()] }))
  assert.equal(r.decision, 'allow')
})

test('会话边界③：已声明主线不受 session.start 影响（设计本意，不误伤）', () => {
  const r = decidePathWrite(mkCtx({ events: [intentDeclaredEv(), sessionStartEv()] }))
  assert.equal(r.decision, 'allow')
  assert.deepEqual(r.events.map((e) => e.type), ['write.allowed'])
})

test('会话边界④：session.start 跨主线生效（他主线的通行证同样作废）', () => {
  // session.start 记账时 mainlineId 恒为 ''；m1 上被拦后跨会话，m1 的通行证也作废
  const r = decidePathWrite(mkCtx({ mainlineId: 'm1', events: [ev('intent.blocked', { mainlineId: 'm1', requirementId: null, reason: 'x', rule: 'first-write-gate' }), sessionStartEv()] }))
  assert.equal(r.decision, 'deny')
})

test('声明晚于被拦：旧 blocked 痕迹不复活通行证（走声明放行分支）', () => {
  const r = decidePathWrite(mkCtx({ events: [intentBlockedEv(), intentDeclaredEv()] }))
  assert.equal(r.decision, 'allow')
  assert.deepEqual(r.events.map((e) => e.type), ['write.allowed'], '声明分支放行，不记重试标注')
})

test('首拦模板口径：verify 命令须可原样执行（单条命令、无反引号、非自然语言）', () => {
  assert.match(INTENT_GATE_TEMPLATE, /可原样执行的单条命令/)
  assert.match(INTENT_GATE_TEMPLATE, /不要反引号、不要自然语言描述/)
})

// —— 敏感路径升级语义 ——

test('敏感未声明 → deny + write.blocked 带规则名 + 理由含敏感提示与用户放行出口', () => {
  const r = decidePathWrite(mkCtx({ rawPath: '.env' }))
  assert.equal(r.decision, 'deny')
  assert.equal(r.events[0].type, 'write.blocked')
  assert.equal((r.events[0] as { rule: string }).rule, 'secret.env')
  assert.match(r.reason ?? '', /命中敏感路径/)
  assert.match(r.reason ?? '', /secret\.env/)
  assert.match(r.reason ?? '', /用户一句话放行/)
})

test('敏感已声明（事件声明 files 覆盖）→ 放行 + write.allowed 带规则名', () => {
  const r = decidePathWrite(mkCtx({ rawPath: '.env', events: [intentDeclaredEv(['.env'])] }))
  assert.equal(r.decision, 'allow')
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].type, 'write.allowed')
  assert.equal((r.events[0] as { rule: string | null }).rule, 'secret.env')
})

test('敏感已声明（transcript 声明覆盖）→ 放行 + intent.declared + write.allowed 带规则名', () => {
  const r = decidePathWrite(
    mkCtx({
      rawPath: '.env',
      transcript: { declared: true, summary: '改 env', verifyCommand: null, risk: null, files: ['.env'] },
    }),
  )
  assert.equal(r.decision, 'allow')
  assert.deepEqual(r.events.map((e) => e.type), ['intent.declared', 'write.allowed'])
  assert.equal((r.events[1] as { rule: string | null }).rule, 'secret.env')
})

test('敏感已声明但声明 files 未覆盖该路径 → 仍 deny（宁严不松）', () => {
  const r = decidePathWrite(mkCtx({ rawPath: '.env', events: [intentDeclaredEv(['src/foo.js'])] }))
  assert.equal(r.decision, 'deny')
})

test('治理升级：write.allowed 带规则名 → governanceStrength 升（只升不降）', () => {
  const state: DevFlowState = defaultState()
  applyEvents(state, [intentDeclaredEv(['.env'], 'npm test')])
  applyEvents(state, [
    ev('write.allowed', { tool: 'Write', path: '.env', rule: 'secret.env', mainlineId: '' }),
  ])
  assert.equal(state.governanceStrength, 1)
  // 普通放行不升级
  const s2: DevFlowState = defaultState()
  applyEvents(s2, [writeAllowedEv()])
  assert.equal(s2.governanceStrength, 0)
})

test('verifyDeclarations：intent.declared 的 verify 命令入声明表，后者覆盖前者', () => {
  const state: DevFlowState = defaultState()
  applyEvents(state, [intentDeclaredEv([], 'npm test')])
  assert.equal(state.verifyDeclarations[''], 'npm test')
  applyEvents(state, [intentDeclaredEv([], 'npm run check')])
  assert.equal(state.verifyDeclarations[''], 'npm run check', '后者覆盖前者')
})

// —— 用户一句话放行消费端 ——

test('unlock 未消费 → 放行；消费事实=其后已有写入事件', () => {
  const ctx = mkCtx({ events: [unlockEv()] })
  assert.equal(hasUnconsumedUnlock(ctx.events, ''), true)
  const r = decidePathWrite(ctx)
  assert.equal(r.decision, 'allow')
  assert.equal(r.events[0].type, 'write.allowed')
  // 消费后：unlock 后有 write.allowed → 未消费判定为假
  const consumed = mkCtx({ events: [unlockEv(), writeAllowedEv()] })
  assert.equal(hasUnconsumedUnlock(consumed.events, ''), false)
})

test('unlock 已消费 → 回到正常门禁（首拦仍拦）', () => {
  const r = decidePathWrite(mkCtx({ events: [unlockEv(), writeAllowedEv()] }))
  assert.equal(r.decision, 'deny', '解锁已被消费，本次首次写入照常拦')
})

test('escape.used 未消费 → 放行（逃生门消费端）', () => {
  const r = decidePathWrite(mkCtx({ events: [ev('escape.used', { quote: '急，直接改' })] }))
  assert.equal(r.decision, 'allow')
})

test('unlock 放行敏感路径：write.allowed 带规则名', () => {
  const r = decidePathWrite(mkCtx({ rawPath: '.env', events: [unlockEv()] }))
  assert.equal(r.decision, 'allow')
  assert.equal((r.events[0] as { rule: string | null }).rule, 'secret.env')
})

// —— Write/Edit/MultiEdit 入口决策 ——

test('decideToolWrite：异常载荷（无路径）放行不拦', () => {
  const r = decideToolWrite({ tool: 'Write', filePath: null, mainlineId: '', cwd: '/proj', pluginRoot: null, state: defaultState(), events: [], config: defaultConfig(), transcript: null, now: 'T' })
  assert.equal(r.decision, 'allow')
  assert.deepEqual(r.events, [])
})

test('decideToolWrite：Edit 也走同一门禁（敏感路径拦截）', () => {
  const r = decideToolWrite({ tool: 'Edit', filePath: '.env', mainlineId: '', cwd: '/proj', pluginRoot: null, state: defaultState(), events: [], config: defaultConfig(), transcript: null, now: 'T' })
  assert.equal(r.decision, 'deny')
})

// —— Bash 门禁 ——

function bashArgs(cmd: string, overrides: Partial<Parameters<typeof decideBashWrite>[0]> = {}) {
  return {
    command: cmd,
    mainlineId: '',
    cwd: '/proj',
    pluginRoot: null,
    state: defaultState(),
    events: [],
    config: defaultConfig(),
    transcript: null,
    now: 'T',
    ...overrides,
  }
}

test('Bash 写敏感路径未声明 → deny + write.blocked（规则名）', () => {
  const r = decideBashWrite(bashArgs('echo x > .env'))
  assert.equal(r.decision, 'deny')
  assert.equal(r.events[0].type, 'write.blocked')
  assert.equal((r.events[0] as { rule: string }).rule, 'secret.env')
})

test('Bash 写非敏感路径（已声明）→ 放行 + write.allowed + file.changed', () => {
  const r = decideBashWrite(
    bashArgs('echo x > src/foo.js', { events: [intentDeclaredEv(['src/foo.js'])] }),
  )
  assert.equal(r.decision, 'allow')
  const types = r.events.map((e) => e.type)
  assert.deepEqual(types, ['write.allowed', 'file.changed'])
  assert.equal((r.events[1] as { path: string }).path, 'src/foo.js')
})

test('Bash 写敏感路径已声明 → 放行 + write.allowed(规则) + file.changed', () => {
  const r = decideBashWrite(bashArgs('echo x > .env', { events: [intentDeclaredEv(['.env'])] }))
  assert.equal(r.decision, 'allow')
  assert.equal((r.events[0] as { rule: string | null }).rule, 'secret.env')
  assert.deepEqual(r.events.map((e) => e.type), ['write.allowed', 'file.changed'])
})

test('Bash 多目标：任一敏感未声明 → 整命令 deny', () => {
  const r = decideBashWrite(bashArgs('echo x > .env && echo y > src/a.js'))
  assert.equal(r.decision, 'deny')
  assert.equal(r.events[0].type, 'write.blocked')
  assert.equal((r.events[0] as { rule: string }).rule, 'secret.env')
})

test('Bash 多目标：声明只落账一次、file.changed 每目标补记', () => {
  const r = decideBashWrite(
    bashArgs('echo x > src/a.js && echo y > src/b.js', {
      transcript: { declared: true, summary: 's', verifyCommand: 'npm test', risk: null, files: ['src/'] },
    }),
  )
  assert.equal(r.decision, 'allow')
  const types = r.events.map((e) => e.type)
  assert.equal(types.filter((t) => t === 'intent.declared').length, 1, '声明只落账一次')
  assert.equal(types.filter((t) => t === 'file.changed').length, 2, '每个目标补 file.changed')
})

test('Bash 不可逆操作 → deny + write.blocked(irreversible.push)；unlock 未消费可放行', () => {
  const r = decideBashWrite(bashArgs('git push'))
  assert.equal(r.decision, 'deny')
  assert.match(r.reason ?? '', /不可逆/)
  assert.equal((r.events[0] as { rule: string }).rule, 'irreversible.push')
  // 用户一句话授权放行
  const r2 = decideBashWrite(bashArgs('git push', { events: [unlockEv()] }))
  assert.equal(r2.decision, 'allow')
  assert.deepEqual(r2.events, [])
})

test('Bash 无写入目标（纯读/解析不出）→ 放行零事件', () => {
  const r = decideBashWrite(bashArgs('ls -la'))
  assert.equal(r.decision, 'allow')
  assert.deepEqual(r.events, [])
})

test('Bash 重试放行：intent.blocked 重试标注只标一次（多目标）', () => {
  const r = decideBashWrite(
    bashArgs('echo x > src/a.js && echo y > src/b.js', { events: [intentBlockedEv()] }),
  )
  assert.equal(r.decision, 'allow')
  const blockedMarks = r.events.filter((e) => e.type === 'intent.blocked')
  assert.equal(blockedMarks.length, 1, '重试标注只一次')
})

test('Bash 重试放行：多目标共用批前通行证（批内 write.allowed 不误消费）', () => {
  // P1 回归锁：通行证一次性语义下，若逐目标现场扫描，第一个目标的
  // write.allowed 会把通行证消费掉，第二个目标被误拦——必须整批放行
  const r = decideBashWrite(
    bashArgs('echo x > src/a.js && echo y > src/b.js', { events: [intentBlockedEv()] }),
  )
  assert.equal(r.decision, 'allow')
  assert.equal(r.events.filter((e) => e.type === 'write.allowed').length, 2, '两个目标都放行')
  assert.equal(r.events.filter((e) => e.type === 'file.changed').length, 2)
})

test('Bash 重试放行后：下一命令无声明 → 重新拦截（通行证不跨工具调用）', () => {
  const r = decideBashWrite(
    bashArgs('echo x > src/a.js', { events: [intentBlockedEv(), writeAllowedEv(), ev('file.changed', { tool: 'Bash', path: 'src/a.js' })] }),
  )
  assert.equal(r.decision, 'deny')
})

// —— assignImplicitMainline（P0：首条 intent.declared 自动建隐式主线）——

test('隐式主线①：无活跃主线 + 批内含空主线 intent.declared → 同批归入新主线', () => {
  const batch: DevFlowEvent[] = [
    ev('intent.declared', { requirementId: null, summary: 's', verifyCommand: 'npm test', risk: null, files: ['src/'] }),
    writeAllowedEv(),
  ]
  const out = assignImplicitMainline(batch, null, '2026-08-21T03:42:49.058Z', '4242abc1')
  const id = `${IMPLICIT_MAINLINE_PREFIX}20260821034249058-4242abc1`
  assert.ok(out.every((e) => e.mainlineId === id), '同批空主线事件全部归入新线')
  assert.equal(out[0].type, 'intent.declared', '事件其余字段不动')
  // 确定性（id 烘焙进事件，rebuild 重放靠它，不靠同 now 同 id）：同输入同输出
  assert.deepEqual(assignImplicitMainline(batch, null, '2026-08-21T03:42:49.058Z', '4242abc1'), out)
  // 不改输入（纯函数纪律）
  assert.equal(batch[0].mainlineId, '')
})

test('隐式主线①b：同毫秒两个进程（唯一性后缀不同）→ id 必不同（防并发撞线合并）', () => {
  const batch: DevFlowEvent[] = [
    ev('intent.declared', { requirementId: null, summary: 's', verifyCommand: 'npm test', risk: null, files: ['src/'] }),
    writeAllowedEv(),
  ]
  // 两个无主线 hook 进程同毫秒各自落账首条 intent.declared：now 相同、suffix 不同
  const a = assignImplicitMainline(batch, null, '2026-08-21T03:42:49.058Z', '4242abc1')
  const b = assignImplicitMainline(batch, null, '2026-08-21T03:42:49.058Z', '7777xyz9')
  assert.notEqual(a[0].mainlineId, b[0].mainlineId, '同毫秒两进程 id 不同，两条意图不合并')
  assert.equal(a[0].mainlineId, `${IMPLICIT_MAINLINE_PREFIX}20260821034249058-4242abc1`)
  assert.equal(b[0].mainlineId, `${IMPLICIT_MAINLINE_PREFIX}20260821034249058-7777xyz9`)
})

test('隐式主线②：已有活跃主线 → 原样返回（不另建线）', () => {
  const batch: DevFlowEvent[] = [
    ev('intent.declared', { requirementId: null, summary: 's', verifyCommand: null, risk: null, files: [] }),
  ]
  const out = assignImplicitMainline(batch, 'ml-existing', 'T', '4242abc1')
  assert.equal(out[0].mainlineId, '', '事件原样（调用方传入的 mainlineId 保持）')
})

test('隐式主线③：批内无 intent.declared（如首拦 deny 批次）→ 不建线', () => {
  const batch: DevFlowEvent[] = [intentBlockedEv()]
  const out = assignImplicitMainline(batch, null, 'T', '4242abc1')
  assert.equal(out[0].mainlineId, '', '被拦痕迹仍归空主线，等声明时才建线')
})

// —— buildFileChangedEvent（T7：Write/Edit/MultiEdit 的 file.changed 构造，PostToolUse 记账用）——
// 路径归一为项目相对（绝对/相对 → 相对 cwd）；越界/空路径/空主线 → null（宁漏勿误收，
// 与 planAutoCommit.normalizePath 同语义——绝对路径与 `..` 段不参与自动提交）。

/** 返回类型收窄（DevFlowEvent 是判别联合，测试只需 path/tool 面） */
function fce(opts: Parameters<typeof buildFileChangedEvent>[0]): { path: string; tool: string } | null {
  return buildFileChangedEvent(opts) as { path: string; tool: string } | null
}

test('buildFileChangedEvent：相对路径原样相对化', () => {
  const e = fce({ tool: 'Write', filePath: 'src/a.ts', cwd: '/proj', mainlineId: 'm1', now: 'T' })
  assert.equal(e!.path, 'src/a.ts')
  assert.equal(e!.tool, 'Write')
})

test('buildFileChangedEvent：项目内绝对路径 → 剥成项目相对', () => {
  // T7 真机实证：模型常传绝对 file_path（/proj/src/app.js），必须归一为 src/app.js 才能进自动提交
  const e = fce({ tool: 'Edit', filePath: '/proj/src/app.js', cwd: '/proj', mainlineId: 'm1', now: 'T' })
  assert.equal(e!.path, 'src/app.js')
  assert.equal(e!.tool, 'Edit')
})

test('buildFileChangedEvent：越界路径（/etc/x）/ 空路径 / 空主线 → null（不参与提交）', () => {
  assert.equal(fce({ tool: 'Write', filePath: '/etc/x', cwd: '/proj', mainlineId: 'm1', now: 'T' }), null)
  assert.equal(fce({ tool: 'Write', filePath: '   ', cwd: '/proj', mainlineId: 'm1', now: 'T' }), null)
  assert.equal(fce({ tool: 'Write', filePath: 'src/a.ts', cwd: '/proj', mainlineId: ' ', now: 'T' }), null)
  // 写入目标即项目根（cwd 本身）→ null（目录形态，exec 层也会剔除目录）
  assert.equal(fce({ tool: 'Write', filePath: '/proj', cwd: '/proj', mainlineId: 'm1', now: 'T' }), null)
})

test('buildFileChangedEvent：NFC 归一化（NFD 输入 → NFC 输出，坑 N-5 同源）', () => {
  // macOS 常存 NFD；输入 NFD 的 'é'（e + U+0301），输出应为 NFC 单码点
  const e = fce({ tool: 'Write', filePath: 'src/caf\u0065\u0301.js', cwd: '/proj', mainlineId: 'm1', now: 'T' })
  assert.equal(e!.path, 'src/caf\u00e9.js')
})

test('buildFileChangedEvent：项目根是 symlink 时不误丢（提交路径不做 realpath 归一）', (t) => {
  // macOS /var、/tmp 是 symlink；若按 realpath 归一，relative 会产出 ../… 被误丢。
  // 回归锁：cwd 传 symlink 路径，相对化必须基于 cwd 原样，产出项目相对路径。
  const real = mkdtempSync(join(tmpdir(), 'dev-flow-fce-real-'))
  t.after(() => rmSync(real, { recursive: true, force: true }))
  const link = join(tmpdir(), `dev-flow-fce-link-${process.pid}`)
  rmSync(link, { recursive: true, force: true })
  t.after(() => rmSync(link, { recursive: true, force: true }))
  symlinkSync(real, link, 'dir')
  const e = fce({ tool: 'Write', filePath: 'src/a.ts', cwd: link, mainlineId: 'm1', now: 'T' })
  assert.equal(e!.path, 'src/a.ts')
  // 绝对路径（经 symlink 项目根）同样剥成项目相对
  const e2 = fce({ tool: 'Write', filePath: join(link, 'src/a.ts'), cwd: link, mainlineId: 'm1', now: 'T' })
  assert.equal(e2!.path, 'src/a.ts')
})
