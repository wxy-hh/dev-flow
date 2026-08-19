/**
 * hook 输出辅助（纯函数）
 *
 * spike 结论（docs/2026-08-19-spike-结论.md §1.1/§4）：2.1.234 的 hook JSON schema
 * 顶层没有 permissionDecision/additionalContext 等决策字段——顶层输出会被宿主静默
 * 忽略（debug 日志记 `unrecognized keys`，deny 会 fail-open）。拦截/注入 JSON 一律
 * hookSpecificOutput 格式：{ hookSpecificOutput: { hookEventName, ...事件字段 } }。
 * 且输出必须同步写（process.stdout.write + process.exit() 会丢输出），见 writeHookOutput。
 */

import { writeSync } from 'node:fs'

/** hookSpecificOutput 载荷：hookEventName 必须与事件名一致（如 "SessionStart"） */
export interface HookSpecificOutput {
  hookEventName: string
  [key: string]: unknown
}

/**
 * 构造 hookSpecificOutput 格式的完整 JSON 字符串（纯函数，可单测）。
 * hookEventName 在前，事件字段随后——与 spike 载荷样例（§1.1）的键序一致。
 */
export function formatHookOutput(
  hookEventName: string,
  eventFields: Record<string, unknown>,
): string {
  const output: HookSpecificOutput = { hookEventName, ...eventFields }
  return JSON.stringify({ hookSpecificOutput: output })
}

/**
 * 同步写 stdout（hook 进程唯一合法的输出方式）。
 * 追加换行收尾：与 spike 脚本一致，避免多 hook 输出粘连。
 */
export function writeHookOutput(
  hookEventName: string,
  eventFields: Record<string, unknown>,
): void {
  writeSync(1, formatHookOutput(hookEventName, eventFields) + '\n')
}
