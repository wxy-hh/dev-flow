#!/bin/bash
# T8 真机验证（status 只读查询工具，先 build 后验证——纪律：绝不把旧构建当真，
# 计划 §2.2/§6 T8 判据）
#
# 场景 ①（主判据）：真实会话跑通完整流程（意图块声明 verify → 写文件 → 跑 verify
#   → done）后，第二个真实会话调用 status 工具：输出含 活跃主线/验收/宣称 摘要
#   且 ≤500 字符（token 面收敛红线）；transcript 硬证据 = status 工具返回原文进
#   tool_result（模型可见通道），提取原文做断言，不依赖模型复述。
# 场景 ②：status 是只读——调用前后 events.jsonl / state.json 逐字节一致
#   （只读工具不写审计不改证据链；报警面 = 输出文本自身）。
#
# 主线建立：软单主线（§5.7）——与 T6 同款：独立 claude -p 发切换短语开主线。
# 每个场景独立重置 sandbox（events 干净起跑），可复跑。
# 模型行为吸收：Kimi 模型偶发"只输出描述文本不真实调用工具"，run_with_retry ≤3 次
# （关键证据 = transcript 里 status 工具返回原文）。
# 证据面：~/.claude/projects transcript（工具返回原文 = 硬证据）+ 文件快照 diff。
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

echo "[t8] 1/7 构建（先 build 后验证）"
cd "$ROOT"
npm run build

WORK="$ROOT/sandbox/work"
# 会话 settings 可被 DEV_FLOW_TEST_SETTINGS 覆盖（直连兜底：代理指向失效 provider 时，见 scripts/make-test-settings.sh）
SETTINGS="${DEV_FLOW_TEST_SETTINGS:-$ROOT/scripts/empty-settings.toml}"
PLUGIN="$ROOT/plugins/dev-flow"
ALLOWED="Write,Bash,Read,Glob,Grep,mcp__plugin_dev-flow_df__*"
# transcript 目录：按 cwd=sandbox/work 编码的会话存储（本机实测路径，与 T4 同款）
TRANSCRIPT_DIR="$HOME/.claude/projects/-Users-weixiaoyu-Desktop-practice-dev-flow-sandbox-work"

# —— 每场景独立重置：seed → work + 清状态/调试目录 ——
reset_work() {
  "$ROOT/scripts/sandbox-reset.sh" >/dev/null
  rm -rf "$WORK/.dev-flow" "$WORK/.dev-flow-debug"
  mkdir -p "$TRANSCRIPT_DIR"
  cd "$WORK" # claude -p 必须在验证仓内运行（CLAUDE_PROJECT_DIR 决定状态根与写入目标）
}

# 独立会话建立主线（软单主线 §5.7；切换短语独立成句，避开 UPS 抱怨词表）
open_mainline() {
  claude -p '先弄那个 场景主线。请只用一句话确认收到，不要执行任何工具、不要写任何文件。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" >/dev/null 2>&1 || true
  grep -q '"type":"mainline.switch"' "$WORK/.dev-flow/events.jsonl" || {
    echo "[t8] 警告：主线建立会话未落账 mainline.switch（见 events.jsonl）" >&2
  }
}

# 取本场景会话的 transcript（目录内最新 jsonl）
# 不用管道取首行：macOS BSD ls 输出多时 head 提前关读端 → ls 收 SIGPIPE → 命令替换退出码 141 → 脚本静默死（T4 实测）
latest_transcript() {
  local out
  out="$(ls -t "$TRANSCRIPT_DIR"/*.jsonl 2>/dev/null)" || out=""
  printf '%s' "${out%%$'\n'*}"
}

# 断言 status 工具返回原文进 transcript（结构感知扫描：tool_result 内容含给定
# 关键词），并把原文写到 /tmp/t8-status-text.txt 供断言。$1=必须包含的子串。
# content 兼容两种宿主形态：纯字符串 / text 块数组（collect 递归合并）。
status_in_transcript() {
  local key="$1" t text
  t="$(latest_transcript)"
  [ -n "$t" ] && [ -f "$t" ] || return 1
  text="$(node -e '
    const fs = require("fs");
    const [file, key] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const collect = (o) => {
      if (typeof o === "string") return o;
      if (Array.isArray(o)) return o.map(collect).join("");
      if (o && typeof o === "object") {
        if (o.type === "text" && typeof o.text === "string") return o.text;
      }
      return "";
    };
    let found = null;
    const scan = (o) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { for (const x of o) scan(x); return; }
      if (o.type === "tool_result") {
        const text = collect(o.content);
        if (text.includes(key)) { found = text; return; }
      }
      for (const v of Object.values(o)) scan(v);
    };
    for (const l of lines) {
      let e;
      try { e = JSON.parse(l); } catch { continue; }
      scan(e);
      if (found !== null) break;
    }
    if (found === null) process.exit(1);
    process.stdout.write(found);
  ' "$t" "$key" 2>/dev/null)" || return 1
  [ -n "$text" ] || return 1
  printf '%s' "$text" > /tmp/t8-status-text.txt
  return 0
}

# 场景执行包装：$1=场景名 $2=transcript 关键子串 $3=场景执行函数
run_with_retry() {
  local label="$1" key="$2" fn="$3" n=0
  while :; do
    n=$((n + 1))
    "$fn"
    if status_in_transcript "$key"; then
      return 0
    fi
    if [ "$n" -ge 3 ]; then
      echo "[t8] 失败：${label} 连续 3 次 transcript 未见 status 工具输出（模型未真实调用？）" >&2
      exit 1
    fi
    echo "[t8] 提示：${label} 第 ${n} 次未见 status 工具输出，重置重试"
  done
}

# —— 场景 ①：完整流程后 status 摘要含 主线/验收/宣称 且 ≤500 字符 ——
echo "[t8] 2/7 场景 ①：status 输出含主线/验收状态摘要且 ≤500 字符"
scene1() {
  reset_work
  open_mainline
  # 会话 A：真实跑通完整流程（意图块 → 写 check.js/src/app.js → node check.js → done），
  # 造出 活跃主线 + 最近验收 + 完成宣称 的状态面
  set +e
  claude -p '请完成一个小任务：创建两个文件。① check.js 放在仓库根目录，内容恰好为 process.exit(0)（一行，验收脚本成功）；② src/app.js，内容为 hello。先按规则输出意图块，其中 verify 行只写 node check.js（不要加括号备注或说明，不要带路径前缀）。然后用 Write 工具真实写入这两个文件。写入后在仓库根目录运行 Bash 命令 node check.js（命令必须就是 node check.js，不要写成 node src/check.js 或加其他参数），确认它退出码为 0。最后调用 MCP 工具 done（完整工具名 mcp__plugin_dev-flow_df__done，参数为空；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" >/dev/null 2>&1
  RC=$?
  set -e
  [ "$RC" -eq 0 ] || {
    echo "[t8] 失败：场景 ① 会话 A claude -p 退出码 ${RC}" >&2
    exit 1
  }
  # 会话 A 是否走完（verify + done）不在此硬判——run_with_retry 以 transcript 里
  # status 输出含「验收：通过」为关键证据，未走完则场景整体重置重试（吸收模型行为噪音）
  # 会话 B：真实调用 status 工具并报告
  set +e
  OUT="$(claude -p '请调用 MCP 工具 status（完整工具名 mcp__plugin_dev-flow_df__status；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。调用后把工具返回的内容完整报告出来。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "$ALLOWED" \
    --settings "$SETTINGS" 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t8-out-1.txt
  [ "$RC" -eq 0 ] || {
    echo "[t8] 失败：场景 ① 会话 B claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
# 关键子串 = 活跃主线 + 验收通过（会话 A 没走完则缺验收 → 场景整体重试）
run_with_retry "场景 ①" '验收：通过' scene1
echo "----- 场景 ① 会话 B 模型输出 -----"
cat /tmp/t8-out-1.txt
echo "----- 场景 ① 输出结束 -----"
STATUS_TEXT="$(cat /tmp/t8-status-text.txt)"
echo "----- 场景 ① status 工具返回原文（transcript 硬证据） -----"
echo "$STATUS_TEXT"
echo "----- 场景 ① 原文结束 -----"
echo "$STATUS_TEXT" | grep -q '活跃主线' || {
  echo "[t8] 失败：场景 ① status 输出缺 活跃主线 摘要" >&2
  exit 1
}
echo "$STATUS_TEXT" | grep -q '验收：通过' || {
  echo "[t8] 失败：场景 ① status 输出缺 验收 摘要" >&2
  exit 1
}
echo "$STATUS_TEXT" | grep -q '宣称' || {
  echo "[t8] 失败：场景 ① status 输出缺 完成宣称 摘要" >&2
  exit 1
}
LEN="${#STATUS_TEXT}"
[ "$LEN" -le 500 ] || {
  echo "[t8] 失败：场景 ① status 输出超 500 字符（实际 $LEN）——token 面收敛红线被破" >&2
  exit 1
}
echo "[t8] 场景 ① 通过：status 输出含主线/验收/宣称摘要，${LEN} 字符 ≤500"

# —— 场景 ②：status 只读——调用前后证据链除会话自身 session.start 外零增改 ——
echo "[t8] 3/7 场景 ②：status 是只读（不改 events / state）"
scene2() {
  reset_work
  open_mainline # 建立主线状态（mainline.switch 落账 + state 折叠）
  cp "$WORK/.dev-flow/events.jsonl" /tmp/t8-events-before.jsonl
  cp "$WORK/.dev-flow/state.json" /tmp/t8-state-before.json
  # 会话 B：真实调用 status（allowedTools 不含 Write/Bash，会话本身也写不了文件）
  set +e
  OUT="$(claude -p '请调用 MCP 工具 status（完整工具名 mcp__plugin_dev-flow_df__status；如果工具列表里没看到它，请用工具搜索 ToolSearch 查找后再调用）。调用后把工具返回的内容完整报告出来。必须真实调用工具，不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep,mcp__plugin_dev-flow_df__*" \
    --settings "$SETTINGS" 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t8-out-2.txt
  [ "$RC" -eq 0 ] || {
    echo "[t8] 失败：场景 ② claude -p 退出码 ${RC}（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ②" '活跃主线' scene2
echo "----- 场景 ② 模型输出 -----"
cat /tmp/t8-out-2.txt
echo "----- 场景 ② 输出结束 -----"
# events 断言：append-only 前缀保持 + 新增行只能是 session.start（会话自身
# SessionStart hook 的记账，与 status 工具无关——status 是只读，不得产生任何
# 业务/审计事件）；state.json 必须逐字节一致（SessionStart 不写 state）。
node -e '
  const fs = require("fs");
  const before = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
  const after = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean);
  if (after.length < before.length) process.exit(2);
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) process.exit(3);
  }
  for (let i = before.length; i < after.length; i++) {
    let e;
    try { e = JSON.parse(after[i]); } catch { process.exit(4); }
    if (e.type !== "session.start") process.exit(5);
  }
' /tmp/t8-events-before.jsonl "$WORK/.dev-flow/events.jsonl"
RC=$?
if [ "$RC" -eq 2 ]; then
  echo "[t8] 失败：场景 ② events.jsonl 有行被删除（append-only 被破坏）" >&2
  exit 1
elif [ "$RC" -eq 3 ]; then
  echo "[t8] 失败：场景 ② events.jsonl 中间行被改写" >&2
  exit 1
elif [ "$RC" -eq 5 ]; then
  echo "[t8] 失败：场景 ② status 调用后 events 新增了业务/审计事件（status 不该写证据链）" >&2
  exit 1
elif [ "$RC" -ne 0 ]; then
  echo "[t8] 失败：场景 ② events.jsonl 新增行解析失败" >&2
  exit 1
fi
diff -q /tmp/t8-state-before.json "$WORK/.dev-flow/state.json" >/dev/null || {
  echo "[t8] 失败：场景 ② status 调用后 state.json 被改动（status 不该写状态）" >&2
  diff /tmp/t8-state-before.json "$WORK/.dev-flow/state.json" >&2 || true
  exit 1
}
echo "[t8] 场景 ② 通过：status 调用前后 events 仅新增会话自身 session.start、state.json 逐字节一致（只读）"

echo "[t8] 4/7 落账证据汇总（.dev-flow/events.jsonl 事件类型计数）"
node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
const count = {};
for (const l of lines) {
  try { const e = JSON.parse(l); count[e.type] = (count[e.type] || 0) + 1; } catch {}
}
console.log(JSON.stringify(count, null, 2));
' "$WORK/.dev-flow/events.jsonl"

echo "[t8] 5/7 status 工具输出原文（最后一个场景）"
cat /tmp/t8-status-text.txt

echo "[t8] 6/7 场景 ① status 输出长度核对"
printf 'status 输出字符数：%s（上限 500）\n' "${#STATUS_TEXT}"

echo "[t8] 7/7 全部通过：两场景端到端验证完成"
echo ""
echo "[t8] 说明：每场景独立重置 sandbox，故末尾工作区 events 仅含最后一个场景；"
echo "      各场景断言已在场景内完成（见上方每个场景的通过行与模型输出）。"
