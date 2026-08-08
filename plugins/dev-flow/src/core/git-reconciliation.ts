import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectConfig } from "./project-config.js";
import type { FeatureState } from "./state-store.js";
import { DevFlowError } from "./errors.js";
import { normalizeProjectPath, normalizeUnicode } from "./path-normalization.js";
import type { ObservedCommit, StartedDirtyPath, WorkspaceLineage } from "../policy/types.js";
import { fingerprintGovernedRoots, snapshotGovernedRoots } from "./fingerprint.js";

const run = promisify(execFile);

async function git(root: string, args: string[], allowExitOne = false): Promise<string> {
  try {
    const result = await run("git", args, { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
    return Buffer.from(result.stdout).toString("utf8");
  } catch (error) {
    const failure = error as { code?: number; stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    if (allowExitOne && failure.code === 1) return Buffer.from(failure.stdout ?? "").toString("utf8");
    throw new DevFlowError("GIT_LINEAGE_UNAVAILABLE", "无法读取当前 Git 工作区。", {
      cause: Buffer.from(failure.stderr ?? failure.message ?? "").toString("utf8").trim() || "Git 命令失败。",
      impact: "无法确定 feature 的基线、提交归属和最终交付内容。",
      recoveryKind: "repair",
      recoveryInstruction: "检查 Git 仓库和当前分支后，刷新状态；不要继续 finalize。",
      retryOriginal: false,
      command: ["git", ...args].join(" "),
    });
  }
}

function normalizePath(value: string): string {
  return normalizeProjectPath(normalizeUnicode(value).replaceAll("\\", "/"));
}

function statusKind(code: string): StartedDirtyPath["status"] {
  if (code.includes("?") || code.includes("A")) return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code[0] !== " " && code[1] === " ") return "staged";
  return "unstaged";
}

async function contentHash(root: string, relative: string): Promise<string | undefined> {
  try {
    const metadata = await lstat(path.join(root, relative));
    if (!metadata.isFile()) return undefined;
    return createHash("sha256").update(await readFile(path.join(root, relative))).digest("hex");
  } catch {
    return undefined;
  }
}

async function dirtyPaths(root: string, config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">): Promise<Record<string, StartedDirtyPath>> {
  const output = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...config.governedRoots]);
  const items = output.split("\0").filter(Boolean);
  const result: Record<string, StartedDirtyPath> = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    const current = normalizePath(item.slice(3));
    if (config.governedRootsExclude?.some((pattern) => current === pattern || current.startsWith(`${pattern}/`))) {
      if (code.includes("R")) index += 1;
      continue;
    }
    const entry: StartedDirtyPath = {
      status: statusKind(code),
      ...(await contentHash(root, current) ? { sha256: await contentHash(root, current) } : {}),
    };
    if (code.includes("R") && items[index + 1]) {
      entry.renamedFrom = normalizePath(items[index + 1]);
      index += 1;
    }
    result[current] = entry;
  }
  return result;
}

async function branchName(root: string): Promise<string> {
  return (await git(root, ["branch", "--show-current"])).trim();
}

async function head(root: string): Promise<string> {
  return (await git(root, ["rev-parse", "HEAD"])).trim();
}

async function fingerprint(root: string, config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">): Promise<string> {
  return fingerprintGovernedRoots(root, config);
}

async function pathFingerprints(
  root: string,
  config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">,
): Promise<Record<string, string>> {
  return Object.fromEntries((await snapshotGovernedRoots(root, config)).map((file) => [
    file.path,
    `${file.kind ?? "file"}:${file.sha256}:${file.mode}`,
  ]));
}

export async function captureWorkspaceLineage(
  root: string,
  config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">,
): Promise<WorkspaceLineage> {
  // Dev Flow's ownership and recovery claims are anchored to a real Git HEAD.
  // A non-repository or unborn repository cannot provide that lineage and must
  // fail closed instead of manufacturing an empty baseline.
  const baseHead = await head(root);
  const baseBranch = await branchName(root);
  const startedDirty = await dirtyPaths(root, config);
  const lastWorkspaceFingerprint = await fingerprint(root, config);
  return {
    baseHead,
    baseBranch,
    observedHead: baseHead,
    startedDirty,
    ownership: {},
    ownershipSource: {},
    observedCommits: [],
    observedPathFingerprints: await pathFingerprints(root, config),
    lastWorkspaceFingerprint,
    reconciliationStatus: "current",
  };
}

export async function captureObservedCommits(root: string, baseHead: string, observedHead: string): Promise<ObservedCommit[]> {
  if (!baseHead || !observedHead || baseHead === observedHead) return [];
  const output = await git(root, ["log", "--format=%H%x00%P", `${baseHead}..${observedHead}`]);
  const commits: ObservedCommit[] = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const [hash, parents = ""] = line.split("\0");
    if (!hash) continue;
    const paths = await git(root, ["show", "--format=", "--name-only", "--pretty=", hash]);
    commits.push({
      hash,
      parentHashes: parents.split(" ").filter(Boolean),
      changedPaths: paths.split("\n").map((value) => value.trim()).filter(Boolean).map(normalizePath),
      source: "unknown",
      observedAt: new Date().toISOString(),
    });
  }
  return commits;
}

export async function changedPathsBetween(root: string, baseHead: string, observedHead: string): Promise<string[]> {
  if (!baseHead || !observedHead || baseHead === observedHead) return [];
  const output = await git(root, ["diff", "--name-only", "-z", baseHead, observedHead]);
  return output.split("\0").filter(Boolean).map(normalizePath).sort();
}

export async function gitBranchAndHead(root: string): Promise<{ branch: string; head: string }> {
  return { branch: await branchName(root), head: await head(root) };
}

export async function reconcileWorkspaceLineage(
  root: string,
  lineage: WorkspaceLineage,
  config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">,
): Promise<WorkspaceLineage> {
  const current = await gitBranchAndHead(root);
  if (lineage.baseBranch && current.branch !== lineage.baseBranch) {
    throw new DevFlowError("GIT_BRANCH_CHANGED", "当前分支已切换，不能自动假定提交归属。", {
      userMessage: "检测到当前分支发生变化，流程已安全停止。",
      cause: `启动分支为 ${lineage.baseBranch}，当前分支为 ${current.branch || "未命名分支"}。`,
      impact: "无法证明当前提交属于原 feature，审查和交付证据保持原状。",
      recoveryKind: "ask-user",
      recoveryInstruction: "切回原分支后刷新状态，或暂停/终止当前 feature。",
      requiresUserDecision: true,
      retryOriginal: false,
      baseBranch: lineage.baseBranch,
      currentBranch: current.branch,
    });
  }
  if (lineage.baseHead && !(await isAncestor(root, lineage.baseHead, current.head))) {
    throw new DevFlowError("GIT_HISTORY_REWRITE", "当前 HEAD 不是启动基线的后代。", {
      userMessage: "检测到 Git 历史无法证明连续，流程已安全停止。",
      cause: "启动基线不是当前 HEAD 的祖先。",
      impact: "交付内容和审查证据的提交归属不确定，不能伪装成功。",
      recoveryKind: "repair",
      recoveryInstruction: "恢复可证明的提交链后刷新状态，或暂停/终止当前 feature。",
      retryOriginal: false,
      baseHead: lineage.baseHead,
      currentHead: current.head,
    });
  }
  const observedCommits = await captureObservedCommits(root, lineage.baseHead, current.head);
  const knownCommits = new Set(lineage.observedCommits.map((commit) => commit.hash));
  return {
    ...lineage,
    observedHead: current.head,
    observedCommits: [...lineage.observedCommits, ...observedCommits.filter((commit) => !knownCommits.has(commit.hash))],
    observedPathFingerprints: await pathFingerprints(root, config),
    lastWorkspaceFingerprint: await fingerprint(root, config),
    reconciliationStatus: "current",
  };
}

export async function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean> {
  if (!ancestor || !descendant) return false;
  try {
    await git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    const failure = error as { code?: number };
    if (failure.code === 1) return false;
    throw error;
  }
}

export function ownershipForScope(
  lineage: WorkspaceLineage,
  inScope: string[],
  outOfScope: string[],
): WorkspaceLineage {
  const ownership = { ...lineage.ownership };
  const ownershipSource = { ...lineage.ownershipSource };
  for (const file of Object.keys(lineage.startedDirty)) {
    if (outOfScope.some((scope) => scope === "." || file === scope || file.startsWith(`${scope}/`))) {
      ownership[file] = "excluded";
    }
  }
  void inScope;
  return { ...lineage, ownership, ownershipSource };
}

export interface WorkspaceReconciliationResult {
  workspace: WorkspaceLineage;
  contentChanged: boolean;
  changedPaths: string[];
}

/**
 * Reconcile a feature's workspace lineage. Only paths changed since the last
 * observed HEAD (plus current dirty paths) are returned to freshness and
 * ownership handling; the full base-to-HEAD history remains audit lineage but
 * must not repeatedly invalidate old checkpoints.
 */
export async function reconcileWorkspaceForFeature(
  root: string,
  state: Pick<FeatureState, "workspace" | "scope">,
  config: Pick<ProjectConfig, "governedRoots" | "governedRootsExclude">,
): Promise<WorkspaceReconciliationResult> {
  const previouslyObservedHead = state.workspace.observedHead;
  let workspace = await reconcileWorkspaceLineage(root, state.workspace, config);
  const committedPaths = await changedPathsBetween(root, previouslyObservedHead, workspace.observedHead);
  const ownership = { ...workspace.ownership };
  const ownershipSource = { ...workspace.ownershipSource };
  for (const file of committedPaths) {
    if (state.scope.outOfScope.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`))) {
      ownership[file] = "excluded";
    }
  }
  workspace = { ...workspace, ownership, ownershipSource };
  const dirty = Object.keys(await dirtyPaths(root, config));
  const previousPaths = state.workspace.observedPathFingerprints ?? {};
  const currentPaths = workspace.observedPathFingerprints;
  const candidates = new Set([...Object.keys(previousPaths), ...Object.keys(currentPaths), ...committedPaths, ...dirty]);
  const changedPaths = [...candidates].filter((file) => previousPaths[file] !== currentPaths[file]).sort();
  return {
    workspace,
    contentChanged: changedPaths.length > 0,
    changedPaths,
  };
}

export function currentWorkspaceFingerprint(paths: Record<string, string | undefined>): string {
  const digest = createHash("sha256");
  for (const [file, hash] of Object.entries(paths).sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(file);
    digest.update("\0");
    digest.update(hash ?? "deleted");
    digest.update("\0");
  }
  return digest.digest("hex");
}
