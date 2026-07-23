import path from "node:path";
import { classifyGitCommand } from "../core/git-policy.js";
import { readActive, readProjectConfig, readRecoveryTransaction, readState, type FeatureState } from "../core/state-store.js";

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export type PreToolBlockCode =
  | "DEV_FLOW_GIT_GUARD"
  | "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED"
  | "DEV_FLOW_STATE_MUTATION_FORBIDDEN"
  | "DEV_FLOW_ARTIFACT_NOT_REGISTERED"
  | "DEV_FLOW_WORKFLOW_STATE_UNREADABLE"
  | "DEV_FLOW_WRITE_TARGET_UNRESOLVED";

export interface PreToolBlock {
  code: PreToolBlockCode;
  recoveryHint: string;
}

/** Serialize for host hooks: first token is stable code. */
export function formatPreToolBlock(block: PreToolBlock): string {
  return `${block.code}: ${block.recoveryHint}`;
}

const directWriteTools = new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);
const controlFileNames = new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "recovery-transaction.json", "recovery-events.jsonl"]);

function toolName(event: HookEvent): string {
  return String(event.tool_name ?? "").toLowerCase();
}

/** Avoid opening workflow files for tools that cannot change Git or project files. */
export function isRelevantPreToolUse(event: HookEvent): boolean {
  const name = toolName(event);
  return name === "bash" || directWriteTools.has(name);
}

function projectRelative(root: string, target: string): string | undefined {
  const absolute = path.resolve(root, target);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function isProtected(root: string, target: string, protectedRoots: string[]): boolean {
  const relative = projectRelative(root, target);
  if (!relative) return false;
  return protectedRoots.some((item) => relative === item || relative.startsWith(`${item}/`));
}

function isDevFlowPath(relative: string): boolean {
  return relative === ".dev-flow" || relative.startsWith(".dev-flow/");
}

function isControlPath(relative: string): boolean {
  if (!isDevFlowPath(relative)) return false;
  const base = path.posix.basename(relative);
  if (controlFileNames.has(base)) return true;
  if (relative.includes("/.lock/") || relative.endsWith("/.lock")) return true;
  if (relative === ".dev-flow/active.json" || relative === ".dev-flow/project.json") return true;
  if (relative.includes("/recovered/")) return true;
  if (relative.endsWith("/state.json") || relative.endsWith("/events.jsonl") || relative.endsWith("/status.md")) return true;
  return false;
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

export type WriteTargetAnalysis =
  | { kind: "read-only" }
  | { kind: "resolved"; targets: string[] }
  | { kind: "unresolved"; syntax: string };

const writeSyntaxHint = /(?:^|[;&|]\s*)(?:\w+=\S+\s+)*(?:tee\b|touch\b|mkdir\b|rm\b|mv\b|cp\b|sed\s+-i\b|perl\s+-pi\b)|(?:^|\s)>{1,2}\s*|\s>{1,2}\s*|\bapply_patch\b/;

function stripQuotes(token: string): string {
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) return token.slice(1, -1);
  return token;
}

function hasUnresolvedExpansion(token: string): boolean {
  return /\$|`|\*|\{|\?/.test(token);
}

function shellWords(input: string): string[] | undefined {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) { quote = undefined; continue; }
      if (quote === '"' && char === "\\") return undefined;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/.test(char)) {
      if (current) { words.push(current); current = ""; }
      continue;
    }
    if (/[|&;<>()$`*{}?\\]/.test(char)) return undefined;
    current += char;
  }
  if (quote) return undefined;
  if (current) words.push(current);
  return words;
}

function collectPathOperands(words: string[], start: number): string[] | undefined {
  const paths: string[] = [];
  let optionsEnded = false;
  for (const word of words.slice(start)) {
    if (!optionsEnded && word === "--") { optionsEnded = true; continue; }
    if (!optionsEnded && word.startsWith("-")) continue;
    if (hasUnresolvedExpansion(word)) return undefined;
    paths.push(word);
  }
  return paths.length ? paths : undefined;
}

function commandWords(segment: string, command: string): string[] | undefined {
  const match = segment.match(new RegExp(`(?:^|\\s)${command}\\s+([\\s\\S]*)$`));
  if (!match) return undefined;
  return shellWords(match[1]);
}

/** Parse bash write targets from supported deterministic forms only. */
export function analyzeBashWriteTargets(command: string): WriteTargetAnalysis {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "read-only" };
  if (/\b(?:sh|bash|zsh)\s+-c\b/.test(trimmed) || /\bxargs\b/.test(trimmed) || /\bapply_patch\b/.test(trimmed)) {
    return { kind: "unresolved", syntax: "unsupported-shell-wrapper" };
  }
  if (!writeSyntaxHint.test(trimmed)) return { kind: "read-only" };

  const segments = trimmed.split(/(?:&&|\|\||;|\n)/).map((part) => part.trim()).filter(Boolean);
  const targets: string[] = [];
  for (const segment of segments) {
    // Drop leading env assignments: FOO=bar cmd
    const withoutEnv = segment.replace(/^(?:\w+=\S+\s+)+/, "");
    if (/\b(?:python|node|ruby|perl)\b/.test(withoutEnv) && !/\bsed\s+-i\b/.test(withoutEnv) && !/\bperl\s+-pi\b/.test(withoutEnv)) {
      if (writeSyntaxHint.test(withoutEnv)) return { kind: "unresolved", syntax: "interpreter-write" };
    }
    const redirectMatches = [...withoutEnv.matchAll(/(?:^|[^0-9])>{1,2}\s*([^\s|&;]+)/g)];
    for (const match of redirectMatches) {
      const token = stripQuotes(match[1]);
      if (hasUnresolvedExpansion(token)) return { kind: "unresolved", syntax: "redirect-expansion" };
      targets.push(token);
    }
    const teeIndex = withoutEnv.search(/\btee\b/);
    if (teeIndex >= 0) {
      if ((withoutEnv.match(/\btee\b/g) ?? []).length !== 1) return { kind: "unresolved", syntax: "multiple-tee" };
      const words = commandWords(withoutEnv.slice(teeIndex), "tee");
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "tee-args" };
      targets.push(...paths);
    }
    const simple = withoutEnv.match(/^(touch|mkdir|rm)\b/);
    if (simple) {
      const words = commandWords(withoutEnv, simple[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "simple-args" };
      targets.push(...paths);
    }
    const moveCopy = withoutEnv.match(/^(mv|cp)\b/);
    if (moveCopy) {
      const words = commandWords(withoutEnv, moveCopy[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths || paths.length < 2) return { kind: "unresolved", syntax: "mv-cp-args" };
      if (moveCopy[1] === "mv") targets.push(...paths);
      else targets.push(paths.at(-1)!);
    }
    const sed = withoutEnv.match(/^sed\s+(-i\S*)\s+([\s\S]*)$/);
    if (sed) {
      const words = shellWords(sed[2]);
      const paths = words && collectPathOperands(words, 1);
      if (!paths) return { kind: "unresolved", syntax: "sed-args" };
      targets.push(...paths);
    }
    const perl = withoutEnv.match(/^perl\s+(-pi\S*)\s+([\s\S]*)$/);
    if (perl) {
      const words = shellWords(perl[2]);
      const firstPath = words?.[0] === "-e" ? 2 : 0;
      const paths = words && collectPathOperands(words, firstPath);
      if (!paths) return { kind: "unresolved", syntax: "perl-args" };
      targets.push(...paths);
    }
  }

  if (targets.length === 0) return { kind: "unresolved", syntax: "write-syntax-no-target" };
  return { kind: "resolved", targets };
}

interface ActiveWorkflow {
  featureId: string;
  route?: string;
  logicComplete?: boolean;
  approvalConfirmed: boolean;
  allowedArtifacts: Set<string>;
  protectedRoots: string[];
}

type UnreadableWorkflow = { kind: "unreadable"; reason: string; protectedRoots?: string[]; blockAllWrites: boolean };

async function loadActiveWorkflow(root: string): Promise<
  | { kind: "none" }
  | UnreadableWorkflow
  | { kind: "ready"; workflow: ActiveWorkflow }
> {
  try {
    const recovery = await readRecoveryTransaction(root);
    if (recovery) {
      try {
        const project = await readProjectConfig(root);
        return { kind: "unreadable", reason: `recovery journal is open for ${recovery.featureId}`, protectedRoots: project.protectedRoots, blockAllWrites: false };
      } catch { return { kind: "unreadable", reason: "recovery journal or project.json invalid", blockAllWrites: true }; }
    }
  } catch { return { kind: "unreadable", reason: "recovery journal unreadable", blockAllWrites: true }; }
  let active;
  try { active = await readActive(root); }
  catch {
    try {
      const project = await readProjectConfig(root);
      return { kind: "unreadable", reason: "active.json unreadable", protectedRoots: project.protectedRoots, blockAllWrites: false };
    } catch { return { kind: "unreadable", reason: "active.json or project.json unreadable", blockAllWrites: true }; }
  }
  if (!active) return { kind: "none" };

  let project;
  try { project = await readProjectConfig(root); }
  catch { return { kind: "unreadable", reason: "project.json invalid", blockAllWrites: true }; }

  let state: FeatureState;
  try {
    state = await readState(root, active.featureId);
    if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer does not match active state", protectedRoots: project.protectedRoots, blockAllWrites: false };
  } catch { return { kind: "unreadable", reason: "state invalid", protectedRoots: project.protectedRoots, blockAllWrites: false }; }

  const allowedArtifacts = new Set<string>();
  for (const [kind, artifact] of Object.entries(state.artifacts ?? {})) {
    if (kind === "status" || !artifact?.path) continue;
    if (path.posix.dirname(artifact.path) !== "." || !artifact.path.endsWith(".md")) {
      return { kind: "unreadable", reason: "artifact path invalid", protectedRoots: project.protectedRoots, blockAllWrites: false };
    }
    const relative = `.dev-flow/features/${active.featureId}/${artifact.path}`.split(path.sep).join("/");
    allowedArtifacts.add(relative);
  }

  return {
    kind: "ready",
    workflow: {
      featureId: active.featureId,
      route: state.route,
      logicComplete: state.logicComplete,
      approvalConfirmed: (state.humanGates.implementation_approval as { status?: string } | undefined)?.status === "confirmed",
      allowedArtifacts,
      protectedRoots: project.protectedRoots,
    },
  };
}

function classifyTarget(
  root: string,
  target: string,
  workflow: ActiveWorkflow,
): PreToolBlock | undefined {
  const relative = projectRelative(root, target);
  if (!relative) {
    return { code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED", recoveryHint: "Use a project-relative path that resolves inside the repository" };
  }
  if (isControlPath(relative)) {
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "Workflow state is MCP-only; edit registered artifacts or use doctor/recovery for corrupt state",
    };
  }
  if (isDevFlowPath(relative)) {
    if (workflow.allowedArtifacts.has(relative)) return undefined;
    // Known artifact filename under active feature but not registered yet
    if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
      return {
        code: "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        recoveryHint: "Scaffold the artifact via MCP first, then edit and record it",
      };
    }
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "Only registered non-status artifacts for the active feature may be edited",
    };
  }
  const needsApproval = ["risk-minimal", "standard-m", "light-l", "standard-l"].includes(workflow.route ?? "");
  if (needsApproval && !workflow.approvalConfirmed && isProtected(root, target, workflow.protectedRoots)) {
    return {
      code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
      recoveryHint: "Target is under a protected root; finish the route and wait for implementation approval",
    };
  }
  return undefined;
}

function unreadableBlock(reason: string): PreToolBlock {
  return {
    code: "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    recoveryHint: `Active workflow cannot be read safely (${reason}); run dev_flow_doctor and recover if corrupt`,
  };
}

function unreadableTargetBlock(root: string, target: string, workflow: UnreadableWorkflow): PreToolBlock | undefined {
  if (workflow.blockAllWrites) return unreadableBlock(workflow.reason);
  const relative = projectRelative(root, target);
  if (!relative || isDevFlowPath(relative) || isProtected(root, target, workflow.protectedRoots ?? [])) return unreadableBlock(workflow.reason);
  return undefined;
}

/**
 * Evaluate only enforcement decisions. Adapters remain event normalizers and do
 * not mutate feature state.
 * Returns a structured block, or undefined to allow.
 */
export async function preToolBlockReason(root: string, event: HookEvent): Promise<string | undefined> {
  const block = await preToolBlock(root, event);
  return block ? formatPreToolBlock(block) : undefined;
}

export async function preToolBlock(root: string, event: HookEvent): Promise<PreToolBlock | undefined> {
  if (!isRelevantPreToolUse(event)) return undefined;

  const loaded = await loadActiveWorkflow(root);
  if (loaded.kind === "none") return undefined;

  if (loaded.kind === "unreadable") {
    // Preserve normal reads and non-protected writes when project policy is readable.
    if (toolName(event) === "bash") {
      const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";
      if (classifyGitCommand(command) === "write") return unreadableBlock(loaded.reason);
      const analysis = analyzeBashWriteTargets(command);
      if (analysis.kind === "read-only") return undefined;
      if (analysis.kind === "unresolved") return unreadableBlock(loaded.reason);
      for (const target of analysis.targets) {
        const block = unreadableTargetBlock(root, target, loaded);
        if (block) return block;
      }
      return undefined;
    }
    const targets = directTargets(event);
    if (!targets.length) return unreadableBlock(loaded.reason);
    for (const target of targets) {
      const block = unreadableTargetBlock(root, target, loaded);
      if (block) return block;
    }
    return undefined;
  }

  const { workflow } = loaded;
  const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";

  if (toolName(event) === "bash" && classifyGitCommand(command) === "write" && !workflow.logicComplete) {
    return {
      code: "DEV_FLOW_GIT_GUARD",
      recoveryHint: "Feature is not logic-complete; finish verify, feature-check, and finalize before git writes",
    };
  }

  if (toolName(event) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return undefined;
    if (analysis.kind === "unresolved") {
      return {
        code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED",
        recoveryHint: "Split into deterministic write commands or use MCP artifact tools; do not mix unresolved shell writes",
      };
    }
    for (const target of analysis.targets) {
      const block = classifyTarget(root, target, workflow);
      if (block) return block;
    }
    return undefined;
  }

  const targets = directTargets(event);
  if (!targets.length) {
    return {
      code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
      recoveryHint: "Patch has no parseable targets; denied conservatively until implementation approval",
    };
  }
  for (const target of targets) {
    const block = classifyTarget(root, target, workflow);
    if (block) return block;
  }
  return undefined;
}
