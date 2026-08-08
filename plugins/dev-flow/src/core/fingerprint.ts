import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, readlink, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathWithinFileScope } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { normalizeProjectPath } from "./path-normalization.js";

const runFile = promisify(execFile);
const ignored = new Set([".git", ".dev-flow", "node_modules"]);

export interface GovernedRootsConfig {
  governedRoots: string[];
  governedRootsExclude?: string[];
}

type GovernedRootsInput = GovernedRootsConfig | string[];

function configFor(input: GovernedRootsInput): GovernedRootsConfig {
  return Array.isArray(input) ? { governedRoots: input } : input;
}

async function collect(root: string, relative: string, files: string[], excludes?: string[]): Promise<void> {
  const absolute = path.join(root, relative);
  let entries;
  try { entries = await readdir(absolute, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const child = normalizeProjectPath(path.join(relative, entry.name));
    if (excludes?.some((pattern) => pathWithinFileScope(child, [pattern]))) continue;
    const target = path.join(root, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root, child, files, excludes);
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
    throw new DevFlowError("PROTECTED_ROOT_ENUMERATION_FAILED", "Git 无法枚举 governed roots。", {
      command: ["git", ...args].join(" "),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function gitFiles(root: string, governedRoots: string[]): Promise<string[] | undefined> {
  const hasMetadata = await hasGitMetadata(root);
  let insideWorktree = false;
  try {
    insideWorktree = (await gitOutput(root, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch (error) {
    if (!hasMetadata) return undefined;
    throw error;
  }
  if (!insideWorktree) return undefined;
  const output = await gitOutput(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...governedRoots]);
  return output.split("\0").filter(Boolean).map(normalizeProjectPath);
}

async function gitTrackedFiles(root: string, governedRoots: string[]): Promise<Set<string>> {
  const output = await gitOutput(root, ["ls-files", "--cached", "-z", "--", ...governedRoots]);
  return new Set(output.split("\0").filter(Boolean).map(normalizeProjectPath));
}

function withinConfiguredRoot(file: string, governedRoots: string[]): boolean {
  return governedRoots.some((root) => root === "." || file === root || file.startsWith(`${root}/`));
}

function applyExcludes(files: string[], excludes: string[] | undefined): string[] {
  return files.filter((file) => !excludes?.some((pattern) => pathWithinFileScope(file, [pattern])));
}

async function assertGovernedRootsSafe(root: string, governedRoots: string[]): Promise<void> {
  for (const relative of governedRoots) {
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
export async function enumerateProtectedFiles(root: string, input: GovernedRootsInput): Promise<string[]> {
  const config = configFor(input);
  const governedRoots = [...new Set(config.governedRoots.map(normalizeProjectPath))].sort();
  const fromGit = await gitFiles(root, governedRoots);
  if (!fromGit) {
    const rootsToValidate = governedRoots.filter((entry) => !config.governedRootsExclude?.some((pattern) => pathWithinFileScope(entry, [pattern])));
    await assertGovernedRootsSafe(root, rootsToValidate);
  }
  const files = fromGit ?? (() => {
    const collected: string[] = [];
    return Promise.all(governedRoots.map((item) => collect(root, item, collected, config.governedRootsExclude))).then(() => collected);
  })();
  const resolved = await files;
  const unique = applyExcludes([...new Set(resolved
    .map(normalizeProjectPath)
    .filter((file) => withinConfiguredRoot(file, governedRoots)))].sort(), config.governedRootsExclude);
  const tracked = fromGit ? await gitTrackedFiles(root, governedRoots) : new Set<string>();
  for (const relative of unique) {
    let metadata;
    try { metadata = await lstat(path.join(root, relative)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      if (!tracked.has(relative)) throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink must be Git-tracked: ${relative}`, { path: relative, recoveryHint: "跟踪该仓内链接，或将其排除在 governedRoots 之外" });
      const resolvedTarget = await realpath(path.join(root, relative));
      const rootPath = await realpath(root);
      const targetRelative = normalizeProjectPath(path.relative(rootPath, resolvedTarget));
      if (!targetRelative || targetRelative === ".." || targetRelative.startsWith("../") || path.isAbsolute(targetRelative)
        || targetRelative === ".git" || targetRelative.startsWith(".git/") || targetRelative === ".dev-flow" || targetRelative.startsWith(".dev-flow/")) {
        throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink target escapes governed safety boundary: ${relative}`, { path: relative, linkTarget: await readlink(path.join(root, relative)) });
      }
    }
  }
  const present = [];
  for (const relative of unique) {
    try { await lstat(path.join(root, relative)); present.push(relative); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return present;
}

/** Hashes only explicitly configured business roots, never workflow state or Git metadata. */
export async function fingerprintGovernedRoots(root: string, input: GovernedRootsInput): Promise<string> {
  const files = await enumerateProtectedFiles(root, input);
  const digest = createHash("sha256");
  for (const relative of files) {
    const absolute = path.join(root, relative);
    const metadata = await lstat(absolute);
    digest.update(relative); digest.update("\0");
    if (metadata.isSymbolicLink()) {
      digest.update("symlink\0");
      digest.update(await readlink(absolute));
    } else {
      digest.update("file\0");
      digest.update(await readFile(absolute));
    }
    digest.update("\0");
  }
  return digest.digest("hex");
}

export interface ProtectedFileSnapshot {
  path: string;
  sha256: string;
  /** Permission bits as an octal string, e.g. "644". */
  mode: string;
  kind?: "file" | "symlink";
  linkTarget?: string;
}

/** Per-file snapshot used by implementation-unit baselines and checkpoint diffs. */
export async function snapshotGovernedRoots(root: string, input: GovernedRootsInput): Promise<ProtectedFileSnapshot[]> {
  const files = await enumerateProtectedFiles(root, input);
  const snapshots: ProtectedFileSnapshot[] = [];
  for (const relative of files) {
    const absolute = path.join(root, relative);
    const metadata = await lstat(absolute);
    const symbolic = metadata.isSymbolicLink();
    const bytes = symbolic ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mode: (metadata.mode & 0o777).toString(8).padStart(3, "0"),
      kind: symbolic ? "symlink" : "file",
      ...(symbolic ? { linkTarget: bytes.toString("utf8") } : {}),
    });
  }
  return snapshots;
}
