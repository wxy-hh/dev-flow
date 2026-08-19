#!/usr/bin/env node
/**
 * Bash 快路径 P95 抽测（T4 判据 4：目标 ≤30ms 含 node 冷启动）
 *
 * 方法：构造一个"无命中"的 PreToolUse Bash 载荷（命令 `ls -la`——快筛正则
 * 无命中），100 次串行执行 plugins/dev-flow/dist/pre-tool-use-bash.cjs，
 * 每次计时（冷启动全进程），输出 P50/P95/max。判定：P95 ≤30ms。
 *
 * 注意：脚本强制先 build（验证纪律——绝不拿旧构建当真）；hook 进程无文件
 * IO（快路径立即 exit 0），环境用空 .dev-flow 也无妨。
 */

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(ROOT, 'plugins/dev-flow/dist/pre-tool-use-bash.cjs')

// 构造无命中载荷（普通只读命令，不触发任何正则）
const payload = JSON.stringify({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls -la' },
  transcript_path: '/nonexistent/transcript.jsonl',
  cwd: ROOT,
})

const N = 100
const samples = []
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint()
  execFileSync(process.execPath, [HOOK], { input: payload, stdio: ['pipe', 'ignore', 'ignore'] })
  const t1 = process.hrtime.bigint()
  samples.push(Number(t1 - t0) / 1e6)
}
samples.sort((a, b) => a - b)
const p50 = samples[Math.floor(N * 0.5)]
const p95 = samples[Math.floor(N * 0.95)]
const max = samples[N - 1]
const mean = samples.reduce((s, x) => s + x, 0) / N

console.log(`Bash 快路径 P95 抽测（${N} 次冷启动，命令：ls -la）`)
console.log(`  P50 = ${p50.toFixed(1)}ms`)
console.log(`  P95 = ${p95.toFixed(1)}ms`)
console.log(`  max = ${max.toFixed(1)}ms`)
console.log(`  mean = ${mean.toFixed(1)}ms`)
console.log(`  目标线：P95 ≤30ms（计划 §7 判据 4，spike 实测 shell-form 26.4ms）`)
console.log(p95 <= 30 ? '  ✅ 达标' : '  ❌ 超标（需 exec form 或进一步瘦身）')

// 留痕（供验收报告引用）
writeFileSync(join(ROOT, 'build', 'bash-fastpath-p95.txt'), `${N} samples: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms mean=${mean.toFixed(1)}ms\n`)
