#!/usr/bin/env bash
# PreToolUse guard (Bash, git commit|push|merge): ask when an in-progress
# dev-flow feature (status.md exists, no completion.md yet) hasn't passed
# dev-flow-feature-check --finish against the current business diff.
# Guardrail, not a security boundary — see
# .claude/skills/dev-flow/references/protocol.md.
#
# Not onboarded, no in-progress feature, or a fresh check-ok stamp: allow
# silently (no stdout).
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
  [ -f "$status_file" ] || continue
  [ -f "$completion_file" ] && continue
  feature_id=$(basename "$feature_dir")

  stamp_file=".claude/runtime/dev-flow/$feature_id.check-ok"
  stamped_fingerprint=""
  [ -f "$stamp_file" ] && stamped_fingerprint=$(sed -n 's/^fingerprint: //p' "$stamp_file")
  current_fingerprint=$("$fingerprint_cmd" "$feature_root" "$review_root" 2>/dev/null)

  if [ -z "$stamped_fingerprint" ] || [ -z "$current_fingerprint" ] || [ "$stamped_fingerprint" != "$current_fingerprint" ]; then
    emit_ask "dev-flow feature ${feature_id} 尚未通过 dev-flow-feature-check --finish（收尾戳记缺失或已过期），建议先完成收尾验证再提交/推送/合并（护栏而非安全边界，见 dev-flow/references/protocol.md）。"
    exit 0
  fi
done < <(find "$feature_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)

exit 0
