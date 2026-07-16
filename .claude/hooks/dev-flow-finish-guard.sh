#!/usr/bin/env bash
# PreToolUse guard (Bash git add|commit|push|merge): ask when an active
# dev-flow feature is not logic-complete.
#
# logic-complete (Git allowed without finalizer):
#   - fresh check-ok (workflow_version + fingerprint)
#   - feature.md + completion.md present
#   - completion outcome/fingerprint align with stamp when present
#   - status.md may still exist (not now / pre-compact)
#
# Finalized (no status.md): final assets must still pass the historical
# finalized validator before Git is allowed.
# Guardrail, not a security boundary — see protocol.md.
set -u

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

payload=$(cat)

json_get() {
  node -e '
    let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try {
        const obj = JSON.parse(d);
        let cur = obj;
        for (const key of process.argv[1].split(".")) {
          if (cur == null) break;
          cur = cur[key];
        }
        if (cur != null) process.stdout.write(String(cur));
      } catch (e) {}
    });
  ' "$1" <<<"$payload" 2>/dev/null
}

command=$(json_get tool_input.command)
[ -z "$command" ] && exit 0
trimmed=$(printf '%s' "$command" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

has_shell_control=0
case "$trimmed" in
  *$'\n'*|*$'\r'*|*'>'*|*'<'*|*'$('*|*'`'*|*'&'*|*'|'*|*';'*) has_shell_control=1 ;;
esac

first_word=${trimmed%%[[:space:]]*}
remainder=${trimmed#"$first_word"}
remainder=$(printf '%s' "$remainder" | sed -e 's/^[[:space:]]*//')
second_word=${remainder%%[[:space:]]*}
[ "$first_word" = git ] || exit 0
case "$second_word" in
  add|commit|push|merge) : ;;
  *) exit 0 ;;
esac

workflow_file=.claude/rules/project-workflow.md
[ -f "$workflow_file" ] || exit 0

config_value() {
  awk -v key="$1" '$0 ~ "^[[:space:]]*" key ":" { value=$0; sub("^[^:]*:[[:space:]]*", "", value); gsub(/^"|"$/, "", value); print value; exit }' "$workflow_file"
}
feature_root=$(config_value feature_root)
review_root=$(config_value review_root)
[ -z "$feature_root" ] && exit 0
[ -d "$feature_root" ] || exit 0

hook_dir=$(cd "$(dirname "$0")" && pwd)
fingerprint_cmd="$hook_dir/../skills/dev-flow/scripts/dev-flow-fingerprint"
[ -x "$fingerprint_cmd" ] || exit 0
validator="$hook_dir/../skills/dev-flow/scripts/dev-flow-validate.mjs"
[ -f "$validator" ] || exit 0

emit_ask() {
  node -e '
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: process.argv[1]
      }
    }));
  ' "$1"
}

if [ "$has_shell_control" = 1 ]; then
  emit_ask "dev-flow Git 收尾命令必须单独执行；禁止拼接、管道、重定向、后台执行或命令替换。"
  exit 0
fi

auth_file=.claude/runtime/dev-flow/write-authorization.json
auth_feature=""
if [ -f "$auth_file" ]; then
  auth_feature=$(node -e '
    try {
      const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (a && a.feature_id) process.stdout.write(String(a.feature_id));
    } catch (e) {}
  ' "$auth_file" 2>/dev/null)
fi

check_feature() {
  local feature_dir=$1
  local feature_id
  feature_id=$(basename "$feature_dir")
  local status_file="$feature_dir/status.md"
  local completion_file="$feature_dir/completion.md"
  local feature_file="$feature_dir/feature.md"
  local stamp_file=".claude/runtime/dev-flow/$feature_id.check-ok"

  # Finalized: no active status, but historical final assets must still be
  # valid. Merely deleting status.md must never unlock Git.
  if [ ! -f "$status_file" ]; then
    if ! node "$validator" feature "$root" "$feature_id" --stage finalized >/dev/null 2>&1; then
      emit_ask "dev-flow feature ${feature_id} 无 active status，但 finalized 资产校验失败。请恢复/修复 feature.md、completion.md 后重试。"
      exit 0
    fi
    return 0
  fi

  local stamped_fingerprint="" stamped_version="" stamped_outcome=""
  [ -f "$stamp_file" ] && stamped_fingerprint=$(sed -n 's/^fingerprint: //p' "$stamp_file")
  [ -f "$stamp_file" ] && stamped_version=$(sed -n 's/^workflow_version: //p' "$stamp_file")
  [ -f "$stamp_file" ] && stamped_outcome=$(sed -n 's/^outcome: //p' "$stamp_file")
  local current_fingerprint
  current_fingerprint=$("$fingerprint_cmd" "$feature_root" "$review_root" 2>/dev/null)
  local expected_version
  expected_version=$(node "$hook_dir/../skills/dev-flow/scripts/dev-flow-policy.mjs" version 2>/dev/null)

  if [ -z "$stamped_fingerprint" ] || [ -z "$current_fingerprint" ] || [ "$stamped_fingerprint" != "$current_fingerprint" ] \
    || [ -z "$stamped_version" ] || [ -z "$expected_version" ] || [ "$stamped_version" != "$expected_version" ]; then
    emit_ask "dev-flow feature ${feature_id} 尚未 logic-complete（check-ok 缺失、版本不匹配或 fingerprint 已漂移）。同 feature 可重跑 complete-verification → feature-check --finish → 更新 completion，无需新 feature id。"
    exit 0
  fi

  if [ ! -f "$feature_file" ] || [ ! -f "$completion_file" ]; then
    emit_ask "dev-flow feature ${feature_id} 缺少 feature.md/completion.md（logic-complete 要求最终资产已生成；compact/full 可选且不阻塞 Git）。"
    exit 0
  fi

  if ! node "$validator" feature "$root" "$feature_id" --stage active >/dev/null 2>&1; then
    emit_ask "dev-flow feature ${feature_id} 当前 status 未通过 finish-stage 校验；请按 validator 输出补齐后重新运行 feature-check。"
    exit 0
  fi
  if ! node "$validator" final-assets "$root" "$feature_file" "$completion_file" --status "$status_file" >/dev/null 2>&1; then
    emit_ask "dev-flow feature ${feature_id} 的 feature.md/completion.md 未通过 final-assets 校验。"
    exit 0
  fi

  local completion_fp completion_outcome completion_ver
  completion_fp=$(sed -n 's/^  business_diff_fingerprint: "*\([^"]*\)"*/\1/p' "$completion_file" | head -1)
  completion_outcome=$(sed -n 's/^  outcome: "*\([^"]*\)"*/\1/p' "$completion_file" | head -1)
  completion_ver=$(sed -n 's/^  workflow_version: "*\([^"]*\)"*/\1/p' "$completion_file" | head -1)

  if [ -z "$completion_fp" ] || [ "$completion_fp" != "$stamped_fingerprint" ]; then
    emit_ask "dev-flow feature ${feature_id} completion fingerprint 与 check-ok 不一致。请更新 completion 后重跑 feature-check。"
    exit 0
  fi
  if [ -z "$completion_outcome" ] || [ -z "$stamped_outcome" ] || [ "$completion_outcome" != "$stamped_outcome" ]; then
    emit_ask "dev-flow feature ${feature_id} completion outcome 与 check-ok 不一致（OUTCOME_MISMATCH）。"
    exit 0
  fi
  if [ -z "$completion_ver" ] || [ "$completion_ver" != "$expected_version" ]; then
    emit_ask "dev-flow feature ${feature_id} completion workflow_version 不匹配（WORKFLOW_VERSION_MISMATCH）。"
    exit 0
  fi

  # logic-complete: Git allowed even if status remains (not now / pre-compact).
  return 0
}

checked_auth_feature=""
if [ -n "$auth_feature" ] && [ -d "$feature_root/$auth_feature" ]; then
  check_feature "$feature_root/$auth_feature"
  checked_auth_feature=$auth_feature
fi

while IFS= read -r feature_dir; do
  [ -z "$feature_dir" ] && continue
  [ -f "$feature_dir/status.md" ] || continue
  [ "$(basename "$feature_dir")" = "$checked_auth_feature" ] && continue
  check_feature "$feature_dir"
done < <(find "$feature_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)

exit 0
