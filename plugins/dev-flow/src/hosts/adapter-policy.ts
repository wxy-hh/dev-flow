import { readFile } from "node:fs/promises";
import path from "node:path";
import { classifyGitCommand } from "../core/git-policy.js";

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export type PreToolBlockReason = "DEV_FLOW_GIT_GUARD" | "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED";

const directWriteTools = new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);

function toolName(event: HookEvent): string {
  return String(event.tool_name ?? "").toLowerCase();
}

/** Avoid opening workflow files for tools that cannot change Git or project files. */
export function isRelevantPreToolUse(event: HookEvent): boolean {
  const name = toolName(event);
  return name === "bash" || directWriteTools.has(name);
}

function isProtected(root: string, target: string, protectedRoots: string[]): boolean {
  const relative = path.relative(root, path.resolve(root, target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
    && protectedRoots.some((item) => relative === item || relative.startsWith(`${item}${path.sep}`));
}

function patchTargets(value: unknown): string[] {
  const text = typeof value === "string" ? value : "";
  const targets = new Set<string>();
  for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) targets.add(match[1].trim());
  for (const match of text.matchAll(/^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/gm)) {
    if (match[1] !== "/dev/null") targets.add(match[1].trim());
  }
  return [...targets];
}

function directTargets(event: HookEvent): string[] {
  const input = event.tool_input ?? {};
  const targets = [input.file_path, input.path, input.target_file].filter((value): value is string => typeof value === "string");
  for (const key of ["patch", "diff", "input"]) targets.push(...patchTargets(input[key]));
  return targets;
}

function bashMightWriteProtectedRoot(command: string, protectedRoots: string[]): boolean {
  if (/\bapply_patch\b/.test(command)) return true;
  const hasWriteSyntax = /(?:^|[;&|]\s*)(?:\w+=\S+\s+)*(?:tee\b|touch\b|mkdir\b|rm\b|mv\b|cp\b|sed\s+-i\b|perl\s+-pi\b)|(?:^|\s)>{1,2}\s*|\s>{1,2}\s*/.test(command);
  if (!hasWriteSyntax) return false;
  return protectedRoots.some((protectedRoot) => {
    const normalized = protectedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(path.sep, "[\\\\/]");
    return new RegExp(`(?:^|[\\s'\"=])${normalized}(?:[\\\\/\\s'\";|&]|$)`).test(command);
  });
}

/**
 * Evaluate only enforcement decisions. Adapters remain event normalizers and do
 * not mutate feature state.
 */
export async function preToolBlockReason(root: string, event: HookEvent): Promise<PreToolBlockReason | undefined> {
  if (!isRelevantPreToolUse(event)) return undefined;
  const active = JSON.parse(await readFile(path.join(root, ".dev-flow", "active.json"), "utf8")) as { featureId: string };
  const state = JSON.parse(await readFile(path.join(root, ".dev-flow", "features", active.featureId, "state.json"), "utf8")) as {
    logicComplete?: boolean; route?: string; humanGates?: Record<string, { status?: string }>;
  };
  const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";
  if (toolName(event) === "bash" && classifyGitCommand(command) === "write" && !state.logicComplete) return "DEV_FLOW_GIT_GUARD";

  const needsApproval = ["risk-minimal", "standard-m", "light-l", "standard-l"].includes(state.route ?? "");
  if (!needsApproval || state.humanGates?.implementation_approval?.status === "confirmed") return undefined;

  const project = JSON.parse(await readFile(path.join(root, ".dev-flow", "project.json"), "utf8")) as { protectedRoots?: string[] };
  const protectedRoots = project.protectedRoots ?? [];
  if (toolName(event) === "bash") {
    return bashMightWriteProtectedRoot(command, protectedRoots) ? "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED" : undefined;
  }
  const targets = directTargets(event);
  // A patch with no parseable target is denied: an adapter must not guess that it is harmless.
  if (toolName(event).includes("patch") && !targets.length) return "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED";
  return targets.some((target) => isProtected(root, target, protectedRoots)) ? "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED" : undefined;
}
