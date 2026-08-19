/**
 * Bash 门禁分析模块（计划 §3.1 PreToolUse Bash 两件事 + §8 残余风险边界）
 *
 * ① 不可逆操作（防线③）：git push / DROP TABLE|DATABASE（SQL 客户端命令级）/
 *    发版 publish 家族（--dry-run 除外）/ rm -rf 高危目标（系统根、家目录本体、
 *    凭据目录）。模式表保持窄而准，宁漏勿滥（滥拦=新摩擦）。
 * ② 启发式写入目标检出：`>`/`>>`/`tee`/`sed -i`/`cp`/`mv`（+ sudo/env 前缀、
 *    heredoc 跳过）。解析用例集必须覆盖变量与引号边界；解析不出=放行不拦
 *    （宁漏勿误拦）；解释器任意写入（python -c 等）为明示残余风险，不做检测。
 *
 * 实现分层：
 * - lex() 轻量 shell 分词（引号/转义/重定向 token/heredoc 跳过/段切分），
 *   含变量或命令替换的 token 标记 dynamic——dynamic 目标一律不当作可靠路径；
 * - analyzeBashCommand() 纯函数产出：不可逆命中 + 写入目标列表（字面路径，
 *   未归一化——归一化/敏感匹配在 write-gate 层做）。
 */

export type IrreversibleRule =
  | 'irreversible.push'
  | 'irreversible.drop'
  | 'irreversible.publish'
  | 'irreversible.rm'

export interface BashAnalysis {
  irreversible: { matched: boolean; rule: IrreversibleRule | null }
  /** 解析出的写入目标（相对 cwd 的字面路径；含 dynamic → 解析不出即不放这里） */
  writeTargets: string[]
}

/** shell 词 token：redir 非空表示该 token 是重定向符（text 为空串） */
export interface BashToken {
  text: string
  /** 含变量/命令替换 → 不能作为可靠路径字面 */
  dynamic: boolean
  redir: '>' | '>>' | null
}

/** 去引号与转义（用于 heredoc 分隔符比较） */
function unquote(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'") {
      const e = s.indexOf("'", i + 1)
      out += e === -1 ? s.slice(i + 1) : s.slice(i + 1, e)
      i = e === -1 ? s.length : e + 1
    } else if (c === '"') {
      const e = s.indexOf('"', i + 1)
      out += e === -1 ? s.slice(i + 1) : s.slice(i + 1, e)
      i = e === -1 ? s.length : e + 1
    } else if (c === '\\') {
      out += s[i + 1] ?? ''
      i += 2
    } else {
      out += c
      i++
    }
  }
  return out
}

/**
 * shell 轻词法：命令串 → 段列表（按未引用的 `|` `;` `&&` `||` `(` `)` 切分），
 * 每段是 token 列表。处理：单双引号（双引号内 $/反引号标记 dynamic）、反斜杠转义、
 * 变量/命令替换/反引号（dynamic）、重定向 `>`/`>>`（含 fd 前缀如 2>）、
 * heredoc `<<WORD` 整段跳过（防 body 里的 `>` 被误读为重定向）、`&` 段切分。
 */
export function lex(cmd: string): BashToken[][] {
  const segments: BashToken[][] = [[]]
  let toks = segments[segments.length - 1]
  let cur: BashToken = { text: '', dynamic: false, redir: null }
  const flush = (): void => {
    if (cur.text !== '' || cur.redir !== null) toks.push(cur)
    cur = { text: '', dynamic: false, redir: null }
  }
  const newSegment = (): void => {
    flush()
    segments.push([])
    toks = segments[segments.length - 1]
  }
  let heredoc: string | null = null
  /** 已捕获分隔符、等下一行开始进入跳过模式（`<<` 后同行的重定向仍要解析） */
  let heredocPending: string | null = null
  let lineStart = true
  const pushChar = (ch: string): void => {
    cur.text += ch
    lineStart = false
  }

  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    // heredoc 分隔符已捕获：到行尾/结束即进入跳过模式（同行内容如 `> out` 正常解析）
    if (heredocPending !== null && (c === '\n' || i >= cmd.length)) {
      heredoc = heredocPending
      heredocPending = null
    }
    if (heredoc !== null) {
      // heredoc 体：跳到以分隔符开头的行即结束，期间内容一律不解析
      if (lineStart) {
        const rest = cmd.slice(i)
        const wm = /^\s*((?:'[^']*'|"[^"]*"|[^\s'"|;()&])+)/.exec(rest)
        if (wm && unquote(wm[1]) === heredoc) heredoc = null
      }
      const nl = cmd.indexOf('\n', i)
      if (nl === -1) break
      i = nl + 1
      lineStart = true
      continue
    }
    if (c === '\n') {
      flush()
      lineStart = true
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      flush()
      i++
      continue
    }
    if (c === '\\') {
      const nxt = cmd[i + 1]
      if (nxt === '\n') {
        i += 2
        continue
      } // 续行
      pushChar(nxt ?? '')
      i += 2
      continue
    }
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1)
      const chunk = end === -1 ? cmd.slice(i + 1) : cmd.slice(i + 1, end)
      for (const ch of chunk) pushChar(ch)
      i = end === -1 ? cmd.length : end + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      let dyn = false
      let buf = ''
      while (j < cmd.length && cmd[j] !== '"') {
        const ch = cmd[j]
        if (ch === '\\') {
          const nx = cmd[j + 1]
          if (nx === '"' || nx === '\\' || nx === '$' || nx === '`' || nx === '\n') {
            buf += nx ?? ''
            dyn = dyn || nx === '$' || nx === '`'
            j += 2
            continue
          }
          buf += ch
          j++
          continue
        }
        if (ch === '$' || ch === '`') dyn = true
        buf += ch
        j++
      }
      for (const ch of buf) pushChar(ch)
      cur.dynamic = cur.dynamic || dyn
      i = j < cmd.length ? j + 1 : cmd.length
      continue
    }
    if (c === '$' || c === '`') {
      if (c === '$' && cmd[i + 1] === '(') {
        // $()/$(( ))：整体作 dynamic 跳过（内部不解析）
        let depth = 0
        let j = i + 1
        for (; j < cmd.length; j++) {
          if (cmd[j] === '(') depth++
          else if (cmd[j] === ')') {
            depth--
            if (depth === 0) {
              j++
              break
            }
          }
        }
        cur.text += cmd.slice(i, j)
        cur.dynamic = true
        i = j
        continue
      }
      if (c === '`') {
        const end = cmd.indexOf('`', i + 1)
        const chunk = end === -1 ? cmd.slice(i) : cmd.slice(i, end + 1)
        cur.text += chunk
        cur.dynamic = true
        i = end === -1 ? cmd.length : end + 1
        continue
      }
      pushChar(c)
      cur.dynamic = true
      i++
      continue
    }
    if (c === '>') {
      // 重定向；fd 前缀（2>）在 cur.text 里——纯数字则丢弃
      if (/^[0-9]+$/.test(cur.text)) cur.text = ''
      const isAppend = cmd[i + 1] === '>'
      flush()
      toks.push({ text: '', dynamic: false, redir: isAppend ? '>>' : '>' })
      i += isAppend ? 2 : 1
      continue
    }
    if (c === '<') {
      if (cmd[i + 1] === '<') {
        // heredoc：记录分隔符，同行内容继续解析、下一行起整段跳过
        let j = i + 2
        if (cmd[j] === '-') j++
        while (j < cmd.length && (cmd[j] === ' ' || cmd[j] === '\t')) j++
        const wm = /(?:'[^']*'|"[^"]*"|[^\s'"|;()&])+/.exec(cmd.slice(j))
        if (wm) {
          heredocPending = unquote(wm[0])
          lineStart = false
        }
        i = j + (wm ? wm[0].length : 0)
        flush()
        continue
      }
      flush()
      i++
      continue
    }
    if (c === '|') {
      if (cmd[i + 1] === '|') {
        newSegment()
        i += 2
      } else {
        newSegment()
        i += 1
      }
      continue
    }
    if (c === '&') {
      if (cmd[i + 1] === '&') {
        newSegment()
        i += 2
      } else newSegment()
      continue
    }
    if (c === ';' || c === '(' || c === ')') {
      newSegment()
      i++
      continue
    }
    pushChar(c)
    i++
  }
  flush()
  return segments
}

/** 段首命令名（跳过 env 前缀赋值与 sudo），返回 { cmd, argIndex } */
function segmentCommand(tokens: BashToken[]): { cmd: string; argStart: number } {
  const words = tokens.filter((t) => t.redir === null)
  let idx = 0
  while (idx < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[idx].text)) idx++
  if (idx >= words.length) return { cmd: '', argStart: words.length }
  let cmd = words[idx].text.split('/').pop() ?? ''
  let argStart = idx + 1
  if (cmd === 'sudo') {
    cmd = (words[idx + 1]?.text.split('/').pop() ?? '').toString()
    argStart = idx + 2
  }
  return { cmd, argStart }
}

/** rm -rf 高危目标判定：系统根（全深度）/ 家目录根（≤1 层）/ 精确危险清单 */
const RM_EXACT_DANGEROUS = new Set([
  '/', '~', '.', '..', './', '../',
  '$HOME', '${HOME}', '$PWD', '${PWD}',
  '~/.ssh', '$HOME/.ssh', '${HOME}/.ssh',
  '~/.aws', '$HOME/.aws', '${HOME}/.aws',
  '~/.npmrc', '$HOME/.npmrc', '${HOME}/.npmrc',
])
const RM_ALL_DEPTH_ROOTS = [
  '/etc', '/usr', '/bin', '/sbin', '/lib', '/System', '/Library',
  '/Applications', '/private', '/var', '/opt', '/boot', '/srv',
  '/dev', '/Volumes', '/root', '/proc', '/sys',
]
const RM_HOME_ROOTS = ['/Users', '/home']

function dangerousRmTarget(text: string): boolean {
  if (RM_EXACT_DANGEROUS.has(text)) return true
  for (const r of RM_ALL_DEPTH_ROOTS) {
    if (text === r || text.startsWith(r + '/')) return true
  }
  for (const r of RM_HOME_ROOTS) {
    const rest = text.startsWith(r + '/') ? text.slice(r.length + 1) : null
    if (rest !== null && !rest.includes('/')) return true // 恰好一层 = 家目录本体
  }
  return false
}

/** SQL 客户端命令表（DROP 检测的判别面：只在这些命令下扫 DROP，防 grep 误拦） */
const SQL_CLIENTS = new Set([
  'psql', 'mysql', 'mariadb', 'sqlite3', 'sqlite', 'pgcli', 'mycli',
  'duckdb', 'clickhouse-client', 'clickhouse', 'snowsql', 'bq', 'sqlcmd', 'trino',
])

/** 发布命令家族（--dry-run 为安全演习，放行） */
const PUBLISH_COMMANDS = new Set(['npm', 'pnpm', 'yarn', 'npx', 'bun'])

/**
 * 不可逆操作检测（纯函数）。注意 rm 危险目标用含 dynamic 的原文判定
 * （`rm -rf $HOME` 的 $HOME 是 dynamic 但正是我们要抓的目标）。
 */
export function detectIrreversible(segments: BashToken[][]): { matched: boolean; rule: IrreversibleRule | null } {
  for (const seg of segments) {
    const { cmd, argStart } = segmentCommand(seg)
    if (cmd === '') continue
    const words = seg.filter((t) => t.redir === null)
    const argTexts = words.slice(argStart).map((t) => t.text)
    if (cmd === 'git' && argTexts[0] === 'push') {
      return { matched: true, rule: 'irreversible.push' }
    }
    if (PUBLISH_COMMANDS.has(cmd)) {
      const dryRun = argTexts.includes('--dry-run')
      const isPublish = argTexts[0] === 'publish' || (argTexts[0] === 'run' && argTexts[1] === 'publish')
      if (isPublish && !dryRun) return { matched: true, rule: 'irreversible.publish' }
    }
    if (cmd === 'rm') {
      const flags = argTexts.filter((a) => a.startsWith('-'))
      const flagChars = flags.join('')
      const hasR = flagChars.includes('r') || flags.some((a) => a === '--recursive')
      const hasF = flagChars.includes('f') || flags.some((a) => a === '--force')
      if (hasR && hasF) {
        const target = argTexts.find((a) => !a.startsWith('-'))
        if (target !== undefined && dangerousRmTarget(target)) {
          return { matched: true, rule: 'irreversible.rm' }
        }
      }
    }
    if (SQL_CLIENTS.has(cmd)) {
      // 段原文重建（token 拼接保留引号内空格）：DROP 出现在 SQL 语句中
      const segText = seg.map((t) => t.text).join(' ')
      if (/\bdrop\s+(table|database)\b/i.test(segText)) {
        return { matched: true, rule: 'irreversible.drop' }
      }
    }
  }
  return { matched: false, rule: null }
}

/**
 * 单段写入目标提取：
 * - 重定向 `>`/`>>` 后的下一个非 dynamic 词；
 * - tee：所有非选项参数（- 视为 stdout）；
 * - cp/mv：最后一个非选项非 dynamic 参数（目标）；
 * - sed -i：最后一个非选项非 dynamic 参数（脚本/BSD 扩展名在前，文件恒最后；
 *   -e/-f 的脚本参数被消费）。
 */
function extractSegmentTargets(tokens: BashToken[]): string[] {
  const targets: string[] = []
  // 重定向目标
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.redir) {
      const nxt = tokens[i + 1]
      if (nxt && !nxt.redir && !nxt.dynamic && nxt.text !== '') targets.push(nxt.text)
    }
  }
  const { cmd, argStart } = segmentCommand(tokens)
  if (cmd === '') return targets
  const words = tokens.filter((t) => t.redir === null)
  const argTokens = words.slice(argStart)
  if (cmd === 'tee') {
    for (const t of argTokens) {
      if (t.dynamic) continue
      if (t.text === '' || t.text === '-' || t.text.startsWith('-')) continue
      targets.push(t.text)
    }
    return targets
  }
  if (cmd === 'cp' || cmd === 'mv') {
    const last = argTokens[argTokens.length - 1]
    if (last && !last.dynamic && last.text !== '' && !last.text.startsWith('-')) {
      targets.push(last.text)
    }
    return targets
  }
  if (cmd === 'sed') {
    let hasI = false
    for (const t of argTokens) if (t.text.startsWith('-i')) hasI = true
    if (hasI) {
      // 消费 -e/-f 及其脚本参数；其余非选项参数里最后一个是文件
      const vals: string[] = []
      let j = 0
      while (j < argTokens.length) {
        const t = argTokens[j]
        if (t.dynamic || t.text === '') {
          j++
          continue
        }
        if (t.text.startsWith('-')) {
          if (t.text === '-e' || t.text === '-f') j += 2
          else j += 1
          continue
        }
        vals.push(t.text)
        j++
      }
      const file = vals[vals.length - 1]
      if (file !== undefined) targets.push(file)
    }
    return targets
  }
  return targets
}

/**
 * Bash 命令分析（纯函数）：不可逆命中 + 写入目标列表。
 * 解析不出目标 → writeTargets 为空（调用方放行不拦，宁漏勿误拦）。
 */
export function analyzeBashCommand(cmd: string): BashAnalysis {
  const segments = lex(cmd)
  const irreversible = detectIrreversible(segments)
  const writeTargets: string[] = []
  for (const seg of segments) {
    for (const t of extractSegmentTargets(seg)) {
      if (!writeTargets.includes(t)) writeTargets.push(t)
    }
  }
  return { irreversible, writeTargets }
}

/**
 * 入口壳快路径正则（高频事件性能生死线，P95 ≤30ms）：
 * 无命中立即 exit 0、不读任何文件。宁可多命中进完整解析（多几步纯函数），
 * 不可漏掉写入——快筛只做"要不要进入完整路径"的粗判。
 */
export const IRREVERSIBLE_HINT_RE = /(?:git\s+push|\bdrop\s+(?:table|database)\b|\bpublish\b|\brm\s+)/i
export const WRITE_HINT_RE = /(?:>|\btee\b|\bsed\b|\bcp\b|\bmv\b)/
