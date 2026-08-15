import path from "node:path";

// ---------------------------------------------------------------------------
// 句法解析：命令如何收成语义意图。归属、阶段、单元、批准判断都在 Core writeGate。
// 本模块只有纯函数：同一命令文本必得同一解析结果，可表驱动直测。
// ---------------------------------------------------------------------------

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
  prompt?: unknown;
  agent_id?: unknown;
  agent_transcript_path?: unknown;
  parent_agent_id?: unknown;
  session_id?: unknown;
}

const directWriteTools = new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);

export function toolName(event: HookEvent): string {
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
export function projectRelativePaths(root: string, targets: string[]): string[] {
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

function patchTargets(value: unknown): string[] {
  const text = typeof value === "string" ? value : "";
  const targets = new Set<string>();
  for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) targets.add(match[1].trim());
  for (const match of text.matchAll(/^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/gm)) {
    if (match[1] !== "/dev/null") targets.add(match[1].trim());
  }
  return [...targets];
}

export function directTargets(event: HookEvent): string[] {
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
