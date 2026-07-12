#!/usr/bin/env bash
# PreToolUse guard (Edit|Write|MultiEdit|NotebookEdit): ask before touching
# business files while a dev-flow feature's implementation_approval gate is
# still required and pending. Guardrail, not a security boundary — see
# .claude/skills/dev-flow/references/protocol.md.
#
# Not onboarded (no project-workflow.md), no in-progress feature, or the
# target path sits inside a workflow-owned directory: allow silently (no
# stdout) so XS/S work stays frictionless.
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

target=$(json_get tool_input.file_path)
[ -z "$target" ] && target=$(json_get tool_input.notebook_path)
[ -z "$target" ] && exit 0

# Canonicalize target's directory (resolve symlinks, e.g. macOS /tmp -> /private/tmp)
# so the prefix match below lines up with git's already-resolved $root.
target_dir=$(cd "$(dirname "$target")" 2>/dev/null && pwd -P) || exit 0
target="$target_dir/$(basename "$target")"

case "$target" in
  "$root"/*) relative=${target#"$root"/} ;;
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

case "$relative" in
  .claude/*|"$feature_root"/*|"$review_root"/*|docs/*|openspec/*) exit 0 ;;
esac

gate_field() {
  awk -v field="$2" '
    $0 == "    implementation_approval:" { in_gate=1; next }
    in_gate && $0 ~ /^    [^ ]/ { in_gate=0 }
    in_gate && $0 ~ "^      " field ":" {
      value=$0
      sub(/^[^:]*:[[:space:]]*/, "", value)
      gsub(/^"|"$/, "", value)
      print value
      exit
    }
  ' "$1"
}

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

while IFS= read -r status_file; do
  [ -z "$status_file" ] && continue
  required=$(gate_field "$status_file" required)
  status=$(gate_field "$status_file" status)
  if [ "$required" = "true" ] && [ "$status" = "pending" ]; then
    feature_id=$(sed -n 's/^  feature_id: "\(.*\)"$/\1/p' "$status_file")
    emit_ask "dev-flow feature ${feature_id:-unknown} 的 implementation_approval 门禁仍待用户确认，业务文件改动需要先经过确认（护栏而非安全边界，见 dev-flow/references/protocol.md）。"
    exit 0
  fi
done < <(find "$feature_root" -mindepth 2 -maxdepth 2 -name status.md 2>/dev/null)

exit 0
