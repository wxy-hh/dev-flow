/**
 * 验收事件记账单测（node:test，T6 判据：退出原因三分支、命令匹配边界）
 *
 * 覆盖：命令归一化与声明匹配（精确/带参/改命令/换序/空声明）；verify:none
 * 判定；退出原因分类（is_interrupt→killed、超时标记→timeout 优先于退出码、
 * Exit code N→nonzero、其余→unknown）；退出码解析；buildVerifyEvent 事件构造
 * （PostToolUse 成功=passed、interrupted=失败 killed、超时转后台 timedOutAfterMs
 * =timeout、主动转后台 backgroundTaskId=unknown、PostToolUseFailure 非零/超时/
 * 中断）；sanitize 白名单对 exitReason 的宽容与拒绝。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVerifyEvent,
  classifyExitReason,
  commandMatchesDeclaration,
  isVerifyNone,
  normalizeCommand,
  parseExitCode,
} from '../src/lib/verify.js'
import { sanitizeEvent } from '../src/lib/events.js'

test('normalizeCommand：去首尾空白、折叠连续空白、按空白分词', () => {
  assert.deepEqual(normalizeCommand('  node   check.js  '), ['node', 'check.js'])
  assert.deepEqual(normalizeCommand(''), [])
  assert.deepEqual(normalizeCommand('   '), [])
  assert.deepEqual(normalizeCommand('npm test --run'), ['npm', 'test', '--run'])
})

test('commandMatchesDeclaration：精确匹配与带参前缀匹配（宽容边界）', () => {
  // 精确一致 → 匹配
  assert.equal(commandMatchesDeclaration('node check.js', 'node check.js'), true)
  // 带额外参数（同一命令前缀）→ 匹配
  assert.equal(commandMatchesDeclaration('node check.js --verbose', 'node check.js'), true)
  // 空白差异归一 → 匹配
  assert.equal(commandMatchesDeclaration('node   check.js', '  node check.js '), true)
})

test('commandMatchesDeclaration：宁严勿宽——改命令/换序/声明更长/空 → 不匹配', () => {
  // 命令变了（token 不完全一致）→ 不匹配
  assert.equal(commandMatchesDeclaration('node check', 'node check.js'), false)
  assert.equal(commandMatchesDeclaration('node check.jsx', 'node check.js'), false)
  // 顺序换位 → 不匹配
  assert.equal(commandMatchesDeclaration('check.js node', 'node check.js'), false)
  // 声明比命令长 → 不匹配
  assert.equal(commandMatchesDeclaration('node', 'node check.js'), false)
  // 空声明 / 空命令 → 不匹配（宁严勿宽：匹配不上就不记）
  assert.equal(commandMatchesDeclaration('node check.js', ''), false)
  assert.equal(commandMatchesDeclaration('', 'node check.js'), false)
  // 声明不在命令开头（如被 cd/&& 包裹）→ 不匹配
  assert.equal(commandMatchesDeclaration('cd src && node check.js', 'node check.js'), false)
  // 环境变量前缀 → 不匹配
  assert.equal(commandMatchesDeclaration('FOO=1 node check.js', 'node check.js'), false)
})

test('isVerifyNone：只认 none（大小写与空白宽容，其他字面值不认）', () => {
  assert.equal(isVerifyNone('none'), true)
  assert.equal(isVerifyNone('None'), true)
  assert.equal(isVerifyNone('  none '), true)
  assert.equal(isVerifyNone('无'), false) // 宽容的是内容，不是动作——只认 none 字面
  assert.equal(isVerifyNone('npm test'), false)
  assert.equal(isVerifyNone(''), false)
})

test('parseExitCode：首行 Exit code N 解析；无退出码 → null', () => {
  assert.equal(parseExitCode('Exit code 3'), 3)
  assert.equal(parseExitCode('Exit code 143\nCommand timed out after 3s'), 143)
  assert.equal(parseExitCode('Exit code 0\noutput'), 0)
  assert.equal(parseExitCode('shell 无法启动'), null)
  assert.equal(parseExitCode(null), null)
  assert.equal(parseExitCode(''), null)
})

test('classifyExitReason：优先级——中断 > 超时标记 > 退出码 > unknown', () => {
  // 中断（abort）→ killed，即使文本含退出码/超时标记
  assert.equal(classifyExitReason('Exit code 3', true), 'killed')
  assert.equal(classifyExitReason('Command timed out after 3s', true), 'killed')
  // 超时标记 → timeout（实证：超时载荷 error 首行是 "Exit code 143"，不能归一为普通失败）
  assert.equal(classifyExitReason('Exit code 143\nCommand timed out after 3s', false), 'timeout')
  assert.equal(classifyExitReason('Command timed out after 2m 0s', false), 'timeout')
  // 普通失败 → nonzero
  assert.equal(classifyExitReason('Exit code 1\nError: cannot find module', false), 'nonzero')
  // 无退出码无超时标记（如无法启动 shell）→ unknown
  assert.equal(classifyExitReason('shell: command not found', false), 'unknown')
  assert.equal(classifyExitReason(null, false), 'unknown')
  assert.equal(classifyExitReason(null, null), 'unknown')
})

test('buildVerifyEvent：PostToolUse 成功 → verify.passed（exitCode 0）', () => {
  const ev = buildVerifyEvent({
    hookEventName: 'PostToolUse',
    command: 'node check.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: { stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false },
    error: null,
    isInterrupt: null,
    durationMs: 26,
  })
  assert.equal(ev.type, 'verify.passed')
  if (ev.type === 'verify.passed') {
    assert.equal(ev.exitCode, 0)
    assert.equal(ev.command, 'node check.js')
    assert.equal(ev.durationMs, 26)
  }
})

test('buildVerifyEvent：PostToolUse 但 interrupted=true（被杀）→ verify.failed killed，绝不为通过', () => {
  const ev = buildVerifyEvent({
    hookEventName: 'PostToolUse',
    command: 'node check.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: { stdout: '', stderr: '', interrupted: true, isImage: false, noOutputExpected: false },
    error: null,
    isInterrupt: null,
    durationMs: 300,
  })
  assert.equal(ev.type, 'verify.failed')
  if (ev.type === 'verify.failed') {
    assert.equal(ev.exitReason, 'killed')
    assert.equal(ev.exitCode, null)
  }
})

test('buildVerifyEvent：PostToolUse 超时转后台（timedOutAfterMs）→ failed timeout，backgroundTaskId 落账', () => {
  // 2026-08-20 真机实证载荷：2.1.234 sdk-cli 下 Bash 超时转后台，走 PostToolUse 成功路径
  const ev = buildVerifyEvent({
    hookEventName: 'PostToolUse',
    command: 'node hang.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: {
      stdout: '',
      stderr: '',
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
      backgroundTaskId: 'bmbru41ng',
      timedOutAfterMs: 3,
    },
    error: null,
    isInterrupt: null,
    durationMs: 2042,
  })
  assert.equal(ev.type, 'verify.failed')
  if (ev.type === 'verify.failed') {
    assert.equal(ev.exitReason, 'timeout') // 超时转后台绝不被归一为通过
    assert.equal(ev.exitCode, null)
    assert.equal(ev.backgroundTaskId, 'bmbru41ng')
    assert.equal(ev.durationMs, 2042)
  }
})

test('buildVerifyEvent：PostToolUse 仅 backgroundTaskId（模型主动转后台）→ failed unknown（无退出码实证）', () => {
  const ev = buildVerifyEvent({
    hookEventName: 'PostToolUse',
    command: 'node check.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b-task-1' },
    error: null,
    isInterrupt: null,
    durationMs: 120,
  })
  assert.equal(ev.type, 'verify.failed')
  if (ev.type === 'verify.failed') {
    assert.equal(ev.exitReason, 'unknown')
    assert.equal(ev.exitCode, null)
    assert.equal(ev.backgroundTaskId, 'b-task-1')
  }
})

test('buildVerifyEvent：转后台判定边界——timedOutAfterMs 无 backgroundTaskId → timeout；空串 id 视为缺失 → passed', () => {
  // timedOutAfterMs 是 number 即可判 timeout；backgroundTaskId 缺失 → null
  const timeout = buildVerifyEvent({
    hookEventName: 'PostToolUse',
    command: 'node hang.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: { stdout: '', stderr: '', interrupted: false, timedOutAfterMs: 3000 },
    error: null,
    isInterrupt: null,
    durationMs: 3000,
  })
  assert.equal(timeout.type, 'verify.failed')
  if (timeout.type === 'verify.failed') {
    assert.equal(timeout.exitReason, 'timeout')
    assert.equal(timeout.backgroundTaskId, null)
  }
  // backgroundTaskId 空串 = 缺失（只认非空 string），无两字段语义 → 仍记通过
  const empty = buildVerifyEvent({
    hookEventName: 'PostToolUse',
    command: 'node check.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: { stdout: 'ok', stderr: '', interrupted: false, backgroundTaskId: '' },
    error: null,
    isInterrupt: null,
    durationMs: 26,
  })
  assert.equal(empty.type, 'verify.passed')
})

test('buildVerifyEvent：PostToolUseFailure 非零退出码 → failed nonzero（含输出尾部）', () => {
  const ev = buildVerifyEvent({
    hookEventName: 'PostToolUseFailure',
    command: 'node check.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: null,
    error: 'Exit code 3\nerror line 1\nerror line 2',
    isInterrupt: false,
    durationMs: 35,
  })
  assert.equal(ev.type, 'verify.failed')
  if (ev.type === 'verify.failed') {
    assert.equal(ev.exitReason, 'nonzero')
    assert.equal(ev.exitCode, 3)
    assert.deepEqual(ev.outputTail, ['Exit code 3', 'error line 1', 'error line 2'])
    assert.equal(ev.durationMs, 35)
  }
})

test('buildVerifyEvent：PostToolUseFailure 超时 → failed timeout（exitCode 保留 143）', () => {
  const ev = buildVerifyEvent({
    hookEventName: 'PostToolUseFailure',
    command: 'sleep 60',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: null,
    error: 'Exit code 143\nCommand timed out after 3s',
    isInterrupt: false,
    durationMs: 3014,
  })
  assert.equal(ev.type, 'verify.failed')
  if (ev.type === 'verify.failed') {
    assert.equal(ev.exitReason, 'timeout') // 超时绝不被归一为普通失败
    assert.equal(ev.exitCode, 143)
  }
})

test('buildVerifyEvent：PostToolUseFailure is_interrupt=true → failed killed', () => {
  const ev = buildVerifyEvent({
    hookEventName: 'PostToolUseFailure',
    command: 'node check.js',
    mainlineId: 'm1',
    now: 'T0',
    toolResponse: null,
    error: 'Exit code 130',
    isInterrupt: true,
    durationMs: 500,
  })
  assert.equal(ev.type, 'verify.failed')
  if (ev.type === 'verify.failed') assert.equal(ev.exitReason, 'killed')
})

test('sanitize 白名单：verify.failed 的 exitReason 枚举透传、畸形值回退 null', () => {
  const ok = sanitizeEvent(
    {
      type: 'verify.failed',
      mainlineId: 'm1',
      exitCode: 143,
      command: 'sleep 60',
      exitReason: 'timeout',
      output: 'x',
    },
    'NOW',
  )
  assert.ok(ok.ok)
  if (ok.ok && ok.event.type === 'verify.failed') assert.equal(ok.event.exitReason, 'timeout')
  // 非白名单值 → null（宽容不崩溃）
  const bad = sanitizeEvent(
    { type: 'verify.failed', mainlineId: 'm1', exitReason: 'killed-by-user', output: 'x' },
    'NOW',
  )
  assert.ok(bad.ok)
  if (bad.ok && bad.event.type === 'verify.failed') assert.equal(bad.event.exitReason, null)
  // 缺失 → null（旧事件兼容，additive-only）
  const missing = sanitizeEvent({ type: 'verify.failed', mainlineId: 'm1', output: 'x' }, 'NOW')
  assert.ok(missing.ok)
  if (missing.ok && missing.event.type === 'verify.failed') assert.equal(missing.event.exitReason, null)
})
