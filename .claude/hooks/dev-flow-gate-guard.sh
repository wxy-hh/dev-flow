#!/usr/bin/env bash
# PreToolUse guard (Edit|Write|MultiEdit|NotebookEdit) for protected business writes.
#
# Model A: default allow; only paths matching protected_write_roots are gated.
# Process-owned paths (.claude/**, feature_root/**, review_root/**, openspec/**)
# are always allowed. Authorization comes from a single worktree file:
#   .claude/runtime/dev-flow/write-authorization.json
#
# Guardrail, not a security boundary — see dev-flow/references/protocol.md.
# Bash write interception is intentionally out of scope for v0.7.
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
target_dir=$(cd "$(dirname "$target")" 2>/dev/null && pwd -P) || exit 0
target="$target_dir/$(basename "$target")"

case "$target" in
  "$root"/*) relative=${target#"$root"/} ;;
  *) exit 0 ;;
esac

workflow_file=.claude/rules/project-workflow.md
# Not onboarded: silent allow (matches prior behavior).
[ -f "$workflow_file" ] || exit 0

config_value() {
  awk -v key="$1" '$0 ~ "^[[:space:]]*" key ":" { value=$0; sub("^[^:]*:[[:space:]]*", "", value); gsub(/^"|"$/, "", value); print value; exit }' "$workflow_file"
}

feature_root=$(config_value feature_root)
review_root=$(config_value review_root)
enforcement_mode=$(config_value enforcement_mode)
[ -z "$enforcement_mode" ] && enforcement_mode=off

# Always-allow process whitelist.
case "$relative" in
  .claude/*|openspec/*) exit 0 ;;
esac
if [ -n "$feature_root" ]; then
  case "$relative" in
    "$feature_root"/*|"$feature_root") exit 0 ;;
  esac
fi
if [ -n "$review_root" ]; then
  case "$relative" in
    "$review_root"/*|"$review_root") exit 0 ;;
  esac
fi

# off: never gate.
if [ "$enforcement_mode" = off ] || [ "$enforcement_mode" = none ]; then
  exit 0
fi

# Load protected_write_roots (block list of globs). Empty => never gate (but
# strict + empty is a doctor preflight failure, not a runtime deny-all).
protected_roots=$(
  awk '
    /^[[:space:]]*protected_write_roots:[[:space:]]*$/ { in_block=1; next }
    in_block && /^[[:space:]]*-[[:space:]]+/ {
      line=$0
      sub(/^[[:space:]]*-[[:space:]]+/, "", line)
      gsub(/^"|"$/, "", line)
      gsub(/^'\''|'\''$/, "", line)
      print line
      next
    }
    in_block && /^[[:space:]]*[a-z_]+:/ { exit }
    /^[[:space:]]*protected_write_roots:[[:space:]]*\[/ {
      line=$0
      sub(/^[^[]*\[/, "", line)
      sub(/\].*$/, "", line)
      n=split(line, parts, /,/)
      for (i=1; i<=n; i++) {
        item=parts[i]
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", item)
        gsub(/^"|"$/, "", item)
        gsub(/^'\''|'\''$/, "", item)
        if (item != "") print item
      }
    }
  ' "$workflow_file"
)

if [ -z "$protected_roots" ]; then
  # No protected roots configured: allow (avoid false positives).
  exit 0
fi

matches_protected=false
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  case "$pattern" in
    */) prefix=${pattern%/} ;;
    *\*\*) prefix=${pattern%%/\*\*} ;;
    *\*) prefix=${pattern%%\*} ; prefix=${prefix%/} ;;
    *) prefix=$pattern ;;
  esac
  if [ -z "$prefix" ]; then
    matches_protected=true
    break
  fi
  case "$relative" in
    "$prefix"|"$prefix"/*) matches_protected=true; break ;;
  esac
done <<< "$protected_roots"

[ "$matches_protected" = true ] || exit 0

# Path is protected: apply enforcement against write-authorization.json.
auth_file=.claude/runtime/dev-flow/write-authorization.json
auth_state=""
auth_feature=""
if [ -f "$auth_file" ]; then
  auth_state=$(node -e '
    try {
      const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (a && a.state) process.stdout.write(String(a.state));
    } catch (e) {}
  ' "$auth_file" 2>/dev/null)
  auth_feature=$(node -e '
    try {
      const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (a && a.feature_id) process.stdout.write(String(a.feature_id));
    } catch (e) {}
  ' "$auth_file" 2>/dev/null)
fi

emit_decision() {
  local decision=$1
  local reason=$2
  node -e '
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: process.argv[1],
        permissionDecisionReason: process.argv[2]
      }
    }));
  ' "$decision" "$reason"
}

next_steps_no_auth='先运行 /dev-task 完成分级；无风险 XS/S 执行 dev-flow-status authorize --level XS|S；M/L 或风险 XS/S 执行 dev-flow-status init … 并在 implementation_approval 确认后写入 approved 授权。'
next_steps_pending='对活动 feature 运行 dev-flow-status confirm-human <feature-id> implementation_approval --status confirmed --evidence "<用户原话>"，或先 /dev-task 完成分类与确认。'

# classified (XS/S no-risk) and approved: allow protected writes.
case "$auth_state" in
  classified|approved) exit 0 ;;
  approval-pending)
    reason="dev-flow write-authorization 仍为 approval-pending（feature ${auth_feature:-unknown}），受保护路径 ${relative} 的写入需要先确认 implementation_approval。${next_steps_pending}"
    if [ "$enforcement_mode" = strict ]; then
      emit_decision deny "$reason"
    else
      # ask mode
      emit_decision ask "$reason"
    fi
    exit 0
    ;;
  closed|"")
    reason="dev-flow 无有效 write-authorization，受保护路径 ${relative} 的写入被拦截（enforcement_mode=${enforcement_mode}）。${next_steps_no_auth}"
    if [ "$enforcement_mode" = strict ]; then
      emit_decision deny "$reason"
    else
      emit_decision ask "$reason"
    fi
    exit 0
    ;;
  *)
    reason="dev-flow write-authorization 状态未知（${auth_state}），受保护路径 ${relative} 需要先 /dev-task 分类。${next_steps_no_auth}"
    if [ "$enforcement_mode" = strict ]; then
      emit_decision deny "$reason"
    else
      emit_decision ask "$reason"
    fi
    exit 0
    ;;
esac
