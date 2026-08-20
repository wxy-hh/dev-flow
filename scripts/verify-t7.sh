#!/bin/bash
# T7 真机验证（done 时选择性自动 commit，先 build 后验证——纪律：绝不把旧构建当真，
# 计划 §2.2/§3.6/§6 T7 判据）
#
# 场景 ①（主判据）：sandbox 里走通「意图块声明 verify → 写文件 → 跑 verify → done」
#   后，git log 出现只含主线文件的自动 commit（message 前缀 `chore(dev-flow): [` +
#   主线标识 + 自动提交尾注）；仓里预置用户自己的未提交改动（已跟踪修改 + 未跟踪
#   新增），断言没被卷进来（红线：绝不 -am）。
# 场景 ②：config.json autoCommit=false → done 照成、不产生任何提交、audit.warning
#   记录「自动提交已关闭」（配置关闭是用户意图，仍进证据链）。
#
# 主线建立：软单主线（§5.7）——与 T6 同款：独立 claude -p 发切换短语开主线
# （done 需要活跃主线；切换短语独立成句，避开 UPS 抱怨词表）。
# 每个场景独立重置 sandbox（events 干净起跑），可复跑。
# 模型行为吸收：Kimi 模型偶发"只输出描述文本不真实调用工具"，run_with_retry ≤3 次。
# 证据面：.dev-flow/events.jsonl + state.json（落账/审计断言）+ git log/status
# （自动提交实锤：提交内容、message、用户改动未动）+ --debug-file（无格式回退）。
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

echo "[t7] 1/6 构建（先 build 后验证）"
cd "$ROOT"
npm run build

WORK="$ROOT/sandbox/work"
# 会话 settings 可被 DEV_FLOW_TEST_SETTINGS 覆盖（直连兜底：代理指向失效 provider 时，见 scripts/make-test-settings.sh）
SETTINGS="${DEV_FLOW_TEST_SETTINGS:-$ROOT/scripts/empty-settings.toml}"
PLUGIN="$ROOT/plugins/dev-flow"
ALLOWED="Write,Bash,Read,Glob,Grep,mcp__plugin_dev-flow_df__*"

# —— 每场景独立重置：seed → work + 清状态/调试目录 + git 身份兜底 ——
reset_work() {
  "$ROOT/scripts/sandbox-reset.sh" >/dev/null
  rm -rf "$WORK/.dev-flow" "$WORK/.dev-flow-debug"
  # sandbox-reset.sh 已局部配置 user.name/email（不依赖全局）；幂等兜底
  git -C "$WORK" config user.name >/dev/null 2>&1 || git -C "$WORK" config user.name "Dev Flow Sandbox"
  git -C "$WORK" config user.email >/dev/null 2>&1 || git -C "$WORK" config user.email "dev-flow-sandbox@localhost"
  cd "$WORK" # claude -p 必须在验证仓内运行（CLAUDE_PROJECT_DIR 决定状态根与写入目标）
}

# 独立会话建立主线（软单主线 §5.7；切换短语独立成句，避开 UPS 抱怨词表）
open_mainline() {
  claude -p '先弄那个 场景主线。请只用一句话确认收到，不要执行任何工具、不要写任何文件。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" >/dev/null 2>&1 || true
  grep -q '"type":"mainline.switch"' "$WORK/.dev-flow/events.jsonl" || {
    echo "[t7] 警告：主线建立会话未落账 mainline.switch（见 events.jsonl）" >&2
  }
}

# 断言事件落账（events.jsonl 含给定子串）
assert_events() {
  local pattern="$1" label="$2"
  grep -q "$pattern" "$WORK/.dev-flow/events.jsonl" || {
    echo "[t7] 失败：${label}——events.jsonl 缺「${pattern}」" >&2
    grep -o '"type":"[a-z.]*"' "$WORK/.dev-flow/events.jsonl" | sort | uniq -c >&2 || true
    exit 1
  }
}

# 场景执行包装：$1=场景名 $2=关键证据 grep 模式 $3=场景执行函数
run_with_retry() {
  local label="$1" key_pattern="$2" fn="$3" n=0
  while :; do
    n=$((n + 1))
    "$fn"
    if grep -q "$key_pattern" "$WORK/.dev-flow/events.jsonl" "$WORK/.dev-flow/state.json" 2>/dev/null; then
      return 0
    fi
    if [ "$n" -ge 3 ]; then
      echo "[t7] 失败：${label} 连续 3 次未产生关键证据（模型可能未真实执行，见上方输出）" >&2
      exit 1
    fi
    echo "[t7] 提示：${label} 第 ${n} 次未产生关键证据，重置重试"
  done
}

# 从 events 提取 done.claimed 的主线 id（自动提交 message 断言用；不依赖实现细节）
mainline_id_of_done() {
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
    let id = "";
    for (const l of lines) {
      try { const e = JSON.parse(l); if (e.type === "done.claimed") id = e.mainlineId; } catch {}
    }
    process.stdout.write(id);
  ' "$WORK/.dev-flow/events.jsonl"
}

# —— 场景 ①：完整流程 done 后选择性自动提交（用户未提交改动不被卷入）——
echo "[t7] 2/6 场景 ①：done 后 git log 出现只含主线文件的自动 commit"
scene1() {
  reset_work
  # 预置用户自己的未提交改动（不在事件里）：已跟踪修改 README.md + 未跟踪新增
  # user-note.md——自动提交绝不把它们卷进来（绝不 -am）
  echo "# 用户自己改了 README 首行（未提交）" > "$WORK/README.md"
  echo "user untracked note" > "$WORK/user-note.md"
  open_mainline
  set +e
  OUT="$(claude -p '请完成一个小任务：创建两个文件。① check.js 放在仓库根目录，内容恰好为 process.exit(0)（一行，验收脚本成功）；② src/app.js，内容为 hello。先按规则输出意图块，其中 verify 行只写 node check.js（不要加括号备注或说明，不要带路径前缀）。然后用 Write 工具真实写入这两个文件。写入后在仓库根目录运行 Bash 命令 node check.js（命令必须就是 node check.js，不要写成 node src/check.js 或加其他参数），确认它退出码为 0。最后调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t7-debug-1.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t7-out-1.txt
  [ "$RC" -eq 0 ] || {
    echo "[t7] 失败：场景 ① claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ①" '"type":"done.claimed"' scene1
echo "----- 场景 ① 模型输出 -----"
cat /tmp/t7-out-1.txt
echo "----- 场景 ① 输出结束 -----"
assert_events '"type":"verify.passed"' "场景 ① verify.passed 落账"
assert_events '"type":"done.claimed"' "场景 ① done.claimed 落账"
# —— git 实锤：自动提交存在、message 前缀 + 主线标识 + 自动提交尾注 ——
LATEST_MSG="$(git -C "$WORK" log -1 --format=%s)"
echo "最新提交 message：$LATEST_MSG"
[[ "$LATEST_MSG" == chore\(dev-flow\):* ]] || {
  echo "[t7] 失败：场景 ① 最新提交不是自动提交（缺固定前缀 chore(dev-flow): [）" >&2
  git -C "$WORK" log --oneline >&2
  exit 1
}
echo "$LATEST_MSG" | grep -q '自动提交' || {
  echo "[t7] 失败：场景 ① 自动提交 message 缺「自动提交」尾注" >&2
  exit 1
}
MLID="$(mainline_id_of_done)"
[ -n "$MLID" ] || {
  echo "[t7] 失败：场景 ① 未能从 events 提取主线 id" >&2
  exit 1
}
echo "$LATEST_MSG" | grep -Fq "[$MLID]" || {
  echo "[t7] 失败：场景 ① 自动提交 message 缺主线标识「[$MLID]」" >&2
  exit 1
}
# —— 选择性提交红线：HEAD 提交只含主线文件，用户改动不卷入 ——
HEAD_CHANGES="$(git -C "$WORK" show --name-status --format= HEAD)"
echo "HEAD 提交变更："
echo "$HEAD_CHANGES"
echo "$HEAD_CHANGES" | grep -q '^A	check.js$' || {
  echo "[t7] 失败：场景 ① HEAD 提交缺 check.js（主线文件）" >&2
  exit 1
}
echo "$HEAD_CHANGES" | grep -q '^A	src/app.js$' || {
  echo "[t7] 失败：场景 ① HEAD 提交缺 src/app.js（主线文件）" >&2
  exit 1
}
if echo "$HEAD_CHANGES" | grep -qE 'README|user-note'; then
  echo "[t7] 失败：场景 ① 用户改动被卷入自动提交（绝不 -am 被违反）" >&2
  exit 1
fi
# —— 用户改动原样留在工作区 ——
WORKTREE="$(git -C "$WORK" status --porcelain)"
echo "$WORKTREE" | grep -q '?? user-note.md' || {
  echo "[t7] 失败：场景 ① user-note.md 应仍为未跟踪（被卷走或已消失）" >&2
  echo "$WORKTREE" >&2
  exit 1
}
echo "$WORKTREE" | grep -q ' M README.md' || {
  echo "[t7] 失败：场景 ① README.md 用户修改应原样留在工作区" >&2
  echo "$WORKTREE" >&2
  exit 1
}
# 无 hook 输出格式回退（spike §4）
grep -q 'Hook JSON output had unrecognized' /tmp/t7-debug-1.jsonl && {
  echo "[t7] 失败：场景 ① debug 日志有 Hook JSON output had unrecognized（hook 输出格式回退）" >&2
  exit 1
}
echo "[t7] 场景 ① 通过：done 后自动 commit 只含主线文件、message 前缀带主线标识、用户改动未卷入"

# —— 场景 ②：autoCommit=false → done 照成、无提交、审计记录已关闭 ——
echo "[t7] 3/6 场景 ②：autoCommit=false → done 照成、不产生提交、审计落账"
scene2() {
  reset_work
  # 配置关闭（用户意图）：done 照成，但不产生自动提交，审计记录「已关闭」
  mkdir -p "$WORK/.dev-flow"
  echo '{"autoCommit": false}' > "$WORK/.dev-flow/config.json"
  open_mainline
  set +e
  OUT="$(claude -p '请完成一个小任务：创建两个文件。① check.js 放在仓库根目录，内容恰好为 process.exit(0)（一行，验收脚本成功）；② src/app.js，内容为 hello。先按规则输出意图块，其中 verify 行只写 node check.js（不要加括号备注或说明，不要带路径前缀）。然后用 Write 工具真实写入这两个文件。写入后在仓库根目录运行 Bash 命令 node check.js（命令必须就是 node check.js，不要写成 node src/check.js 或加其他参数），确认它退出码为 0。最后调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t7-debug-2.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t7-out-2.txt
  [ "$RC" -eq 0 ] || {
    echo "[t7] 失败：场景 ② claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ②" '"type":"done.claimed"' scene2
echo "----- 场景 ② 模型输出 -----"
cat /tmp/t7-out-2.txt
echo "----- 场景 ② 输出结束 -----"
assert_events '"type":"done.claimed"' "场景 ② done.claimed 落账（配置关闭不影响 done 成功）"
# 无任何新提交（只有 sandbox-reset 的 seed 初始提交）
COMMIT_COUNT="$(git -C "$WORK" rev-list --count HEAD)"
[ "$COMMIT_COUNT" -eq 1 ] || {
  echo "[t7] 失败：场景 ② autoCommit=false 仍产生了提交（rev-list count=$COMMIT_COUNT）" >&2
  git -C "$WORK" log --oneline >&2
  exit 1
}
# 审计落账：「自动提交已关闭」（配置关闭是用户意图，仍进证据链）
grep -q '自动提交已关闭' "$WORK/.dev-flow/events.jsonl" || {
  echo "[t7] 失败：场景 ② audit.warning 缺「自动提交已关闭」" >&2
  grep -o '"detail":"[^"]*"' "$WORK/.dev-flow/events.jsonl" | tail -3 >&2
  exit 1
}
echo "[t7] 场景 ② 通过：autoCommit=false 时 done 照成、无提交、审计记录已关闭"

echo "[t7] 4/6 落账证据汇总（.dev-flow/events.jsonl 事件类型计数）"
node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
const count = {};
for (const l of lines) {
  try { const e = JSON.parse(l); count[e.type] = (count[e.type] || 0) + 1; } catch {}
}
console.log(JSON.stringify(count, null, 2));
' "$WORK/.dev-flow/events.jsonl"

echo "[t7] 5/6 git log（自动提交实锤）"
git -C "$WORK" log --oneline

echo "[t7] 6/6 全部通过：两场景端到端验证完成"
echo ""
echo "[t7] 说明：每场景独立重置 sandbox，故末尾工作区 events 仅含最后一个场景；"
echo "      各场景断言已在场景内完成（见上方每个场景的通过行与模型输出）。"
