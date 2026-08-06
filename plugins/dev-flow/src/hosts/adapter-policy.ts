import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { approvalBasisArtifacts, confirmedApproval } from "../core/approval-basis.js";
import { classifyGitCommand, classifyGitCommandKind } from "../core/git-policy.js";
import { readActive, readFeatureEvents, readProjectConfig, readRecoveryTransaction, readState, type FeatureState } from "../core/state-store.js";
import { readTraceability } from "../core/traceability-store.js";
import { readReviewLedger } from "../core/review-store.js";
import { ensureActiveImplementationUnit, implementationUnitWriteBlock } from "../core/implementation-units.js";
import { currentOpenStep } from "../core/step-order.js";
import { judgeWrite } from "../core/write-policy.js";

/** Host adapters never mint review attestations or assurance; those enter only via MCP/Core. */

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  event_id?: string;
  tool_use_id?: string;
  permission_request_id?: string;
  tool_call_id?: string;
  tool_output?: unknown;
  prompt?: unknown;
  error?: unknown;
  tool_response?: unknown;
  tool_result?: unknown;
}

export type PreToolBlockCode =
  | "DEV_FLOW_GIT_GUARD"
  | "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED"
  | "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED"
  | "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE"
  | "DEV_FLOW_STATE_MUTATION_FORBIDDEN"
  | "DEV_FLOW_ARTIFACT_NOT_REGISTERED"
  | "DEV_FLOW_WORKFLOW_STATE_UNREADABLE";

export interface PreToolRecovery {
  mode: "automatic" | "guided" | "user-decision";
  action: string;
  retryOriginal: boolean;
}

export interface PreToolBlock {
  code: PreToolBlockCode;
  reason: string;
  impact: string;
  recovery: PreToolRecovery;
  /** @deprecated Use recovery.action. Kept for source consumers during migration. */
  recoveryHint?: string;
}

export interface PreToolAdvisory {
  code: "DEV_FLOW_HOOK_EVALUATION_FAILED";
  message: string;
}

export type PreToolOutcome =
  | { kind: "allow"; advisory?: PreToolAdvisory }
  | { kind: "block"; block: PreToolBlock };

function createPreToolBlock(
  code: PreToolBlockCode,
  reason: string,
  impact: string,
  recovery: PreToolRecovery,
): PreToolBlock {
  return { code, reason, impact, recovery, recoveryHint: recovery.action };
}

/** Serialize the complete recovery contract for host hooks and model context. */
export function formatPreToolBlock(block: PreToolBlock): string {
  const confirmation = block.recovery.mode === "user-decision"
    ? "需要用户决定；模型应只询问一次，确认后直接执行解决动作。"
    : block.recovery.mode === "guided"
      ? "先自动执行解决动作；只有动作证明需要 recover、重建、放弃或改变目标时才询问用户一次。"
      : "不需要用户决定；模型可以直接执行解决动作。";
  const continuation = block.recovery.retryOriginal
    ? "解决后自动重试原操作，无需用户再次回复继续"
    : "原操作不会重试；完成解决动作后继续后续必要步骤";
  return [
    block.code,
    `原因：${block.reason}`,
    `影响：${block.impact}`,
    `解决方案：${block.recovery.action}`,
    `确认：${confirmation}`,
    `继续方式：${continuation}`,
  ].join("\n");
}

const directWriteTools = new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);
const controlFileNames = new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "状态文档.md", "recovery-transaction.json", "recovery-events.jsonl"]);

/** 拦截消息中的 scratch 引导：临时验证文件放到 protectedRoots 之外的 scratch/，不触发 checkpoint。 */
const scratchHint = "；临时验证文件请放入 scratch/ 目录";
const runGit = promisify(execFile);

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
  return relative.split(path.sep).join("/").normalize("NFC");
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
  if (/^\.dev-flow\/features\/[^/]+\/traceability(?:\/|$)/.test(relative)) return true;
  if (/^\.dev-flow\/features\/[^/]+\/review\/(?:snapshots|packages|projections)(?:\/|$)/.test(relative)) return true;
  const base = path.posix.basename(relative);
  if (controlFileNames.has(base)) return true;
  if (relative.includes("/.lock/") || relative.endsWith("/.lock")) return true;
  if (relative === ".dev-flow/active.json" || relative === ".dev-flow/project.json") return true;
  if (relative.includes("/recovered/")) return true;
  if (relative.endsWith("/state.json") || relative.endsWith("/events.jsonl") || relative.endsWith("/status.md") || relative.endsWith("/状态文档.md")) return true;
  return false;
}

function isGeneratedReviewProjectionPath(kind: string, artifactPath: unknown): boolean {
  return kind === "plan-review" && typeof artifactPath === "string"
    && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifactPath);
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

function knownWriteTargets(event: HookEvent): string[] | undefined {
  if (toolName(event) === "bash") {
    const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";
    const analysis = analyzeBashWriteTargets(command);
    return analysis.kind === "resolved" ? analysis.targets : analysis.kind === "read-only" ? [] : undefined;
  }
  return directTargets(event);
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

/**
 * Deliberately narrow heredoc support. `cat` has no output-file option and
 * `tee` targets are parsed below; broader Unix-filter lists are unsafe because
 * commands such as `sort -o`, `diff --output`, and `iconv -o` can write files.
 */
const heredocDataConsumers = new Set(["cat", "tee"]);

type HeredocDelimiter = { value: string; consumed: number };

/**
 * Bash quote removal for a heredoc delimiter word: strips matching quotes and
 * backslash escapes (`<<'END MARK'` → `END MARK`, `<<E\OF` → `EOF`). Inside
 * double quotes a backslash is special only before $, `, ", \\, or newline.
 * Returns undefined when the word cannot be resolved statically (unclosed
 * quotes, trailing backslash, parameter/command expansion), which must fail
 * closed.
 */
function heredocDelimiter(rest: string): HeredocDelimiter | undefined {
  let word = "";
  let index = 0;
  while (index < rest.length && /\s/.test(rest[index])) index += 1;
  while (index < rest.length) {
    const char = rest[index];
    if (char === "'") {
      const end = rest.indexOf("'", index + 1);
      if (end < 0) return undefined;
      word += rest.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (char === '"') {
      let cursor = index + 1;
      let inner = "";
      let closed = false;
      while (cursor < rest.length) {
        const current = rest[cursor];
        if (current === '"') { closed = true; break; }
        if (current === "\\" && cursor + 1 < rest.length) {
          const next = rest[cursor + 1];
          if (["$", "`", "\"", "\\"].includes(next)) {
            inner += next;
            cursor += 2;
            continue;
          }
          inner += `\\${next}`;
          cursor += 2;
          continue;
        }
        inner += current;
        cursor += 1;
      }
      if (!closed) return undefined;
      word += inner;
      index = cursor + 1;
      continue;
    }
    if (char === "\\") {
      if (index + 1 >= rest.length) return undefined;
      word += rest[index + 1];
      index += 2;
      continue;
    }
    if (/\s/.test(char)) break;
    if (char === "$" || char === "`") return undefined;
    word += char;
    index += 1;
  }
  return word ? { value: word, consumed: index } : undefined;
}

/**
 * Finds the first out-of-quotes heredoc opener on a line, skipping arithmetic
 * substitutions `$(( ... ))` / `(( ... ))` and herestrings `<<<`. An
 * unparsable delimiter still reports an opener so the caller can fail closed.
 */
function findHeredocOpener(line: string): {
  delimiter: string | undefined;
  openerIndex: number;
  openerEndIndex: number;
  stripTabs: boolean;
} | undefined {
  let quote: "'" | '"' | undefined;
  for (let cursor = 0; cursor < line.length - 1; cursor += 1) {
    const char = line[cursor];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if ((char === "$" && line[cursor + 1] === "(" && line[cursor + 2] === "(")
      || (char === "(" && line[cursor + 1] === "(")) {
      let depth = 1;
      cursor += char === "$" ? 2 : 1;
      while (depth > 0 && cursor + 1 < line.length) {
        cursor += 1;
        if (line[cursor] === "(" && line[cursor + 1] === "(") { depth += 1; cursor += 1; }
        else if (line[cursor] === ")" && line[cursor + 1] === ")") { depth -= 1; cursor += 1; }
      }
      continue;
    }
    if (char !== "<" || line[cursor + 1] !== "<" || line[cursor + 2] === "<") continue;
    let restStart = cursor + 2;
    const stripTabs = line[restStart] === "-";
    if (stripTabs) restStart += 1;
    const parsed = heredocDelimiter(line.slice(restStart));
    return {
      delimiter: parsed?.value,
      openerIndex: cursor,
      openerEndIndex: parsed ? restStart + parsed.consumed : line.length,
      stripTabs,
    };
  }
  return undefined;
}

/** The command word that owns a heredoc opener (the last segment before the `<<`). */
function heredocConsumer(line: string, openerIndex: number): string | undefined {
  const lastSegment = line.slice(0, openerIndex).split(/[;&|]\s*/).at(-1) ?? "";
  const withoutEnv = lastSegment.replace(/^(?:\w+=\S+\s+)+/, "");
  const command = withoutEnv.match(/^\s*(?:command\s+)?([A-Za-z0-9_./-]+)/)?.[1];
  return command ? path.posix.basename(command) : undefined;
}

/**
 * Masks heredoc bodies so their lines cannot be misread as write syntax or
 * redirect targets. A body is only masked when the owning command is a known
 * data consumer, the delimiter resolves statically, and the terminator line is
 * found; any other situation is unsafe and the caller must fail closed. The
 * opener line keeps its redirects so `cat > target <<'EOF'` still resolves the
 * real target.
 */
function maskHeredocBodies(command: string): { masked: string; unsafe: boolean } {
  const lines = command.split("\n");
  const masked = [...lines];
  let index = 0;
  while (index < lines.length) {
    const opener = findHeredocOpener(lines[index]);
    if (!opener) { index += 1; continue; }
    const consumer = heredocConsumer(lines[index], opener.openerIndex);
    if (opener.delimiter === undefined || !consumer || !heredocDataConsumers.has(consumer)) {
      return { masked: command, unsafe: true };
    }
    masked[index] = `${lines[index].slice(0, opener.openerIndex)}${lines[index].slice(opener.openerEndIndex)}`;
    // Multiple heredocs on one command have interleaved body ordering. Keep the
    // supported grammar small and fail closed instead of guessing.
    if (findHeredocOpener(masked[index])) return { masked: command, unsafe: true };
    let terminatorIndex = -1;
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      const candidateLine = opener.stripTabs ? lines[candidate].replace(/^\t+/, "") : lines[candidate];
      if (candidateLine === opener.delimiter || candidateLine === `${opener.delimiter}\r`) {
        terminatorIndex = candidate;
        break;
      }
    }
    if (terminatorIndex < 0) return { masked: command, unsafe: true };
    for (let body = index + 1; body < terminatorIndex; body += 1) masked[body] = "";
    index = terminatorIndex + 1;
  }
  return { masked: masked.join("\n"), unsafe: false };
}

/** Parse bash write targets from supported deterministic forms only. */
export function analyzeBashWriteTargets(command: string): WriteTargetAnalysis {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "read-only" };
  if (/\b(?:sh|bash|zsh)\s+-c\b/.test(trimmed) || /\bxargs\b/.test(trimmed) || /\bapply_patch\b/.test(trimmed)) {
    return { kind: "unresolved", syntax: "unsupported-shell-wrapper" };
  }
  const { masked, unsafe } = maskHeredocBodies(trimmed);
  // Only proven data heredocs are masked; anything else (unknown consumer,
  // unresolvable delimiter, unterminated body) remains unresolved.
  if (unsafe) return { kind: "unresolved", syntax: "heredoc-unresolved" };
  if (!writeSyntaxHint.test(masked)) return { kind: "read-only" };

  const segments = masked.split(/(?:&&|\|\||;|\n)/).map((part) => part.trim()).filter(Boolean);
  const targets: string[] = [];
  let sawDevNull = false;
  const collect = (token: string) => {
    if (token === "/dev/null") { sawDevNull = true; return; }
    targets.push(token);
  };
  for (const segment of segments) {
    // Drop leading env assignments: FOO=bar cmd
    const withoutEnv = segment.replace(/^(?:\w+=\S+\s+)+/, "");
    if (/\b(?:python|node|ruby|perl)\b/.test(withoutEnv) && !/\bsed\s+-i\b/.test(withoutEnv) && !/\bperl\s+-pi\b/.test(withoutEnv)) {
      if (writeSyntaxHint.test(withoutEnv)) return { kind: "unresolved", syntax: "interpreter-write" };
    }
    const redirectMatches = [...withoutEnv.matchAll(/(?:^|[^0-9&])>{1,2}\s*([^\s|&;]+)/g)];
    for (const match of redirectMatches) {
      const token = stripQuotes(match[1]);
      if (hasUnresolvedExpansion(token)) return { kind: "unresolved", syntax: "redirect-expansion" };
      collect(token);
    }
    const teeIndex = withoutEnv.search(/\btee\b/);
    if (teeIndex >= 0) {
      if ((withoutEnv.match(/\btee\b/g) ?? []).length !== 1) return { kind: "unresolved", syntax: "multiple-tee" };
      const words = commandWords(withoutEnv.slice(teeIndex), "tee");
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "tee-args" };
      for (const path of paths) collect(path);
    }
    const simple = withoutEnv.match(/^(touch|mkdir|rm)\b/);
    if (simple) {
      const words = commandWords(withoutEnv, simple[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "simple-args" };
      for (const path of paths) collect(path);
    }
    const moveCopy = withoutEnv.match(/^(mv|cp)\b/);
    if (moveCopy) {
      const words = commandWords(withoutEnv, moveCopy[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths || paths.length < 2) return { kind: "unresolved", syntax: "mv-cp-args" };
      if (moveCopy[1] === "mv") for (const path of paths) collect(path);
      else collect(paths.at(-1)!);
    }
    const sed = withoutEnv.match(/^sed\s+(-i\S*)\s+([\s\S]*)$/);
    if (sed) {
      const words = shellWords(sed[2]);
      const paths = words && collectPathOperands(words, 1);
      if (!paths) return { kind: "unresolved", syntax: "sed-args" };
      for (const path of paths) collect(path);
    }
    const perl = withoutEnv.match(/^perl\s+(-pi\S*)\s+([\s\S]*)$/);
    if (perl) {
      const words = shellWords(perl[2]);
      const firstPath = words?.[0] === "-e" ? 2 : 0;
      const paths = words && collectPathOperands(words, firstPath);
      if (!paths) return { kind: "unresolved", syntax: "perl-args" };
      for (const path of paths) collect(path);
    }
  }

  if (targets.length === 0) {
    // All would-be targets were /dev/null, or every remaining write hint lived
    // inside a masked heredoc body: nothing writes to the repository.
    if (sawDevNull || masked !== trimmed) return { kind: "read-only" };
    return { kind: "unresolved", syntax: "write-syntax-no-target" };
  }
  return { kind: "resolved", targets };
}

interface ActiveWorkflow {
  featureId: string;
  route?: string;
  logicComplete?: boolean;
  approvalConfirmed: boolean;
  allowedArtifacts: Set<string>;
  protectedRoots: string[];
  /** Read-only Core inputs for the shared implementation-unit judgment. */
  state?: FeatureState;
  ledger?: Awaited<ReturnType<typeof readTraceability>>;
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
        return { kind: "unreadable", reason: `recovery journal open for ${recovery.featureId}`, protectedRoots: project.protectedRoots, blockAllWrites: false };
      } catch { return { kind: "unreadable", reason: "project.json invalid while recovery journal is open", blockAllWrites: true }; }
    }
  } catch { return { kind: "unreadable", reason: "recovery journal unreadable", blockAllWrites: true }; }
  let active;
  try { active = await readActive(root); }
  catch {
    try {
      const project = await readProjectConfig(root);
      return { kind: "unreadable", reason: "active.json unreadable", protectedRoots: project.protectedRoots, blockAllWrites: false };
    } catch { return { kind: "unreadable", reason: "project.json invalid while active.json is unreadable", blockAllWrites: true }; }
  }
  if (!active) return { kind: "none" };

  let project;
  try { project = await readProjectConfig(root); }
  catch { return { kind: "unreadable", reason: "project.json invalid", blockAllWrites: true }; }

  let state: FeatureState;
  let ledger: Awaited<ReturnType<typeof readTraceability>> | undefined;
  try {
    state = await readState(root, active.featureId);
  } catch { return { kind: "unreadable", reason: "state invalid", protectedRoots: project.protectedRoots, blockAllWrites: false }; }
  if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer revision mismatch", protectedRoots: project.protectedRoots, blockAllWrites: false };
  if (state.traceability) {
    try { ledger = await readTraceability(root, state); }
    catch { return { kind: "unreadable", reason: "traceability snapshot invalid", protectedRoots: project.protectedRoots, blockAllWrites: false }; }
  }
  if (state.review) {
    try { await readReviewLedger(root, state); }
    catch { return { kind: "unreadable", reason: "review snapshot invalid", protectedRoots: project.protectedRoots, blockAllWrites: false }; }
  }

  const allowedArtifacts = new Set<string>();
  for (const [kind, artifact] of Object.entries(state.artifacts ?? {})) {
    if (kind === "status" || !artifact?.path) continue;
    // Review projections are Core-generated, content-addressed files. They
    // are valid state artifacts but deliberately never become host-editable.
    if (isGeneratedReviewProjectionPath(kind, artifact.path)) continue;
    if (typeof artifact.path !== "string" || path.posix.dirname(artifact.path) !== "." || !artifact.path.endsWith(".md")) {
      return { kind: "unreadable", reason: "artifact path invalid", protectedRoots: project.protectedRoots, blockAllWrites: false };
    }
    const relative = `.dev-flow/features/${active.featureId}/${artifact.path}`.split(path.sep).join("/");
    allowedArtifacts.add(relative);
  }

  const approvalConfirmed = Boolean(confirmedApproval(state));

  return {
    kind: "ready",
    workflow: {
      featureId: active.featureId,
      route: state.route,
      logicComplete: state.logicComplete,
      approvalConfirmed,
      allowedArtifacts,
      protectedRoots: project.protectedRoots,
      state,
      ledger,
    },
  };
}

function classifyTarget(
  root: string,
  target: string,
  workflow: ActiveWorkflow,
): PreToolBlock | undefined {
  const relative = projectRelative(root, target);
  // Repository-external writes are outside the workflow asset contract. The
  // host's own permissions/sandbox remains responsible for those operations.
  if (!relative) return undefined;
  if (isControlPath(relative)) return controlMutationBlock(relative);
  if (isDevFlowPath(relative)) {
    if (workflow.allowedArtifacts.has(relative)) return undefined;
    // Known artifact filename under active feature but not registered yet
    if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
      const displayName = path.posix.basename(relative, ".md");
      const kind = displayName === "需求文档" ? "requirements" : displayName === "实施计划" ? "implementation-plan" : displayName;
      return createPreToolBlock(
        "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        `目标 ${relative} 是 active feature 的 ${kind} Markdown 资产，但尚未登记`,
        "原写入未执行；该资产不会进入 feature 证据账本",
        {
          mode: "guided",
          action: `先通过 MCP scaffold/register ${kind} 资产 ${relative}，再自动重试原写入`,
          retryOriginal: true,
        },
      );
    }
    return createPreToolBlock(
      "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      `目标 ${relative} 位于 Dev Flow 控制区，且不是 active feature 已登记的可编辑 Markdown 资产`,
      "原写入未执行；Dev Flow 控制区没有被修改",
      {
        mode: "user-decision",
        action: "确认后由模型调用对应 MCP 完成同一工作流意图；不要直接编辑控制区文件",
        retryOriginal: false,
      },
    );
  }
  if (workflow.state?.mode === "intake") {
    const decision = judgeWrite({ mode: "intake", controlPath: false, protectedPath: isProtected(root, target, workflow.protectedRoots), impactResolved: false });
    if (decision.decision === "block") {
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
        `feature 仍处于 intake，目标 ${relative} 位于 protected root，尚未进入可执行实现阶段`,
        "原写入未执行；protected 目标保持不变",
        {
          mode: "user-decision",
          action: "先完成 intake 调查、解决分类决策并锁定基础路线；满足实现批准条件后自动重试原写入",
          retryOriginal: true,
        },
      );
    }
  }
  if (workflow.state?.mode === "routed" && currentOpenStep(workflow.state) === "implementation" && isProtected(root, target, workflow.protectedRoots)) {
    const approvalPending = workflow.state.obligations?.some((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied") ?? false;
    if (approvalPending && !workflow.approvalConfirmed) {
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
        `当前 open step 是 implementation，但目标 ${projectRelative(root, target)} 位于 protected root，执行批准义务尚未满足`,
        "原写入未执行；目标文件和当前 feature 状态未改变",
        {
          mode: "user-decision",
          action: `向用户展示当前实现批准问题并请求一次确认；确认后自动重试原写入${scratchHint}`,
          retryOriginal: true,
        },
      );
    }
    // Checkpoint-enforced routes need a live unit baseline before the first
    // protected write. Scope membership itself is audited at checkpoint time;
    // it is deliberately not a write-time allowlist.
    const unitBlock = implementationUnitWriteBlock(workflow.state, workflow.ledger, projectRelative(root, target)!);
    if (unitBlock?.code === "IMPLEMENTATION_UNIT_REQUIRED") {
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        `目标 ${projectRelative(root, target)} 已通过实现批准，但当前没有活动的 rollback unit`,
        "原写入未执行；protected 目标保持不变",
        {
          mode: "automatic",
          action: "调用 dev_flow_begin_implementation_unit 准备当前 rollback unit；成功后自动重试原写入",
          retryOriginal: true,
        },
      );
    }
    if (unitBlock?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        `当前 rollback unit 在 Trace 中已失效，无法证明目标 ${projectRelative(root, target)} 属于当前实现依据`,
        "原写入未执行；目标文件和 Trace 状态未改变",
        {
          mode: "user-decision",
          action: "刷新 Trace；能自动修复失效引用时先修复，否则展示差异并向用户询问一次；解决后自动重试原写入",
          retryOriginal: true,
        },
      );
    }
    const decision = judgeWrite({ mode: "routed", stage: "implementation", controlPath: false, protectedPath: true, impactResolved: true });
    if (decision.decision !== "block") return undefined;
  }
  if (workflow.state && isProtected(root, target, workflow.protectedRoots)) {
    // Hooks delegate to the one Core judgment; they only map its codes.
    const relative = projectRelative(root, target)!;
    const block = implementationUnitWriteBlock(workflow.state, workflow.ledger, relative);
    if (block?.code === "IMPLEMENTATION_UNIT_REQUIRED") {
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        `目标 ${relative} 位于 protected root，但没有活动的 rollback unit`,
        "原写入未执行；目标文件保持不变",
        {
          mode: "automatic",
          action: "调用 dev_flow_begin_implementation_unit 开始下一个 rollback unit；成功后自动重试原写入",
          retryOriginal: true,
        },
      );
    }
    if (block?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        `当前 rollback unit 在 Trace 中已失效，无法证明目标 ${relative} 属于当前实现依据`,
        "原写入未执行；目标文件和 Trace 状态未改变",
        {
          mode: "user-decision",
          action: "刷新 Trace；能自动修复失效引用时先修复，否则展示差异并向用户询问一次；解决后自动重试原写入",
          retryOriginal: true,
        },
      );
    }
    // Anticipated fileScope drift is reported by the checkpoint auditor, not
    // rejected by the host write hook.
  }
  return undefined;
}

async function stagedGitPaths(root: string): Promise<string[]> {
  const result = await runGit("git", ["diff", "--cached", "--name-only", "-z"], { cwd: root, encoding: "utf8" });
  return String(result.stdout).split("\0").filter(Boolean).map((value) => value.replaceAll("\\", "/").normalize("NFC"));
}

function inFeatureScope(relative: string, state: FeatureState): boolean {
  return state.scope.inScope.some((scope) => scope === "." || relative === scope || relative.startsWith(`${scope}/`));
}

function gitPathPolicy(command: string, root: string, workflow: ActiveWorkflow, paths: string[]): PreToolBlock | undefined {
  const state = workflow.state;
  if (!state) return undefined;
  const excluded = paths.filter((relative) => state.workspace.ownership[relative] === "excluded");
  const unknown = paths.filter((relative) => state.workspace.ownership[relative] !== "feature" && !inFeatureScope(relative, state));
  if (excluded.length || unknown.length) {
    return createPreToolBlock(
      "DEV_FLOW_GIT_GUARD",
      "Git 命令包含未归属或已排除的路径",
      "原 Git 操作未执行；不会把用户或其他任务的文件混入 feature 提交",
      {
        mode: "user-decision",
        action: "先将路径明确纳入当前 feature 或移出暂存区；本仓库禁止智能体提交时交由用户审核",
        retryOriginal: false,
      },
    );
  }
  void command;
  void root;
  return undefined;
}

function controlMutationBlock(relative: string): PreToolBlock {
  return createPreToolBlock(
    "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
    `目标 ${relative} 是 Dev Flow 控制文件，不能由普通文件工具直接修改`,
    "原写入未执行；工作流控制状态保持不变",
    {
      mode: "user-decision",
      action: `确认后由模型调用对应 MCP 完成对 ${relative} 的同一意图；不要重试这次控制文件直接写入`,
      retryOriginal: false,
    },
  );
}

/** 从事件账本推导实现批准是否因计划依据变更而作废（返回最近作废的资产 kind）。 */
async function revokedImplementationApprovalHint(root: string, featureId: string): Promise<string | undefined> {
  const events = await readFeatureEvents(root, featureId);
  let lastConfirmedIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    const data = event.data as { approval?: string };
    if ((event.type === "approval-confirmed" || event.type === "approval-interaction-resolved") && typeof data.approval === "string" && data.approval.startsWith("approval:")) {
      lastConfirmedIndex = index;
      break;
    }
  }
  if (lastConfirmedIndex < 0) return undefined;
  for (let index = events.length - 1; index >= lastConfirmedIndex; index--) {
    const event = events[index];
    const data = event.data as { kind?: string; invalidationReason?: unknown };
    if ((event.type === "artifact-recorded" || event.type === "artifact-recorded-with-trace")
      && data.kind !== undefined && approvalBasisArtifacts.includes(data.kind)
      && data.invalidationReason) {
      return data.kind;
    }
  }
  return undefined;
}

async function augmentApprovalBlock(
  root: string,
  workflow: ActiveWorkflow,
  block: PreToolBlock,
): Promise<PreToolBlock> {
  if (block.code !== "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED") return block;
  let revokedKind: string | undefined;
  try {
    revokedKind = await revokedImplementationApprovalHint(root, workflow.featureId);
  } catch {
    return unreadableBlock("events.jsonl invalid or unreadable");
  }
  if (!revokedKind) return block;
  const action = `计划依据（${revokedKind}）已在实现批准后变更，批准已作废；请先完成相关步骤并重新确认实现批准后再写 protected 文件${scratchHint}`;
  return {
    ...block,
    reason: action,
    recovery: { ...block.recovery, action },
    recoveryHint: action,
  };
}

function annotatePreparationFailure(block: PreToolBlock, diagnostic: string | undefined): PreToolBlock {
  if (!diagnostic || (block.code !== "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED" && block.code !== "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE")) return block;
  const reason = `${block.reason} Core 自动准备 rollback unit 失败：${diagnostic}`;
  const action = `${block.recovery.action}；不要把该 Core 错误解释为 workflow state unreadable`;
  return { ...block, reason, recovery: { ...block.recovery, action }, recoveryHint: action };
}

function unreadableBlock(reason: string): PreToolBlock {
  return createPreToolBlock(
    "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    `读取工作流证据失败：${reason}`,
    "原操作未执行；无法安全确认当前 workflow gate 是否满足",
    {
      mode: "guided",
      action: "先自动刷新 active/state 并运行只读 dev_flow_doctor；只有 doctor 证明必须 recover、重建或放弃 feature 时才向用户询问一次，解决后自动重试原操作",
      retryOriginal: true,
    },
  );
}

function unreadableTargetBlock(root: string, target: string, workflow: UnreadableWorkflow): PreToolBlock | undefined {
  const relative = projectRelative(root, target);
  if (!relative) return undefined;
  if (isControlPath(relative)) return controlMutationBlock(relative);
  if (workflow.blockAllWrites) return unreadableBlock(workflow.reason);
  if (isDevFlowPath(relative) || isProtected(root, target, workflow.protectedRoots ?? [])) return unreadableBlock(workflow.reason);
  return undefined;
}

/** Evaluate policy without making adapters infer meaning from exceptions. */
export async function evaluatePreToolUse(root: string, event: HookEvent): Promise<PreToolOutcome> {
  if (!isRelevantPreToolUse(event)) return { kind: "allow" };
  try {
    const block = await evaluatePreToolUseInternal(root, event);
    return block ? { kind: "block", block } : { kind: "allow" };
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

/** Compatibility wrapper for callers that only need a possible block. */
export async function preToolBlock(root: string, event: HookEvent): Promise<PreToolBlock | undefined> {
  const outcome = await evaluatePreToolUse(root, event);
  return outcome.kind === "block" ? outcome.block : undefined;
}

/** Compatibility wrapper for callers that need the serialized block reason. */
export async function preToolBlockReason(root: string, event: HookEvent): Promise<string | undefined> {
  const block = await preToolBlock(root, event);
  return block ? formatPreToolBlock(block) : undefined;
}

async function evaluatePreToolUseInternal(root: string, event: HookEvent): Promise<PreToolBlock | undefined> {
  if (!isRelevantPreToolUse(event)) return undefined;

  // A statically known control target remains fail-closed even if loading the
  // rest of the workflow later encounters an unexpected I/O or policy error.
  const knownTargets = knownWriteTargets(event);
  if (knownTargets) {
    for (const target of knownTargets) {
      const relative = projectRelative(root, target);
      if (relative && isControlPath(relative)) return controlMutationBlock(relative);
    }
  }

  const loaded = await loadActiveWorkflow(root);
  if (loaded.kind === "none") {
    return undefined;
  }

  if (loaded.kind === "unreadable") {
    // Preserve normal reads and non-protected writes when project policy is readable.
    if (toolName(event) === "bash") {
      const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";
      if (classifyGitCommand(command) === "write") return unreadableBlock(loaded.reason);
      const analysis = analyzeBashWriteTargets(command);
      if (analysis.kind === "read-only") return undefined;
      if (analysis.kind === "unresolved") return undefined;
      for (const target of analysis.targets) {
        const block = unreadableTargetBlock(root, target, loaded);
        if (block) return block;
      }
      return undefined;
    }
    const targets = directTargets(event);
    if (!targets.length) return undefined;
    for (const target of targets) {
      const block = unreadableTargetBlock(root, target, loaded);
      if (block) return block;
    }
    return undefined;
  }

  let { workflow } = loaded;
  const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";

  // Starting the first internal rollback unit is safe to do lazily at the
  // write boundary. It keeps the unit/checkpoint contract intact while
  // avoiding a user-visible failure for a model that proceeds directly from
  // approval to its first ordinary file write.
  const prepareImplementationWrite = async (targets: string[]): Promise<string | undefined> => {
    if (workflow.state?.mode !== "routed" || currentOpenStep(workflow.state) !== "implementation"
      || !targets.some((target) => isProtected(root, target, workflow.protectedRoots))) return undefined;
    try {
      const prepared = await ensureActiveImplementationUnit(root, workflow.featureId, workflow.state);
      if (prepared.revision !== workflow.state.revision) {
        const refreshed = await loadActiveWorkflow(root);
        if (refreshed.kind === "ready") workflow = refreshed.workflow;
        else return "active workflow refresh after implementation-unit preparation did not produce a readable state";
      }
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  if (toolName(event) === "bash" && classifyGitCommand(command) === "write") {
    const gitKind = classifyGitCommandKind(command);
    const localCommit = gitKind === "local-stage" || gitKind === "local-commit";
    const implementationReady = workflow.state?.mode === "routed"
      && currentOpenStep(workflow.state) === "implementation"
      && workflow.approvalConfirmed;
    const unsafePathForm = localCommit && /\bgit\s+add\s+(?:-A|--all|\.|-u\b)|\bgit\s+commit\s+[^\n]*\s-a(?:\s|$)/.test(command);
    if (localCommit && workflow.state?.lifecycle === "active" && (workflow.logicComplete || implementationReady) && !unsafePathForm) {
      const addMatch = command.match(/\bgit\s+add\s+([^;&|\n]+)/);
      const explicitPaths = addMatch
        ? addMatch[1].split(/\s+/).filter((value) => value && !value.startsWith("-"))
        : await stagedGitPaths(root);
      const pathBlock = gitPathPolicy(command, root, workflow, explicitPaths.map((value) => projectRelative(root, value) ?? value));
      if (!pathBlock) return undefined;
      return pathBlock;
    }
    return createPreToolBlock(
      "DEV_FLOW_GIT_GUARD",
      gitKind === "external-publish" ? "外部发布仍然被禁止" : "当前 Git 写入不满足阶段、批准或路径归属条件",
      "原 Git 操作未执行；工作树和 Git 历史没有被这次命令修改",
      {
        mode: "guided",
        action: gitKind === "external-publish" ? "不要执行 push 或其他外部发布；本仓库由用户审核后手动发布" : "先完成实现批准并只暂存 feature-owned 路径；仓库规则禁止智能体提交时交由用户执行",
        retryOriginal: true,
      },
    );
  }

  if (toolName(event) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return undefined;
    // The analyzer is advisory. Unknown shell syntax must not become a second
    // permission system or force the model to rewrite an otherwise valid tool call.
    if (analysis.kind === "unresolved") return undefined;
    const preparationDiagnostic = await prepareImplementationWrite(analysis.targets);
    for (const target of analysis.targets) {
      const block = classifyTarget(root, target, workflow);
      if (block) return augmentApprovalBlock(root, workflow, annotatePreparationFailure(block, preparationDiagnostic));
    }
    return undefined;
  }

  const targets = directTargets(event);
  if (!targets.length) return undefined;
  const preparationDiagnostic = await prepareImplementationWrite(targets);
  for (const target of targets) {
    const block = classifyTarget(root, target, workflow);
    if (block) return augmentApprovalBlock(root, workflow, annotatePreparationFailure(block, preparationDiagnostic));
  }
  return undefined;
}
