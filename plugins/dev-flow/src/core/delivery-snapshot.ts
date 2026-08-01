import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DevFlowError } from "./errors.js";
import type { ProjectConfig } from "./project-config.js";
import type { FeatureState } from "./state-store.js";

const run = promisify(execFile);

export interface DeliveryBaseline {
  gitHead?: string;
  dirtyPaths: string[];
}

export interface DeliverySnapshot {
  manifestPath: string;
  manifestSha256: string;
  patchPath: string;
  patchSha256: string;
  baseHead: string;
  files: string[];
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function git(root: string, args: string[], allowExitOne = false): Promise<string> {
  try {
    const result = await run("git", args, { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
    return Buffer.from(result.stdout).toString("utf8");
  } catch (error) {
    const failure = error as { code?: number; stdout?: string | Buffer; stderr?: string | Buffer; message: string };
    if (allowExitOne && failure.code === 1) return Buffer.from(failure.stdout ?? "").toString("utf8");
    const details = Buffer.from(failure.stderr ?? failure.message).toString("utf8").trim();
    throw new DevFlowError("DELIVERY_SNAPSHOT_GIT_REQUIRED", "delivery snapshots require a Git repository with a readable HEAD", {
      recoveryHint: "Initialize or repair Git, commit the baseline, then rerun finalize",
      ...(details ? { gitError: details } : {}),
    });
  }
}

function nulItems(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function normalizePath(value: string): string {
  const slashPath = value.replaceAll("\\\\", "/");
  const normalized = path.posix.normalize(slashPath);
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.startsWith("../")
    || normalized === ".." || normalized.startsWith(".dev-flow/") || normalized !== slashPath) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must be normalized project-relative protected paths", {
      path: value,
    });
  }
  return normalized;
}

function isWithinProtectedRoot(file: string, protectedRoots: string[]): boolean {
  return protectedRoots.some((root) => root === "." || file === root || file.startsWith(`${root}/`));
}

export function assertImplementationFilesInProtectedRoots(files: string[], protectedRoots: string[]): void {
  if (files.some((file) => !isWithinProtectedRoot(file, protectedRoots))) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must be inside configured protectedRoots", {
      protectedRoots,
    });
  }
}

/** Validates and normalizes the feature-owned files registered by implementation. */
export function implementationFiles(evidence: unknown): string[] {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    throw new DevFlowError("IMPLEMENTATION_FILES_REQUIRED", "implementation evidence must include files: string[]");
  }
  const files = (evidence as { files?: unknown }).files;
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string")) {
    throw new DevFlowError("IMPLEMENTATION_FILES_REQUIRED", "implementation evidence must include files: string[]");
  }
  const normalized = files.map(normalizePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must not contain duplicates");
  }
  return normalized.sort();
}

const missingFileHint = "files 只接受纯路径，如 \"src/foo.js\"（而非 \"src/foo.js (新增)\"）；先创建或登记实际存在的文件后再重录";

/**
 * Every registered implementation file must exist on disk. A file is still
 * acceptable when Git reports it as deleted (worktree or staged) or as the
 * renamed-from source of an R/C entry — those are legitimate feature-owned
 * removals. Git failures (non-repository) reject conservatively.
 */
export async function assertImplementationFilesExist(root: string, files: string[]): Promise<void> {
  const missing: string[] = [];
  for (const file of files) {
    try { await lstat(path.join(root, file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(file);
    }
  }
  if (!missing.length) return;
  let status: string;
  try { status = await git(root, ["status", "--porcelain=v1", "-z"]); }
  catch (error) {
    if (error instanceof DevFlowError && error.code === "DELIVERY_SNAPSHOT_GIT_REQUIRED") {
      throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", `implementation file does not exist: ${missing.join(", ")}`, {
        files: missing,
        recoveryHint: missingFileHint,
      });
    }
    throw error;
  }
  const allowed = new Set<string>();
  const items = nulItems(status);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    if (code.includes("D")) allowed.add(normalizePath(item.slice(3)));
    if (/[RC]/.test(code)) {
      const original = items[index + 1];
      if (original) {
        allowed.add(normalizePath(original));
        index += 1;
      }
    }
  }
  const stillMissing = missing.filter((file) => !allowed.has(file));
  if (stillMissing.length) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", `implementation file does not exist: ${stillMissing.join(", ")}`, {
      files: stillMissing,
      recoveryHint: missingFileHint,
    });
  }
}

function statusPaths(value: string): string[] {
  const items = nulItems(value);
  const paths = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const status = item.slice(0, 2);
    paths.add(normalizePath(item.slice(3)));
    if (/[RC]/.test(status)) {
      const original = items[index + 1];
      if (original) {
        paths.add(normalizePath(original));
        index += 1;
      }
    }
  }
  return [...paths].sort();
}

async function dirtyPaths(root: string, protectedRoots: string[]): Promise<string[]> {
  const output = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...protectedRoots]);
  return statusPaths(output);
}

export async function captureDeliveryBaseline(root: string, protectedRoots: string[]): Promise<DeliveryBaseline> {
  try {
    const gitHead = (await git(root, ["rev-parse", "HEAD"])).trim();
    return { gitHead, dirtyPaths: await dirtyPaths(root, protectedRoots) };
  } catch (error) {
    if (error instanceof DevFlowError && error.code === "DELIVERY_SNAPSHOT_GIT_REQUIRED") {
      return { dirtyPaths: [] };
    }
    throw error;
  }
}

async function fileHash(root: string, file: string): Promise<string | "deleted"> {
  try { return digest(await readFile(path.join(root, file))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "deleted";
    throw error;
  }
}

async function assertPlainFile(root: string, file: string): Promise<void> {
  const metadata = await lstat(path.join(root, file));
  if (!metadata.isFile()) throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "untracked implementation files must be regular files", { path: file });
}

async function untrackedFiles(root: string, files: string[]): Promise<Set<string>> {
  if (!files.length) return new Set();
  const output = await git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...files]);
  return new Set(nulItems(output).map(normalizePath));
}

export async function createDeliverySnapshot(
  root: string,
  featureId: string,
  state: FeatureState,
  config: ProjectConfig,
): Promise<DeliverySnapshot | undefined> {
  const files = implementationFiles(state.steps.implementation?.evidence);
  assertImplementationFilesInProtectedRoots(files, config.protectedRoots);

  const baseline = state.deliveryBaseline;
  if (!baseline?.gitHead) {
    throw new DevFlowError("DELIVERY_SNAPSHOT_GIT_REQUIRED", "delivery snapshots require Git HEAD captured at feature start", {
      recoveryHint: "Start a new feature from a committed Git baseline before modifying protected files",
    });
  }
  const currentHead = (await git(root, ["rev-parse", "HEAD"])).trim();
  if (currentHead !== baseline.gitHead) {
    throw new DevFlowError("DELIVERY_BASELINE_CHANGED", "Git HEAD changed after this feature started; delivery snapshot ownership is no longer reliable", {
      expectedHead: baseline.gitHead,
      currentHead,
      recoveryHint: "Start a new feature from the current committed HEAD, then reapply and verify the intended changes",
    });
  }
  const initialDirty = new Set(baseline.dirtyPaths);
  const claimedDirty = files.filter((file) => initialDirty.has(file));
  if (claimedDirty.length) {
    throw new DevFlowError("DELIVERY_FILE_PREEXISTING_DIRTY", "feature-owned files were already dirty when the feature started", {
      files: claimedDirty,
      recoveryHint: "Isolate the feature in a clean worktree or exclude the pre-existing changes before finalizing",
    });
  }

  const currentDirty = await dirtyPaths(root, config.protectedRoots);
  const unexpected = currentDirty.filter((file) => !initialDirty.has(file) && !files.includes(file));
  if (unexpected.length) {
    throw new DevFlowError("DELIVERY_FILE_UNREGISTERED", "protected changes are not registered in implementation evidence", {
      files: unexpected,
      recoveryHint: "把每个 feature 拥有的受保护文件加入 implementation evidence.files（只接受纯路径，如 \"src/foo.js\" 而非 \"src/foo.js (新增)\"），然后重新验证并 finalize",
    });
  }
  const changed = files.filter((file) => currentDirty.includes(file));
  const untracked = await untrackedFiles(root, changed);
  const tracked = changed.filter((file) => !untracked.has(file));
  const patches: string[] = [];
  if (tracked.length) {
    patches.push(await git(root, ["diff", "--binary", "--full-index", "--no-ext-diff", baseline.gitHead, "--", ...tracked]));
  }
  for (const file of [...untracked].sort()) {
    await assertPlainFile(root, file);
    patches.push(await git(root, ["diff", "--binary", "--no-index", "--", "/dev/null", file], true));
  }

  const relativeDirectory = path.posix.join(".dev-flow", "features", featureId);
  const patchFilename = "交付快照.patch";
  const manifestFilename = "交付快照文档.md";
  const patchPath = path.posix.join(relativeDirectory, patchFilename);
  const manifestPath = path.posix.join(relativeDirectory, manifestFilename);
  const patch = patches.filter(Boolean).join("\n");
  const patchHash = digest(patch);
  await writeFile(path.join(root, patchPath), patch, "utf8");
  const rows = await Promise.all(files.map(async (file) => `| ${file} | ${currentDirty.includes(file) ? "changed" : "unchanged"} | ${await fileHash(root, file)} |`));
  const manifest = [
    "# 交付快照",
    "",
    `- Feature: ${featureId}`,
    `- Base Git HEAD: ${baseline.gitHead}`,
    `- Patch: ${patchFilename}`,
    `- Patch SHA-256: ${patchHash}`,
    "",
    "## 已登记文件",
    "",
    "| 路径 | 状态 | SHA-256 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## 回滚",
    "",
    `在仓库根目录执行：\`git apply -R --binary ${patchPath}\``,
    "",
  ].join("\n");
  const manifestHash = digest(manifest);
  await writeFile(path.join(root, manifestPath), manifest, "utf8");
  return { manifestPath, manifestSha256: manifestHash, patchPath, patchSha256: patchHash, baseHead: baseline.gitHead, files };
}
