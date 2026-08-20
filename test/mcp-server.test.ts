/**
 * MCP server 接线单测（T7/T8，node:test + 真实子进程，零新增依赖）
 *
 * 链路：npm test 的 build --test 先构建 src/hooks/mcp-server.ts →
 * plugins/dev-flow/dist/mcp-server.cjs（hooks 与测试同一次构建产出），本文件
 * spawn 该真实产物、走完整 JSON-RPC stdio 协议，验证接线（非纯函数面）：
 *
 * - tools/list：done 与 status 双工具注册（T8 注册判据）；
 * - tools/call status：真实落盘状态 → 摘要文本，含 主线/验收 且 ≤500 字符，
 *   调用前后 events.jsonl / state.json 逐字节一致（只读不改证据链）；
 * - tools/call done 驳回路径：验收未过 → done.rejected，绝不产生任何提交
 *   （T7 硬规格：done.rejected 路径绝不触发 commit）；
 * - tools/call done 通过路径：done.claimed + 选择性自动提交——真实 git 仓里
 *   commit 只含主线文件、message 前缀带主线标识、用户未提交改动（已跟踪修改 +
 *   未跟踪新增）不被卷入（绝不 -am）。
 *
 * fail-open 语义（merge 冲突/detached HEAD/空提交/autoCommit=false）与 message
 * 契约的细粒度断言在 test/auto-commit.test.ts（lib 层），此处只证接线成立。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendEvent, readEvents } from '../src/lib/events.js'
import { loadState, writeState } from '../src/lib/state.js'
import { applyEvents } from '../src/lib/rebuild.js'

/** 构建产物（npm test 先跑 build --test，hooks 与测试同批产出） */
const SERVER = join(process.cwd(), 'plugins/dev-flow/dist/mcp-server.cjs')
assert.ok(existsSync(SERVER), `mcp-server 构建产物缺失：${SERVER}（先 npm run build / npm test）`)

/** JSON-RPC 客户端（stdio 线协议，id 匹配 + 超时护栏） */
interface RpcClient {
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  close(): Promise<void>
}

function startServer(projectDir: string): RpcClient {
  const proc: ChildProcessWithoutNullStreams = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (d) => {
    stderr += String(d)
  })
  let buf = ''
  let nextId = 1
  const pending = new Map<number, (msg: Record<string, unknown>) => void>()
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (d) => {
    buf += String(d)
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (line.trim() === '') continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const id = msg.id
      if (typeof id === 'number' && pending.has(id)) {
        const resolve = pending.get(id)!
        pending.delete(id)
        resolve(msg)
      }
    }
  })
  return {
    call(method, params) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`JSON-RPC 调用 ${method} 超时；stderr：${stderr || '（空）'}`))
        }, 15000)
        pending.set(id, (m) => {
          clearTimeout(timer)
          resolve(m)
        })
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    },
    close() {
      return new Promise((resolve) => {
        const killTimer = setTimeout(() => {
          proc.kill()
          resolve()
        }, 3000)
        proc.on('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })
        proc.stdin.end()
      })
    },
  }
}

/** 建独立临时项目目录（无 git；status/拒绝路径用），用毕清理 */
function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-mcp-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 建独立临时 git 仓（自动提交用例用），局部身份配置（不依赖全局 git config），用毕清理 */
function tempRepo(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-mcp-repo-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'dev-flow-test'])
  git(dir, ['config', 'user.email', 'test@dev-flow.local'])
  return dir
}

/** 跑 git 并返回 stdout（测试辅助） */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 用真实写路径构造事件 + 折叠 state（与 hook 链路一致：append → fold → write） */
function seedFlow(projectDir: string, events: Array<Record<string, unknown>>): void {
  const root = join(projectDir, '.dev-flow')
  for (const ev of events) appendEvent(root, ev)
  const { state } = loadState(root)
  writeState(root, applyEvents(state, readEvents(root).events))
}

test('tools/list：done 与 status 双工具注册（T8 注册判据）', async (t) => {
  const dir = tempDir(t)
  const client = startServer(dir)
  t.after(() => client.close())
  const res = await client.call('tools/list')
  const tools = (res.result as { tools: Array<{ name: string }> }).tools
  assert.deepEqual(tools.map((x) => x.name), ['done', 'status'])
})

test('tools/call status：无状态 → "无状态"摘要（fail-open 不报错）', async (t) => {
  const dir = tempDir(t)
  const client = startServer(dir)
  t.after(() => client.close())
  const res = await client.call('tools/call', { name: 'status', arguments: {} })
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text
  assert.equal((res.result as { isError: boolean }).isError, false)
  assert.ok(text.includes('无状态'), `应返回无状态摘要：${text}`)
  assert.ok(text.length <= 500)
})

test('tools/call status：完整状态 → 摘要含 主线/验收 且 ≤500 字符、只读不改证据链', async (t) => {
  const dir = tempDir(t)
  seedFlow(dir, [
    { type: 'intent.declared', mainlineId: 'm1', requirementId: null, summary: '接线测试', verifyCommand: 'node check.js', risk: null, files: [] },
    { type: 'file.changed', mainlineId: 'm1', tool: 'Write', path: 'src/a.ts' },
    { type: 'verify.passed', mainlineId: 'm1', requirementId: null, exitCode: 0, command: 'node check.js', durationMs: 10 },
  ])
  const root = join(dir, '.dev-flow')
  const eventsBefore = readFileSync(join(root, 'events.jsonl'), 'utf8')
  const stateBefore = readFileSync(join(root, 'state.json'), 'utf8')
  const client = startServer(dir)
  t.after(() => client.close())
  const res = await client.call('tools/call', { name: 'status', arguments: {} })
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text
  assert.equal((res.result as { isError: boolean }).isError, false)
  assert.ok(text.includes('活跃主线「接线测试」'), `应含活跃主线：${text}`)
  assert.ok(text.includes('验收：通过 node check.js'), `应含最近验收：${text}`)
  assert.ok(text.length <= 500, `status 输出超 500 字符：${text.length}`)
  // 只读：调用前后证据链文件逐字节一致（不写审计不改状态）
  assert.equal(readFileSync(join(root, 'events.jsonl'), 'utf8'), eventsBefore)
  assert.equal(readFileSync(join(root, 'state.json'), 'utf8'), stateBefore)
})

test('tools/call done 驳回路径：验收未过 → done.rejected，绝不产生任何提交', async (t) => {
  const repo = tempRepo(t)
  writeFileSync(join(repo, 'base.txt'), 'v1', 'utf8')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-qm', 'baseline'])
  // 有主线有声明（node check.js），但从未跑 verify → 时序双检查不过
  seedFlow(repo, [
    { type: 'intent.declared', mainlineId: 'm1', requirementId: null, summary: '接线测试', verifyCommand: 'node check.js', risk: null, files: ['src/a.ts'] },
    { type: 'file.changed', mainlineId: 'm1', tool: 'Write', path: 'src/a.ts' },
  ])
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/a.ts'), 'hello', 'utf8')
  const client = startServer(repo)
  t.after(() => client.close())
  const res = await client.call('tools/call', { name: 'done', arguments: {} })
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text
  assert.ok(text.includes('done 驳回'), `应驳回：${text}`)
  // done.rejected 落账（证据链）；git 无任何新提交（驳回路径绝不 commit）
  const evs = readEvents(join(repo, '.dev-flow')).events
  assert.ok(evs.some((e) => e.type === 'done.rejected'))
  assert.ok(!evs.some((e) => e.type === 'done.claimed'))
  assert.equal(git(repo, ['rev-list', '--count', 'HEAD']).trim(), '1')
})

test('tools/call done 通过路径：done.claimed + 选择性自动提交（只含主线文件，用户改动不卷入）', async (t) => {
  const repo = tempRepo(t)
  writeFileSync(join(repo, 'README.md'), 'baseline readme', 'utf8')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-qm', 'baseline'])
  // 用户自己的未提交改动（不在事件里）：已跟踪修改 + 未跟踪新增，断言不被卷入
  writeFileSync(join(repo, 'README.md'), 'user changed readme', 'utf8')
  writeFileSync(join(repo, 'user-note.md'), 'user untracked', 'utf8')
  // 主线流程事件：声明（verify:none 免验收）→ 写 src/a.ts
  seedFlow(repo, [
    { type: 'intent.declared', mainlineId: 'm1', requirementId: null, summary: '接线测试', verifyCommand: 'none', risk: null, files: ['src/a.ts'] },
    { type: 'file.changed', mainlineId: 'm1', tool: 'Write', path: 'src/a.ts' },
  ])
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/a.ts'), 'mainline code', 'utf8')
  const client = startServer(repo)
  t.after(() => client.close())
  const res = await client.call('tools/call', { name: 'done', arguments: {} })
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text
  assert.ok(text.includes('done 完成'), `应完成：${text}`)
  assert.ok(text.includes('自动提交'), `响应应带自动提交尾注：${text}`)
  // 证据链：done.claimed 落账
  const evs = readEvents(join(repo, '.dev-flow')).events
  assert.ok(evs.some((e) => e.type === 'done.claimed'))
  // 最新提交 = 自动提交：前缀 + 主线标识 + 只含主线文件（绝不 -am）
  const lastMsg = git(repo, ['log', '-1', '--format=%s']).trim()
  assert.ok(lastMsg.startsWith('chore(dev-flow): [m1]'), `message 前缀应带主线标识：${lastMsg}`)
  assert.ok(lastMsg.includes('自动提交'), `message 应带自动提交尾注：${lastMsg}`)
  const changed = git(repo, ['show', '--name-status', '--format=', 'HEAD']).trim().split('\n')
  assert.deepEqual(changed, ['A\tsrc/a.ts'])
  // 用户改动原样留在工作区（未跟踪新增 + 已跟踪修改都未被卷入）
  const st = git(repo, ['status', '--porcelain']).split('\n').map((s) => s.trimEnd()).filter((s) => s !== '')
  assert.ok(st.includes('?? user-note.md'), `user-note.md 应未跟踪：${st.join('|')}`)
  assert.ok(st.includes(' M README.md'), `README.md 用户修改应未动：${st.join('|')}`)
  assert.ok(!st.some((s) => s.includes('src/a.ts')), `src/a.ts 应已提交：${st.join('|')}`)
})
