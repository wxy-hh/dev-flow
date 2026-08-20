/**
 * 自动 git commit 模块单测（node:test + esbuild 链，零新增依赖——计划 §6 T7 判据）
 *
 * 计划 §3.6 规格逐条落测（真实临时仓，node 环境有 git）：
 * - 选择性提交：仓里混用户未提交改动 + 主线文件，断言 git log 只含主线文件、
 *   用户改动还在工作区（红线：绝不卷用户改动）；
 * - message 前缀契约（可过滤可 squash）+ intent 摘要进消息；
 * - 空提交 fail-open（清单文件与 HEAD 相同 → nothing-staged，不产生提交）；
 * - detached HEAD fail-open、merge 冲突 fail-open、git 不存在 fail-open、
 *   不在仓内 fail-open；
 * - autoCommit=false → disabled（直接返回"已关闭"）；
 * - 已删除文件处理（已跟踪删除正常提交、从未存在路径剔除）;
 * - 清单去重、路径归一、ignored 剔除、目录剔除；
 * - 纯函数面（planAutoCommit / buildCommitMessage）确定性。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  AUTO_COMMIT_PREFIX,
  AUTO_COMMIT_TAG,
  autoCommitOutcome,
  buildCommitMessage,
  execAutoCommit,
  planAutoCommit,
  type AutoCommitResult,
} from '../src/lib/auto-commit.js'
import { defaultConfig } from '../src/lib/config.js'
import type { DevFlowEvent } from '../src/lib/events.js'

/** 跑 git 并返回 stdout + 退出码（测试辅助，失败不抛） */
function git(cwd: string, args: string[]): { out: string; status: number } {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { out, status: 0 }
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string }
    return { out: String(e.stderr ?? '').trim(), status: e.status ?? -1 }
  }
}

/** 建独立临时 git 仓（每个用例互不污染），用毕清理 */
function tempRepo(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-commit-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(git(dir, ['init', '-q', '-b', 'main']).status, 0)
  git(dir, ['config', 'user.name', 'dev-flow-test'])
  git(dir, ['config', 'user.email', 'test@dev-flow.local'])
  return dir
}

/** 建不含 git 的临时目录（not-a-repo 用例） */
function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-flow-commit-norepo-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeFile(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

function rmFile(dir: string, rel: string): void {
  rmSync(join(dir, rel))
}

/** 提交信息列表（新→旧） */
function logMessages(dir: string): string[] {
  return git(dir, ['log', '--format=%s']).out.trim().split('\n').filter((s) => s !== '')
}

/** HEAD 提交的变更文件（name-status 行） */
function headChanges(dir: string): string[] {
  return git(dir, ['show', '--name-status', '--format=', 'HEAD']).out.trim().split('\n').filter((s) => s !== '')
}

/** 工作区状态（porcelain 行；只去行尾空白，保留列前缀空格：` M x`=工作区修改） */
function worktreeStatus(dir: string): string[] {
  return git(dir, ['status', '--porcelain']).out.split('\n').map((s) => s.trimEnd()).filter((s) => s !== '')
}

/** file.changed 事件构造 */
function fc(mainlineId: string, path: string): DevFlowEvent {
  return { type: 'file.changed', t: 'T0', mainlineId, tool: 'Write', path }
}

/** intent.declared 事件构造（摘要进 commit message） */
function intent(mainlineId: string, summary: string): DevFlowEvent {
  return { type: 'intent.declared', t: 'T0', mainlineId, requirementId: null, summary, verifyCommand: null, risk: null, files: [] }
}

test('planAutoCommit：无事件 → no-files；autoCommit=false → disabled；空主线 id → no-files', () => {
  const cfg = defaultConfig()
  assert.deepEqual(planAutoCommit([], 'm1', cfg), { status: 'no-files', mainlineId: 'm1' })
  assert.deepEqual(planAutoCommit([], '', cfg), { status: 'no-files', mainlineId: '' })
  const off = { ...defaultConfig(), autoCommit: false }
  const p = planAutoCommit([fc('m1', 'a.ts')], 'm1', off)
  assert.equal(p.status, 'disabled')
  // 他主线事件不参与
  assert.equal(planAutoCommit([fc('other', 'a.ts')], 'm1', cfg).status, 'no-files')
})

test('planAutoCommit：清单去重保序 + 路径归一（./、尾部斜杠、绝对路径、.. 剔除）', () => {
  const cfg = defaultConfig()
  const events = [
    fc('m1', 'src/a.ts'),
    fc('m1', './src/a.ts'), // 与上行同文件（归一后去重）
    fc('m1', 'src/a.ts'), // 重复
    fc('m1', 'lib/x/'), // 尾部斜杠（目录形态归一为 lib/x）
    fc('m1', '/etc/abs.ts'), // 绝对路径剔除
    fc('m1', 'a/../b.ts'), // 越界路径剔除
    fc('m1', '..'), // 非法剔除
    fc('m1', '  '), // 空白剔除
    fc('m1', 'src/b.ts'),
  ]
  const p = planAutoCommit(events, 'm1', cfg)
  assert.equal(p.status, 'ready')
  if (p.status === 'ready') {
    assert.deepEqual(p.files, ['src/a.ts', 'lib/x', 'src/b.ts'])
  }
})

test('buildCommitMessage：前缀契约 + 摘要进消息 + 无摘要兜底 + 控制字符单行化 + 截断', () => {
  // 前缀固定（过滤键）与尾注
  assert.ok(buildCommitMessage('m1', 3, null).startsWith(`${AUTO_COMMIT_PREFIX}[m1]`))
  assert.equal(buildCommitMessage('m1', 3, null), `${AUTO_COMMIT_PREFIX}[m1] ${AUTO_COMMIT_TAG} 3 个文件`)
  // 摘要进消息
  assert.equal(
    buildCommitMessage('ml-9', 2, '修复登录页空白'),
    `${AUTO_COMMIT_PREFIX}[ml-9] 修复登录页空白（${AUTO_COMMIT_TAG} 2 个文件）`,
  )
  // 空摘要 = 无摘要
  assert.equal(buildCommitMessage('m1', 1, '   '), `${AUTO_COMMIT_PREFIX}[m1] ${AUTO_COMMIT_TAG} 1 个文件`)
  // 控制字符/换行压平（防多行消息注入）
  const msg = buildCommitMessage('m1\nEVIL', 1, '修复\n登录')
  assert.ok(!msg.includes('\n'))
  assert.equal(msg, `${AUTO_COMMIT_PREFIX}[m1 EVIL] 修复 登录（${AUTO_COMMIT_TAG} 1 个文件）`)
  // 摘要按码点截断（不劈半代理对）
  const long = buildCommitMessage('m1', 1, '😀'.repeat(70))
  assert.ok(!long.includes('\n'))
  assert.ok(long.includes('😀'.repeat(60)))
  assert.ok(!long.includes('😀'.repeat(61)))
})

test('选择性提交：仓里混用户未提交改动（untracked + 已跟踪修改），git log 只含主线文件', (t) => {
  const repo = tempRepo(t)
  // 基线提交：base.txt 与 tracked-main.ts
  writeFile(repo, 'base.txt', 'v1')
  writeFile(repo, 'tracked-main.ts', 'v1')
  assert.equal(git(repo, ['add', '.']).status, 0)
  assert.equal(git(repo, ['commit', '-qm', 'baseline']).status, 0)
  // 用户自己的未提交改动：新增未跟踪文件 + 修改已跟踪文件（都不在事件里）
  writeFile(repo, 'user-new.txt', 'user stuff')
  writeFile(repo, 'base.txt', 'v2-user-change')
  // 主线改动：修改 tracked-main.ts + 新建 src/m1.ts
  writeFile(repo, 'tracked-main.ts', 'v2-mainline')
  writeFile(repo, 'src/m1.ts', 'mainline content')

  const p = planAutoCommit([fc('m1', 'tracked-main.ts'), fc('m1', 'src/m1.ts')], 'm1', defaultConfig())
  assert.equal(p.status, 'ready')
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'committed')

  // HEAD 提交只含主线文件（选择性提交红线）
  const changes = headChanges(repo)
  assert.equal(changes.length, 2)
  assert.ok(changes.includes('M\ttracked-main.ts'))
  assert.ok(changes.includes('A\tsrc/m1.ts'))
  assert.ok(!changes.some((c) => c.includes('base.txt') || c.includes('user-new.txt')))

  // 用户改动原样留在工作区
  const st = worktreeStatus(repo)
  assert.ok(st.includes(' M base.txt'), `base.txt 用户修改应未动：${st.join('|')}`)
  assert.ok(st.includes('?? user-new.txt'), `user-new.txt 应未跟踪：${st.join('|')}`)
  assert.ok(!st.some((s) => s.includes('tracked-main.ts') || s.includes('src/m1.ts')))
})

test('message 进 git log：前缀契约可过滤（^chore(dev-flow): \\[）+ 摘要来自 intent.declared', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'fix.ts', 'x')
  const p = planAutoCommit([intent('m1', '修复登录页空白'), fc('m1', 'fix.ts')], 'm1', defaultConfig())
  assert.equal(p.status, 'ready')
  if (p.status === 'ready') {
    assert.ok(p.message.startsWith(`${AUTO_COMMIT_PREFIX}[m1] 修复登录页空白（`))
    const r = execAutoCommit(p, repo)
    assert.equal(r.status, 'committed')
    const logs = logMessages(repo)
    assert.equal(logs.length, 1)
    assert.equal(logs[0], p.message)
    // 过滤键：git log --grep 按前缀能全部命中
    const grep = git(repo, ['log', '--format=%s', `--grep=^chore(dev-flow): \\[`])
    assert.equal(grep.status, 0)
    assert.equal(grep.out.trim(), p.message)
  }
})

test('空提交 fail-open：清单文件与 HEAD 相同 → nothing-staged，不产生提交', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'same.ts', 'v1')
  assert.equal(git(repo, ['add', '.']).status, 0)
  assert.equal(git(repo, ['commit', '-qm', 'baseline']).status, 0)
  // 事件声称改过 same.ts，但工作区内容与 HEAD 相同（重写同内容 / 启发式误记）
  const p = planAutoCommit([fc('m1', 'same.ts')], 'm1', defaultConfig())
  assert.equal(p.status, 'ready')
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'skipped')
  if (r.status === 'skipped') assert.equal(r.reason, 'nothing-staged')
  assert.equal(logMessages(repo).length, 1) // 没有新提交
  assert.deepEqual(worktreeStatus(repo), [])
})

test('detached HEAD fail-open：跳过不提交，返回结构化原因', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'base.txt', 'v1')
  assert.equal(git(repo, ['add', '.']).status, 0)
  assert.equal(git(repo, ['commit', '-qm', 'baseline']).status, 0)
  assert.equal(git(repo, ['checkout', '-q', '--detach']).status, 0)
  writeFile(repo, 'new.ts', 'x')
  const p = planAutoCommit([fc('m1', 'new.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'skipped')
  if (r.status === 'skipped') {
    assert.equal(r.reason, 'detached-head')
    assert.equal(logMessages(repo).length, 1)
  }
})

test('merge 冲突 fail-open：有未合并路径 → 跳过，不碰冲突中的 index', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'conflict.ts', 'base')
  assert.equal(git(repo, ['add', '.']).status, 0)
  assert.equal(git(repo, ['commit', '-qm', 'baseline']).status, 0)
  // 两分支各自改同一文件 → 合并必然冲突
  assert.equal(git(repo, ['checkout', '-q', '-b', 'side']).status, 0)
  writeFile(repo, 'conflict.ts', 'side')
  assert.equal(git(repo, ['commit', '-qam', 'side']).status, 0)
  assert.equal(git(repo, ['checkout', '-q', 'main']).status, 0)
  writeFile(repo, 'conflict.ts', 'main')
  assert.equal(git(repo, ['commit', '-qam', 'main']).status, 0)
  assert.equal(git(repo, ['merge', 'side']).status, 1) // 冲突
  assert.notEqual(git(repo, ['ls-files', '--unmerged']).out.trim(), '')

  writeFile(repo, 'unrelated.ts', 'x')
  const p = planAutoCommit([fc('m1', 'unrelated.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'skipped')
  if (r.status === 'skipped') assert.equal(r.reason, 'merge-conflict')
  // index 未被我们动过：冲突状态原样保留
  assert.notEqual(git(repo, ['ls-files', '--unmerged']).out.trim(), '')
})

test('git 不存在 fail-open：PATH 注入 → git-missing，不抛异常', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'a.ts', 'x')
  const p = planAutoCommit([fc('m1', 'a.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, repo, { PATH: '/nonexistent-dir' })
  assert.equal(r.status, 'skipped')
  if (r.status === 'skipped') assert.equal(r.reason, 'git-missing')
})

test('不在 git 仓内 fail-open：not-a-repo', (t) => {
  const dir = tempDir(t)
  writeFile(dir, 'a.ts', 'x')
  const p = planAutoCommit([fc('m1', 'a.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, dir)
  assert.equal(r.status, 'skipped')
  if (r.status === 'skipped') assert.equal(r.reason, 'not-a-repo')
})

test('exec 收到非 ready 计划：防御性透传其语义（disabled / no-files）', (t) => {
  const repo = tempRepo(t)
  const off = planAutoCommit([fc('m1', 'a.ts')], 'm1', { ...defaultConfig(), autoCommit: false })
  assert.equal(off.status, 'disabled')
  const r1 = execAutoCommit(off, repo)
  assert.equal(r1.status, 'skipped')
  if (r1.status === 'skipped') assert.equal(r1.reason, 'disabled')
  const noFiles = planAutoCommit([], 'm1', defaultConfig())
  assert.equal(noFiles.status, 'no-files')
  const r2 = execAutoCommit(noFiles, repo)
  assert.equal(r2.status, 'skipped')
  if (r2.status === 'skipped') assert.equal(r2.reason, 'no-files')
})

test('已删除文件处理：已跟踪删除随提交记录；从未存在的路径剔除（no-addable-files）', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'gone.ts', 'v1')
  writeFile(repo, 'keep.ts', 'v1')
  assert.equal(git(repo, ['add', '.']).status, 0)
  assert.equal(git(repo, ['commit', '-qm', 'baseline']).status, 0)
  // 主线删除 gone.ts（已跟踪 → git add -A 正常暂存删除），另新建 keep2.ts
  rmFile(repo, 'gone.ts')
  writeFile(repo, 'keep2.ts', 'new')

  const p = planAutoCommit([fc('m1', 'gone.ts'), fc('m1', 'keep2.ts')], 'm1', defaultConfig())
  assert.equal(p.status, 'ready')
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'committed')
  const changes = headChanges(repo)
  assert.ok(changes.includes('D\tgone.ts'), `应含删除：${changes.join('|')}`)
  assert.ok(changes.includes('A\tkeep2.ts'))

  // 从未存在的路径：不在磁盘、不被跟踪 → 剔除 → no-addable-files（无 addable）
  const ghost = planAutoCommit([fc('m1', 'ghost.ts')], 'm1', defaultConfig())
  const rg = execAutoCommit(ghost, repo)
  assert.equal(rg.status, 'skipped')
  if (rg.status === 'skipped') assert.equal(rg.reason, 'no-addable-files')
})

test('ignored 文件剔除：git add 对 ignored 报错，预剔除后照常提交其余文件', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, '.gitignore', 'dist/\n')
  writeFile(repo, 'dist/out.js', 'gen') // 被忽略的产物
  writeFile(repo, 'src/real.ts', 'real')
  const p = planAutoCommit([fc('m1', 'dist/out.js'), fc('m1', 'src/real.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'committed')
  const changes = headChanges(repo)
  assert.equal(changes.length, 1)
  assert.ok(changes.includes('A\tsrc/real.ts'))
  if (r.status === 'committed') {
    assert.deepEqual(r.dropped, [{ path: 'dist/out.js', reason: 'ignored' }])
    assert.deepEqual(r.staged, ['src/real.ts'])
  }
  // dist/out.js 仍在工作区（未被我们卷走，仍是 ignored untracked）
  assert.equal(existsSync(join(repo, 'dist/out.js')), true)
})

test('目录路径剔除：file.changed 记目录名（cp/mv 场景）→ 不 add 目录，只提交文件清单', (t) => {
  const repo = tempRepo(t)
  mkdirSync(join(repo, 'assets'), { recursive: true })
  writeFile(repo, 'assets/x.txt', 'asset')
  writeFile(repo, 'src/r.ts', 'real')
  const p = planAutoCommit([fc('m1', 'assets'), fc('m1', 'src/r.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'committed')
  const changes = headChanges(repo)
  assert.deepEqual(changes, ['A\tsrc/r.ts'])
  if (r.status === 'committed') {
    assert.deepEqual(r.dropped, [{ path: 'assets', reason: 'directory' }])
  }
  // assets/x.txt 原样未跟踪（目录被跳过，用户/主线内容都没被卷进）
  assert.equal(existsSync(join(repo, 'assets/x.txt')), true)
  assert.ok(worktreeStatus(repo).includes('?? assets/'))
})

test('首次提交（无基线）：unborn 分支上自动 commit 正常产出根提交', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'src/init.ts', 'hello')
  const p = planAutoCommit([intent('m1', '初始化'), fc('m1', 'src/init.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'committed')
  assert.deepEqual(headChanges(repo), ['A\tsrc/init.ts'])
  if (r.status === 'committed') assert.ok(r.sha !== null)
})

test('exec 成功时返回短 sha 与 message（审计落账素材）', (t) => {
  const repo = tempRepo(t)
  writeFile(repo, 'a.ts', 'x')
  const p = planAutoCommit([fc('m1', 'a.ts')], 'm1', defaultConfig())
  const r = execAutoCommit(p, repo)
  assert.equal(r.status, 'committed')
  if (r.status === 'committed') {
    assert.match(r.sha ?? '', /^[0-9a-f]{7,}$/)
    assert.ok(r.message.startsWith(`${AUTO_COMMIT_PREFIX}[m1]`))
  }
})

// —— T7 接线裁决（autoCommitOutcome：plan/result → 审计文案 + 响应尾注）——
// 判断逻辑在 lib 的纯函数面（接线壳只做 IO：写审计、拼尾注），语义契约落测：
// disabled（配置关闭）→ 审计；no-files（无事可做）→ 不审计；committed → 尾注
// 带短 sha；skipped/failed → 审计含原因中文标签、无尾注（fail-open：done 照成）。

test('autoCommitOutcome：disabled（autoCommit=false）→ 审计"已关闭"，无响应尾注', () => {
  const plan = planAutoCommit([fc('m1', 'a.ts')], 'm1', { ...defaultConfig(), autoCommit: false })
  assert.equal(plan.status, 'disabled')
  if (plan.status === 'disabled') {
    const o = autoCommitOutcome(plan, null)
    assert.ok(o.audit !== null && o.audit.includes('已关闭'))
    assert.equal(o.note, null)
  }
})

test('autoCommitOutcome：no-files → 无审计无尾注（无事可做，非故障）', () => {
  const plan = planAutoCommit([], 'm1', defaultConfig())
  assert.equal(plan.status, 'no-files')
  if (plan.status === 'no-files') {
    assert.deepEqual(autoCommitOutcome(plan, null), { audit: null, note: null })
  }
})

test('autoCommitOutcome：committed → 无审计 + 尾注带短 sha（取不到给兜底）', () => {
  const plan = planAutoCommit([fc('m1', 'a.ts')], 'm1', defaultConfig())
  assert.equal(plan.status, 'ready')
  if (plan.status === 'ready') {
    const committed: AutoCommitResult = {
      status: 'committed',
      sha: 'abc1234',
      message: plan.message,
      staged: ['a.ts'],
      dropped: [],
    }
    const o = autoCommitOutcome(plan, committed)
    assert.equal(o.audit, null)
    assert.equal(o.note, '；自动提交 abc1234')
    // 短 sha 获取失败（尽力而为）→ 兜底尾注，仍无审计
    const o2 = autoCommitOutcome(plan, { ...committed, sha: null })
    assert.equal(o2.audit, null)
    assert.equal(o2.note, '；自动提交已完成')
  }
})

test('autoCommitOutcome：skipped（merge 冲突/detached/空提交等）→ 审计含原因，无尾注', () => {
  const plan = planAutoCommit([fc('m1', 'a.ts')], 'm1', defaultConfig())
  assert.equal(plan.status, 'ready')
  if (plan.status === 'ready') {
    const cases: Array<['merge-conflict' | 'detached-head' | 'nothing-staged' | 'git-missing' | 'not-a-repo', string]> = [
      ['merge-conflict', 'merge 冲突中'],
      ['detached-head', 'HEAD 游离'],
      ['nothing-staged', '空提交'],
      ['git-missing', 'git 未安装'],
      ['not-a-repo', '不在 git 仓内'],
    ]
    for (const [reason, label] of cases) {
      const o = autoCommitOutcome(plan, { status: 'skipped', reason, detail: null })
      assert.ok(o.audit !== null && o.audit.includes(label), `${reason} 审计应含「${label}」，实际：${o.audit}`)
      assert.ok(o.audit!.startsWith('自动提交跳过'), '审计文案应以「自动提交跳过」开头')
      assert.equal(o.note, null)
    }
    // detail 存在时并入审计（剔除路径明细）
    const o2 = autoCommitOutcome(plan, {
      status: 'skipped',
      reason: 'no-addable-files',
      detail: '2 条路径被剔除：x.ts(missing-untracked)',
    })
    assert.ok(o2.audit!.includes('2 条路径被剔除'))
  }
})

test('autoCommitOutcome：failed → 审计含失败原因（git add / commit 失败）', () => {
  const plan = planAutoCommit([fc('m1', 'a.ts')], 'm1', defaultConfig())
  assert.equal(plan.status, 'ready')
  if (plan.status === 'ready') {
    const o = autoCommitOutcome(plan, {
      status: 'failed',
      reason: 'git-commit-failed',
      detail: 'git commit 失败：xxx',
      staged: ['a.ts'],
      dropped: [],
    })
    assert.ok(o.audit !== null && o.audit.includes('git commit 失败'))
    assert.ok(o.audit!.startsWith('自动提交失败'))
    assert.equal(o.note, null)
    // 调用方违约（ready 计划却无 exec 结果）：防御性不审计不提示
    assert.deepEqual(autoCommitOutcome(plan, null), { audit: null, note: null })
  }
})
