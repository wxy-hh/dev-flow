// SPIKE THROWAWAY：MCP 链路探测（T6 实证用，非正式代码）
// 把 PostToolUse / PostToolUseFailure 的完整 stdin 载荷转存到
// ${CLAUDE_PROJECT_DIR}/.dev-flow-debug/probe-<tag>.jsonl，供人工核对。
const fs = require('node:fs')
const path = require('node:path')

const tag = process.argv[2] ?? 'unknown'
const raw = fs.readFileSync(0, 'utf8')
let parsed = null
try { parsed = JSON.parse(raw) } catch {}

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const logDir = path.join(projectDir, '.dev-flow-debug')
fs.mkdirSync(logDir, { recursive: true })
fs.appendFileSync(path.join(logDir, `probe-${tag}.jsonl`), raw + '\n', 'utf8')
fs.appendFileSync(
  path.join(logDir, `probe-${tag}.meta`),
  JSON.stringify({
    tag,
    t: new Date().toISOString(),
    keys: parsed ? Object.keys(parsed) : null,
    tool_name: parsed?.tool_name ?? null,
    tool_input: parsed?.tool_input ?? null,
    tool_response: parsed?.tool_response ?? null,
    error: parsed?.error ?? null,
    is_interrupt: parsed?.is_interrupt ?? null,
    duration_ms: parsed?.duration_ms ?? null,
  }) + '\n',
  'utf8',
)
