/**
 * 敏感路径表模块（计划 §3.4，T4 硬门禁的数据面）
 *
 * - 初始四类（宁窄勿宽）：① 密钥凭据（.env/*.pem/*.key/secrets/.ssh/.aws/.npmrc，
 *   豁免 .env.example/.env.sample/.env.template——它们就是要公开的）② CI 与发布
 *   （.github/workflows、Dockerfile、deploy/、k8s/、*.tf）③ 数据（migrations/、
 *   schema.prisma）④ 元敏感（.dev-flow/、.claude/、插件根——改门禁规则自身）；
 * - 语义敏感（支付/鉴权逻辑）不进路径表（glob 误判率高），走意图块自报；
 * - 项目补充：.dev-flow/config.json 的 sensitivePaths **只追加不覆盖**（本模块
 *   只接收追加列表，不负责读取 config——读取在 config.ts）；
 * - 匹配实现硬要求：路径比较前 **NFC 归一化 + symlink 目标解析**（macOS 文件系统
 *   常存 NFD 路径，归一化防漏判/误判；symlink 按目标解析后匹配——坑 N-5）。
 *
 * 函数分层（纯函数纪律）：
 * - matchSensitivePath 纯函数（无 IO，任意输入不崩溃——性质测试依据）；
 * - resolveWritePath / resolveSymlinkTarget 是 IO 函数（realpath syscall），
 *   入口壳/解析器在调用匹配前先归一化。
 */

import { isAbsolute, join } from 'node:path'
import { realpathSync } from 'node:fs'
import { dirname, basename } from 'node:path'

/**
 * symlink 目标解析（IO，逐级回溯）：优先对全路径 realpath；
 * 路径尚不存在（首次创建）时沿路径向上找最深存在的祖先解析，再拼回剩余段。
 * 保证"写一个 symlink 指向的敏感文件"（如 ln -s .env real 后写 real）按目标匹配。
 * 全部失败 → 原样返回（归一化降级，宁漏不误判）。
 */
export function resolveSymlinkTarget(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    // 全路径不可解析（不存在）→ 逐级回溯
  }
  const tail: string[] = []
  let cur = p
  for (;;) {
    const parent = dirname(cur)
    if (parent === cur) return p // 到根仍不可解析 → 原样返回
    tail.unshift(basename(cur))
    cur = parent
    try {
      return join(realpathSync(cur), ...tail)
    } catch {
      // 该级也不存在，继续向上
    }
  }
}

/**
 * 写入路径归一化（IO）：相对路径按 cwd 绝对化 → NFC 归一化 → symlink 目标解析。
 * 返回规范化后的绝对路径（匹配函数只吃这种输入）。
 */
export function resolveWritePath(p: string, cwd: string): string {
  const abs = isAbsolute(p) ? p : join(cwd, p)
  return resolveSymlinkTarget(abs.normalize('NFC')).normalize('NFC')
}

/** 内置敏感规则名（写进 write.allowed/write.blocked 的 rule 字段，审计可读） */
export type SensitiveRule =
  | 'secret.env'
  | 'secret.pem'
  | 'secret.key'
  | 'secret.dir'
  | 'secret.ssh'
  | 'secret.aws'
  | 'secret.npmrc'
  | 'ci.workflows'
  | 'ci.dockerfile'
  | 'ci.deploy'
  | 'ci.k8s'
  | 'ci.tf'
  | 'data.migrations'
  | 'data.schema'
  | 'meta.devflow'
  | 'meta.claude'
  | 'meta.plugin'
  | 'config.custom'

export const EXEMPT_ENV_BASENAMES = new Set(['.env.example', '.env.sample', '.env.template'])

/** 内置规则（字面量全部已为 NFC；匹配前输入也已 NFC，两边同一形态） */
interface BuiltinRule {
  name: SensitiveRule
  kind: 'basenameEq' | 'basenamePrefix' | 'basenameSuffix' | 'segments' | 'pluginRoot'
  value: string
  /** basenameEq/basenamePrefix 的豁免表（只服务 .env 族） */
  exempt?: Set<string>
}

const BUILTIN_RULES: BuiltinRule[] = [
  // ① 密钥凭据
  { name: 'secret.env', kind: 'basenamePrefix', value: '.env', exempt: EXEMPT_ENV_BASENAMES },
  { name: 'secret.pem', kind: 'basenameSuffix', value: '.pem' },
  { name: 'secret.key', kind: 'basenameSuffix', value: '.key' },
  { name: 'secret.dir', kind: 'segments', value: 'secrets' },
  { name: 'secret.ssh', kind: 'segments', value: '.ssh' },
  { name: 'secret.aws', kind: 'segments', value: '.aws' },
  { name: 'secret.npmrc', kind: 'basenameEq', value: '.npmrc' },
  // ② CI 与发布
  { name: 'ci.workflows', kind: 'segments', value: '.github/workflows' },
  { name: 'ci.dockerfile', kind: 'basenameEq', value: 'Dockerfile' },
  { name: 'ci.deploy', kind: 'segments', value: 'deploy' },
  { name: 'ci.k8s', kind: 'segments', value: 'k8s' },
  { name: 'ci.tf', kind: 'basenameSuffix', value: '.tf' },
  // ③ 数据
  { name: 'data.migrations', kind: 'segments', value: 'migrations' },
  { name: 'data.schema', kind: 'basenameEq', value: 'schema.prisma' },
  // ④ 元敏感（改门禁规则自身 = 新系统特有攻击面，零成本防线）
  { name: 'meta.devflow', kind: 'segments', value: '.dev-flow' },
  { name: 'meta.claude', kind: 'segments', value: '.claude' },
  // 插件根：按绝对路径前缀匹配（pluginRoot 由 hook 环境注入，非插件运行不命中）
  { name: 'meta.plugin', kind: 'pluginRoot', value: '' },
]

/** 段序列连续包含：segments 是否包含 value 按 '/' 分段后的连续子序列 */
function containsSegmentSeq(segments: string[], seq: string[]): boolean {
  if (seq.length === 0 || seq.length > segments.length) return false
  outer: for (let i = 0; i <= segments.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (segments[i + j] !== seq[j]) continue outer
    }
    return true
  }
  return false
}

/** 单条内置规则判定（纯函数） */
function ruleMatches(rule: BuiltinRule, segments: string[], basename: string, pluginRoot: string | null): boolean {
  switch (rule.kind) {
    case 'basenameEq':
      return basename === rule.value
    case 'basenameSuffix':
      return basename.endsWith(rule.value)
    case 'basenamePrefix':
      if (rule.exempt?.has(basename)) return false // 豁免永不被拦
      return basename === rule.value || basename.startsWith(rule.value + '.')
    case 'segments':
      return containsSegmentSeq(segments, rule.value.split('/'))
    case 'pluginRoot':
      // 插件根（meta.plugin 专用）：绝对路径前缀；pluginRoot 缺失（非插件运行）→ 不命中
      return pluginRoot !== null && (segments.join('/') + '/').startsWith(pluginRoot + '/')
  }
}

/** 通配模式 → 完整路径正则（`**` → 任意、`*` → 非分隔符，锚定首尾） */
function globToRegExp(pat: string): RegExp {
  const escaped = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * config 追加模式判定（纯函数，只追加不覆盖）：
 * - 含星号 → 通配匹配（对去首斜杠的完整路径与 basename 各测一次；跨层用
 *   双星前缀，如 "internal 目录下任意层" 的写法——模式按字面路径理解，宁窄）；
 * - 含 '/' → 段序列连续包含（'deploy/'、'foo/bar'，首尾 '/' 忽略）；
 * - 否则 → basename 精确（如 'credentials.json'）。
 */
export function extraPatternMatches(pat: string, segments: string[], basename: string): boolean {
  const p = pat.trim().normalize('NFC')
  if (p === '') return false
  if (p.includes('*')) {
    const rel = segments.join('/').replace(/^\/+/, '')
    return globToRegExp(p).test(rel) || globToRegExp(p).test(basename)
  }
  if (p.includes('/')) {
    return containsSegmentSeq(segments, p.split('/').filter((s) => s !== ''))
  }
  return basename === p
}

export interface SensitiveMatch {
  matched: boolean
  /** 命中规则名（write.allowed/write.blocked 的 rule 字段）；未命中 null */
  rule: SensitiveRule | null
}

/**
 * 敏感路径匹配（纯函数，无 IO）：输入必须是已归一化的绝对路径
 * （NFC + symlink 解析由 resolveWritePath 完成；这里再做一次防御性 NFC）。
 * 内置四类 + 项目追加（追加不覆盖）；性质测试任意输入不崩溃的契约对象。
 */
export function matchSensitivePath(
  absPath: string,
  extraPatterns: string[] = [],
  pluginRoot: string | null = null,
): SensitiveMatch {
  const norm = absPath.normalize('NFC')
  const segments = norm.split('/')
  const base = segments[segments.length - 1] ?? ''
  for (const rule of BUILTIN_RULES) {
    if (ruleMatches(rule, segments, base, pluginRoot)) return { matched: true, rule: rule.name }
  }
  for (const pat of extraPatterns) {
    if (extraPatternMatches(pat, segments, base)) return { matched: true, rule: 'config.custom' }
  }
  return { matched: false, rule: null }
}

/**
 * 意图块声明是否覆盖目标路径（敏感升级语义"已声明该路径"）：
 * 声明 files 清单项与目标路径比对——清单项是目录前缀时视为覆盖其下所有文件。
 * 双方都先 NFC 归一化（声明来自模型文本，可能 NFD；路径已归一化）。
 */
export function declaredFilesCoverPath(declaredFiles: string[], absPath: string): boolean {
  const target = absPath.normalize('NFC')
  for (const raw of declaredFiles) {
    const f = raw.trim().normalize('NFC')
    if (f === '') continue
    if (f === target) return true
    const dir = f.replace(/\/+$/, '') // 目录声明（'src/'）覆盖目录自身与其下所有文件
    if (target === dir) return true
    if (target.startsWith(dir + '/')) return true
  }
  return false
}
