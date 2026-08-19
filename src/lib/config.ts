/**
 * 项目配置模块：.dev-flow/config.json（整体可选，计划 §3.4/§3.6）
 *
 * - 配置项：sensitivePaths（敏感路径表只追加不覆盖）、autoCommit（T7 用，默认 true）；
 * - 读取容错：文件缺失 → 默认配置静默；JSON 损坏/字段畸形 → 默认配置 + audit 警告，
 *   fail-open 绝不阻塞；未知字段忽略（additive-only 向前兼容）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { auditWarning, ensureStateRoot } from './events.js'

export interface DevFlowConfig {
  /** 项目追加敏感路径模式（只追加不覆盖内置四类） */
  sensitivePaths: string[]
  /** done 时自动 commit 开关（T7 使用，T4 只读取容错） */
  autoCommit: boolean
}

export function defaultConfig(): DevFlowConfig {
  return { sensitivePaths: [], autoCommit: true }
}

/**
 * 解析 config.json 文本（纯函数）：非对象顶层 → 默认；敏感字段逐项宽容提取。
 * 未知字段忽略；sensitivePaths 只取字符串项（追加不覆盖由调用方保证）。
 */
export function parseConfig(raw: string): DevFlowConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultConfig()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultConfig()
  const o = parsed as Record<string, unknown>
  const cfg = defaultConfig()
  if (Array.isArray(o.sensitivePaths)) {
    for (const item of o.sensitivePaths) {
      if (typeof item === 'string' && item.trim() !== '') cfg.sensitivePaths.push(item.trim())
    }
  }
  if (typeof o.autoCommit === 'boolean') cfg.autoCommit = o.autoCommit
  return cfg
}

/**
 * 读取配置（IO 薄壳，fail-open）：缺失静默（首次运行）；损坏 → 默认 + audit 警告。
 * 绝不因配置问题阻塞门禁。
 */
export function loadConfig(root: string): DevFlowConfig {
  ensureStateRoot(root)
  let raw: string
  try {
    raw = readFileSync(join(root, 'config.json'), 'utf8')
  } catch {
    return defaultConfig()
  }
  const cfg = parseConfig(raw)
  const corrupted = !isValidRaw(raw)
  if (corrupted) {
    auditWarning(root, 'config.json 损坏或结构非法，已按默认配置放行（fail-open）', 'config')
  }
  return cfg
}

/** 判断原始文本是否合法 JSON 对象（loadConfig 审计用） */
function isValidRaw(raw: string): boolean {
  try {
    const v = JSON.parse(raw) as unknown
    return !!v && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}
