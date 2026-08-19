/**
 * transcript 意图块检测单测（node:test，零新增依赖——计划 §4 T4 判据）
 *
 * 覆盖：限定 assistant 消息 text 块（spike L3 坑：注入规则/deny 模板所在的
 * user 消息含「#意图块」字样绝不命中——自注入污染）；四要素提取（summary/
 * files/risk/verify）；无意图块 → declared:false；读取失败/路径缺失 → null
 * （不影响主通道）；JSONL 逐行解析与 text 块过滤。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectIntentInTexts, readTranscriptIntent } from '../src/lib/transcript.js'

/** 临时 transcript 文件，用毕清理 */
function tempFile(t: { after(fn: () => void): void }, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-transcript-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'transcript.jsonl')
  writeFileSync(file, content)
  return file
}

/** 组装一条 transcript 行 */
function line(obj: unknown): string {
  return JSON.stringify(obj)
}

const assistantText = (text: string): unknown => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})

const userText = (text: string): unknown => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
})

const toolResult = (text: string): unknown => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'x', content: text }],
  },
})

test('detectIntentInTexts：命中意图块并提取四要素', () => {
  const r = detectIntentInTexts([
    `#意图块
做什么：把 hello 改成 world
文件：src/foo.js, src/bar.ts
风险：无
verify：npm test
`,
  ])
  assert.equal(r.declared, true)
  assert.equal(r.summary, '把 hello 改成 world')
  assert.deepEqual(r.files, ['src/foo.js', 'src/bar.ts'])
  assert.equal(r.risk, '无')
  assert.equal(r.verifyCommand, 'npm test')
})

test('detectIntentInTexts：多行文件清单与冒号变体（英文冒号）', () => {
  const r = detectIntentInTexts([
    `#意图块\n文件:\n- src/a.ts\n- src/b.ts\nverify: npm run check\n`,
  ])
  assert.equal(r.declared, true)
  assert.deepEqual(r.files, ['src/a.ts', 'src/b.ts'])
  assert.equal(r.verifyCommand, 'npm run check')
})

test('detectIntentInTexts：列表式意图块（- 字段：值，T6 实测模型写法）', () => {
  const r = detectIntentInTexts([
    `#意图块
- 做什么：创建文件
- 文件：src/app.js
- 风险：无
- verify：node check.js
`,
  ])
  assert.equal(r.declared, true)
  assert.equal(r.summary, '创建文件')
  assert.deepEqual(r.files, ['src/app.js']) // 列表式字段行不进文件清单
  assert.equal(r.risk, '无')
  assert.equal(r.verifyCommand, 'node check.js')
})

test('detectIntentInTexts：列表式文件清单 + 列表式 verify（- 文件 多行项）', () => {
  const r = detectIntentInTexts([
    `#意图块
- 做什么：多文件改动
- 文件：
  - src/a.ts
  - src/b.ts
- 风险：无
- verify：node check.js
`,
  ])
  assert.equal(r.declared, true)
  assert.deepEqual(r.files, ['src/a.ts', 'src/b.ts'])
  assert.equal(r.verifyCommand, 'node check.js')
})

test('detectIntentInTexts：紧凑行内多字段（T6 实测模型写法——规则文本「/」样式整行塞满）', () => {
  // 规则文本以「做什么 / 预计动哪些文件 / 风险 / verify」呈现四要素，模型常把
  // 多要素塞进一行（`做什么：A / 文件：B / verify：C`）。旧解析器只认每行一个
  // 标签，verify 会被吞进 risk——T6 场景①实测 done 因此误驳「无验收声明」。
  const r = detectIntentInTexts([
    `#意图块
做什么：创建 src/app.js，内容为单行 hello / 预计动哪些文件：新增 src/app.js
敏感路径与风险标签：无敏感路径，低风险新增文件 / verify 命令：node check.js
`,
  ])
  assert.equal(r.declared, true)
  assert.equal(r.summary, '创建 src/app.js，内容为单行 hello')
  // files 含「新增」动词前缀是 parseFiles 按空白切分的如实产物（冗余词无害——
  // files 仅用于敏感路径升级匹配，路径在列即达意）
  assert.deepEqual(r.files, ['新增', 'src/app.js'])
  assert.equal(r.risk, '无敏感路径，低风险新增文件')
  assert.equal(r.verifyCommand, 'node check.js') // 关键：verify 不再被吞
})

test('detectIntentInTexts：行内「；」分隔（T6 实测模型写法 2——要素行用分号内联）', () => {
  const r = detectIntentInTexts([
    `#意图块
做什么：创建 src/app.js，内容为单行 hello；预计动哪些文件：新增 src/app.js
敏感路径与风险标签：无敏感路径，低风险新增文件
verify 命令：node check.js
`,
  ])
  assert.equal(r.declared, true)
  assert.equal(r.summary, '创建 src/app.js，内容为单行 hello')
  assert.deepEqual(r.files, ['新增', 'src/app.js']) // 「新增」同 parseFiles 如实产物
  assert.equal(r.risk, '无敏感路径，低风险新增文件')
  assert.equal(r.verifyCommand, 'node check.js')
})

test('detectIntentInTexts：未命中 → declared:false', () => {
  const r = detectIntentInTexts(['普通文本，没有任何意图块标记'])
  assert.equal(r.declared, false)
  assert.equal(r.verifyCommand, null)
  assert.deepEqual(r.files, [])
})

test('readTranscriptIntent：自注入污染防护——user 消息/工具结果的标记不命中', (t) => {
  // 注入规则（user 消息）与 deny 模板（tool_result）都含「#意图块」，但 assistant 无 → 不命中
  const content = [
    line(userText('第一次写文件前先输出意图块（以「#意图块」开头）…规则注入')),
    line(toolResult('未检测到意图块。模板：#意图块\n做什么：…')),
    line(assistantText('我这就动手写文件。')),
  ].join('\n')
  const file = tempFile(t, content)
  const r = readTranscriptIntent(file)
  assert.equal(r?.declared, false)
})

test('readTranscriptIntent：assistant 命中 → declared:true', (t) => {
  const content = [
    line(userText('注入规则……「#意图块」')),
    line(
      assistantText(
        '#意图块\n做什么：加一个接口\n文件：src/api.ts\n风险：无\nverify：npm test\n',
      ),
    ),
  ].join('\n')
  const file = tempFile(t, content)
  const r = readTranscriptIntent(file)
  assert.equal(r?.declared, true)
  assert.equal(r?.summary, '加一个接口')
  assert.deepEqual(r?.files, ['src/api.ts'])
})

test('readTranscriptIntent：content 为字符串的 assistant 消息也支持', (t) => {
  const content = [
    line({ type: 'assistant', message: { role: 'assistant', content: '#意图块\nverify：node check\n' } }),
  ].join('\n')
  const file = tempFile(t, content)
  const r = readTranscriptIntent(file)
  assert.equal(r?.declared, true)
  assert.equal(r?.verifyCommand, 'node check')
})

test('readTranscriptIntent：坏行/缺路径/路径不存在 → null（不影响主通道）', (t) => {
  const content = ['{not json', line(assistantText('#意图块\nverify：x\n'))].join('\n')
  const file = tempFile(t, content)
  const r = readTranscriptIntent(file)
  assert.equal(r?.declared, true, '坏行跳过，好行仍解析')
  assert.equal(readTranscriptIntent(join(file, 'nope.jsonl')), null)
  assert.equal(readTranscriptIntent(null), null)
  assert.equal(readTranscriptIntent(undefined), null)
})

test('readTranscriptIntent：空文件 → declared:false（读到但无内容）', (t) => {
  const file = tempFile(t, '')
  const r = readTranscriptIntent(file)
  assert.equal(r?.declared, false)
})
