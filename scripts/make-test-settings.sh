#!/bin/bash
# 生成真机验证用的 --settings 文件（环境兜底，2026-08-19 T6 踩坑沉淀）
#
# 背景：本机 claude 经 CC Switch 代理（127.0.0.1:15721）走"当前选中 provider"。
# 若当前 provider 失效（如 opencode 上游 403 DataPolicyError 要求数据 opt-in），
# 验证脚本全挂。本脚本从 CC Switch 数据库（只读）提取一个可用 provider 的
# env 段，写成 session settings JSON（--settings 的 env 段会覆盖 settings.json
# env 段——实证：进程 env 覆盖无效，settings 文件 env 段才有效），供验证脚本
# 以 DEV_FLOW_TEST_SETTINGS 引用。
#
# 用法：node 前置已检查；输出文件路径到 stdout，供调用方赋值。
#   TEST_SETTINGS="$(bash scripts/make-test-settings.sh)"
#   DEV_FLOW_TEST_SETTINGS="$TEST_SETTINGS" bash scripts/verify-t6.sh
#
# provider 选择：默认取 CC Switch 数据库里 claude 类 provider 中名为 Kimi 的
# （T6 实证：k3 直连工具调用可靠）；可用环境变量 DF_TEST_PROVIDER_NAME 覆盖
# （如 Micu_grok）。只读用户配置，绝不写回。
set -euo pipefail

DB="${CC_SWITCH_DB:-$HOME/.cc-switch/cc-switch.db}"
PROVIDER_NAME="${DF_TEST_PROVIDER_NAME:-Kimi}"
OUT="${DF_TEST_SETTINGS_OUT:-/tmp/df-test-settings.json}"

[ -f "$DB" ] || {
  echo "错误：找不到 CC Switch 数据库 $DB（本脚本是本机验证环境的直连兜底，非通用设施）" >&2
  exit 1
}

node - "$DB" "$PROVIDER_NAME" "$OUT" <<'EOF'
const fs = require('fs')
const path = require('path')
const dbPath = process.argv[2]
const name = process.argv[3]
const out = process.argv[4]
// 用只读模式打开 sqlite（不触发任何写）
const { DatabaseSync } = require('node:sqlite')
let rows
try {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  rows = db.prepare(
    "SELECT settings_config FROM providers WHERE app_type='claude' AND name = ? ORDER BY is_current DESC",
  ).all(name)
  db.close()
} catch (err) {
  console.error('错误：读取 CC Switch 数据库失败：' + err.message)
  process.exit(1)
}
if (rows.length === 0) {
  console.error(`错误：未找到 claude provider「${name}」（可用 DF_TEST_PROVIDER_NAME 指定其他名字）`)
  process.exit(1)
}
const cfg = JSON.parse(rows[0].settings_config)
const env = cfg.env || {}
if (!env.ANTHROPIC_AUTH_TOKEN || !env.ANTHROPIC_BASE_URL) {
  console.error(`错误：provider「${name}」env 缺 ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL`)
  process.exit(1)
}
// 只带认证与模型路由字段（不携带用户其他会话配置，最小面）
const picked = {
  env: {
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL || undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME || undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME || undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL || undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME || undefined,
  },
}
for (const k of Object.keys(picked.env)) if (picked.env[k] === undefined) delete picked.env[k]
fs.writeFileSync(out, JSON.stringify(picked, null, 2) + '\n', 'utf8')
process.stdout.write(out)
EOF
