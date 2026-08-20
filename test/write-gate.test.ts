/**
 * 写门禁主决策单测（node:test，零新增依赖——计划 §4 T4 判据）
 *
 * 覆盖：一拦二放状态机（首拦 deny+模板 / 重试放行 / 已声明不拦）；敏感路径
 * 升级语义（未声明 deny 带规则名 / 已声明放行带规则名 + 治理升级）；unlock/
 * escape.used 消费端（未消费放行、已消费回到正常门禁）；transcript 声明放行
 * 加分项（intent.declared 落账 + verify 声明）；Bash 逐目标判定（任一 deny
 * 整命令 deny、多目标声明只落账一次、file.changed 补记）；applyEvents 折叠
 * （治理强度只升不降、verifyDeclarations 后者覆盖前者）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildFileChangedEvent,
  decideBashWrite,
  decidePathWrite,
  decideToolWrite,
  hasUnconsumedUnlock,
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
