#!/usr/bin/env bash
# PreToolUse guard (Bash, git commit|push|merge): ask when an in-progress
# dev-flow feature (status.md still present) is not ready for git close-out.
#
# Ask when:
#   - check-ok is missing, stale, or wrong workflow_version (needs feature-check)
#   - status + completion both exist (verified-unfinalized / "not now"; assets
#     not finalized yet — finalizer removes status.md only on success)
#
# Allow silently when:
#   - not onboarded
#   - no in-progress feature (no status.md)
#   - status present, fresh stamp, no completion yet (post feature-check,
#     pre-final-asset generation)
#
# Guardrail, not a security boundary — see
# .claude/skills/dev-flow/references/protocol.md.
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
trimmed=$(printf '%s' "$command" | sed -e 's/^[[:space:]]*//')
case "$trimmed" in
  "git commit "*|"git commit") : ;;
  "git push "*|"git push") : ;;
  "git merge "*|"git merge") : ;;
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

# Resolve relative to this hook's own location (a sibling of skills/dev-flow/scripts/
# in the same copied .claude/ tree), not $root, so this works from any cwd.
hook_dir=$(cd "$(dirname "$0")" && pwd)
fingerprint_cmd="$hook_dir/../skills/dev-flow/scripts/dev-flow-fingerprint"
[ -x "$fingerprint_cmd" ] || exit 0

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

while IFS= read -r feature_dir; do
  [ -z "$feature_dir" ] && continue
  status_file="$feature_dir/status.md"
  completion_file="$feature_dir/completion.md"
  # status.md still present ⇒ not finalized. Finalizer is the only path that
  # removes it; presence of completion.md alone is not "done".
  [ -f "$status_file" ] || continue
  feature_id=$(basename "$feature_dir")

  stamp_file=".claude/runtime/dev-flow/$feature_id.check-ok"
  stamped_fingerprint=""
  stamped_version=""
  [ -f "$stamp_file" ] && stamped_fingerprint=$(sed -n 's/^fingerprint: //p' "$stamp_file")
  [ -f "$stamp_file" ] && stamped_version=$(sed -n 's/^workflow_version: //p' "$stamp_file")
  current_fingerprint=$("$fingerprint_cmd" "$feature_root" "$review_root" 2>/dev/null)
  expected_version=$(node "$hook_dir/../skills/dev-flow/scripts/dev-flow-policy.mjs" version 2>/dev/null)

  # v0.7 stamps lack workflow_version and are always stale under v0.8+.
  if [ -z "$stamped_fingerprint" ] || [ -z "$current_fingerprint" ] || [ "$stamped_fingerprint" != "$current_fingerprint" ] \
    || [ -z "$stamped_version" ] || [ -z "$expected_version" ] || [ "$stamped_version" != "$expected_version" ]; then
    emit_ask "dev-flow feature ${feature_id} 尚未通过 dev-flow-feature-check --finish（收尾戳记缺失、版本过期或已过期），建议先完成收尾验证再提交/推送/合并（护栏而非安全边界，见 dev-flow/references/protocol.md）。"
    exit 0
  fi

  # Fresh stamp but completion present ⇒ verified-unfinalized ("not now" or
  # waiting for compact/retain full). Guard must ask; do not treat check-ok as
  # finalization proof.
  if [ -f "$completion_file" ]; then
    emit_ask "dev-flow feature ${feature_id} 已验证但资产尚未 finalized（verified-unfinalized）。请运行 /finish 并精确回复 compact / retain full / not now 后再提交/推送/合并（护栏而非安全边界，见 dev-flow/references/protocol.md）。"
    exit 0
  fi
done < <(find "$feature_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)

exit 0
