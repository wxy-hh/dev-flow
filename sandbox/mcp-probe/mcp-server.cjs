// SPIKE THROWAWAY：极简 MCP stdio server（T6 链路探测用，非正式代码）
// 协议：newline-delimited JSON-RPC（MCP 2024-11-05）。只实现
// initialize / notifications/initialized / tools/list / tools/call。
// 一切非协议输出走 stderr；stdout 只写协议消息。
const readline = require('node:readline')

const PROTOCOL_VERSION = '2024-11-05'

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function tool(name, description, inputSchema) {
  return { name, description, inputSchema }
}

const TOOLS = [
  tool('done', '（探测用）完成宣称回显工具：把收到的参数原样返回。', {
    type: 'object',
    properties: {},
  }),
]

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const method = msg.method
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'df-probe', version: '0.0.0' },
      },
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return // 通知无需响应
  }
  if (msg.id === undefined || msg.id === null) return // 其他通知忽略
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } })
    return
  }
  if (method === 'tools/call') {
    const name = msg.params?.name
    const arguments_ = msg.params?.arguments ?? {}
    if (name !== 'done') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true },
      })
      return
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ probe: 'done-echo', arguments: arguments_ }) }],
        isError: false,
      },
    })
    return
  }
  send({
    jsonrpc: '2.0',
    id: msg.id,
    result: { content: [{ type: 'text', text: `未支持的方法：${method}` }], isError: true },
  })
})
