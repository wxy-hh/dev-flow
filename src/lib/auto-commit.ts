/**
 * 自动 git commit 模块（计划 §3.6，T7：done 时选择性自动 commit）
 *
 * 职责边界：本模块只提供「纯函数 plan + 薄 exec 壳」+「接线裁决（autoCommitOutcome：
 * plan + exec 结果 → 审计文案与响应尾注，判断逻辑不进壳）」；不负责调用时机（done
 * 成功时由接线方调用）与审计落账（接线方按 autoCommitOutcome.audit 写 audit.warning）。
 * push 永不出现（防线③）——本模块没有任何 push 相关代码。
 *
 * == 选择性提交（红线）==
 * 只 `git add -A -- <清单路径>`（事件 file.changed 里本主线触碰的文件），
 * 绝不 `commit -am`、绝不无路径 add——用户自己的未提交改动一个都不卷进来。
 * exec 内做三类剔除（git 行为实测为准，探针与测试见 test/auto-commit.test.ts）：
 * - 目录路径（cp/mv 到目录时 file.changed 记的是目录名）：剔除。git add 目录
 *   pathspec 会把目录下一切未提交改动卷进来（实测 exit 0 照常暂存），宁漏勿误收；
 * - 被 .gitignore 忽略的文件：剔除。`git add -A` 对 ignored 路径直接报错
 *   "ignored by one of your .gitignore files"（实测 exit 1），会让整个 add 失败；
 * - 不存在且未跟踪的文件：剔除。`git add -A` 对 missing pathspec 报错
 *   "pathspec did not match any files"（实测 exit 128），会让整个 add 失败；
 *   已跟踪的删除文件保留——git add -A 正常暂存删除，commit 记录删除。
 * 剔除项全部带原因返回（dropped），供调用方审计。
 *
 * == 失败 fail-open（铁律）==
 * merge 冲突中 / detached HEAD / 空提交 / git 不存在 / 不在 git 仓内 → 不阻塞、
 * 不抛异常，返回结构化结果（status: skipped / failed + 原因），调用方警告+审计。
 * exec 永不 throw：git 的任何非零退出与 ENOENT 都捕获进结果（runGit 全捕获）。
 *
 * == commit message 契约（可过滤可 squash，唯一生成点 = buildCommitMessage）==
 *    chore(dev-flow): [<主线id>] [<摘要>（]自动提交 N 个文件[）]
 * - 前缀 `chore(dev-flow): [` 固定不变 → 过滤：`git log --grep='^chore(dev-flow): \['`；
 * - [<主线id>] 主线标识（清洗后：剥离换行/控制字符，≤80 码点）；过滤键即消息
 *   中的形式，原始 id 在 plan.mainlineId 字段随结果返回供审计；
 * - 摘要 = 该主线最近一条 intent.declared 摘要（截断 60 码点、换行压平），
 *   无声明或为空则省略；
 * - 尾注「自动提交 N 个文件」标识自动检查点（区别于人工提交），N = plan 时清单
 *   数（exec 剔除可能略少，剔除项见 dropped）；
 * - squash：同前缀同主线的提交可整体合并（`git rebase -i` 按前缀分组）。
 * - 消息的清洗只做「单行化 + 截断」，不做转义——commit 消息里不需要转义。
 *
 * == 路径契约 ==
 * file.changed 的 path 相对调用方传入的 cwd（项目根）；Bash 命令先 cd 再写入时
 * 启发式记的是相对命令 cwd 的路径，对不上项目根 → 落进 missing-untracked 剔除
 * （宁漏勿误收，明示边界）。所有路径 NFC 归一化（坑 N-5 同源：macOS 常存 NFD，
 * 比较前归一防漏配；git 侧 macOS 默认 core.precomposeunicode=true 按 NFC 处理）。
 *
 * == 性能 ==
 * 热路径：rev-parse → symbolic-ref → ls-files --unmerged → [缺失路径批量
 * ls-files] → [check-ignore 批量] → add（一次）→ diff --cached --quiet →
 * commit（一次）→ rev-parse --short。全是批次调用，绝不循环（spec：一次 add +
 * 一次 commit）。done 时执行（非每事件 hook），不在 P95 ≤30ms 事件线内。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import type { DevFlowEvent } from './events.js'
import type { DevFlowConfig } from './config.js'

/** commit message 固定前缀（过滤键：`git log --grep='^chore(dev-flow): \['`） */
export const AUTO_COMMIT_PREFIX = 'chore(dev-flow): '

/** 自动检查点尾注（区别于人工提交的标识） */
export const AUTO_COMMIT_TAG = '自动提交'

/** 消息段长度上限（码点计）：主线 id / 摘要，保单行与整洁 */
export const MAX_ID_LEN = 80
export const MAX_SUMMARY_LEN = 60

/**
 * 消息段清洗（纯函数）：控制字符压成空格、连续空白压平、去首尾空白、按码点截断。
 * 单行化是契约一部分（commit 消息保持单行，防止 mainlineId/摘要换行注入多行消息）。
 */
function cleanSegment(s: string, max: number): string {
  const cleaned = Array.from(s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim())
  return cleaned.slice(0, max).join('')
}

/**
 * 生成 commit message（纯函数，消息的唯一生成点，exec 只透传）：
 * `chore(dev-flow): [<id>] 自动提交 N 个文件`，有摘要时
 * `chore(dev-flow): [<id>] <摘要>（自动提交 N 个文件）`。契约见文件头。
 */
export function buildCommitMessage(mainlineId: string, fileCount: number, summary: string | null): string {
  const id = cleanSegment(mainlineId, MAX_ID_LEN)
  const s = summary !== null && summary.trim() !== '' ? cleanSegment(summary, MAX_SUMMARY_LEN) : null
  const tail = s === null ? `${AUTO_COMMIT_TAG} ${fileCount} 个文件` : `${s}（${AUTO_COMMIT_TAG} ${fileCount} 个文件）`
  return `${AUTO_COMMIT_PREFIX}[${id}] ${tail}`
}

/**
 * 路径归一（纯函数）：NFC 归一 + 去 `./` 前缀与尾部斜杠 + 剔除非法形态
 * （空 / `.` / `..` / 绝对路径 / 含 `..` 段）。返回 null = 该路径不参与提交
 * （宁漏勿误收：`..` 段与绝对路径要么越界要么不是仓内路径，git pathspec 会拒）。
 */
function normalizePath(raw: string): string | null {
  let p = raw.normalize('NFC').trim()
  if (p === '' || p === '.' || p === '..') return null
  while (p.startsWith('./')) p = p.slice(2)
  p = p.replace(/\/+$/, '')
  if (p === '' || p.startsWith('/') || p.split('/').includes('..')) return null
  return p
}

/** 计划结果（discriminated union）：disabled / no-files 是纯 plan 语义，不碰 git */
export type AutoCommitPlan =
  | { status: 'disabled'; mainlineId: string }
  | { status: 'no-files'; mainlineId: string }
  | { status: 'ready'; mainlineId: string; files: string[]; message: string }

/**
 * 提交计划（纯函数，无 IO）：从事件里提取本主线的触碰文件清单 + 生成 message。
 *
 * - autoCommit=false → disabled（配置关闭是用户意图，直接返回"已关闭"，不碰 git）；
 * - 无 file.changed / 主线 id 为空 → no-files（空主线 id 拒绝参与提交：未知归属
 *   的写入绝不卷进自动 commit）；
 * - 清单去重（保首现序）、路径归一剔除非法形态；
 * - 摘要取该主线最近一条 intent.declared（append 序即时间序，后者覆盖前者）。
 */
export function planAutoCommit(
  events: DevFlowEvent[],
  mainlineId: string,
  config: DevFlowConfig,
): AutoCommitPlan {
  if (!config.autoCommit) return { status: 'disabled', mainlineId }
  const id = (mainlineId ?? '').trim()
  if (id === '') return { status: 'no-files', mainlineId: id }
  const files: string[] = []
  const seen = new Set<string>()
  let summary: string | null = null
  for (const ev of events) {
    if (ev.mainlineId !== id) continue
    if (ev.type === 'file.changed') {
      const p = normalizePath(ev.path)
      if (p === null) continue
      if (!seen.has(p)) {
        seen.add(p)
        files.push(p)
      }
    } else if (ev.type === 'intent.declared' && ev.summary.trim() !== '') {
      summary = ev.summary.trim()
    }
  }
  if (files.length === 0) return { status: 'no-files', mainlineId: id }
  return { status: 'ready', mainlineId: id, files, message: buildCommitMessage(id, files.length, summary) }
}

/** 跳过原因（fail-open 的枚举面：调用方按此决定警告文案与审计） */
export type SkipReason =
  | 'disabled' // 配置 autoCommit=false（plan 语义，不经 git）
  | 'no-files' // 无本主线触碰文件（plan 语义，不经 git）
  | 'not-ready' // exec 收到非 ready 计划（防御：调用方应只传 ready）
  | 'git-missing' // git 不在 PATH（ENOENT）
  | 'not-a-repo' // cwd 不在 git 工作区内
  | 'detached-head' // HEAD detached：commit 会脱离分支，跳过
  | 'merge-conflict' // 有未合并路径（git ls-files --unmerged 非空）
  | 'no-addable-files' // 清单全部被剔除（目录 / ignored / 不存在且未跟踪）
  | 'nothing-staged' // git add 后无暂存变更（空提交）

/** 失败原因（fail-open：不阻塞，调用方警告 + 审计） */
export type FailReason = 'git-add-failed' | 'git-commit-failed'

/** 被剔除的路径与原因（审计用） */
export interface DroppedPath {
  path: string
  reason: 'directory' | 'ignored' | 'missing-untracked'
}

/** 执行结果（fail-open 结构化面）：committed / skipped / failed 三态 */
export type AutoCommitResult =
  | { status: 'committed'; sha: string | null; message: string; staged: string[]; dropped: DroppedPath[] }
  | { status: 'skipped'; reason: SkipReason; detail: string | null }
  | { status: 'failed'; reason: FailReason; detail: string; staged: string[]; dropped: DroppedPath[] }

/** git 调用结果（全捕获，永不 throw） */
interface GitRunResult {
  ok: boolean
  /** git 命令不存在（ENOENT）——git-missing 的依据 */
  missing: boolean
  status: number
  out: string
  stderr: string
}

/**
 * git 调用壳：args 已是完整 argv（含全局项）。统一带 -c quotepath=false
 * （路径原样输出防 C 转义）。--literal-pathspecs（防 glob 展开）只用于支持它的
 * 命令（add/ls-files 实测支持；check-ignore 实测报 "pathspec magic not supported"，
 * 走 qn 不带 literal 的变体）。
 */
function runGit(cwd: string, env: NodeJS.ProcessEnv, args: string[]): GitRunResult {
  try {
    const out = execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, missing: false, status: 0, out, stderr: '' }
  } catch (err) {
    const e = err as { code?: string; status?: number; stdout?: unknown; stderr?: unknown }
    if (e.code === 'ENOENT') return { ok: false, missing: true, status: -1, out: '', stderr: '' }
    return { ok: false, missing: false, status: e.status ?? -1, out: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}

/** 全局项 + literal-pathspecs（add/ls-files 等支持的命令） */
function q(sub: string, ...rest: string[]): string[] {
  return ['-c', 'core.quotepath=false', '--literal-pathspecs', sub, ...rest]
}

/** 全局项、不带 literal-pathspecs（check-ignore 实测不支持 pathspec magic） */
function qn(sub: string, ...rest: string[]): string[] {
  return ['-c', 'core.quotepath=false', sub, ...rest]
}

/** git-missing 短路：返回 skipped 结果或 null（继续） */
function missingResult(r: GitRunResult): AutoCommitResult | null {
  return r.missing ? { status: 'skipped', reason: 'git-missing', detail: null } : null
}

/** 行拆分 + NFC 归一（与路径契约对齐：git 输出在 macOS 可能是 NFD） */
function linesOf(out: string): string[] {
  return out.split('\n').map((s) => s.trim().normalize('NFC')).filter((s) => s !== '')
}

/**
 * 执行自动提交（薄 exec 壳）：计划 → 预检（仓内/分支/冲突）→ 剔除 → 一次 add →
 * 空提交预检 → 一次 commit → 尽力取短 sha。fail-open：任何故障进结构化结果，
 * 永不 throw。env 参数为测试注入（git-missing 模拟）与防御 GIT_* 环境泄漏。
 */
export function execAutoCommit(
  plan: AutoCommitPlan,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): AutoCommitResult {
  // 防御：非 ready 计划直接透传其语义（disabled / no-files）
  if (plan.status !== 'ready') return { status: 'skipped', reason: plan.status, detail: null }
  if (plan.files.length === 0) return { status: 'skipped', reason: 'no-files', detail: null }

  // 防御：剥离外部 GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE，防止 git 操作到别的仓
  const gitEnv = { ...env }
  delete gitEnv.GIT_DIR
  delete gitEnv.GIT_WORK_TREE
  delete gitEnv.GIT_INDEX_FILE

  // ① 在仓内？（同时探测 git 是否存在）
  const repo = runGit(cwd, gitEnv, q('rev-parse', '--is-inside-work-tree'))
  const repoMissing = missingResult(repo)
  if (repoMissing !== null) return repoMissing
  if (!repo.ok || repo.out.trim() !== 'true') {
    return { status: 'skipped', reason: 'not-a-repo', detail: repo.stderr || null }
  }

  // ② detached HEAD？（symbolic-ref -q HEAD：分支上 exit 0，detached exit 1）
  const head = runGit(cwd, gitEnv, q('symbolic-ref', '-q', 'HEAD'))
  const headMissing = missingResult(head)
  if (headMissing !== null) return headMissing
  if (!head.ok) return { status: 'skipped', reason: 'detached-head', detail: head.stderr || null }

  // ③ merge 冲突中？（ls-files --unmerged 非空即未合并；add 冲突文件会暂存冲突标记，
  //    实测 git commit 也会拒绝——预检拦截，绝不碰冲突中的 index）
  const unmerged = runGit(cwd, gitEnv, q('ls-files', '--unmerged'))
  const unmergedMissing = missingResult(unmerged)
  if (unmergedMissing !== null) return unmergedMissing
  if (!unmerged.ok) {
    return { status: 'skipped', reason: 'not-a-repo', detail: `git ls-files --unmerged 异常：${unmerged.stderr}` }
  }
  if (unmerged.out.trim() !== '') return { status: 'skipped', reason: 'merge-conflict', detail: null }

  // ④ 清单分类：现存文件 / 缺失路径（已跟踪删除 vs 从未存在）／目录（剔除）
  const dropped: DroppedPath[] = []
  const addable: string[] = []
  const missing: string[] = []
  for (const p of plan.files) {
    const abs = join(cwd, p)
    let st
    try {
      if (!existsSync(abs)) throw new Error('missing')
      st = lstatSync(abs)
    } catch {
      missing.push(p)
      continue
    }
    if (st.isDirectory()) {
      dropped.push({ path: p, reason: 'directory' })
      continue
    }
    addable.push(p)
  }

  // ⑤ 缺失路径中已跟踪的 = 删除，保留进 add；其余剔除（git add 对 missing 报错）
  let deletions: string[] = []
  if (missing.length > 0) {
    const ls = runGit(cwd, gitEnv, q('ls-files', '--', ...missing))
    const lsMissing = missingResult(ls)
    if (lsMissing !== null) return lsMissing
    const tracked = new Set(linesOf(ls.out))
    for (const p of missing) {
      if (tracked.has(p)) deletions.push(p)
      else dropped.push({ path: p, reason: 'missing-untracked' })
    }
  }

  // ⑥ ignored 剔除（git add 对 ignored 报错；check-ignore 输出被忽略项，exit 0）
  if (addable.length > 0) {
    const ign = runGit(cwd, gitEnv, qn('check-ignore', '--', ...addable))
    const ignMissing = missingResult(ign)
    if (ignMissing !== null) return ignMissing
    const ignoredSet = new Set(linesOf(ign.out))
    const kept: string[] = []
    for (const p of addable) {
      if (ignoredSet.has(p)) dropped.push({ path: p, reason: 'ignored' })
      else kept.push(p)
    }
    addable.length = 0
    addable.push(...kept)
  }

  const addPaths = [...addable, ...deletions]
  if (addPaths.length === 0) {
    const detail =
      dropped.length > 0
        ? `${dropped.length} 条路径被剔除：${dropped.map((d) => `${d.path}(${d.reason})`).join('、')}`
        : null
    return { status: 'skipped', reason: 'no-addable-files', detail }
  }

  // ⑦ 一次 add（-A：含已跟踪删除）
  const add = runGit(cwd, gitEnv, q('add', '-A', '--', ...addPaths))
  const addMissing = missingResult(add)
  if (addMissing !== null) return addMissing
  if (!add.ok) return { status: 'failed', reason: 'git-add-failed', detail: `git add 失败：${add.stderr}`, staged: [], dropped }

  // ⑧ 空提交预检（diff --cached --quiet：exit 0=无暂存差异=空提交，exit 1=有差异）
  const stagedCheck = runGit(cwd, gitEnv, q('diff', '--cached', '--quiet'))
  const stagedMissing = missingResult(stagedCheck)
  if (stagedMissing !== null) return stagedMissing
  if (stagedCheck.ok) {
    return { status: 'skipped', reason: 'nothing-staged', detail: 'git add 后无暂存变更（清单文件与 HEAD 相同或已提交）', }
  }
  if (stagedCheck.status !== 1) {
    return { status: 'failed', reason: 'git-add-failed', detail: `git diff --cached 异常：${stagedCheck.stderr}`, staged: addPaths, dropped }
  }

  // ⑨ 一次 commit（message 透传 plan，唯一生成点 = buildCommitMessage）
  const cm = runGit(cwd, gitEnv, q('commit', '-m', plan.message))
  const cmMissing = missingResult(cm)
  if (cmMissing !== null) return cmMissing
  if (!cm.ok) {
    return { status: 'failed', reason: 'git-commit-failed', detail: `git commit 失败：${cm.stderr}`, staged: addPaths, dropped }
  }

  // ⑩ 短 sha（尽力而为：取不到不影响已完成的 commit）
  const shaRun = runGit(cwd, gitEnv, q('rev-parse', '--short', 'HEAD'))
  return {
    status: 'committed',
    sha: shaRun.ok ? shaRun.out.trim() : null,
    message: plan.message,
    staged: addPaths,
    dropped,
  }
}

/** 原因中文标签（审计文案用；SkipReason/FailReason 共用，枚举面完整） */
function reasonLabel(reason: SkipReason | FailReason): string {
  switch (reason) {
    case 'disabled':
      return '配置已关闭'
    case 'no-files':
      return '无本主线触碰文件'
    case 'not-ready':
      return '计划未就绪'
    case 'git-missing':
      return 'git 未安装'
    case 'not-a-repo':
      return '不在 git 仓内'
    case 'detached-head':
      return 'HEAD 游离（detached）'
    case 'merge-conflict':
      return 'merge 冲突中'
    case 'no-addable-files':
      return '清单全部不可提交'
    case 'nothing-staged':
      return '空提交（无变更）'
    case 'git-add-failed':
      return 'git add 失败'
    case 'git-commit-failed':
      return 'git commit 失败'
  }
}

/** 自动提交接线裁决（纯函数，T7）：plan + exec 结果 → 审计文案 + 响应尾注 */
export interface AutoCommitOutcome {
  /** 需写 audit.warning 的文案（null=无需审计：提交成功或无事可做） */
  audit: string | null
  /** 追加到 done 响应的尾注（null=不追加；committed 时给短 sha 供回溯） */
  note: string | null
}

/**
 * 接线裁决（纯函数，判断逻辑不进壳）：把 plan/result 翻译成「写什么审计、响应加
 * 什么尾注」。fail-open 语义落点：skipped/failed 只影响审计与提示，done 的成功
 * 由调用方照常返回（本函数永不抛错、永不表达"应回卷"）。disabled（配置关闭）是
 * 用户意图，仍写审计（证据链可见）；no-files（无事可做）不算故障，不审计。
 */
export function autoCommitOutcome(plan: AutoCommitPlan, result: AutoCommitResult | null): AutoCommitOutcome {
  if (plan.status === 'disabled') {
    return { audit: '自动提交已关闭（config.json autoCommit=false），本次 done 未产生提交', note: null }
  }
  if (plan.status === 'no-files') return { audit: null, note: null }
  // plan.status === 'ready'；result 为 null 属调用方违约（防御：不审计不提示）
  if (result === null) return { audit: null, note: null }
  if (result.status === 'committed') {
    return { audit: null, note: result.sha !== null ? `；自动提交 ${result.sha}` : '；自动提交已完成' }
  }
  if (result.status === 'skipped') {
    const detail = result.detail !== null ? `：${result.detail}` : ''
    return { audit: `自动提交跳过（${reasonLabel(result.reason)}）${detail}`, note: null }
  }
  return { audit: `自动提交失败（${reasonLabel(result.reason)}）：${result.detail}`, note: null }
}
