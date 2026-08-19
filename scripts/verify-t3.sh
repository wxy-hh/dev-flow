#!/bin/bash
# T3 真机验证（三场景，先 build 后验证——纪律：绝不把旧构建当真，计划 §2.2）
#
# 场景 A：空状态开会话 → 意图块规则常驻注入生效
#   （硬断言：debug 日志 additional_context 含规则文本；模型输出是否感知规则为加分证据）
# 场景 B：预置"未关闭主线 + 写到一半"→ 恢复播报（resume 听到主线名/阶段/还差什么）
#   （硬断言：debug 日志含播报 ∧ 模型输出复述主线名）
# 场景 C：预置"verify.passed 晚于最后写入、无 done.claimed"→ done 兜底完成确认提示
#   （硬断言：debug 日志含兜底消息 ∧ 模型输出感知"验收/确认"）
#
# 预置数据用脚本写 sandbox/work/.dev-flow/（events.jsonl 手造几行 + 一致 state.json），
# 场景可复跑（sandbox-reset 一键回干净态）。
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

# —— 认证 env（spike 附录 A）——
# shellcheck disable=SC1091
source "$ROOT/scripts/auth-env.sh"

echo "[t3] 1/5 构建（先 build 后验证）"
cd "$ROOT"
npm run build

echo "[t3] 2/5 重置 sandbox"
"$ROOT/scripts/sandbox-reset.sh"

WORK="$ROOT/sandbox/work"
cd "$WORK"
DEBUG_LOG="$WORK/.dev-flow-debug/session-start.log"
# 会话 settings 可被 DEV_FLOW_TEST_SETTINGS 覆盖（直连兜底：代理指向失效 provider 时，见 scripts/make-test-settings.sh）
SETTINGS="${DEV_FLOW_TEST_SETTINGS:-$ROOT/scripts/empty-settings.toml}"
PLUGIN="$ROOT/plugins/dev-flow"

# —— 场景 A：空状态开会话 → 规则常驻注入 ——
echo "[t3] 3/5 场景 A：空状态开会话（意图块规则常驻注入）"
set +e
OUT_A="$(claude -p '请在 README.md 末尾追加一行："T3 场景 A 通过"。先输出你的计划，再动手。' \
  --plugin-dir "$PLUGIN" \
  --allowedTools "Read,Write,Glob,Grep" \
  --settings "$SETTINGS" 2>&1)"
RC_A=$?
set -e
echo "$OUT_A" > /tmp/t3-out-a.txt
echo "----- 场景 A 模型输出 -----"
cat /tmp/t3-out-a.txt
echo "----- 场景 A 输出结束 -----"
[ "$RC_A" -eq 0 ] || {
  echo "[t3] 失败：场景 A claude -p 退出码 $RC_A（见上方输出）" >&2
  exit 1
}
[ -f "$DEBUG_LOG" ] || {
  echo "[t3] 失败：SessionStart hook 未触发（$DEBUG_LOG 不存在）" >&2
  exit 1
}
grep -q '#意图块' "$DEBUG_LOG" || {
  echo "[t3] 失败：场景 A 注入未含意图块规则（additionalContext 缺失）" >&2
  exit 1
}
echo "[t3] 场景 A 通过：规则已注入（debug 日志含 #意图块）"
if grep -q '#意图块' /tmp/t3-out-a.txt; then
  echo "[t3] 加分：模型在写入前主动输出意图块（规则被感知）"
else
  echo "[t3] 注意：模型本次未复述意图块（规则是引导不是强制，T4 强制层在后续任务）"
fi

# —— 场景 B：预置未关闭主线 → 恢复播报 ——
echo "[t3] 4/5 场景 B：预置主线（写代码阶段）→ resume 恢复播报"
rm -rf "$WORK/.dev-flow"
mkdir -p "$WORK/.dev-flow"
cat > "$WORK/.dev-flow/events.jsonl" <<'EOF'
{"type":"session.start","t":"2026-08-19T08:00:00.000Z","mainlineId":"","sessionId":"prev-session","source":"startup"}
{"type":"intent.declared","t":"2026-08-19T08:01:00.000Z","mainlineId":"m1","requirementId":"m1@r1","summary":"做标签功能","verifyCommand":"npm test","risk":null,"files":["src/tags.ts"]}
{"type":"file.changed","t":"2026-08-19T08:20:00.000Z","mainlineId":"m1","tool":"Write","path":"src/tags.ts"}
EOF
cat > "$WORK/.dev-flow/state.json" <<'EOF'
{
  "version": 1,
  "updatedAt": "2026-08-19T08:20:00.000Z",
  "activeMainlineId": "m1",
  "mainlines": {
    "m1": {
      "id": "m1",
      "name": "",
      "status": "active",
      "createdAt": "2026-08-19T08:01:00.000Z",
      "updatedAt": "2026-08-19T08:20:00.000Z",
      "claimedAt": null,
      "rejectedAt": null,
      "lastWriteAt": "2026-08-19T08:20:00.000Z"
    }
  },
  "requirements": [
    {
      "id": "m1@r1",
      "mainlineId": "m1",
      "summary": "做标签功能",
      "verifyCommand": "npm test",
      "status": "declared",
      "createdAt": "2026-08-19T08:01:00.000Z",
      "blockedAt": null,
      "blockedReason": null,
      "doneAt": null
    }
  ],
  "governanceStrength": 0,
  "loseStreak": 0,
  "doneLock": false,
  "lastVerification": null,
  "verifyDeclarations": {}
}
EOF
set +e
OUT_B="$(claude -p '请只报告：会话开始时系统注入的恢复信息说了什么——正在做的主线、处于什么阶段、还差什么。不要执行任何工具，也不要读取任何文件。' \
  --plugin-dir "$PLUGIN" \
  --allowedTools "Read,Glob,Grep" \
  --settings "$SETTINGS" 2>&1)"
RC_B=$?
set -e
echo "$OUT_B" > /tmp/t3-out-b.txt
echo "----- 场景 B 模型输出 -----"
cat /tmp/t3-out-b.txt
echo "----- 场景 B 输出结束 -----"
[ "$RC_B" -eq 0 ] || {
  echo "[t3] 失败：场景 B claude -p 退出码 $RC_B（见上方输出）" >&2
  exit 1
}
grep -q '做标签功能' "$DEBUG_LOG" || {
  echo "[t3] 失败：场景 B 注入未含恢复播报（additionalContext 缺主线名）" >&2
  exit 1
}
grep -q '做标签功能' /tmp/t3-out-b.txt || {
  echo "[t3] 失败：场景 B 模型未听到播报（输出缺主线名，见上方输出）" >&2
  exit 1
}
echo "[t3] 场景 B 通过：恢复播报已注入且模型听到主线名「做标签功能」"

# —— 场景 C：预置"验收已过、只差确认"→ done 兜底确认提示 ——
echo "[t3] 5/5 场景 C：verify.passed 晚于最后写入、无 done.claimed → 完成确认提示"
rm -rf "$WORK/.dev-flow"
mkdir -p "$WORK/.dev-flow"
cat > "$WORK/.dev-flow/events.jsonl" <<'EOF'
{"type":"session.start","t":"2026-08-19T08:00:00.000Z","mainlineId":"","sessionId":"prev-session","source":"startup"}
{"type":"intent.declared","t":"2026-08-19T08:01:00.000Z","mainlineId":"m1","requirementId":"m1@r1","summary":"做标签功能","verifyCommand":"npm test","risk":null,"files":["src/tags.ts"]}
{"type":"file.changed","t":"2026-08-19T08:20:00.000Z","mainlineId":"m1","tool":"Write","path":"src/tags.ts"}
{"type":"verify.passed","t":"2026-08-19T08:30:00.000Z","mainlineId":"m1","requirementId":null,"exitCode":0,"command":"npm test","durationMs":150}
EOF
cat > "$WORK/.dev-flow/state.json" <<'EOF'
{
  "version": 1,
  "updatedAt": "2026-08-19T08:30:00.000Z",
  "activeMainlineId": "m1",
  "mainlines": {
    "m1": {
      "id": "m1",
      "name": "",
      "status": "active",
      "createdAt": "2026-08-19T08:01:00.000Z",
      "updatedAt": "2026-08-19T08:30:00.000Z",
      "claimedAt": null,
      "rejectedAt": null,
      "lastWriteAt": "2026-08-19T08:20:00.000Z"
    }
  },
  "requirements": [
    {
      "id": "m1@r1",
      "mainlineId": "m1",
      "summary": "做标签功能",
      "verifyCommand": "npm test",
      "status": "declared",
      "createdAt": "2026-08-19T08:01:00.000Z",
      "blockedAt": null,
      "blockedReason": null,
      "doneAt": null
    }
  ],
  "governanceStrength": 0,
  "loseStreak": 0,
  "doneLock": false,
  "lastVerification": {
    "at": "2026-08-19T08:30:00.000Z",
    "exitCode": 0,
    "command": "npm test",
    "durationMs": 150
  },
  "verifyDeclarations": { "m1": "npm test" }
}
EOF
set +e
OUT_C="$(claude -p '请只报告：会话开始时系统注入的恢复提示里，有没有需要用户确认的事项？逐字引用相关内容。不要执行任何工具，也不要读取任何文件。' \
  --plugin-dir "$PLUGIN" \
  --allowedTools "Read,Glob,Grep" \
  --settings "$SETTINGS" 2>&1)"
RC_C=$?
set -e
echo "$OUT_C" > /tmp/t3-out-c.txt
echo "----- 场景 C 模型输出 -----"
cat /tmp/t3-out-c.txt
echo "----- 场景 C 输出结束 -----"
[ "$RC_C" -eq 0 ] || {
  echo "[t3] 失败：场景 C claude -p 退出码 $RC_C（见上方输出）" >&2
  exit 1
}
grep -q '只差确认完成' "$DEBUG_LOG" || {
  echo "[t3] 失败：场景 C 兜底未命中（additionalContext 缺确认提示）" >&2
  exit 1
}
grep -q '验收' /tmp/t3-out-c.txt && grep -q '确认' /tmp/t3-out-c.txt || {
  echo "[t3] 失败：场景 C 模型未感知完成确认提示（输出缺验收/确认，见上方输出）" >&2
  exit 1
}
echo "[t3] 场景 C 通过：done 兜底已注入且模型听到「验收已过、只差确认」"

echo ""
echo "[t3] 全部通过：三场景端到端验证完成"
