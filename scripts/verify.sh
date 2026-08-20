#!/bin/bash
# T1 真机验证（先 build 后验证——纪律：绝不把旧构建当真，计划 §2.2）
#
# 流程：node/claude 存在性检查 → 认证 env（spike 附录 A）→ npm run build
#      → sandbox 一键重置 → 在 sandbox/work 起 claude -p 非交互会话跑最小场景
#      → 断言：模型输出 README 首行 ∧ SessionStart hook 被触发（.dev-flow-debug 日志）∧ 版本注入生效
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# —— doctor 前身：安装期前置条件检查（计划 §2.1/§8），缺失即中文报错退出 ——
command -v node >/dev/null 2>&1 || {
  echo "错误：未找到 node。dev-flow 以 node >= 20 为安装前置条件，请先安装 Node.js。" >&2
  exit 1
}
command -v claude >/dev/null 2>&1 || {
  echo "错误：未找到 claude。请安装 Claude Code CLI。" >&2
  exit 1
}

# —— 认证 env（spike 附录 A，本机 claude 未登录 Anthropic，需 env 注入）——
# 提取逻辑见 scripts/auth-env.sh（env 段优先 → 旧 providers 段回退；用户 export 优先）。
# shellcheck disable=SC1091
source "$ROOT/scripts/auth-env.sh"

echo "[verify] 1/4 构建（先 build 后验证）"
cd "$ROOT"
npm run build

echo "[verify] 2/4 重置 sandbox"
"$ROOT/scripts/sandbox-reset.sh"

echo "[verify] 3/4 claude -p 端到端（sandbox/work 内起会话）"
WORK="$ROOT/sandbox/work"
cd "$WORK"
# 坑（spike 坑 5）：--allowedTools/--settings 是变参 flag，位置参数 prompt 必须放其前
# 会话 settings 可被 DEV_FLOW_TEST_SETTINGS 覆盖（直连兜底：代理指向失效 provider 时，见 scripts/make-test-settings.sh）
SETTINGS="${DEV_FLOW_TEST_SETTINGS:-$ROOT/scripts/empty-settings.toml}"
PROMPT='请读取 README.md，并一字不差报告第一行内容。'
OUTPUT="$(claude -p "$PROMPT" \
  --plugin-dir "$ROOT/plugins/dev-flow" \
  --allowedTools "Read,Glob,Grep" \
  --settings "$SETTINGS" 2>&1)"
echo "$OUTPUT"

echo "[verify] 4/4 断言"
# ① 模型完成最小场景：输出 README 首行
EXPECT_FIRST_LINE="$(head -n 1 "$WORK/README.md")"
case "$OUTPUT" in
  *"$EXPECT_FIRST_LINE"*) ;;
  *)
    echo "[verify] 失败：模型输出未包含 README 首行「${EXPECT_FIRST_LINE}」" >&2
    exit 1
    ;;
esac

# ② 空壳插件加载成功：SessionStart hook 被触发（写日志即证明）
LOG="$WORK/.dev-flow-debug/session-start.log"
[ -f "$LOG" ] || {
  echo "[verify] 失败：SessionStart hook 未触发（$LOG 不存在）——空壳插件可能未被宿主加载" >&2
  exit 1
}
grep -q '"hook_event_name":"SessionStart"' "$LOG" || {
  echo "[verify] 失败：日志无 SessionStart 事件" >&2
  exit 1
}

# ③ 版本注入机制跑通：产物里 DEV_FLOW_VERSION = package.json version
PKG_VERSION="$(awk -F'"' '/"version"/{print $4; exit}' "$ROOT/package.json")"
grep -q "\"dev_flow_version\":\"$PKG_VERSION\"" "$LOG" || {
  echo "[verify] 失败：版本注入未生效（日志 dev_flow_version ≠ package.json $PKG_VERSION）" >&2
  exit 1
}

echo "[verify] 通过：空壳插件加载成功、SessionStart hook 触发、版本注入 $PKG_VERSION 生效"
