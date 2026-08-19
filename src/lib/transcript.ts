/**
 * transcript 意图块检测模块（计划 §3.2 检测主通道的"放行加分项"）
 *
 * - 限定 assistant 消息的 text 块搜「#意图块」（spike L3 坑：SessionStart 注入的
 *   规则文本与 deny 理由模板都含「#意图块」字样且位于 user 消息/tool 结果，全
 *   transcript 搜索会永远命中——自注入污染；只扫 role=assistant 的 text 块）；
 * - 跨回合才可靠（spike 实测同回合滞后 55ms）→ 命中即视为已声明放行，未命中
 *   不拦（主通道"一拦二放"兜底），检测从不成为阻塞点；
 * - 尽力提取 verify 命令行（第四要素）存入 verifyDeclarations（后者覆盖前者），
 *   以及 summary/files/risk 供敏感升级语义"已声明该路径"判断；
 * - 读不到/解析失败 → null（不影响主通道，按未声明处理）。
 *
 * transcript 文件为 JSONL：每行 { type:'assistant', message:{ role, content } }，
 * content 为 text/tool_use 块数组（或字符串）。
 */

import { readFileSync } from 'node:fs'

export interface TranscriptIntent {
  declared: boolean
  summary: string | null
  verifyCommand: string | null
  risk: string | null
  files: string[]
}

/** 空白/空行（构造空结果用） */
function emptyResult(): TranscriptIntent {
  return { declared: false, summary: null, verifyCommand: null, risk: null, files: [] }
}

/** 取一行中 `字段：` / `字段:` 冒号后的值（截断到 500 字符） */
function fieldValue(line: string): string {
  const m = /^[^:：]*[:：]\s*(.+)$/.exec(line.trim())
  if (!m) return ''
  return m[1].trim().slice(0, 500)
}

/** files 字段解析：按中文/英文逗号、空白分隔（兼容 `-` 列表项），取非空项 */
function parseFiles(value: string): string[] {
  const parts = value.split(/[,，\s]+/)
  const out: string[] = []
  for (const p of parts) {
    const clean = p.replace(/^[-*]\s*/, '').trim()
    if (clean !== '' && !out.includes(clean)) out.push(clean)
  }
  return out
}

/**
 * 单字段行判定（四要素 + 别名；返回 true = 该行消费为一个已知字段）。
 * first-wins 守卫：同字段已提取则不覆盖（文本提取取首个出现即可）。
 * 行内多字段切分出的每段也走本判定（标签集保持单一来源）。
 */
function applyFieldLine(result: TranscriptIntent, trimmed: string): boolean {
  if (/^[-*]?\s*(做什么|目的)[:：]/.test(trimmed) && result.summary === null) {
    result.summary = fieldValue(trimmed)
    return true
  }
  if (/^[-*]?\s*(文件|预计动哪些文件|涉及文件|改动文件)[:：]/.test(trimmed) && result.files.length === 0) {
    result.files = parseFiles(fieldValue(trimmed))
    return true
  }
  if (/^[-*]?\s*(风险|敏感路径与风险标签)[:：]/.test(trimmed) && result.risk === null) {
    result.risk = fieldValue(trimmed)
    return true
  }
  if (/^[-*]?\s*(verify|verify 命令|验收命令)\s*[:：]/.test(trimmed) && result.verifyCommand === null) {
    result.verifyCommand = fieldValue(trimmed)
    return true
  }
  return false
}

/**
 * 行内多字段切分的标签边界（行首，或「 / 」「；」「;」分隔后）——标签集与
 * applyFieldLine 一致，仅标签本身进分段；值里自带的「/」「；」不产生新段。
 */
const INLINE_LABEL_RE =
  /(?:^|[/；;]\s*)([-*]\s*)?((?:做什么|目的|文件|预计动哪些文件|涉及文件|改动文件|风险|敏感路径与风险标签|verify|verify 命令|验收命令)\s*[:：])/g

/**
 * 行内多字段切分（T6 实测模型紧凑写法）：规则文本以「做什么 / 预计动哪些文件 /
 * 敏感路径与风险标签 / verify 命令」的「/」样式呈现四要素，模型常把多要素塞进
 * 一行（`做什么：A / 文件：B / verify：C`）。按标签边界把一行切成多段，逐段进
 * applyFieldLine；段内无标签的碎片并入前一段，绝不凭空造字段。无标签命中 →
 * 整行单段（与旧行为一致）。
 */
function splitInlineSegments(line: string): string[] {
  const starts: number[] = []
  INLINE_LABEL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_LABEL_RE.exec(line)) !== null) {
    // 标签起点 = 匹配终点减去「标签+冒号」长度（跳过边界「/ 」「；」与列表符「- 」；
    // 行首标签起点即 0）
    starts.push(m.index + m[0].length - m[2].length)
  }
  // 无标签或只有一个标签 → 整行单段（与旧行为一致，列表符由 applyFieldLine 的
  // `[-*]?\s*` 容错；多行文件清单的续行逻辑只对单段行生效）
  if (starts.length <= 1) return [line]
  const out: string[] = []
  let prev = 0
  for (const s of starts) {
    if (s > prev) {
      // 循环内段都终止于下一个标签起点：剥离段尾分隔符（「 / 」「；」——
      // 它属于下一个标签的边界，不属于本段值）
      out.push(line.slice(prev, s).trim().replace(/\s*[/；;]\s*$/, ''))
    }
    prev = s
  }
  out.push(line.slice(prev).trim())
  return out.filter((s) => s !== '')
}

/**
 * 纯函数：从已提取的 assistant text 块集合中检测意图块并提取四要素。
 * 检测逻辑独立成纯函数便于单测（IO 只发生在 readTranscriptIntent 读文件）。
 */
export function detectIntentInTexts(texts: string[]): TranscriptIntent {
  let sawMarker = false
  const result = emptyResult()
  for (const text of texts) {
    if (!text.includes('#意图块')) continue
    sawMarker = true
    const lines = text.split('\n')
    // 只从含标记的块内扫描要素行（标记后的若干行）
    let scanning = false
    for (let li = 0; li < lines.length; li++) {
      const trimmed = lines[li].trim()
      if (trimmed.includes('#意图块')) {
        scanning = true
        continue
      }
      if (!scanning) continue
      if (trimmed === '') {
        // 空行结束要素区（防止串到后续无关文本）
        break
      }
      // 行内多字段（紧凑写法：`做什么：A / 文件：B / verify：C`）：逐段判定，
      // 不触发文件多行续行（续行只属于纯文件清单行）
      const segments = splitInlineSegments(trimmed)
      if (segments.length > 1) {
        for (const seg of segments) applyFieldLine(result, seg)
        continue
      }
      if (!applyFieldLine(result, trimmed)) continue
      // 兼容多行列表：后续 `- item` / `* item` 行并入文件清单；
      // 列表式字段行（`- 风险：…` / `- verify：…`）不是文件项，立即止步
      if (/^[-*]?\s*(文件|预计动哪些文件|涉及文件|改动文件)[:：]/.test(trimmed)) {
        const items = result.files
        for (let k = li + 1; k < lines.length; k++) {
          const next = lines[k].trim()
          if (/^[-*]\s*\S+[:：]/.test(next)) break
          if (/^[-*]\s+\S/.test(next)) {
            items.push(next.replace(/^[-*]\s+/, '').trim())
            li = k
          } else {
            break
          }
        }
        result.files = items
      }
    }
  }
  if (sawMarker) result.declared = true
  return result
}

/**
 * 读 transcript 并检测意图块（IO 薄壳，fail-open）：
 * - 路径缺失/不可读/非 JSON → null（不影响主通道）；
 * - 读到了但无意图块 → { declared:false }。
 */
export function readTranscriptIntent(transcriptPath: string | null | undefined): TranscriptIntent | null {
  if (!transcriptPath) return null
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }
  const texts: string[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (e.type !== 'assistant') continue
    const msg = e.message
    if (!msg || typeof msg !== 'object') continue
    if ((msg as { role?: unknown }).role !== 'assistant') continue
    const content = (msg as { content?: unknown }).content
    if (typeof content === 'string') {
      texts.push(content)
      continue
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as { type?: unknown; text?: unknown }
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
      }
    }
  }
  return detectIntentInTexts(texts)
}
