import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DevFlowError } from "./errors.js";
import { normalizeProjectPath, normalizeUnicode } from "./path-normalization.js";
import type { ProjectConfig } from "./project-config.js";
import type { FeatureState } from "./state-store.js";
import { pathWithinFileScope } from "../policy/rollback.js";
import { changedPathsBetween, gitBranchAndHead, isAncestor } from "./git-reconciliation.js";
import { currentRiskAuthorizations } from "./governance-state.js";

const run = promisify(execFile);

export interface DeliveryBaseline {
  gitHead?: string;
  baseBranch?: string;
  dirtyPaths: string[];
  startedDirty?: Record<string, { status: "staged" | "unstaged" | "untracked" | "deleted" | "renamed"; sha256?: string; blobSha256?: string; renamedFrom?: string }>;
}

export interface DeliverySnapshot {
  manifestPath: string;
  manifestSha256: string;
  patchPath: string;
  patchSha256: string;
  baseHead: string;
  finalHead?: string;
  branch?: string;
  files: string[];
  commitRange?: string[];
  ownedPaths?: string[];
  manualAdoptedPaths?: string[];
  uncommittedPaths?: string[];
  qualityExceptions?: string[];
  /** 已排除但仍有内容变化的路径（透明性提示，不属于交付内容）。 */
  excludedChangedPaths?: string[];
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
  const slashPath = normalizeUnicode(value).replaceAll("\\", "/");
  const normalized = normalizeProjectPath(slashPath);
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.startsWith("../")
    || normalized === ".." || normalized.startsWith(".dev-flow/") || normalized !== slashPath) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "实现文件必须是规范化的项目相对 governed 路径。", {
      path: value,
    });
  }
  return normalized;
}

function isWithinProtectedRoot(file: string, governedRoots: string[]): boolean {
  return governedRoots.some((root) => root === "." || file === root || file.startsWith(`${root}/`));
}

export function assertImplementationFilesInGovernedRoots(files: string[], governedRoots: string[]): void {
  if (files.some((file) => !isWithinProtectedRoot(file, governedRoots))) {
    throw new DevFlowError("INVALID_IMPLEMENTATION_FILE", "implementation files must be inside configured governedRoots", {
      governedRoots,
      recoveryHint: "实现证据只登记 feature-owned 且位于 governedRoots 的文件；测试、日志和验证产物请放入 verification evidence，或先把确属交付范围的目录加入 governedRoots",
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

/** Core derives delivery files from Git drift plus explicit/trusted ownership. */
export async function deriveImplementationFiles(root: string, state: FeatureState, config: ProjectConfig): Promise<string[]> {
  const current = await gitBranchAndHead(root);
  const committed = await changedPathsBetween(root, state.workspace.baseHead, current.head);
  const dirty = await dirtyPaths(root, config);
  const changed = [...new Set([...committed, ...dirty])]
    .filter((file) => isWithinProtectedRoot(file, config.governedRoots))
    .filter((file) => !config.governedRootsExclude?.some((pattern) => pathWithinFileScope(file, [pattern])))
    .sort();
  const unknown = changed.filter((file) => state.workspace.ownership[file] !== "feature" && state.workspace.ownership[file] !== "excluded");
  if (unknown.length) throw new DevFlowError("DELIVERY_OWNERSHIP_UNRESOLVED", "存在尚未确认归属的 governed 文件。", {
    files: unknown,
    recoveryHint: "运行 dev_flow_reconcile_workspace，并逐个回答 ownership decision 后重试 implementation",
  });
  return changed.filter((file) => state.workspace.ownership[file] === "feature");
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

async function dirtyPaths(root: string, config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">): Promise<string[]> {
  const output = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...config.governedRoots]);
  return statusPaths(output).filter((file) => !config.governedRootsExclude?.some((pattern) => pathWithinFileScope(file, [pattern])));
}

export async function captureDeliveryBaseline(root: string, config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">): Promise<DeliveryBaseline> {
  try {
    const gitHead = (await git(root, ["rev-parse", "HEAD"])).trim();
    return { gitHead, dirtyPaths: await dirtyPaths(root, config) };
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
  const implementation = implementationFiles(state.steps.implementation?.evidence);
  assertImplementationFilesInGovernedRoots(implementation, config.governedRoots);

  const baseline = state.deliveryBaseline;
  const lineage = state.workspace;
  if (!baseline?.gitHead || !lineage.baseHead) {
    throw new DevFlowError("DELIVERY_SNAPSHOT_GIT_REQUIRED", "交付快照需要 feature 启动时捕获的 Git 基线。", {
      userMessage: "当前仓库没有可证明的 Git 基线，不能生成交付快照。",
      cause: "启动时没有可读取的 HEAD。",
      impact: "最终交付内容无法与启动状态比较。",
      recoveryKind: "repair",
      recoveryInstruction: "修复 Git 仓库后重新开始 feature；系统不会猜测基线。",
      retryOriginal: false,
    });
  }
  const current = await gitBranchAndHead(root);
  if (lineage.baseBranch && current.branch !== lineage.baseBranch) {
    throw new DevFlowError("GIT_BRANCH_CHANGED", "当前分支与 feature 启动分支不同。", { baseBranch: lineage.baseBranch, currentBranch: current.branch, recoveryHint: "切回启动分支后重新对账" });
  }
  if (!(await isAncestor(root, lineage.baseHead, current.head))) {
    throw new DevFlowError("GIT_HISTORY_REWRITE", "当前 HEAD 不是 feature 基线的祖先链后代。", { baseHead: lineage.baseHead, currentHead: current.head, recoveryHint: "恢复可证明的提交链后重新对账" });
  }

  const initialDirty = new Set(Object.keys(lineage.startedDirty).length ? Object.keys(lineage.startedDirty) : baseline.dirtyPaths);
  const currentDirty = await dirtyPaths(root, config);
  const committed = await changedPathsBetween(root, lineage.baseHead, current.head);
  const featureOwned = new Set([
    ...implementation,
    ...Object.entries(lineage.ownership).filter(([, owner]) => owner === "feature").map(([file]) => file),
  ]);
  const protectedChanged = [...new Set([...committed, ...currentDirty])].filter((file) => isWithinProtectedRoot(file, config.governedRoots));
  const unexpected = protectedChanged.filter((file) => !featureOwned.has(file)
    && !(initialDirty.has(file) && lineage.ownership[file] === "excluded"));
  if (unexpected.length) {
    throw new DevFlowError("DELIVERY_FILE_UNREGISTERED", "存在尚未归属的受保护文件变更。", {
      files: unexpected,
      userMessage: "发现未归属的受保护文件变更，不能生成交付快照。",
      cause: "系统不会猜测这些改动属于当前 feature。",
      impact: "交付快照可能混入其他任务的内容。",
      recoveryKind: "ask-user",
      recoveryInstruction: "先通过工作区对账接纳文件、调整范围，或由用户处理这些文件后重试。",
      requiresUserDecision: true,
      retryOriginal: false,
    });
  }
  const claimedDirty = [...featureOwned].filter((file) => initialDirty.has(file) && lineage.ownership[file] !== "feature");
  if (claimedDirty.length) {
    throw new DevFlowError("DELIVERY_FILE_PREEXISTING_DIRTY", "feature-owned 文件在启动时已经有未归属改动。", {
      files: claimedDirty,
      userMessage: "当前 feature 的文件在启动前已有改动，尚未完成归属。",
      cause: "启动脏树必须先经过用户归属决策。",
      impact: "系统不会把预存改动静默算入本次交付。",
      recoveryKind: "ask-user",
      recoveryInstruction: "接纳这些改动为当前 feature，或先提交、暂存/恢复后再继续。",
      requiresUserDecision: true,
      retryOriginal: false,
    });
  }
  const files = [...featureOwned].sort();
  // 非交付改动：已明确排除但仍有内容变化的 governed 路径。只作透明性
  // 提示，不加入 patch、不阻塞 finalize、不重新打开归属交互。
  const excludedChangedPaths = protectedChanged
    .filter((file) => lineage.ownership[file] === "excluded")
    .sort();
  const untracked = await untrackedFiles(root, files);
  const tracked = files.filter((file) => !untracked.has(file));
  const patches: string[] = [];
  if (tracked.length) patches.push(await git(root, ["diff", "--binary", "--full-index", "--no-ext-diff", lineage.baseHead, "--", ...tracked]));
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
    `- Base Git HEAD: ${lineage.baseHead}`,
    `- Final Git HEAD: ${current.head}`,
    `- Branch: ${current.branch}`,
    `- Commit range: ${lineage.baseHead}..${current.head}`,
    `- Patch: ${patchFilename}`,
    `- Patch SHA-256: ${patchHash}`,
    "",
    "## 已登记文件",
    "",
    "| 路径 | 状态 | SHA-256 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## 归属记录",
    "",
    `- Feature-owned 路径：${files.length ? files.join(", ") : "无"}`,
    `- 用户手动接纳路径：${Object.entries(lineage.ownershipSource).filter(([, source]) => source === "user-adopted").map(([file]) => file).join(", ") || "无"}`,
    `- 未提交路径：${currentDirty.filter((file) => featureOwned.has(file)).join(", ") || "无"}`,
    `- 用户接受风险：${currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).map((authorization) => authorization.target).join(", ") || "无"}`,
    ...(excludedChangedPaths.length ? [
      "",
      "## 非交付改动",
      "",
      "以下路径已被排除或不属于当前任务交付，但仍检测到变化；它们不会进入交付 patch，也不会阻塞完成。请记得单独处理：",
      "",
      ...excludedChangedPaths.map((file) => `- ${file}`),
    ] : []),
    "",
    "## 回滚",
    "",
    `在仓库根目录执行：\`git apply -R --binary ${patchPath}\``,
    "",
  ].join("\n");
  const manifestHash = digest(manifest);
  await writeFile(path.join(root, manifestPath), manifest, "utf8");
  return {
    manifestPath,
    manifestSha256: manifestHash,
    patchPath,
    patchSha256: patchHash,
    baseHead: lineage.baseHead,
    finalHead: current.head,
    branch: current.branch,
    files,
    commitRange: current.head === lineage.baseHead ? [] : [lineage.baseHead, current.head],
    ownedPaths: files,
    manualAdoptedPaths: Object.entries(lineage.ownershipSource).filter(([, source]) => source === "user-adopted").map(([file]) => file),
    uncommittedPaths: currentDirty.filter((file) => featureOwned.has(file)),
    qualityExceptions: currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).map((authorization) => authorization.target),
    ...(excludedChangedPaths.length ? { excludedChangedPaths } : {}),
  };
}
