/**
 * 输出辅助单测（node:test，零新增依赖——计划 T1 单测预备）
 *
 * 链路：test/*.test.ts → esbuild bundle 成 .cjs → `node --test`（scripts/build.mjs --test）。
 * T1 只覆盖 src/ 里唯一的纯函数模块，证明测试链路通；policy 全覆盖是 T2 起的事。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatHookOutput } from '../src/lib/output.js'

test('formatHookOutput：输出 hookSpecificOutput 格式（2.1.234 唯一有效格式）', () => {
  const s = formatHookOutput('SessionStart', { additionalContext: '你好' })
  assert.deepEqual(JSON.parse(s), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '你好' },
  })
})

test('formatHookOutput：事件字段可携带任意键（拦截型决策嵌套其中）', () => {
  const s = formatHookOutput('PreToolUse', {
    permissionDecision: 'deny',
    permissionDecisionReason: '测试理由',
  })
  assert.deepEqual(JSON.parse(s), {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '测试理由',
    },
  })
})
