import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyGitCommand, classifyGitCommandKind } from "../core/git-policy.js";
import { writeGate, type WriteGateBlock, type WriteIntent } from "../core/write-gate.js";

/** Host adapters never mint review attestations or assurance; those enter only via MCP/Core. */

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  event_id?: string;
  tool_use_id?: string;
  permission_request_id?: string;
  error?: unknown;
  tool_response?: unknown;
  tool_result?: unknown;
}

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
  code: "DEV_FLOW_HOOK_EVALUATION_FAILED" | "DEV_FLOW_HOOK_UNRESOLVED_WRITE" | "DEV_FLOW_GIT_STARTUP_EXCLUDED";
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

/** 拦截消息中的 scratch 引导：临时验证文件放到 governedRoots 之外的 scratch/，不触发 checkpoint。 */
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

/** Normalize statically attributable write targets to project-relative, preserving order. */
function projectRelativePaths(root: string, targets: string[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const target of targets) {
    const relative = projectRelative(root, target);
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    paths.push(relative);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// 句法解析：命令如何收成语义意图。归属、阶段、单元、批准判断都在 Core writeGate。
// ---------------------------------------------------------------------------

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

/** Normalize statically attributable write targets for trusted hook auditing. */
export function trustedWriteTargets(root: string, event: HookEvent): string[] {
  const targets = toolName(event) === "bash"
    ? (() => {
      const analysis = analyzeBashWriteTargets(String(event.tool_input?.command ?? ""));
      return analysis.kind === "resolved" ? analysis.targets : [];
    })()
    : directTargets(event);
  return [...new Set(targets.map((target) => projectRelative(root, target)).filter((value): value is string => Boolean(value)))].sort();
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
// 门禁结果格式化：语义判决 → 宿主 PreToolBlock。中文文案只在这一层。
// ---------------------------------------------------------------------------

function artifactKind(relative: string): string {
  const displayName = path.posix.basename(relative, ".md");
  return displayName === "需求文档" ? "requirements" : displayName === "实施计划" ? "implementation-plan" : displayName;
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

function formatWriteGateBlock(block: WriteGateBlock): PreToolBlock {
  const relative = block.paths[0] ?? "";
  const detail = block.detail;
  switch (block.code) {
    case "CONTROL_MUTATION_FORBIDDEN":
      if (detail?.variant === "control-area") {
        return createPreToolBlock(
          "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
          `目标 ${relative} 位于 Dev Flow 控制区，且不是 active feature 已登记的可编辑 Markdown 资产`,
          "原写入未执行；Dev Flow 控制区没有被修改",
          { mode: "user-decision", action: "确认后由模型调用对应 MCP 完成同一工作流意图；不要直接编辑控制区文件", retryOriginal: false },
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
        `目标 ${relative} 是 Dev Flow 控制文件，不能由普通文件工具直接修改`,
        "原写入未执行；工作流控制状态保持不变",
        { mode: "user-decision", action: `确认后由模型调用对应 MCP 完成对 ${relative} 的同一意图；不要重试这次控制文件直接写入`, retryOriginal: false },
      );
    case "ARTIFACT_NOT_REGISTERED": {
      const kind = artifactKind(relative);
      return createPreToolBlock(
        "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        `目标 ${relative} 是 active feature 的 ${kind} Markdown 资产，但尚未登记`,
        "原写入未执行；该资产不会进入 feature 证据账本",
        { mode: "guided", action: `先通过 MCP scaffold/register ${kind} 资产 ${relative}，再自动重试原写入`, retryOriginal: true },
      );
    }
    case "IMPLEMENTATION_APPROVAL_REQUIRED": {
      const impact = "原写入未执行；目标文件和当前 feature 状态未改变";
      if (detail?.revokedKind) {
        const action = `计划依据（${detail.revokedKind}）已在实现批准后变更，批准已作废；请先完成相关步骤并重新确认实现批准后再写 governed 文件${scratchHint}`;
        return createPreToolBlock("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", action, impact, { mode: "user-decision", action, retryOriginal: true });
      }
      if (detail?.variant === "approval") {
        return createPreToolBlock(
          "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
          `当前 open step 是 implementation，但目标 ${relative} 位于 governed root，执行批准义务尚未满足`,
          impact,
          { mode: "user-decision", action: `向用户展示当前实现批准问题并请求一次确认；确认后自动重试原写入${scratchHint}`, retryOriginal: true },
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
        `feature 仍处于 intake，目标 ${relative} 位于 governed root，尚未进入可执行实现阶段`,
        "原写入未执行；governed 目标保持不变",
        { mode: "user-decision", action: "先完成 intake 调查、解决分类决策并锁定基础路线；满足实现批准条件后自动重试原写入", retryOriginal: true },
      );
    }
    case "IMPLEMENTATION_UNIT_REQUIRED": {
      const base = createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        `目标 ${relative} 已通过实现批准，但当前没有活动的 implementation unit`,
        "原写入未执行；governed 目标保持不变",
        { mode: "automatic", action: "调用 dev_flow_begin_implementation_unit 准备当前 implementation unit；成功后自动重试原写入", retryOriginal: true },
      );
      if (!detail?.beginFailed) return base;
      const reason = `${base.reason} Core 自动准备 implementation unit 失败：${detail.beginFailed}`;
      const action = `${base.recovery.action}；不要把该 Core 错误解释为 workflow state unreadable`;
      return { ...base, reason, recovery: { ...base.recovery, action }, recoveryHint: action };
    }
    case "IMPLEMENTATION_UNIT_OUT_OF_SCOPE":
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        `当前 implementation unit 在 Trace 中已失效，无法证明目标 ${relative} 属于当前实现依据`,
        "原写入未执行；目标文件和 Trace 状态未改变",
        { mode: "user-decision", action: "刷新 Trace；能自动修复失效引用时先修复，否则展示差异并向用户询问一次；解决后自动重试原写入", retryOriginal: true },
      );
    case "GIT_GUARD":
      if (detail?.variant === "paths") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "Git 命令包含未归属或已排除的路径",
          "原 Git 操作未执行；不会把用户或其他任务的文件混入 feature 提交",
          { mode: "user-decision", action: "先将路径明确纳入当前 feature 或移出暂存区；本仓库禁止智能体提交时交由用户审核", retryOriginal: false },
        );
      }
      if (detail?.variant === "publish") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "外部发布仍然被禁止",
          "原 Git 操作未执行；工作树和 Git 历史没有被这次命令修改",
          { mode: "guided", action: "不要执行 push 或其他外部发布；本仓库由用户审核后手动发布", retryOriginal: true },
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_GIT_GUARD",
        "当前 Git 写入不满足阶段、批准或路径归属条件",
        "原 Git 操作未执行；工作树和 Git 历史没有被这次命令修改",
        { mode: "guided", action: "先完成实现批准并只暂存 feature-owned 路径；仓库规则禁止智能体提交时交由用户执行", retryOriginal: true },
      );
    case "WORKFLOW_STATE_UNREADABLE":
      return unreadableBlock(detail?.unreadableReason ?? block.reason);
    default:
      // GIT_STARTUP_EXCLUDED is an audit verdict and is never formatted as a block.
      return unreadableBlock(block.reason);
  }
}

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
