import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathWithinFileScope } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { normalizeProjectPath } from "./path-normalization.js";

const runFile = promisify(execFile);
const ignored = new Set([".git", ".dev-flow", "node_modules"]);

export interface ProtectedRootsConfig {
  protectedRoots: string[];
  protectedRootsExclude?: string[];
}

type ProtectedRootsInput = ProtectedRootsConfig | string[];

function configFor(input: ProtectedRootsInput): ProtectedRootsConfig {
  return Array.isArray(input) ? { protectedRoots: input } : input;
}

async function collect(root: string, relative: string, files: string[]): Promise<void> {
  const absolute = path.join(root, relative);
  let entries;
  try { entries = await readdir(absolute, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const child = normalizeProjectPath(path.join(relative, entry.name));
    const target = path.join(root, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root, child, files);
    else if (metadata.isFile()) files.push(child);
  }
}

async function hasGitMetadata(root: string): Promise<boolean> {
  let current = path.resolve(root);
  while (true) {
    try {
      await lstat(path.join(current, ".git"));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function gitOutput(root: string, args: string[]): Promise<string> {
  try {
    const result = await runFile("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return String(result.stdout);
  } catch (error) {
    throw new DevFlowError("PROTECTED_ROOT_ENUMERATION_FAILED", "Git could not enumerate protected roots", {
      command: ["git", ...args].join(" "),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function gitFiles(root: string, protectedRoots: string[]): Promise<string[] | undefined> {
  const hasMetadata = await hasGitMetadata(root);
  let insideWorktree = false;
  try {
    insideWorktree = (await gitOutput(root, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch (error) {
    if (!hasMetadata) return undefined;
    throw error;
  }
  if (!insideWorktree) return undefined;
  const output = await gitOutput(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...protectedRoots]);
  return output.split("\0").filter(Boolean).map(normalizeProjectPath);
}

function withinConfiguredRoot(file: string, protectedRoots: string[]): boolean {
  return protectedRoots.some((root) => root === "." || file === root || file.startsWith(`${root}/`));
}

function applyExcludes(files: string[], excludes: string[] | undefined): string[] {
  return files.filter((file) => !excludes?.some((pattern) => pathWithinFileScope(file, [pattern])));
}

async function assertProtectedRootsSafe(root: string, protectedRoots: string[]): Promise<void> {
  for (const relative of protectedRoots) {
    try {
      const metadata = await lstat(path.join(root, relative));
      if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${relative}`);
    } catch (error) {
      if (error instanceof DevFlowError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Enumerate protected files using Git's ignore semantics when the project is a
 * worktree. A real worktree never silently falls back to recursive traversal.
 */
export async function enumerateProtectedFiles(root: string, input: ProtectedRootsInput): Promise<string[]> {
  const config = configFor(input);
  const protectedRoots = [...new Set(config.protectedRoots.map(normalizeProjectPath))].sort();
  await assertProtectedRootsSafe(root, protectedRoots);
  const fromGit = await gitFiles(root, protectedRoots);
  const files = fromGit ?? (() => {
    const collected: string[] = [];
    return Promise.all(protectedRoots.map((item) => collect(root, item, collected))).then(() => collected);
  })();
  const resolved = await files;
  const unique = [...new Set(resolved
    .map(normalizeProjectPath)
    .filter((file) => withinConfiguredRoot(file, protectedRoots)))].sort();
  for (const relative of unique) {
    let metadata;
    try { metadata = await lstat(path.join(root, relative)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${relative}`);
  }
  const present = [];
  for (const relative of unique) {
    try { await lstat(path.join(root, relative)); present.push(relative); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return applyExcludes(present, config.protectedRootsExclude);
}

/** Hashes only explicitly configured business roots, never workflow state or Git metadata. */
export async function fingerprintProtectedRoots(root: string, input: ProtectedRootsInput): Promise<string> {
  const files = await enumerateProtectedFiles(root, input);
  const digest = createHash("sha256");
  for (const relative of files) {
    digest.update(relative); digest.update("\0"); digest.update(await readFile(path.join(root, relative))); digest.update("\0");
  }
  return digest.digest("hex");
}

export interface ProtectedFileSnapshot {
  path: string;
  sha256: string;
  /** Permission bits as an octal string, e.g. "644". */
  mode: string;
}

/** Per-file snapshot used by implementation-unit baselines and checkpoint diffs. */
export async function snapshotProtectedRoots(root: string, input: ProtectedRootsInput): Promise<ProtectedFileSnapshot[]> {
  const files = await enumerateProtectedFiles(root, input);
  const snapshots: ProtectedFileSnapshot[] = [];
  for (const relative of files) {
    const absolute = path.join(root, relative);
    const metadata = await lstat(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash("sha256").update(await readFile(absolute)).digest("hex"),
      mode: (metadata.mode & 0o777).toString(8).padStart(3, "0"),
    });
  }
  return snapshots;
}
