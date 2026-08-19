#!/usr/bin/env node
/**
 * esbuild 构建脚本（T1 骨架）
 *
 * - hooks：src/hooks/*.ts → plugins/dev-flow/dist/*.cjs
 *   单文件 bundle（--bundle --format=cjs --platform=node）。
 *   spike 结论（§4）：仓库 type:module 下 .js 的 require 会崩，产物必须 .cjs。
 * - 版本注入：从 package.json 读 version，以 esbuild --define 注入 DEV_FLOW_VERSION
 *   常量（版本单源，plugin.json 永不写 version，计划 §2.2）。
 * - 单测：--test 时把 test/*.test.ts 全部 bundle 到 build/test/（outdir + glob，
 *   outExtension 保持 .cjs 与 hook 产物一致），供 `node --test` 跑（零新增依赖，node:test）。
 *
 * 用法：node scripts/build.mjs [--test]
 */

import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const base = {
  bundle: true,
  format: 'cjs', // hook 脚本必须 CJS（type:module 仓库）
  platform: 'node',
  target: 'node20',
  define: { DEV_FLOW_VERSION: JSON.stringify(pkg.version) }, // 版本注入
}

await build({
  ...base,
  entryPoints: [
    join(ROOT, 'src/hooks/session-start.ts'),
    join(ROOT, 'src/hooks/user-prompt-submit.ts'),
    join(ROOT, 'src/hooks/pre-tool-use-write.ts'),
    join(ROOT, 'src/hooks/pre-tool-use-bash.ts'),
    join(ROOT, 'src/hooks/post-tool-use.ts'),
    join(ROOT, 'src/hooks/mcp-server.ts'),
  ],
  outdir: join(ROOT, 'plugins/dev-flow/dist'),
  outbase: join(ROOT, 'src/hooks'),
  outExtension: { '.js': '.cjs' }, // outdir 模式默认 .js，显式保持 .cjs（type:module 仓库）
})

if (process.argv.includes('--test')) {
  await build({
    ...base,
    entryPoints: [join(ROOT, 'test/*.test.ts')],
    outdir: join(ROOT, 'build/test'),
    outbase: join(ROOT, 'test'),
    outExtension: { '.js': '.cjs' }, // outdir 模式默认 .js，显式保持 .cjs（type:module 仓库）
  })
}
