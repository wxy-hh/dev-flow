/**
 * UserPromptSubmit hook（T5 真逻辑）
 *
 * 四件事一个注册点（计划 §3.1/§3.7）：
 * 1. 逃生门（§5.5）→ escape.used 记账 + 注入"已放行并记账"；
 * 2. 主线切换（§5.7）→ mainline.switch（from/to/name）+ 注入新主线激活；
 * 3. 用户通道完成确认（§6.3 两跳）→ 置/清 pendingDoneConfirm（state 中间态，
 *    additive-only 新字段）+ 注入 hop 文本；hook 永不翻转完成状态
 *    （attestation 原则，done 工具 T6 才是咽喉）；
 * 4. 用户终裁解锁（§4.6）→ unlock 记账（含用户上下文原话），T4 写门禁消费。
 *
 * 识别/渲染/事件构造全部在纯函数层（src/lib/user-prompt.ts，模式表数据驱动），
 * 本壳只做 stdin 解析 + IO + 写输出。
 *
 * 硬约束（spike §4 / §3.7）：
 * - 注入一律 hookSpecificOutput.additionalContext + fs.writeSync(1,…) 同步写
 *   （src/lib/output.ts）；绝不 block（block 会擦除用户 prompt）、绝不改写 prompt；
 * - 识别纪律：状态翻转只信精确短语匹配；抱怨/疑问句零注入；模式表外一律放行；
 * - fail-open：任何异常 → audit + 零注入放行（UPS 故障绝不能阻塞用户说话）；
 * - 性能：state 一次读 + 至多两条事件 append + state 原子写，微秒级——30s 预算
 *   内不读 events（识别所需全部在 state 缓存面：pending 中间态/活跃主线/主线表）。
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendEvent, auditWarning, type DevFlowEvent } from '../lib/events.js'
import { loadState, writeState } from '../lib/state.js'
import {
  nextPendingDoneConfirm,
  recognizeUserPrompt,
  renderUpsInjection,
  upsEvents,
  type UpsAction,
} from '../lib/user-prompt.js'
import { applyEvents } from '../lib/rebuild.js'
import { writeHookOutput } from '../lib/output.js'

declare const DEV_FLOW_VERSION: string

/** 解析 stdin 载荷；非法输入返回 null（hook no-op 放行，读 fail-open） */
function parseStdinPayload(): Record<string, unknown> | null {
  try {
    const raw = readFileSync(0, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * 写一行触发证据到 ${CLAUDE_PROJECT_DIR}/.dev-flow-debug/。
 * T5 验证环断言注入是否生效（sandbox 端到端：动作类型 + 注入文本都可见）。
 * 记事实不记内容：payload（用户原话）不落盘，只记动作与注入文本——
 * 用户原话由事件链承载（escape.used.quote / unlock.context，红线截断 500）。
 */
function logTrigger(payload: Record<string, unknown> | null, action: UpsAction, injection: string): void {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const logDir = join(projectDir, '.dev-flow-debug')
  mkdirSync(logDir, { recursive: true })
  appendFileSync(
    join(logDir, 'user-prompt-submit.log'),
    JSON.stringify({
      t: new Date().toISOString(),
      hook_event_name: 'UserPromptSubmit',
      action: action.kind,
      session_id: payload?.session_id ?? null,
      dev_flow_version: DEV_FLOW_VERSION,
      injection,
    }) + '\n',
  )
}

function main(): void {
  const payload = parseStdinPayload()
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const root = join(projectDir, '.dev-flow')
  try {
    const prompt = typeof payload?.prompt === 'string' ? payload.prompt : ''
    if (prompt === '') process.exit(0) // 无 prompt（异常载荷）→ 零注入放行
    // fail-open 读：state 损坏 → 空状态 + 审计（loadState 内部处理），照常识别
    const { state } = loadState(root)
    const action = recognizeUserPrompt(prompt, {
      pendingMainlineId: state.pendingDoneConfirm,
      activeMainlineId: state.activeMainlineId,
      mainlines: state.mainlines,
    })
    const injection = renderUpsInjection(action)
    if (injection === null) process.exit(0) // 零注入（识别纪律：模式表外一律当普通 prompt 放行）
    const now = new Date().toISOString()
    const events: DevFlowEvent[] = upsEvents(action, state.activeMainlineId, now)
    for (const ev of events) appendEvent(root, ev, now)
    // 状态推进：事件折叠（switch 挂起/激活、unlock 解锁）+ 完成确认中间态（仅 UPS 写）
    if (events.length > 0 || action.kind === 'doneHop1' || action.kind === 'doneHop2') {
      const next = applyEvents(state, events)
      next.pendingDoneConfirm = nextPendingDoneConfirm(
        state.pendingDoneConfirm,
        action,
        state.activeMainlineId,
      )
      writeState(root, next)
    }
    logTrigger(payload, action, injection)
    writeHookOutput('UserPromptSubmit', { additionalContext: injection })
  } catch (err) {
    // fail-open：UPS 故障绝不能阻塞用户说话——审计 + 零注入放行
    auditWarning(root, `UserPromptSubmit 处理异常：${String(err)}，已按 fail-open 放行`, 'ups')
  }
}

main()
process.exit(0)
