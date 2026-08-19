#!/bin/bash
# T5 真机验证（三通道，先 build 后验证——纪律：绝不把旧构建当真，计划 §2.2）
#
# 场景 ① 逃生门（§5.5）："急，直接改" → escape.used 落账（记用户原话截断）
#         + 注入"已放行并记账" → 后续写入被 T4 消费端放行，文件真实落盘
# 场景 ② 主线切换（§5.7）："先弄那个 登录问题" → mainline.switch（ml-1，名=登录问题）
#         → "先弄那个 性能优化" → 切到 ml-2（ml-1 挂起保留）
#         → 新会话 SessionStart 播报侧认出新主线「性能优化」
# 场景 ③ 用户通道完成确认（§6.3 两跳）："好了" → 注入"请展示待完成摘要并确认"
#         → "确认" → 注入"请执行验收并调 done 工具"；hook 不翻转状态
#         （断言无 done.claimed 事件、pendingDoneConfirm 置位→清空）
#
# 每个场景独立重置 sandbox（events 干净起跑），可复跑。
# 模型行为吸收：Kimi 模型（§8.5 个体差异）偶发"只输出描述文本不真实调用工具"，
# 脚本按"关键证据缺失"自动重置重试该场景（≤3 次），保证机制验证不被行为噪音干扰。
# 证据面：.dev-flow/events.jsonl + .dev-flow/state.json（落账/状态断言）+
# .dev-flow-debug/user-prompt-submit.log（注入文本——注入正确的确定性证据）+
# 模型输出摘录（模型感知注入的行为证据，宽松断言）。
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

echo "[t5] 1/5 构建（先 build 后验证）"
cd "$ROOT"
npm run build

WORK="$ROOT/sandbox/work"
# 会话 settings 可被 DEV_FLOW_TEST_SETTINGS 覆盖（直连兜底：代理指向失效 provider 时，见 scripts/make-test-settings.sh）
SETTINGS="${DEV_FLOW_TEST_SETTINGS:-$ROOT/scripts/empty-settings.toml}"
PLUGIN="$ROOT/plugins/dev-flow"

# —— 每场景独立重置：seed → work + 清状态目录 ——
reset_work() {
  "$ROOT/scripts/sandbox-reset.sh"
  rm -rf "$WORK/.dev-flow" "$WORK/.dev-flow-debug"
  cd "$WORK" # claude -p 必须在验证仓内运行（CLAUDE_PROJECT_DIR 决定状态根与写入目标）
}

# 断言事件落账（events.jsonl 含给定子串）
assert_events() {
  local pattern="$1" label="$2"
  grep -q "$pattern" "$WORK/.dev-flow/events.jsonl" || {
    echo "[t5] 失败：${label}——events.jsonl 缺「${pattern}」" >&2
    exit 1
  }
}

# 断言注入文本（user-prompt-submit.log 的注入记录，注入正确的确定性证据）
assert_injection() {
  local log="$WORK/.dev-flow-debug/user-prompt-submit.log" pattern="$1" label="$2"
  [ -f "$log" ] || {
    echo "[t5] 失败：${label}——user-prompt-submit.log 不存在（UPS hook 未触发？）" >&2
    exit 1
  }
  grep -q "$pattern" "$log" || {
    echo "[t5] 失败：${label}——注入日志缺「${pattern}」" >&2
    exit 1
  }
}

# 场景执行包装：$1=场景名 $2=关键证据 grep 模式 $3=场景执行函数（函数内负责 reset+claude+保存输出）
run_with_retry() {
  local label="$1" key_pattern="$2" fn="$3" n=0
  while :; do
    n=$((n + 1))
    "$fn"
    if grep -q "$key_pattern" "$WORK/.dev-flow/events.jsonl" "$WORK/.dev-flow/state.json" "$WORK/.dev-flow-debug/user-prompt-submit.log" 2>/dev/null; then
      return 0
    fi
    if [ "$n" -ge 3 ]; then
      echo "[t5] 失败：${label} 连续 3 次未产生关键证据（模型可能未真实执行，见上方输出）" >&2
      exit 1
    fi
    echo "[t5] 提示：${label} 第 ${n} 次未产生关键证据，重置重试"
  done
}

echo "[t5] 2/5 场景 ①：逃生门（"急，直接改" → escape.used + 放行写入）"
scene1() {
  reset_work
  set +e
  OUT="$(claude -p '急，直接改。请把 src/hello.txt 的内容写成 escape-ok：直接实际调用 Write 工具（file_path="src/hello.txt"，content="escape-ok"），必须真实调用工具、不要只输出描述性文本。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Write,Bash,Read,Glob,Grep" \
    --settings "$SETTINGS" \
    --debug-file /tmp/t5-debug-1.jsonl 2>&1)"
  RC=$?
  set -e
  echo "$OUT" > /tmp/t5-out-1.txt
  [ "$RC" -eq 0 ] || {
    echo "[t5] 失败：场景 ① claude -p 退出码 $RC（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ①" '"type":"escape.used"' scene1
echo "----- 场景 ① 模型输出 -----"
cat /tmp/t5-out-1.txt
echo "----- 场景 ① 输出结束 -----"
assert_events '"type":"escape.used"' "场景 ① escape.used 落账"
# 记账内容 = 用户原话（红线截断 500；escape.used.quote）
assert_events '"quote":"急，直接改' "场景 ① escape.used 记用户原话"
# 注入正确：逃生门语义（已放行并记账）
assert_injection '逃生门' "场景 ① 注入含逃生门语义"
# 放行写入：escape.used 未消费 → T4 消费端放行（write.allowed + 文件真实落盘）
assert_events '"type":"write.allowed"' "场景 ① 写入放行"
[ -f "$WORK/src/hello.txt" ] && grep -q 'escape-ok' "$WORK/src/hello.txt" || {
  echo "[t5] 失败：场景 ① src/hello.txt 未写入或内容不对（逃生门放行未生效？）" >&2
  exit 1
}
grep -q '"type":"write.blocked"' "$WORK/.dev-flow/events.jsonl" && {
  echo "[t5] 警告：场景 ① 出现 write.blocked（逃生门应放行首次写入）" >&2
}
grep -q 'Hook JSON output had unrecognized' /tmp/t5-debug-1.jsonl && {
  echo "[t5] 失败：场景 ① debug 日志有 Hook JSON output had unrecognized（hook 输出格式回退）" >&2
  exit 1
}
echo "[t5] 场景 ① 通过：escape.used 落账、注入逃生门语义、写入放行落盘"

echo "[t5] 3/5 场景 ②：主线切换（先弄那个 → mainline.switch + 播报侧认新主线）"
scene2() {
  reset_work
  set +e
  # 提示词结构：先交代"只确认不执行"（防模型被注入后试图写文件打转），
  # 切换短语放句尾（主线名提取 = '先弄那个' 之后的余部）
  OUT2A="$(claude -p '这是主线切换指令，请只确认收到，不要执行任何工具、不要写任何文件。先弄那个 登录问题。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" 2>&1)"
  RC2A=$?
  set -e
  echo "$OUT2A" > /tmp/t5-out-2a.txt
  [ "$RC2A" -eq 0 ] || {
    echo "[t5] 失败：场景 ② 第一步 claude -p 退出码 $RC2A（见上方输出）" >&2
    exit 1
  }
  set +e
  OUT2B="$(claude -p '这是主线切换指令，请只确认收到，不要执行任何工具、不要写任何文件。先弄那个 性能优化。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" 2>&1)"
  RC2B=$?
  set -e
  echo "$OUT2B" > /tmp/t5-out-2b.txt
  [ "$RC2B" -eq 0 ] || {
    echo "[t5] 失败：场景 ② 第二步 claude -p 退出码 $RC2B（见上方输出）" >&2
    exit 1
  }
  # 播报侧验证：新会话恢复时 SessionStart 播报活跃主线「性能优化」
  set +e
  OUT2C="$(claude -p '继续' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" 2>&1)"
  RC2C=$?
  set -e
  echo "$OUT2C" > /tmp/t5-out-2c.txt
  [ "$RC2C" -eq 0 ] || {
    echo "[t5] 失败：场景 ② 第三步 claude -p 退出码 $RC2C（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ②" '"activeMainlineId": "ml-2"' scene2
echo "----- 场景 ② 第一步（先弄那个 登录问题）模型输出 -----"
cat /tmp/t5-out-2a.txt
echo "----- 场景 ② 第一步输出结束 -----"
echo "----- 场景 ② 第二步（先弄那个 性能优化）模型输出 -----"
cat /tmp/t5-out-2b.txt
echo "----- 场景 ② 第二步输出结束 -----"
echo "----- 场景 ② 第三步（恢复会话）模型输出 -----"
cat /tmp/t5-out-2c.txt
echo "----- 场景 ② 第三步输出结束 -----"
# 两次主线切换落账（from/to/name）
grep -c '"type":"mainline.switch"' "$WORK/.dev-flow/events.jsonl" | grep -qx '2' || {
  echo "[t5] 失败：场景 ② 应落账 2 条 mainline.switch" >&2
  grep '"type":"mainline.switch"' "$WORK/.dev-flow/events.jsonl" >&2 || true
  exit 1
}
# 事件形状：第一次切换 name=登录问题、第二次 from=ml-1 to=ml-2
grep -q '"name":"登录问题"' "$WORK/.dev-flow/events.jsonl" || {
  echo "[t5] 失败：场景 ② 第一次 mainline.switch 缺 name=登录问题（主线名提取失败）" >&2
  exit 1
}
grep -q '"from":"ml-1","to":"ml-2"' "$WORK/.dev-flow/events.jsonl" || {
  echo "[t5] 失败：场景 ② 第二次 mainline.switch 缺 from=ml-1 to=ml-2" >&2
  exit 1
}
# 状态面：活跃主线 ml-2、ml-1 挂起保留、主线名正确（播报侧数据源）
grep -q '"activeMainlineId": "ml-2"' "$WORK/.dev-flow/state.json" || {
  echo "[t5] 失败：场景 ② state 活跃主线不是 ml-2" >&2
  exit 1
}
grep -q '"name": "性能优化"' "$WORK/.dev-flow/state.json" || {
  echo "[t5] 失败：场景 ② state 缺新主线名「性能优化」" >&2
  exit 1
}
grep -q '"name": "登录问题"' "$WORK/.dev-flow/state.json" || {
  echo "[t5] 失败：场景 ② state 缺挂起主线名「登录问题」（状态保留）" >&2
  exit 1
}
# 播报侧认出新主线：新会话 SessionStart 播报含「性能优化」
grep '性能优化' "$WORK/.dev-flow-debug/session-start.log" | tail -1 | grep -q '在做「性能优化」' || {
  echo "[t5] 失败：场景 ② 恢复播报未认出新主线「性能优化」（见 session-start.log）" >&2
  grep 'session-start' "$WORK/.dev-flow-debug/session-start.log" | tail -2 >&2 || true
  exit 1
}
# 注入正确：第二次切换注入含新主线名
assert_injection '切换主线到「性能优化」' "场景 ② 切换注入含新主线名"
echo "[t5] 场景 ② 通过：两次切换落账、ml-1 挂起保留、播报侧认出新主线「性能优化」"

echo "[t5] 4/5 场景 ③：用户通道完成确认（两跳：好了 → 摘要确认；确认 → 验收 done）"
scene3() {
  reset_work
  set +e
  # 先做一点真实工作（写出真实摘要的素材；写入结果不参与断言）
  OUT3A="$(claude -p '请创建一个文件 src/note.txt，内容为 hello。先按规则输出意图块声明，然后实际调用 Write 工具写入。' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Write,Bash,Read,Glob,Grep" \
    --settings "$SETTINGS" 2>&1)"
  RC3A=$?
  set -e
  echo "$OUT3A" > /tmp/t5-out-3a.txt
  [ "$RC3A" -eq 0 ] || {
    echo "[t5] 失败：场景 ③ 第一步 claude -p 退出码 $RC3A（见上方输出）" >&2
    exit 1
  }
  set +e
  OUT3B="$(claude -p --continue '好了' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" 2>&1)"
  RC3B=$?
  set -e
  echo "$OUT3B" > /tmp/t5-out-3b.txt
  [ "$RC3B" -eq 0 ] || {
    echo "[t5] 失败：场景 ③ 第二跳 claude -p 退出码 $RC3B（见上方输出）" >&2
    exit 1
  }
  set +e
  OUT3C="$(claude -p --continue '确认' \
    --plugin-dir "$PLUGIN" \
    --allowedTools "Read,Glob,Grep" \
    --settings "$SETTINGS" 2>&1)"
  RC3C=$?
  set -e
  echo "$OUT3C" > /tmp/t5-out-3c.txt
  [ "$RC3C" -eq 0 ] || {
    echo "[t5] 失败：场景 ③ 第三跳 claude -p 退出码 $RC3C（见上方输出）" >&2
    exit 1
  }
}
run_with_retry "场景 ③" '"action":"doneHop2"' scene3
echo "----- 场景 ③ 第一步（创建工作）模型输出 -----"
cat /tmp/t5-out-3a.txt
echo "----- 场景 ③ 第一步输出结束 -----"
echo "----- 场景 ③ 第二跳（好了）模型输出 -----"
cat /tmp/t5-out-3b.txt
echo "----- 场景 ③ 第二跳输出结束 -----"
echo "----- 场景 ③ 第三跳（确认）模型输出 -----"
cat /tmp/t5-out-3c.txt
echo "----- 场景 ③ 第三跳输出结束 -----"
# 第一跳注入：请展示待完成摘要并向用户确认
assert_injection '"action":"doneHop1"' "场景 ③ 第一跳触发"
assert_injection '待完成摘要' "场景 ③ 第一跳注入摘要确认语义"
# 第二跳注入：请执行验收并调 done 工具
assert_injection '"action":"doneHop2"' "场景 ③ 第二跳触发"
assert_injection '调用 done 工具' "场景 ③ 第二跳注入验收 done 语义"
# 第二跳后中间态清空（一次确认即完成，防重复触发）
grep -q '"pendingDoneConfirm": null' "$WORK/.dev-flow/state.json" || {
  echo "[t5] 失败：场景 ③ 第二跳后 pendingDoneConfirm 未清空（见 state.json）" >&2
  exit 1
}
# hook 不翻转状态（attestation §6.3）：无 done.claimed 事件
grep -q '"type":"done.claimed"' "$WORK/.dev-flow/events.jsonl" && {
  echo "[t5] 失败：场景 ③ hook 直接写了 done.claimed（违反 attestation——状态翻转只走 done 咽喉）" >&2
  exit 1
}
# 模型感知（宽松断言，行为面）：第一跳后模型展示摘要/询问确认
grep -qE '摘要|确认|完成' /tmp/t5-out-3b.txt || {
  echo "[t5] 警告：场景 ③ 第二跳模型输出未体现摘要/确认语义（模型行为面，机制面已由注入日志证明）"
}
echo "[t5] 场景 ③ 通过：两跳注入正确、中间态置位→清空、hook 未翻转状态"

echo "[t5] 5/5 全部通过：三通道端到端验证完成"
echo ""
echo "[t5] 说明：每场景独立重置 sandbox，故末尾工作区的 events 仅含最后一个场景；"
echo "      各场景的事件断言已在场景内完成（见上方每个场景的通过行与模型输出）。"
