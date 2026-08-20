#!/bin/bash
# T6 真机验证（done MCP 工具 + 验收事件记账，先 build 后验证——纪律：绝不把旧构建当真）
#
# 场景 ① 未跑 verify 就 done → 驳回且理由可见（fail-visible）
# 场景 ② 跑 verify 失败（非零退出码）→ done 驳回（验收记账 exitReason=nonzero）
# 场景 ③ 跑 verify 成功 → done 成功 + done.claimed 落账 + 连败清零
# 场景 ④ 验收通过后改代码 → done 驳回（时序双检查：代码变则验收失效）
# 场景 ⑤ verify 命令超时 → 记账 exitReason=timeout（绝不被归一为通过/普通失败；
#   2026-08-20 实证：2.1.234 sdk-cli 下超时由宿主转后台，载荷为 PostToolUse +
#   timedOutAfterMs/backgroundTaskId，不再走 PostToolUseFailure）
#
# 主线建立：软单主线（§5.7）——全新状态首写不建主线（mainlineId 为空串），
# done 需要活跃主线。每场景先用一个独立 claude -p 调用发切换短语（"先弄那个
# 场景主线"）开主线，与任务提示词解耦（UPS 抱怨词表会阻断含"失败/怎么"等词的
# prompt，短语独立成句最稳——T6 实测两坑：验证失败场景/故意失败 都被阻断）。
#
# MCP 链路（本次任务实证结论，沉淀为本脚本的固定驱动方式）：
# - 插件 .mcp.json 标准 mcpServers 配置（command/args 支持 ${CLAUDE_PLUGIN_ROOT} 替换）；
# - 工具渲染名 = mcp__plugin_dev-flow_df__done（§2.2 命名预判实证成立）；
# - -p 模式 allowedTools 用 'mcp__plugin_dev-flow_df__*'（通配只能放工具位，
#   'mcp__.*' 会被拒绝）；
# - 模型经 ToolSearch（deferred tool loading）发现并调用 done；验证由模型真实调用。
#
# 每个场景独立重置 sandbox（events 干净起跑），可复跑。
# 模型行为吸收：Kimi 模型偶发"只输出描述文本不真实调用工具"或偏序执行，
# 脚本按"关键证据缺失"自动重置重试该场景（≤3 次），保证机制验证不被行为噪音干扰。
# 证据面：.dev-flow/events.jsonl + state.json（落账/状态断言）+ .dev-flow-debug/
# post-tool-use.log（验收记账判定证据）+ --debug-file（无 unrecognized keys 核对）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# —— doctor 前身：安装期前置条件检查（计划 §2.1/§8）——
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

echo "[t6] 1/7 构建（先 build 后验证）"
cd "$ROOT"
npm run build

WORK="$ROOT/sandbox/work"
# 会话 settings 可被 DEV_FLOW_TEST_SETTINGS 覆盖（直连兜底：代理指向失效 provider 时，见 scripts/make-test-settings.sh）
SETTINGS="${DEV_FLOW_TEST_SETTINGS:-$ROOT/scripts/empty-settings.toml}"
PLUGIN="$ROOT/plugins/dev-flow"
ALLOWED="Write,Bash,Read,Glob,Grep,mcp__plugin_dev-flow_df__*"

# —— 每场景独立重置：seed → work + 清状态/调试目录 ——
reset_work() {
  "$ROOT/scripts/sandbox-reset.sh" >/dev/null
  rm -rf "$WORK/.dev-flow" "$WORK/.dev-flow-debug"
  cd "$WORK"
}

# 独立会话建立主线（软单主线 §5.7：done 需要活跃主线；切换短语独立成句，
# 避开 UPS 抱怨词表——含"失败/怎么/卡住"等词的 prompt 会被识别为抱怨零注入）
open_mainline() {
  claude -p '先弄那个 场景主线。请只用一句话确认收到，不要执行任何工具、不要写任何文件。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" >/dev/null 2>&1 || true
  grep -q '"type":"mainline.switch"' "$WORK/.dev-flow/events.jsonl" || {
    echo "[t6] 警告：主线建立会话未落账 mainline.switch（见 events.jsonl）" >&2
  }
}

# 断言事件落账（events.jsonl 含给定子串）
assert_events() {
  local pattern="$1" label="$2"
  grep -q "$pattern" "$WORK/.dev-flow/events.jsonl" || {
    echo "[t6] 失败：${label}——events.jsonl 缺「${pattern}」" >&2
    grep -o '"type":"[a-z.]*"' "$WORK/.dev-flow/events.jsonl" | sort | uniq -c >&2 || true
    exit 1
  }
}

# 断言验收记账判定（post-tool-use.log 的 hook 判定证据，记账正确的确定性证据）
assert_ptu() {
  local log="$WORK/.dev-flow-debug/post-tool-use.log" pattern="$1" label="$2"
  [ -f "$log" ] || {
    echo "[t6] 失败：${label}——post-tool-use.log 不存在（PostToolUse hook 未触发？）" >&2
    exit 1
  }
  grep -q "$pattern" "$log" || {
    echo "[t6] 失败：${label}——post-tool-use.log 缺「${pattern}」" >&2
    tail -5 "$log" >&2 || true
    exit 1
  }
}

# 断言 done 驳回理由进入模型输出（fail-visible 的行为证据，宽松断言）
assert_reason_seen() {
  local out="$1" pattern="$2" label="$3"
  grep -qE "$pattern" "$out" || {
    echo "[t6] 警告：${label}——模型输出未见驳回理由（机制面已由 events 断言证明）"
  }
}

# 场景执行包装：$1=场景名 $2=关键证据 grep 模式 $3=场景执行函数
run_with_retry() {
  local label="$1" key_pattern="$2" fn="$3" n=0
  while :; do
    n=$((n + 1))
    "$fn"
    if grep -q "$key_pattern" "$WORK/.dev-flow/events.jsonl" "$WORK/.dev-flow/state.json" "$WORK/.dev-flow-debug/post-tool-use.log" 2>/dev/null; then
      return 0
    fi
    if [ "$n" -ge 3 ]; then
      echo "[t6] 失败：${label} 连续 3 次未产生关键证据（模型可能未真实执行，见上方输出）" >&2
      exit 1
    fi
    echo "[t6] 提示：${label} 第 ${n} 次未产生关键证据，重置重试"
  done
}

# —— 场景 ①：意图块声明 verify，未跑就 done → 驳回 + 理由可见 ——
echo "[t6] 2/7 场景 ①：未跑 verify 就 done → 驳回（fail-visible）"
scene1() {
  reset_work
  open_mainline
  set +e
  OUT="$(claude -p '请创建一个文件 src/app.js（内容为 hello，一行）。先按规则输出意图块，其中 verify 行只写 node check.js（不要加括号备注或说明）。然后实际调用 Write 工具写入。写入完成后：不要运行任何验证命令，直接调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t6-debug-1.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t6-out-1.txt
  [ "$RC" -eq 0 ] || {
    echo "[t6] 失败：场景 ① claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ①" '"type":"done.rejected"' scene1
echo "----- 场景 ① 模型输出 -----"
cat /tmp/t6-out-1.txt
echo "----- 场景 ① 输出结束 -----"
assert_events '"type":"done.rejected"' "场景 ① done.rejected 落账"
# 主线已由切换短语建立（软单主线 §5.7），驳回理由是缺验收（fail-visible：说清缺什么）
grep -q '无验收通过记录' "$WORK/.dev-flow/events.jsonl" || {
  echo "[t6] 失败：场景 ① done.rejected 理由未说明缺验收（无验收通过记录）" >&2
  grep -o '"reason":"[^"]*"' "$WORK/.dev-flow/events.jsonl" | tail -1 >&2
  exit 1
}
# 连败计数 +1（第一批只计数不锁定）
grep -q '"loseStreak": 1' "$WORK/.dev-flow/state.json" || {
  echo "[t6] 失败：场景 ① 连败计数未 +1（见 state.json）" >&2
  exit 1
}
# 模型感知驳回理由（宽松断言，行为面）
assert_reason_seen /tmp/t6-out-1.txt '验收|verify|done' "场景 ① 模型输出见驳回语义"
grep -q 'Hook JSON output had unrecognized' /tmp/t6-debug-1.jsonl && {
  echo "[t6] 失败：场景 ① debug 日志有 Hook JSON output had unrecognized（hook 输出格式回退）" >&2
  exit 1
}
echo "[t6] 场景 ① 通过：未验收 done 被驳回、理由可见、连败 +1"

# —— 场景 ②：跑 verify 失败（非零）→ done 驳回 + 记账 exitReason=nonzero ——
echo "[t6] 3/7 场景 ②：verify 非零退出码 → done 驳回（记账可区分）"
scene2() {
  reset_work
  open_mainline
  set +e
  OUT="$(claude -p '请完成一个小任务：创建两个文件。① check.js 放在仓库根目录，内容恰好为 process.exit(1)（一行，验收脚本按设计以退出码 1 结束）；② src/app.js，内容为 hello。先按规则输出意图块，其中 verify 行只写 node check.js（不要加括号备注或说明，不要带路径前缀）。然后用 Write 工具真实写入这两个文件。写入后在仓库根目录运行 Bash 命令 node check.js（命令必须就是 node check.js，不要写成 node src/check.js 或加其他参数），确认它退出码非零。最后调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t6-debug-2.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t6-out-2.txt
  [ "$RC" -eq 0 ] || {
    echo "[t6] 失败：场景 ② claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ②" '"exitReason":"nonzero"' scene2
echo "----- 场景 ② 模型输出 -----"
cat /tmp/t6-out-2.txt
echo "----- 场景 ② 输出结束 -----"
# 验收记账：verify.failed 且退出原因 = nonzero（非零退出码，绝不被归一）
assert_events '"exitReason":"nonzero"' "场景 ② verify.failed 记账 exitReason=nonzero"
assert_events '"type":"done.rejected"' "场景 ② done.rejected 落账"
grep -q '无验收通过记录' "$WORK/.dev-flow/events.jsonl" || {
  echo "[t6] 失败：场景 ② done.rejected 理由未说明缺验收" >&2
  exit 1
}
# hook 判定证据：匹配到声明、记成 verify.failed nonzero
assert_ptu '"matched":true,"recorded":true,"event_type":"verify.failed","exit_reason":"nonzero"' "场景 ② post-tool-use 判定 nonzero"
echo "[t6] 场景 ② 通过：非零退出码记账可区分、done 驳回"

# —— 场景 ③：跑 verify 成功 → done 成功 + claimed 落账 + 连败清零 ——
echo "[t6] 4/7 场景 ③：verify 成功 → done 成功"
scene3() {
  reset_work
  open_mainline
  set +e
  OUT="$(claude -p '请完成一个小任务：创建两个文件。① check.js 放在仓库根目录，内容恰好为 process.exit(0)（一行，验收脚本成功）；② src/app.js，内容为 hello。先按规则输出意图块，其中 verify 行只写 node check.js（不要加括号备注或说明，不要带路径前缀）。然后用 Write 工具真实写入这两个文件。写入后在仓库根目录运行 Bash 命令 node check.js（命令必须就是 node check.js，不要写成 node src/check.js 或加其他参数），确认它退出码为 0。最后调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t6-debug-3.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t6-out-3.txt
  [ "$RC" -eq 0 ] || {
    echo "[t6] 失败：场景 ③ claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ③" '"type":"done.claimed"' scene3
echo "----- 场景 ③ 模型输出 -----"
cat /tmp/t6-out-3.txt
echo "----- 场景 ③ 输出结束 -----"
assert_events '"type":"verify.passed"' "场景 ③ verify.passed 落账"
assert_events '"type":"done.claimed"' "场景 ③ done.claimed 落账"
# 主线关闭：claimedAt 非空 + 连败清零
grep -q '"claimedAt": "[0-9]' "$WORK/.dev-flow/state.json" || {
  echo "[t6] 失败：场景 ③ state 主线未关闭（claimedAt 缺失）" >&2
  exit 1
}
grep -q '"loseStreak": 0' "$WORK/.dev-flow/state.json" || {
  echo "[t6] 失败：场景 ③ 连败未清零（见 state.json）" >&2
  exit 1
}
# hook 判定证据：verify.passed
assert_ptu '"event_type":"verify.passed"' "场景 ③ post-tool-use 判定 passed"
echo "[t6] 场景 ③ 通过：verify 成功 → done 成功、主线关闭、连败清零"

# —— 场景 ④：验收通过后改代码 → done 驳回（时序双检查）——
echo "[t6] 5/7 场景 ④：验收通过后改代码 → done 驳回（时序双检查）"
scene4() {
  reset_work
  open_mainline
  set +e
  OUT="$(claude -p '请按顺序完成：① 输出意图块，其中 verify 行只写 node check.js（不要加括号备注或说明，不要带路径前缀）；② 用 Write 创建 check.js（放仓库根目录，内容 process.exit(0)）和 src/app.js（内容 hello）；③ 在仓库根目录运行 Bash 命令 node check.js（命令必须就是 node check.js），确认退出码 0（验收通过）；④ 验收之后，再用 Write 修改 src/app.js（内容改为 hello-v2，这是验收通过后的代码变更）；⑤ 然后调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。严格按此顺序，必须真实调用工具。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t6-debug-4.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t6-out-4.txt
  [ "$RC" -eq 0 ] || {
    echo "[t6] 失败：场景 ④ claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ④" '验收已失效' scene4
echo "----- 场景 ④ 模型输出 -----"
cat /tmp/t6-out-4.txt
echo "----- 场景 ④ 输出结束 -----"
assert_events '"type":"done.rejected"' "场景 ④ done.rejected 落账"
# 时序双检查的驳回理由（代码变则验收失效）
grep -q '验收已失效' "$WORK/.dev-flow/events.jsonl" || {
  echo "[t6] 失败：场景 ④ done.rejected 理由未说明验收失效" >&2
  grep -o '"reason":"[^"]*"' "$WORK/.dev-flow/events.jsonl" | tail -1 >&2
  exit 1
}
# 事件序核对：验收通过事件存在、其后有写入（最后一次写入晚于验收）
assert_events '"type":"verify.passed"' "场景 ④ 此前验收通过已落账"
echo "[t6] 场景 ④ 通过：代码变更后验收失效、done 驳回"

# —— 场景 ⑤：verify 命令挂死/超时 → 记账 exitReason=timeout ——
echo "[t6] 6/7 场景 ⑤：verify 超时（超时被宿主转入后台）→ 记账可区分"
scene5() {
  reset_work
  open_mainline
  set +e
  OUT="$(claude -p '请完成：① 输出意图块，其中 verify 行只写 node hang.js（不要加括号备注或说明，不要带路径前缀）；② 用 Write 创建 hang.js（放仓库根目录），内容恰好为 setTimeout(() => {}, 60000)（挂死脚本）；③ 在仓库根目录运行 Bash 命令 node hang.js（命令必须就是 node hang.js），并且必须把 Bash 工具的 timeout 参数显式设为 3（秒）——注意这是 Bash 工具的 timeout 参数（数字 3），不是 shell 的 timeout 命令。命令会被超时杀掉；④ 然后调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。必须真实调用工具。注意：如果 done 被驳回，这正是本任务的预期终点——被驳回后不要再运行任何命令、不要再调用任何工具，直接结束并汇报驳回理由。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t6-debug-5.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t6-out-5.txt
  [ "$RC" -eq 0 ] || {
    echo "[t6] 失败：场景 ⑤ claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ⑤" '"exitReason":"timeout"' scene5
echo "----- 场景 ⑤ 模型输出 -----"
cat /tmp/t6-out-5.txt
echo "----- 场景 ⑤ 输出结束 -----"
# 验收记账：verify.failed + exitReason=timeout（超时挂死绝不被归一为普通失败）
assert_events '"exitReason":"timeout"' "场景 ⑤ verify.failed 记账 exitReason=timeout"
# 2026-08-20 实证：本宿主超时转后台（非 PostToolUseFailure），记账事件必须带
# backgroundTaskId（旧断言 "Command timed out" 基于已不成立的假设，已替换）
grep -q '"backgroundTaskId":"' "$WORK/.dev-flow/events.jsonl" || {
  echo "[t6] 失败：场景 ⑤ 验收记账缺 backgroundTaskId（超时转后台未落账）" >&2
  exit 1
}
# hook 判定证据：timeout
assert_ptu '"exit_reason":"timeout"' "场景 ⑤ post-tool-use 判定 timeout"
# 超时验收不计为通过：done 应被驳回（无 verify.passed）
assert_events '"type":"done.rejected"' "场景 ⑤ 超时后 done 驳回"
grep -q '"type":"verify.passed"' "$WORK/.dev-flow/events.jsonl" && {
  echo "[t6] 失败：场景 ⑤ 超时被归一为通过（verify.passed 不应存在）" >&2
  exit 1
}
echo "[t6] 场景 ⑤ 通过：超时与普通失败在记账中可区分、done 不误放行"

echo "[t6] 7/7 全部通过：五场景端到端验证完成"
echo ""
echo "[t6] 说明：每场景独立重置 sandbox，故末尾工作区 events 仅含最后一个场景；"
echo "      各场景断言已在场景内完成（见上方每个场景的通过行与模型输出）。"
