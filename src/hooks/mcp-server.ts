/**
 * MCP stdio server（计划 §2.2 工具面：server 名压最短 `df`，T6 只挂 done；
 * T8 的只读 status 加进 TOOLS 表即可——server 骨架与协议层在此一次建好）
 *
 * 链路实证（2026-08-19，sandbox/mcp-probe）：插件 .mcp.json（mcpServers 标准
 * 配置，command/args 支持 ${CLAUDE_PLUGIN_ROOT} 替换）→ 会话启动自动连接
 * （stdio，27ms）→ 工具渲染名 mcp__plugin_dev-flow_df__done（宿主定形
 * mcp__plugin_<plugin>_<server>__<tool>，§2.2 命名预判实证成立）→ -p 模式
 * --allowedTools 'mcp__plugin_dev-flow_df__*'（通配只能放工具位）即可调用。
 *
 * 协议：newline-delimited JSON-RPC（MCP 2024-11-05），仅实现 initialize /
 * notifications/initialized / tools/list / tools/call；stdout 只写协议消息，
 * 一切日志走 stderr。Claude Code 版本 2.1.234 实证兼容。
 *
 * done 语义（§3.3）：
 * - 硬校验 = 时序双检查（存在 verify.passed 且晚于最后写入），读 events 尾反向扫；
 * - verify:none 显式声明 → 免验收（声明存在性 = state.verifyDeclarations）；
 * - 缺省无声明 = 驳回（fail-visible 给声明模板）；驳回记 done.rejected + 连败+1，
 *   通过记 done.claimed + 连败清零（§9：连败=连续驳回次数，一次宣称通过即破）；
 * - done 不自己执行命令（MCP 超时 + 重复跑测试成本）；
 * - 响应面收敛：只返回一句话结论（成败 + 理由），不返回全量状态（§4 token 面）；
 * - fail-closed（唯一允许）：内部异常 → 驳回 + 理由（咽喉故障宁可驳回不可假
 *   通过——驳回成本=用户再问一句，假通过成本=证据链造假）。
 */

import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { loadState, writeState } from '../lib/state.js'
import { applyEvents } from '../lib/rebuild.js'
import { auditWarning, appendEvent, emptyFacts, readEvents, scanMainlineFacts } from '../lib/events.js'
import { doneSuccessMessage, evaluateDone } from '../lib/done.js'
import type { DevFlowEvent } from '../lib/events.js'

declare const DEV_FLOW_VERSION: string

const PROTOCOL_VERSION = '2024-11-05'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

/** 工具定义表（第一批 1 个：done；T8 status 追加此处，协议层零改动） */
const TOOLS = [
  {
    name: 'done',
    description:
      '完成宣称（状态翻转唯一咽喉）：验收通过（verify 命令退出码 0 且晚于最后写入）后调用；无验收项需意图块显式声明 verify: none。返回一句话成败结论。',
    inputSchema: { type: 'object', properties: {} },
  },
]

/** 协议消息发送（stdout 只写协议；同步写防丢输出——spike §4 同款纪律） */
function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function result(id: JsonRpcRequest['id'], resultValue: unknown): void {
  send({ jsonrpc: '2.0', id, result: resultValue })
}

function errorResult(id: JsonRpcRequest['id'], text: string): void {
  send({
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text }], isError: true },
  })
}

/** 状态根（MCP server 进程继承 CLAUDE_PROJECT_DIR，实证：插件 MCP 子进程同样注入） */
function stateRoot(): string {
  return join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.dev-flow')
}

/**
 * done 工具执行（薄壳：纯函数裁决在 lib/done.ts；本函数只做 IO 与事件落账）。
 * 任何驳回（含无活跃主线）都记 done.rejected（证据链 + fail-visible）；
 * 事件落账失败（append 抛异常）→ 不写 state（证据链与缓存保持一致），驳回。
 */
function handleDone(): string {
  const root = stateRoot()
  try {
    const { state } = loadState(root)
    const { events } = readEvents(root)
    const mainlineId = state.activeMainlineId
    // 无主线也走统一驳回路径（evaluateDone 返回"无活跃主线"裁决，记账不缺席）
    const facts = mainlineId !== null ? scanMainlineFacts(events, mainlineId) : emptyFacts()
    const verdict = evaluateDone(state, facts)
    const now = new Date().toISOString()
    if (!verdict.ok) {
      // 驳回：done.rejected + 连败 +1（applyEvents 折叠；claimed 通过时清零）
      const ev: DevFlowEvent = {
        type: 'done.rejected',
        t: now,
        mainlineId: mainlineId ?? '',
        reason: verdict.reason,
      }
      appendEvent(root, ev, now)
      writeState(root, applyEvents(state, [ev]))
      return `done 驳回：${verdict.reason}`
    }
    // 通过：done.claimed + 主线关闭 + 连败清零（evaluateDone ok 时活跃主线必存在）
    const ev: DevFlowEvent = {
      type: 'done.claimed',
      t: now,
      mainlineId: mainlineId!,
      requirementId: null,
      channel: 'tool',
    }
    appendEvent(root, ev, now)
    writeState(root, applyEvents(state, [ev]))
    return doneSuccessMessage(state, facts)
  } catch (err) {
    // fail-closed（唯一允许）：咽喉故障宁可驳回不可假通过
    try {
      auditWarning(root, `done 工具内部异常：${String(err)}，已驳回（fail-closed：咽喉故障不假通过）`, 'mcp-done')
    } catch {
      // 审计也失败：静默（响应仍走驳回路径）
    }
    return `done 驳回：内部故障（${String(err).slice(0, 160)}）。请稍后重试。`
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  let msg: JsonRpcRequest
  try {
    msg = JSON.parse(line) as JsonRpcRequest
  } catch {
    return // 畸形行忽略（协议容忍）
  }
  const method = msg.method
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'df', version: DEV_FLOW_VERSION },
      },
    })
    return
  }
  // 通知（无 id）→ 忽略（notifications/initialized / notifications/cancelled）
  if (msg.id === undefined || msg.id === null) return
  if (method === 'ping') {
    result(msg.id, {})
    return
  }
  if (method === 'tools/list') {
    result(msg.id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    const name = msg.params?.name
    if (name === 'done') {
      const text = handleDone()
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], isError: false } })
      return
    }
    errorResult(msg.id, `未知工具：${String(name)}`)
    return
  }
  errorResult(msg.id, `未支持的方法：${String(method)}`)
})
