import path from "node:path";
import { gateBasisArtifacts } from "../core/gate-basis.js";
import { classifyGitCommand } from "../core/git-policy.js";
import { readActive, readFeatureEvents, readProjectConfig, readRecoveryTransaction, readState, type FeatureState } from "../core/state-store.js";
import { readTraceability } from "../core/traceability-store.js";
import { readReviewLedger } from "../core/review-store.js";
import { implementationUnitWriteBlock } from "../core/implementation-units.js";

/** Host adapters never mint review attestations or assurance; those enter only via MCP/Core. */

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export type PreToolBlockCode =
  | "DEV_FLOW_GIT_GUARD"
  | "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED"
  | "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED"
  | "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE"
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
const controlFileNames = new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "状态文档.md", "recovery-transaction.json", "recovery-events.jsonl"]);

/** 拦截消息中的 scratch 引导：临时验证文件放到 protectedRoots 之外的 scratch/，不触发 checkpoint。 */
const scratchHint = "；临时验证文件请放入 scratch/ 目录";

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
  // unresolvable delimiter, unterminated body) fails closed.
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
  let ledger: Awaited<ReturnType<typeof readTraceability>> | undefined;
  try {
    state = await readState(root, active.featureId);
    if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer does not match active state", protectedRoots: project.protectedRoots, blockAllWrites: false };
    if (state.traceability) ledger = await readTraceability(root, state);
    if (state.review) await readReviewLedger(root, state);
  } catch { return { kind: "unreadable", reason: "state invalid", protectedRoots: project.protectedRoots, blockAllWrites: false }; }

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

  const approvalConfirmed = (state.humanGates.implementation_approval as { status?: string } | undefined)?.status === "confirmed";

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
  if (!relative) {
    return {
      code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED",
      recoveryHint: "请使用能解析到仓库内的项目相对路径（验证日志请写入项目内，例如 vitest.log）",
    };
  }
  if (isControlPath(relative)) {
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "工作流状态仅能通过 MCP 变更；请编辑已登记资产，或对损坏状态使用 doctor/recovery",
    };
  }
  if (isDevFlowPath(relative)) {
    if (workflow.allowedArtifacts.has(relative)) return undefined;
    // Known artifact filename under active feature but not registered yet
    if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
      return {
        code: "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        recoveryHint: "请先通过 MCP scaffold 该资产，编辑后登记",
      };
    }
    return {
      code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
      recoveryHint: "仅可编辑 active feature 已登记的非 status Markdown 资产",
    };
  }
  const needsApproval = ["risk-minimal", "standard-m", "light-l", "standard-l"].includes(workflow.route ?? "");
  if (needsApproval && !workflow.approvalConfirmed && isProtected(root, target, workflow.protectedRoots)) {
    return {
      code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
      recoveryHint: `目标位于受保护根目录；请完成路线步骤并等待实现批准（计划依据变更会使批准作废，需重新确认）${scratchHint}`,
    };
  }
  if (workflow.state && isProtected(root, target, workflow.protectedRoots)) {
    // Hooks delegate to the one Core judgment; they only map its codes.
    const relative = projectRelative(root, target)!;
    const block = implementationUnitWriteBlock(workflow.state, workflow.ledger, relative);
    if (block?.code === "IMPLEMENTATION_UNIT_REQUIRED") {
      return {
        code: "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        recoveryHint: "请先通过 dev_flow_begin_implementation_unit 开始下一个回撤单元，再写 protected 文件",
      };
    }
    if (block?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
      const scope = (block.details.fileScope as string[] | undefined) ?? [];
      return {
        code: "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        recoveryHint: `当前回撤单元 ${block.details.unitId} 仅覆盖：${scope.join(", ") || "(当前无 scope)"}；移动/重命名需把源与目标路径都加入 file_scope 并重登记；临时验证文件请放 scratch/`,
      };
    }
  }
  return undefined;
}

/** 从事件账本推导实现批准是否因计划依据变更而作废（返回最近作废的资产 kind）。 */
async function revokedImplementationApprovalHint(root: string, featureId: string): Promise<string | undefined> {
  const events = await readFeatureEvents(root, featureId);
  let lastConfirmedIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    const data = event.data as { gate?: string };
    if ((event.type === "gate-confirmed" || event.type === "gate-interaction-resolved") && data.gate === "implementation_approval") {
      lastConfirmedIndex = index;
      break;
    }
  }
  if (lastConfirmedIndex < 0) return undefined;
  const basis = gateBasisArtifacts.implementation_approval;
  for (let index = events.length - 1; index >= lastConfirmedIndex; index--) {
    const event = events[index];
    const data = event.data as { kind?: string; invalidationReason?: unknown };
    if ((event.type === "artifact-recorded" || event.type === "artifact-recorded-with-trace")
      && data.kind !== undefined && basis.includes(data.kind)
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
  const revokedKind = await revokedImplementationApprovalHint(root, workflow.featureId);
  if (!revokedKind) return block;
  return {
    ...block,
    recoveryHint: `计划依据（${revokedKind}）已在实现批准后变更，批准已作废；请先完成相关步骤并重新确认实现批准后再写 protected 文件${scratchHint}`,
  };
}

function unreadableBlock(reason: string): PreToolBlock {
  return {
    code: "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    recoveryHint: `无法安全读取活动工作流（${reason}）；请运行 dev_flow_doctor，损坏时使用 recover 恢复`,
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
      recoveryHint: "功能尚未 logic-complete；请先完成 verify、feature-check 与 finalize 再进行 git 写入",
    };
  }

  if (toolName(event) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return undefined;
    if (analysis.kind === "unresolved") {
      return {
        code: "DEV_FLOW_WRITE_TARGET_UNRESOLVED",
        recoveryHint: "请拆分确定性的写命令或使用 MCP 资产工具；验证日志请写入项目内相对路径（例如 vitest.log），勿混用未解析的 shell 写入",
      };
    }
    for (const target of analysis.targets) {
      const block = classifyTarget(root, target, workflow);
      if (block) return augmentApprovalBlock(root, workflow, block);
    }
    return undefined;
  }

  const targets = directTargets(event);
  if (!targets.length) {
    return {
      code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
      recoveryHint: "补丁无可解析目标；在实现批准前保守拒绝",
    };
  }
  for (const target of targets) {
    const block = classifyTarget(root, target, workflow);
    if (block) return augmentApprovalBlock(root, workflow, block);
  }
  return undefined;
}
