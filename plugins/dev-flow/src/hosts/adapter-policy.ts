import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyGitCommand, classifyGitCommandKind } from "../core/git-policy.js";
import { writeGate, type WriteIntent } from "../core/write-gate.js";
import {
  analyzeBashWriteTargets,
  directTargets,
  isRelevantPreToolUse,
  projectRelativePaths,
  toolName,
  type HookEvent,
} from "./bash-syntax.js";
import {
  formatWriteGateBlock,
  type PreToolAdvisory,
  type PreToolBlock,
  type PreToolOutcome,
} from "./block-format.js";

/** Host adapters never mint review attestations or assurance; those enter only via MCP/Core. */

export interface HostToolExecutionDetails {
  toolName: string;
  executionId: string;
  result: "success" | "failure";
  resultSummary: string;
}

/** Build the safe, verifiable subset persisted for a native PostToolUse event. */
export function hostToolExecutionDetails(event: HookEvent, succeeded: boolean, fallbackEventId: string): HostToolExecutionDetails {
  const response = event.tool_response ?? event.tool_result;
  const record = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : undefined;
  const message = [record?.summary, record?.message, record?.text]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return {
    toolName: String(event.tool_name ?? "unknown"),
    executionId: event.tool_use_id ?? event.event_id ?? fallbackEventId,
    result: succeeded ? "success" : "failure",
    resultSummary: (message?.trim() ?? (succeeded ? "工具执行成功" : "工具执行失败")).slice(0, 512),
  };
}

const runGit = promisify(execFile);

async function stagedGitPaths(root: string): Promise<string[]> {
  const result = await runGit("git", ["diff", "--cached", "--name-only", "-z"], { cwd: root, encoding: "utf8" });
  return String(result.stdout).split("\0").filter(Boolean).map((value) => value.replaceAll("\\", "/").normalize("NFC"));
}

/** 把 git 命令收成语义意图；add -A/commit -a 等无法安全枚举时用 form，不用空 paths。 */
async function buildGitIntent(command: string, root: string): Promise<WriteIntent> {
  const gitKind = classifyGitCommandKind(command);
  const localCommit = gitKind === "local-stage" || gitKind === "local-commit";
  const unsafePathForm = localCommit && (
    /\bgit\s+add\s+(?:-A|--all|\.|-u\b)/.test(command)
    || /\bgit\s+commit\b[^;&|\n]*?\s(?:-a(?:m)?|--all)(?:\s|$)/.test(command)
  );
  if (gitKind === "external-publish") return { kind: "git", form: "publish" };
  if (unsafePathForm) return { kind: "git", form: "unbounded" };
  if (localCommit) {
    const addMatch = command.match(/\bgit\s+add\s+([^;&|\n]+)/);
    const explicitPaths = addMatch
      ? addMatch[1].split(/\s+/).filter((value) => value && !value.startsWith("-"))
      : await stagedGitPaths(root);
    return { kind: "git", paths: projectRelativePaths(root, explicitPaths) };
  }
  // merge/rebase/reset/tag/branch 等无法安全枚举的 git 写
  return { kind: "git", form: "unbounded" };
}

// ---------------------------------------------------------------------------
// 编排：句法收意图（bash-syntax）→ Core writeGate 判决 → 文案成形（block-format）。
// ---------------------------------------------------------------------------

/** Evaluate policy without making adapters infer meaning from exceptions. */
export async function evaluatePreToolUse(root: string, event: HookEvent): Promise<PreToolOutcome> {
  if (!isRelevantPreToolUse(event)) return { kind: "allow" };
  const advisoryOut: { advisory?: PreToolAdvisory } = {};
  try {
    const block = await evaluatePreToolUseInternal(root, event, advisoryOut);
    if (block) return { kind: "block", block };
    return advisoryOut.advisory ? { kind: "allow", advisory: advisoryOut.advisory } : { kind: "allow" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "allow",
      advisory: {
        code: "DEV_FLOW_HOOK_EVALUATION_FAILED",
        message: `DEV_FLOW_HOOK_EVALUATION_FAILED: Dev Flow hook analysis failed (${detail}); the original operation was not blocked and remains subject to host permissions.`,
      },
    };
  }
}

async function evaluatePreToolUseInternal(
  root: string,
  event: HookEvent,
  advisoryOut: { advisory?: PreToolAdvisory } = {},
): Promise<PreToolBlock | undefined> {
  if (!isRelevantPreToolUse(event)) return undefined;
  const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";

  if (toolName(event) === "bash" && classifyGitCommand(command) === "write") {
    const intent = await buildGitIntent(command, root);
    const verdict = await writeGate(root, intent);
    if (verdict.decision === "allow") return undefined;
    if (verdict.decision === "audit") {
      advisoryOut.advisory = {
        code: "DEV_FLOW_GIT_STARTUP_EXCLUDED",
        message: `该路径启动前已有改动、已默认排除出交付；本次 Git 操作未拦截，但这些文件不会进入交付快照。如需计入请先在工作区对账纳入：${verdict.block.paths.join("、")}`,
      };
      return undefined;
    }
    return formatWriteGateBlock(verdict.block);
  }

  if (toolName(event) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return undefined;
    // The analyzer is advisory. Unknown shell syntax must not become a second
    // permission system or force the model to rewrite an otherwise valid tool call.
    // The write itself is allowed (host permissions stay authoritative), but
    // the affected files will not be auto-owned; surface that plainly instead
    // of letting the ownership prompt surprise the user later.
    if (analysis.kind === "unresolved") {
      const verdict = await writeGate(root, { kind: "file", unresolved: true });
      if (verdict.decision === "allow" && verdict.advisory === "unresolved-write") {
        advisoryOut.advisory = {
          code: "DEV_FLOW_HOOK_UNRESOLVED_WRITE",
          message: "DEV_FLOW_HOOK_UNRESOLVED_WRITE: 无法从命令文本确认本次写入涉及哪些文件，因此没有自动把这些文件记入当前任务；如果涉及项目文件，稍后会请你确认这些文件是否属于当前任务。",
        };
      }
      return undefined;
    }
    const verdict = await writeGate(root, { kind: "file", paths: projectRelativePaths(root, analysis.targets) });
    if (verdict.decision === "block") return formatWriteGateBlock(verdict.block);
    return undefined;
  }

  const targets = directTargets(event);
  if (!targets.length) return undefined;
  const verdict = await writeGate(root, { kind: "file", paths: projectRelativePaths(root, targets) });
  if (verdict.decision === "block") return formatWriteGateBlock(verdict.block);
  return undefined;
}
