/**
 * writeState 并发写回归测试（P0：24 条 rename ENOENT 实证——固定 tmp 名在并发
 * 写者下互踩）。零新增依赖（node:test + assert/strict + 仓库已有 esbuild devDep）。
 *
 * 覆盖：
 * 1. 真实多进程并发（12 进程 × 15 轮，同步 sleep 放大重叠窗口）：
 *    - 对照：内联旧版"固定 tmp 名"写原语跑同样负载，断言竞态必现（负载有效性）；
 *    - 被测：新版 writeState 全进程退出码 0（无 ENOENT 抛错）、最终 state.json
 *      合法 JSON、无孤儿 tmp 残留；
 * 2. 异常路径：目标被目录占位 → 有界重试后抛错（fail-open 交调用方），
 *    且不留自己的孤儿 tmp；
 * 3. 残留 tmp（崩溃遗留）由下次写清理——只清 mtime 超龄（>10s）的，在途 tmp 不误删。
 *
 * 实现说明：单进程内同步 writeState 无法真正并发，故用 child_process 起多个
 * node 进程同时写同一 root（进程间无共享内存，与真实 hook 进程隔离模型一致）。
 * 子进程加载的 state 模块 = 用仓库已有 esbuild CLI 把 src/lib/state.ts 现场
 * bundle 成临时 .cjs（非新增依赖；esbuild 是 package.json devDependencies）。
 * 同步 sleep 用 Atomics.wait（零依赖）。
 *
 * 链路：test/*.test.ts → esbuild bundle 成 .cjs → `node --test`（scripts/build.mjs --test）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultState, writeState } from '../src/lib/state.js'

/** 建独立临时目录（每用例互不污染），用毕清理 */
function tempRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-state-conc-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * 用仓库已有 esbuild CLI 把 src/lib/state.ts bundle 成临时 .cjs（子进程可
 * require 的真实被测模块；events.ts 只依赖 node 内置，可独立 bundle）。
 * 仓库根 = 测试进程 cwd（npm test 从仓库根运行）。
 */
function bundleState(t: { after(fn: () => void): void }): string {
  const repoRoot = process.cwd()
  const esbuildBin = join(repoRoot, 'node_modules', '.bin', 'esbuild')
  assert.equal(existsSync(esbuildBin), true, `esbuild CLI 缺失：${esbuildBin}（请先 npm install）`)
  const outDir = tempRoot(t)
  const stateCjs = join(outDir, 'state.cjs')
  const r = spawnSync(
    esbuildBin,
    ['src/lib/state.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${stateCjs}`],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  assert.equal(r.status, 0, `esbuild 编译失败：${r.stderr}`)
  assert.equal(existsSync(stateCjs), true, 'esbuild 产物缺失')
  return stateCjs
}

/** 子进程负载脚本：先跑"旧版固定 tmp 名"对照（统计失败数），再跑新版 writeState */
function childScript(stateCjs: string, root: string): string {
  const cjs = JSON.stringify(stateCjs)
  const r = JSON.stringify(root)
  return `
const fs = require('fs');
const path = require('path');
const { writeState } = require(${cjs});
const root = ${r};
// 同步 sleep：Atomics.wait（零依赖，进程内真实阻塞，放大并发重叠窗口）
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// 阶段一（对照）：旧版固定 tmp 名写原语——并发下必然出现 rename ENOENT
let legacyFailures = 0;
for (let i = 0; i < 15; i++) {
  sleep(Math.floor(Math.random() * 4));
  try {
    fs.writeFileSync(path.join(root, 'state.json.tmp'), JSON.stringify({ legacy: true, i }), 'utf8');
    fs.renameSync(path.join(root, 'state.json.tmp'), path.join(root, 'state.json'));
  } catch (e) { legacyFailures += 1; }
}
// 阶段二（被测）：新版 writeState——并发下不应抛错（抛错=未捕获异常，进程非 0 退出）
for (let i = 0; i < 15; i++) {
  sleep(Math.floor(Math.random() * 4));
  writeState(root, { version: 1, extra: { pid: process.pid, i } });
}
process.stdout.write('legacyFailures=' + legacyFailures + '\\n');
`
}

/** 起一个子进程并等待退出，返回退出码与 legacyFailures 计数 */
function runChild(script: string): Promise<{ code: number; legacyFailures: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => {
      out += c
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      const m = /legacyFailures=(\d+)/.exec(out)
      resolve({ code: code ?? -1, legacyFailures: m ? Number(m[1]) : -1 })
    })
  })
}

test('writeState 并发写（12 进程×15 轮）：对照固定名必现竞态，唯一名全绿、state.json 合法、无孤儿 tmp', async (t) => {
  const dir = tempRoot(t) // 并发写的共享状态根
  const stateCjs = bundleState(t)
  const script = childScript(stateCjs, dir)
  const CHILDREN = 12
  const results = await Promise.all(Array.from({ length: CHILDREN }, () => runChild(script)))

  // ① 对照负载有效性：固定 tmp 名在并发下必现竞态（否则说明负载没造成重叠）
  const legacyTotal = results.reduce((s, r) => s + r.legacyFailures, 0)
  assert.ok(
    legacyTotal > 0,
    `对照负载未复现固定名竞态（legacyFailures=${legacyTotal}）——本测试负载需加大，未测到并发重叠`,
  )
  // ② 被测：新版 writeState 全部成功（任何抛错 → 进程非 0 退出）
  for (const r of results) {
    assert.equal(r.code, 0, `子进程异常退出（新版 writeState 不应抛错）：legacyFailures=${r.legacyFailures}`)
  }
  // ③ 最终 state.json 合法 JSON 对象
  const parsed = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as unknown
  assert.ok(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
  // ④ 无孤儿 tmp 残留（正常路径 write→rename 不落 tmp；写前清理只动超龄残留）
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), [])
})

test('writeState：目标被目录占位 → 有界重试后抛错（fail-open 交调用方），且不留自己的孤儿 tmp', (t) => {
  const dir = tempRoot(t)
  mkdirSync(join(dir, 'state.json')) // rename(tmp → 目录) 必然失败，重试耗尽仍失败
  assert.throws(() => writeState(dir, defaultState()))
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), [])
})

test('writeState 清理旧 tmp 残留按 mtime 年龄：>10s 才算崩溃遗留被清，在途/刚写的 tmp 不误删', (t) => {
  const dir = tempRoot(t)
  const stale = join(dir, 'state.json.4242.1.abc123.tmp')
  writeFileSync(stale, '旧残留（崩溃遗留）', 'utf8')
  const fresh = join(dir, 'state.json.9999.2.zzz999.tmp')
  writeFileSync(fresh, '在途 tmp（并发写者刚写完、未 rename）', 'utf8')
  const past = new Date(Date.now() - 60_000)
  utimesSync(stale, past, past) // 把残留 mtime 拨老：模拟崩溃遗留（返修：只清老的）
  writeState(dir, defaultState())
  assert.equal(existsSync(join(dir, 'state.json')), true)
  assert.equal(existsSync(stale), false, '老的残留（mtime >10s）应被清理')
  assert.equal(existsSync(fresh), true, '在途/刚写的 tmp（mtime 新）不应被误删——误删会重新制造并发 ENOENT')
})
