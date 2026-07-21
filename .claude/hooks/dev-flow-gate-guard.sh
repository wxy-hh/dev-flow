#!/usr/bin/env bash
# PreToolUse guard (Edit|Write|MultiEdit|NotebookEdit|Bash) for protected writes.
#
# Model A: default allow; only paths matching protected_write_roots are gated.
# Process-owned paths (.claude/**, feature_root/**, review_root/**, openspec/**)
# are always allowed for Edit/Write. Authorization comes from:
#   .claude/runtime/dev-flow/write-authorization.json
# Approved state must pass validator authorization recompute (approval_basis).
#
# Bash: no large command whitelist. pending/stale/missing blocks non-control Bash
# in strict/ask modes. Control: a single exact dev-flow status/validate/policy/doctor
# invocation. Git close-out is delegated only for a single git command.
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

tool_name=$(json_get tool_name)
[ -z "$tool_name" ] && tool_name=$(json_get tool.name)

workflow_file=.claude/rules/project-workflow.md
[ -f "$workflow_file" ] || exit 0

config_value() {
  awk -v key="$1" '$0 ~ "^[[:space:]]*" key ":" { value=$0; sub("^[^:]*:[[:space:]]*", "", value); gsub(/^"|"$/, "", value); print value; exit }' "$workflow_file"
}

feature_root=$(config_value feature_root)
review_root=$(config_value review_root)
enforcement_mode=$(config_value enforcement_mode)
[ -z "$enforcement_mode" ] && enforcement_mode=off

if [ "$enforcement_mode" = off ] || [ "$enforcement_mode" = none ]; then
  exit 0
fi

hook_dir=$(cd "$(dirname "$0")" && pwd)
validator="$hook_dir/../skills/dev-flow/scripts/dev-flow-validate.mjs"
classifier="$hook_dir/../skills/dev-flow/scripts/dev-flow-command.mjs"
auth_file=.claude/runtime/dev-flow/write-authorization.json

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

decide_for_mode() {
  local reason=$1
  if [ "$enforcement_mode" = strict ]; then
    emit_decision deny "$reason"
  else
    emit_decision ask "$reason"
  fi
  exit 0
}

# --- auth state + basis validation ---
auth_state=""
auth_feature=""
auth_valid=0
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
  if [ "$auth_state" = "approved" ]; then
    if node "$validator" authorization "$root" "$auth_file" >/dev/null 2>&1; then
      auth_valid=1
    else
      auth_state="stale"
    fi
  elif [ "$auth_state" = "classified" ]; then
    auth_valid=1
  fi
fi

status_cli="node \"${root}/.claude/skills/dev-flow/scripts/dev-flow-status.mjs\""
next_steps_no_auth='先运行 /dev-task 完成分级；由高层 start 根据分级创建授权或 status，勿直接调用低层 init。'
next_steps_pending="对活动 feature 运行 ${status_cli} confirm-human <feature-id> implementation_approval --status confirmed --evidence \"<用户原话>\"。"
next_steps_stale="approval_basis 已过期：查看变更后重新 ${status_cli} confirm-human <feature-id> implementation_approval --status confirmed（内容变更不必重跑全部前置 gate；结构变更需补齐路线要求）。"

# --- Bash path ---
case "$tool_name" in
  Bash|bash)
    command=$(json_get tool_input.command)
    [ -z "$command" ] && exit 0
    trimmed=$(printf '%s' "$command" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

    classification=$(DEV_FLOW_REPO_ROOT="$root" node "$classifier" "$trimmed" 2>/dev/null)
    has_shell_control=$(node -e 'try { process.stdout.write(JSON.parse(process.argv[1]).has_shell_control ? "1" : "0") } catch { process.stdout.write("1") }' "$classification")
    is_control=$(node -e 'try { process.stdout.write(JSON.parse(process.argv[1]).is_control ? "1" : "0") } catch { process.stdout.write("0") }' "$classification")
    writes_secret_file=$(node -e 'try { process.stdout.write(JSON.parse(process.argv[1]).writes_secret_file ? "1" : "0") } catch { process.stdout.write("0") }' "$classification")
    command_kind=$(node -e 'try { process.stdout.write(JSON.parse(process.argv[1]).command_kind || "other") } catch { process.stdout.write("other") }' "$classification")

    if [ "$writes_secret_file" = 1 ]; then
      emit_decision ask "dev-flow detected a Bash write to a real secret-bearing file; confirm the target and keep secret values out of workflow evidence."
      exit 0
    fi

    # Git add/commit/push/merge close-out is finish-guard's job, but only when
    # the payload is exactly one Git command.
    if [ "$has_shell_control" = 0 ] && [ "$command_kind" = git-closeout ]; then
      exit 0
    fi

    if [ "$auth_valid" = 1 ]; then
      exit 0
    fi

    if [ "$is_control" = 1 ]; then
      exit 0
    fi

    case "$auth_state" in
      approval-pending)
        decide_for_mode "dev-flow write-authorization 仍为 approval-pending（feature ${auth_feature:-unknown}），非控制 Bash 需先确认 implementation_approval。${next_steps_pending}"
        ;;
      stale)
        decide_for_mode "dev-flow write-authorization approval_basis 已过期（feature ${auth_feature:-unknown}）。${next_steps_stale}"
        ;;
      closed|"")
        decide_for_mode "dev-flow 无有效 write-authorization，Bash 受保护写入被拦截（enforcement_mode=${enforcement_mode}）。${next_steps_no_auth}"
        ;;
      *)
        decide_for_mode "dev-flow write-authorization 状态未知（${auth_state}）。${next_steps_no_auth}"
        ;;
    esac
    ;;
esac

# --- Edit/Write path ---
target=$(json_get tool_input.file_path)
[ -z "$target" ] && target=$(json_get tool_input.notebook_path)
[ -z "$target" ] && exit 0

target_dir=$(cd "$(dirname "$target")" 2>/dev/null && pwd -P) || exit 0
target="$target_dir/$(basename "$target")"

case "$target" in
  "$root"/*) relative=${target#"$root"/} ;;
  *) exit 0 ;;
esac

# Real secret-bearing files always require an explicit user confirmation.
case "$relative" in
  *.env.example|*/.env.example) ;;
  .env|*/.env|.env.*|*/.env.*|*.pem|*.key|secrets.*|*/secrets.*|credentials.*|*/credentials.*)
    emit_decision ask "dev-flow detected a write to a real secret-bearing file (${relative}); confirm the target and ensure no secret value is copied into workflow evidence."
    exit 0
    ;;
esac

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

if [ "$auth_valid" = 1 ]; then
  exit 0
fi

case "$auth_state" in
  approval-pending)
    decide_for_mode "dev-flow write-authorization 仍为 approval-pending（feature ${auth_feature:-unknown}），受保护路径 ${relative} 需要先确认 implementation_approval。${next_steps_pending}"
    ;;
  stale)
    decide_for_mode "dev-flow write-authorization approval_basis 已过期（feature ${auth_feature:-unknown}），路径 ${relative}。${next_steps_stale}"
    ;;
  closed|"")
    decide_for_mode "dev-flow 无有效 write-authorization，受保护路径 ${relative} 的写入被拦截（enforcement_mode=${enforcement_mode}）。${next_steps_no_auth}"
    ;;
  *)
    decide_for_mode "dev-flow write-authorization 状态未知（${auth_state}），受保护路径 ${relative}。${next_steps_no_auth}"
    ;;
esac
