import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { RepositoryObservation } from "../policy/types.js";
import { DevFlowError } from "./errors.js";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

function invalid(message: string): never {
  throw new DevFlowError("INVALID_REPOSITORY_FACT", message, {
    recoveryHint: "修正结构化仓库观察后重试；观察必须能由 Core 在当前仓库中重复执行。",
    retryOriginal: true,
  });
}

function safeRelative(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(absoluteRoot, absolute).split(path.sep).join("/");
  if (!relative || relative === "." || relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)
    || relative === ".git" || relative.startsWith(".git/") || relative === ".dev-flow" || relative.startsWith(".dev-flow/")
    || relative === "node_modules" || relative.startsWith("node_modules/")) invalid(`repository observation path escapes the project: ${candidate}`);
  return relative;
}

async function filesInScope(root: string, scope: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const raw of scope) {
    const entry = safeRelative(root, raw);
    const absolute = path.join(root, entry);
    let metadata;
    try { metadata = await lstat(absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") invalid(`repository observation scope does not exist: ${entry}`);
      throw invalid(`repository observation scope is not readable: ${entry}`);
    }
    if (metadata.isSymbolicLink()) invalid(`repository observation scope cannot be a symbolic link: ${entry}`);
    if (metadata.isFile()) files.push(entry);
    else if (metadata.isDirectory()) {
      for (const child of await readdir(absolute, { recursive: true })) {
        const relative = path.posix.join(entry, String(child).split(path.sep).join("/"));
        const childAbsolute = path.join(root, relative);
        try {
          const childMetadata = await lstat(childAbsolute);
          if (childMetadata.isFile() && !childMetadata.isSymbolicLink()) files.push(relative);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    } else invalid(`repository observation scope is not a file or directory: ${entry}`);
  }
  return [...new Set(files)].sort();
}

async function readRegularFile(root: string, candidate: string): Promise<{ path: string; contents: string; sha256: string }> {
  const relative = safeRelative(root, candidate);
  const absolute = path.join(root, relative);
  let metadata;
  try { metadata = await lstat(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") invalid(`repository observation file does not exist: ${relative}`);
    throw invalid(`repository observation file is not readable: ${relative}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) invalid(`repository observation file is not a regular file: ${relative}`);
  try {
    const contents = await readFile(absolute, "utf8");
    return { path: relative, contents, sha256: digest(contents) };
  } catch { throw invalid(`repository observation file is not readable: ${relative}`); }
}

function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) invalid("json-value observation pointer must be an RFC 6901 pointer");
  let current = value;
  for (const segment of pointer.slice(1).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in (current as Record<string, unknown>))) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeRegex(pattern: string): RegExp {
  if (!pattern || pattern.length > 200 || /(?:\\[1-9]|\([^)]*[+*][^)]*\)[+*])/.test(pattern)) {
    invalid("search-absent regex is empty, too long, or potentially catastrophic");
  }
  try { return new RegExp(pattern, "m"); }
  catch { throw invalid("search-absent regex is invalid"); }
}

export async function executeRepositoryObservation(root: string, observation: RepositoryObservation): Promise<{ confirmed: boolean; observedFingerprint: string; summary: string }> {
  if (observation.kind === "file-exists") {
    const file = await readRegularFile(root, observation.path);
    return { confirmed: true, observedFingerprint: file.sha256, summary: `${file.path} is a readable file` };
  }
  if (observation.kind === "text-present" || observation.kind === "symbol-present") {
    const file = await readRegularFile(root, observation.path);
    const needle = observation.kind === "text-present" ? observation.text : observation.symbol;
    if (!needle.trim()) invalid(`${observation.kind} observation requires a non-empty anchor`);
    const count = file.contents.split(needle).length - 1;
    const required = observation.kind === "text-present" ? observation.occurrence ?? 1 : 1;
    return { confirmed: count >= required, observedFingerprint: file.sha256, summary: `${file.path} contains ${observation.kind === "text-present" ? "the requested text" : "the requested symbol"}` };
  }
  if (observation.kind === "json-value") {
    const file = await readRegularFile(root, observation.path);
    let parsed: unknown;
    try { parsed = JSON.parse(file.contents); } catch { return { confirmed: false, observedFingerprint: file.sha256, summary: `${file.path} is not valid JSON` }; }
    return { confirmed: equalJson(jsonPointer(parsed, observation.pointer), observation.expected), observedFingerprint: file.sha256, summary: `${file.path} JSON pointer ${observation.pointer} matches the expected value` };
  }
  const files = await filesInScope(root, observation.checkedScope);
  const matcher = observation.patternKind === "literal" ? undefined : safeRegex(observation.pattern);
  let hit = false;
  const hashes: string[] = [];
  for (const file of files) {
    const read = await readRegularFile(root, file);
    hashes.push(`${file}:${read.sha256}`);
    if (matcher ? matcher.test(read.contents) : read.contents.includes(observation.pattern)) hit = true;
  }
  const observedFingerprint = digest(hashes.sort().join("\n"));
  return { confirmed: !hit, observedFingerprint, summary: `${observation.patternKind} search across ${files.length} files found no match` };
}

/** Legacy location fingerprint used only while loading the current 5.0 v4 active shape. */
export async function computeLocationFingerprint(root: string, location: { kind: "positive"; path: string } | { kind: "negative"; checkedScope: string[] }): Promise<string> {
  if (location.kind === "positive") return (await readRegularFile(root, location.path)).sha256;
  const files = await filesInScope(root, location.checkedScope);
  const hashes: string[] = [];
  for (const file of files) hashes.push(`${file}:${(await readRegularFile(root, file)).sha256}`);
  return digest(hashes.sort().join("\n"));
}

export async function assertPositiveAnchor(root: string, location: { path: string; anchor?: string }): Promise<void> {
  if (!location.anchor) return;
  const file = await readRegularFile(root, location.path);
  if (!file.contents.includes(location.anchor)) invalid(`repository fact anchor is not present: ${location.path}`);
}
