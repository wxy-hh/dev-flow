/** Git writes are denied before logic-complete; observability commands stay available. */
const readOnly = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "ls-tree", "cat-file", "name-rev"]);
const write = new Set(["add", "commit", "push", "merge", "rebase", "tag", "cherry-pick", "reset"]);

export type GitCommandKind = "read" | "local-stage" | "local-commit" | "history-rewrite" | "external-publish" | "other";

function isReadOnly(subcommand: string, args: string): boolean {
  if (readOnly.has(subcommand)) return true;
  const normalized = args.trim();
  if (subcommand === "branch") return normalized === "" || /^(--list|--show-current|-a|-r|-v|-vv)(\s|$)/.test(normalized);
  if (subcommand === "remote") return /^(?:-v|show|get-url)(\s|$)/.test(normalized);
  if (subcommand === "config") return /^(?:--get|--get-all|--list)(\s|$)/.test(normalized);
  if (subcommand === "worktree") return /^list(\s|$)/.test(normalized);
  if (subcommand === "stash") return /^(?:list|show)(\s|$)/.test(normalized);
  return false;
}

/** Strict, intentionally conservative classification. Unknown Git invocations are write-capable. */
export function classifyGitCommand(command: string): "read" | "write" | "other" {
  const commands = [...command.matchAll(/(?:^|[;&|]\s*|\$\([^)]*?)(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:command\s+)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+([\w-]+)([^;&|\n)]*)/g)];
  if (!commands.length) return "other";
  for (const match of commands) {
    const subcommand = match[1]; const args = match[2] ?? "";
    if (write.has(subcommand) || !isReadOnly(subcommand, args)) return "write";
  }
  return "read";
}

export function classifyGitCommandKind(command: string): GitCommandKind {
  const commands = [...command.matchAll(/(?:^|[;&|]\s*)(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:command\s+)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+([\w-]+)([^;&|\n)]*)/g)];
  if (!commands.length) return "other";
  let result: GitCommandKind = "read";
  for (const match of commands) {
    const subcommand = match[1];
    const args = (match[2] ?? "").trim();
    if (isReadOnly(subcommand, args)) continue;
    if (subcommand === "add") result = "local-stage";
    else if (subcommand === "commit") result = result === "history-rewrite" ? result : "local-commit";
    else if (subcommand === "push") result = "external-publish";
    else result = "history-rewrite";
  }
  return result;
}

export const gitReadOnlyCommands = [...readOnly].sort();
