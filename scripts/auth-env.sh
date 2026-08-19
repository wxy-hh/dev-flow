#!/bin/bash
# 认证 env（spike 附录 A）：被 verify.sh / verify-t3.sh source 加载。
# 环境事实变更（2026-08-19）：~/.claude/settings.json 结构已从 providers 段
# 迁为顶层 env 段（ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL），且 base_url 指向
# 本机 cc-switch 代理（127.0.0.1:15721）。提取逻辑：env 段优先 → 旧 providers 段回退。
# 用户显式 export 的 ANTHROPIC_AUTH_TOKEN 始终优先。
#
# 用法：source 本文件（假设调用方已定义 ROOT；本文件只设置 env，不设 set -e）。
extract_settings_env() { # $1=键名，输出到 stdout
  node -e '
    const fs = require("fs");
    const key = process.argv[1];
    try {
      const o = JSON.parse(fs.readFileSync(process.env.HOME + "/.claude/settings.json", "utf8"));
      const v = o && o.env ? o.env[key] : undefined;
      if (v) process.stdout.write(String(v));
    } catch {}
  ' "$1"
}
if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  ANTHROPIC_AUTH_TOKEN="$(extract_settings_env ANTHROPIC_AUTH_TOKEN)"
  if [ -z "$ANTHROPIC_AUTH_TOKEN" ] && [ -f "$HOME/.claude/settings.json" ]; then
    # 回退：旧 providers 段结构（spike 附录 A 的写法）
    ANTHROPIC_AUTH_TOKEN="$(awk -F'"' '/^api_key *=/{print $2; exit}' "$HOME/.claude/settings.json")"
  fi
  export ANTHROPIC_AUTH_TOKEN
  [ -n "$ANTHROPIC_AUTH_TOKEN" ] || {
    echo "错误：未设置 ANTHROPIC_AUTH_TOKEN 且 ~/.claude/settings.json 无可用的 api key（env 段/旧 providers 段均无）。无法驱动 claude -p。" >&2
    exit 1
  }
fi
export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-$(extract_settings_env ANTHROPIC_BASE_URL)}"
ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://api.kimi.com/coding}" # 默认直连 Kimi；坑：不能带 /v1（spike 坑 2）
export ANTHROPIC_BASE_URL
export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-kimi-for-coding}"
