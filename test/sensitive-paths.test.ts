/**
 * 敏感路径表单测（node:test，零新增依赖——计划 §4 T4 判据）
 *
 * 覆盖：四类内置模式各中（密钥凭据/CI 发布/数据/元敏感）；豁免永不拦
 * （.env.example/.env.sample/.env.template）；性质测试任意输入不崩溃；
 * NFC 归一化用例（NFD 输入命中 NFC 模式——macOS 文件系统常存 NFD）；
 * symlink 目标解析用例（文件级与目录级 symlink，写 symlink 命中目标敏感路径）；
 * config 追加只追加不覆盖（含通配/段序列/basename）；声明覆盖判定。
 *
 * 链路：test/*.test.ts → esbuild bundle 成 .cjs → `node --test`（scripts/build.mjs --test）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  declaredFilesCoverPath,
  extraPatternMatches,
  matchSensitivePath,
  resolveSymlinkTarget,
  resolveWritePath,
} from '../src/lib/sensitive-paths.js'

/** 临时根（symlink 用例需要真实文件系统），用毕清理 */
function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-sensitive-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 相对路径 → 绝对（模拟 hook 层 resolveWritePath 的输出形态） */
const abs = (p: string): string => (p.startsWith('/') ? p : `/${p}`)

test('敏感路径四类各中（内置表全覆盖）', () => {
  const cases: Array<[string, string]> = [
    // ① 密钥凭据
    ['/.env', 'secret.env'],
    ['/config/.env', 'secret.env'],
    ['/.env.local', 'secret.env'],
    ['/x/.env.prod', 'secret.env'],
    ['/certs/server.pem', 'secret.pem'],
    ['/certs/id_rsa.key', 'secret.key'],
    ['/secrets/whatever.json', 'secret.dir'],
    ['/app/config/secrets/token', 'secret.dir'],
    ['/home/u/.ssh/config', 'secret.ssh'],
    ['/home/u/.aws/credentials', 'secret.aws'],
    ['/home/u/.npmrc', 'secret.npmrc'],
    // ② CI 与发布
    ['/.github/workflows/ci.yml', 'ci.workflows'],
    ['/repo/.github/workflows/deploy.yml', 'ci.workflows'],
    ['/Dockerfile', 'ci.dockerfile'],
    ['/deploy/prod.sh', 'ci.deploy'],
    ['/infra/k8s/deploy.yaml', 'ci.k8s'],
    ['/infra/main.tf', 'ci.tf'],
    // ③ 数据
    ['/db/migrations/001_init.sql', 'data.migrations'],
    ['/prisma/schema.prisma', 'data.schema'],
    // ④ 元敏感
    ['/.dev-flow/state.json', 'meta.devflow'],
    ['/.dev-flow/events.jsonl', 'meta.devflow'],
    ['/.claude/settings.json', 'meta.claude'],
  ]
  for (const [path, rule] of cases) {
    const r = matchSensitivePath(abs(path))
    assert.equal(r.matched, true, `应命中：${path}`)
    assert.equal(r.rule, rule, `规则名：${path} → ${rule}`)
  }
})

test('豁免永不拦（.env 三例 + 正常文件）', () => {
  const allowed: string[] = [
    '/.env.example',
    '/.env.sample',
    '/.env.template',
    '/config/.env.example',
    '/README.md',
    '/src/foo.js',
    '/src/lib/main.ts',
    '/package.json',
    '/.gitignore',
    '/.env.example.local', // 非豁免三例精确名 → 拦（宁窄：只有三例公开）
  ]
  for (const path of allowed.slice(0, 9)) {
    const r = matchSensitivePath(abs(path))
    assert.equal(r.matched, false, `不应命中：${path}`)
  }
  // 最后一个：.env.example.local 应命中（不在豁免清单）
  const r = matchSensitivePath(abs(allowed[9]))
  assert.equal(r.matched, true, '.env.example.local 不在豁免清单，应命中')
  assert.equal(r.rule, 'secret.env')
})

test('性质测试：任意输入不崩溃、匹配结果布尔稳定', () => {
  const inputs = [
    '',
    '/',
    '..',
    '.',
    '//',
    '/a//b',
    '/a/./b',
    'a b c',
    '/\u0000/secret',
    '/\uFFFF.env',
    'x'.repeat(10000),
    '/.env/',
    '/.env.example',
    '/A/./.env',
    '/secrets',
    'secrets',
    '/secret/',
    '/.ssh',
    '/.github/workflows',
    '/migrations',
    '/tmp',
    '/Users/me/Desktop/practice/dev-flow/.dev-flow/state.json',
    '/caf\u00e9/schema.prisma',
    '/\u0301',
    '日本語/パス.env',
  ]
  for (const input of inputs) {
    const r = matchSensitivePath(input)
    assert.equal(typeof r.matched, 'boolean', `不崩溃：${JSON.stringify(input)}`)
    if (r.matched) assert.equal(typeof r.rule, 'string')
  }
})

test('NFC 归一化：NFD 输入命中 NFC 模式（macOS 防漏判）', () => {
  // é 的 NFD = e + U+0301；NFC = U+00E9。config 追加 NFD 模式，NFD 输入应命中。
  const nfd = '/proj/cafe\u0301/creds.env' // cafe\u0301 是 NFD 的 café
  const nfc = nfd.normalize('NFC')
  assert.notEqual(nfd, nfc, '前置：NFD 与 NFC 字符串确实不同')

  // 内置 basename 规则（.env）不依赖归一化也能中；关键是段规则/自定义模式
  const extraNfd = 'cafe\u0301/'
  const r = matchSensitivePath(nfd, [extraNfd])
  assert.equal(r.matched, true, 'NFD 输入 + NFD 追加模式应命中（归一化后同形）')
  assert.equal(r.rule, 'config.custom')

  // NFC 输入 + NFD 追加模式也应命中（两边都归一化到 NFC）
  const r2 = matchSensitivePath(nfc, [extraNfd])
  assert.equal(r2.matched, true, 'NFC 输入 + NFD 追加模式应命中')
})

test('symlink 目标解析：写 symlink 命中目标敏感路径（坑 N-5）', (t) => {
  const dir = tempDir(t)
  // 文件级：真实 .env + 普通名 symlink → 写 symlink 应按目标命中
  const realDir = join(dir, 'real')
  mkdirSync(realDir)
  writeFileSync(join(realDir, '.env'), 'x')
  const link = join(dir, 'link-file')
  symlinkSync(join(realDir, '.env'), link)

  const resolved = resolveWritePath(link, dir)
  assert.ok(resolved.endsWith('real/.env'), `应解析到真实目标：${resolved}`)
  const r = matchSensitivePath(resolved)
  assert.equal(r.matched, true, 'symlink 目标为 .env → 命中')
  assert.equal(r.rule, 'secret.env')

  // 目录级：symlink 目录 → 目录内文件按目标段命中
  const linkDir = join(dir, 'link-dir')
  symlinkSync(join(dir, 'real'), linkDir, 'dir')
  const resolved2 = resolveWritePath(join(linkDir, '.env'), dir)
  assert.ok(resolved2.endsWith('real/.env'), `目录 symlink 解析：${resolved2}`)
  assert.equal(matchSensitivePath(resolved2).matched, true)

  // 相对 symlink 目标
  const relLink = join(dir, 'rel-link')
  symlinkSync('real/.env', relLink)
  const resolved3 = resolveWritePath(relLink, dir)
  assert.ok(resolved3.endsWith('real/.env'), `相对目标解析：${resolved3}`)

  // 普通文件（无 symlink）→ 原样返回（macOS /tmp→/private/tmp 等系统级 symlink
  // 会被 realpath 解析，属预期行为；断言以尾部文件名与可解析性为准）
  const plain = join(dir, 'plain.txt')
  writeFileSync(plain, 'x')
  const resolvedPlain = resolveWritePath(plain, dir)
  assert.ok(resolvedPlain.endsWith('plain.txt'), `普通文件可解析：${resolvedPlain}`)
  assert.equal(resolveSymlinkTarget(plain), resolvedPlain)

  // 不存在的路径（首次创建）→ 不崩、按可解析祖先归一化
  const notExist = join(dir, 'nope', 'deep', 'file.ts')
  assert.equal(typeof resolveWritePath(notExist, dir), 'string')
})

test('resolveSymlinkTarget：不存在路径逐级回溯到可解析祖先', (t) => {
  const dir = tempDir(t)
  const sub = join(dir, 'sub')
  mkdirSync(sub)
  const target = join(sub, 'a', 'b', 'c.ts')
  const resolved = resolveSymlinkTarget(target)
  assert.ok(resolved.includes('/sub/'), `祖先 sub 被解析：${resolved}`)
  assert.ok(resolved.endsWith('/a/b/c.ts'), '尾部保留')
})

test('config 追加只追加不覆盖（basename/段序列/通配）', () => {
  // basename 精确
  assert.equal(extraPatternMatches('credentials.json', ['/proj', 'credentials.json'], 'credentials.json'), true)
  assert.equal(extraPatternMatches('credentials.json', ['/proj', 'x.json'], 'x.json'), false)
  // 段序列（'foo/bar' 连续包含）
  assert.equal(extraPatternMatches('foo/bar', ['/a', 'foo', 'bar', 'x'], 'x'), true)
  assert.equal(extraPatternMatches('foo/bar', ['/a', 'foo', 'mid', 'bar', 'x'], 'x'), false)
  // 通配：*.prod 命中 basename；双星 internal 星 命中任意层级的 internal 目录
  // （单星不跨层；双星可跨层）
  assert.equal(extraPatternMatches('*.prod', ['/a', 'x.prod'], 'x.prod'), true)
  assert.equal(extraPatternMatches('*.prod', ['/a', 'x.prod'], 'x.prod'), true)
  assert.equal(extraPatternMatches('**/internal/*', ['', 'proj', 'internal', 'x'], 'x'), true)
  assert.equal(extraPatternMatches('**/internal/*', ['', 'proj', 'internal', 'deep', 'x'], 'x'), false)
  assert.equal(extraPatternMatches('**/internal/**', ['', 'proj', 'internal', 'deep', 'x'], 'x'), true)
  assert.equal(extraPatternMatches('**/internal/*', ['', 'proj', 'other', 'x'], 'x'), false)
  assert.equal(extraPatternMatches('internal/*', ['', 'internal', 'x'], 'x'), true)
  // 空/空白 → 不命中
  assert.equal(extraPatternMatches('  ', ['/a', 'x'], 'x'), false)
})

test('matchSensitivePath 集成：内置 + config 追加合并（追加不覆盖）', () => {
  const extras = ['credentials.json', 'internal/']
  assert.equal(matchSensitivePath('/proj/credentials.json', extras).rule, 'config.custom')
  assert.equal(matchSensitivePath('/proj/internal/x/y.ts', extras).matched, true)
  // 内置规则仍生效（追加不影响）
  assert.equal(matchSensitivePath('/proj/.env', extras).rule, 'secret.env')
  // 未命中
  assert.equal(matchSensitivePath('/proj/src/main.ts', extras).matched, false)
})

test('插件根元敏感（meta.plugin）：写插件自身文件被拦', () => {
  const pluginRoot = '/repo/plugins/dev-flow'
  const r = matchSensitivePath('/repo/plugins/dev-flow/hooks/hooks.json', [], pluginRoot)
  assert.equal(r.matched, true)
  assert.equal(r.rule, 'meta.plugin')
  // 插件根缺失（非插件运行）→ 不命中
  assert.equal(matchSensitivePath('/repo/plugins/dev-flow/hooks/hooks.json', [], null).matched, false)
})

test('declaredFilesCoverPath：声明文件/目录前缀覆盖判定（NFC 归一化）', () => {
  // 相对声明 + 相对目标（模型意图块与 Write file_path 的常态）
  assert.equal(declaredFilesCoverPath(['src/foo.js'], 'src/foo.js'), true)
  assert.equal(declaredFilesCoverPath(['src/'], 'src/foo/bar.ts'), true)
  assert.equal(declaredFilesCoverPath(['src'], 'src/foo/bar.ts'), true)
  assert.equal(declaredFilesCoverPath(['src/'], 'src'), true)
  assert.equal(declaredFilesCoverPath(['.env'], '.env'), true)
  assert.equal(declaredFilesCoverPath(['other/'], 'src/foo.ts'), false)
  assert.equal(declaredFilesCoverPath(['src/foo.ts'], 'src/foo.js'), false)
  // 绝对声明 + 绝对目标
  assert.equal(declaredFilesCoverPath(['/proj/src/'], '/proj/src/foo/bar.ts'), true)
  // NFD 声明 + NFC 路径（归一化后同形；声明与目标同形态比较）
  assert.equal(declaredFilesCoverPath(['cafe\u0301/x.ts'], 'caf\u00e9/x.ts'), true)
  assert.equal(declaredFilesCoverPath(['cafe\u0301/'], 'caf\u00e9/x.ts'), true)
})
