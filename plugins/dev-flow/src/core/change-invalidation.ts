/**
 * 变更失效传播（issue 21）：审查之后交付内容再次变化时，自动重开受影响的
 * 实现单元（checkpoint）、代码审查与验证，确保最终交付内容与通过记录使用
 * 相同依据。无法定位变化影响时保守完整重开，并记录诊断原因。
 *
 * 基准选择：最近一次"通过记录"的全局逐文件快照——验证通过优先，其次代码
 * 审查。两者都不存在时（早期阶段）短路返回，零快照开销。
 */
import { fingerprintFeatureOwned, fingerprintGovernedRoots, snapshotGovernedRoots, type ProtectedFileSnapshot } from "./fingerprint.js";
import { DevFlowError } from "./errors.js";
import { mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { routeDefinitionForState } from "./step-order.js";
import { readCheckpointManifest } from "./checkpoint-store.js";
import { readEvidenceSnapshot, writeEvidenceSnapshot } from "./evidence-snapshot-store.js";
import { reopenImplementationUnit } from "../policy/rollback.js";

export interface AffectedClaimsInvalidation {
  /** 变化文件；undefined 表示基准快照缺失/损坏，无法定位到文件级。 */
  changedFiles: string[] | undefined;
  /** 被重开的实现单元（回 pending，重新 begin/checkpoint）。 */
  reopenedUnits: string[];
  /** 代码审查证据是否失效（需要重新完成双轴审查）。 */
  reviewReopened: boolean;
  /** 验证证据是否失效（需要重新运行验证）。 */
  verificationReopened: boolean;
  /** 无法定位变化影响时的完整回退是否发生。 */
  fallback: boolean;
  reason: string;
}

type RecordedBaseline = { fingerprint: string; snapshotPath?: string };

/** 最近一次"通过记录"的基准：验证通过优先，其次代码审查，再其次风险接受的绑定内容。 */
function recordedBaseline(state: FeatureState): RecordedBaseline | undefined {
  const verificationEvidence = state.steps.verification?.evidence as { snapshotPath?: string } | undefined;
  if (state.verification.verifiedFingerprint) {
    return { fingerprint: state.verification.verifiedFingerprint, snapshotPath: verificationEvidence?.snapshotPath };
  }
  const reviewEvidence = state.steps.code_review?.evidence as { fingerprint?: string; snapshotPath?: string } | undefined;
  if (typeof reviewEvidence?.fingerprint === "string") {
    return { fingerprint: reviewEvidence.fingerprint, snapshotPath: reviewEvidence.snapshotPath };
  }
  // 风险接受绑定接受时的交付内容（issue 22）：验证失败被接受后没有通过记录，
  // 内容变化必须仍能被检测到，使旧接受失效并回到验证步骤重新检查。
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const accepted = (state.governance?.authorizations ?? []).find((authorization) =>
    authorization.authorizationType === "risk-acceptance"
    && authorization.basis?.kind === "content"
    && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt));
  if (accepted?.basis?.kind === "content") return { fingerprint: accepted.basis.sha256 };
  return undefined;
}

/** 逐文件 diff 的路径集合（内容/权限/类型任一变化都算）。 */
function changedPaths(before: ProtectedFileSnapshot[], after: ProtectedFileSnapshot[]): string[] {
  const beforeMap = new Map(before.map((file) => [file.path, file]));
  const afterMap = new Map(after.map((file) => [file.path, file]));
  const changed = new Set<string>();
  for (const [filePath, beforeFile] of beforeMap) {
    const afterFile = afterMap.get(filePath);
    if (!afterFile) changed.add(filePath);
    else if (afterFile.sha256 !== beforeFile.sha256 || afterFile.mode !== beforeFile.mode) changed.add(filePath);
  }
  for (const [filePath] of afterMap) {
    if (!beforeMap.has(filePath)) changed.add(filePath);
  }
  return [...changed].sort();
}

/**
 * 幂等失效传播：工作区内容与最近一次通过记录不一致时，重开受影响步骤并
 * 返回失效明细；无变化、无通过记录或没有任何步骤需要重开时返回 undefined。
 * 旧的风险接受（quality exception）随内容变化自动变为 stale（issue 22）：
 * 验证/审查先自动重开重跑，问题仍存在时才需要用户再次接受风险。
 */
export async function invalidateAffectedClaims(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<AffectedClaimsInvalidation | undefined> {
  const state = await readState(root, id);
  if (state.lifecycle !== "active") return undefined;
  const baseline = recordedBaseline(state);
  if (!baseline) return undefined;
  const config = await readProjectConfig(root);
  const current = await fingerprintFeatureOwned(root, config, state.workspace.ownership);
  const currentFull = await fingerprintGovernedRoots(root, config);

  // 先计算逐文件差异，再决定是否短路。这样即使 feature-owned 指纹没有
  // 变化，也能发现 governed root 中新增但尚未归属的文件，并走完整回退；
  // 明确标记 excluded 的文件则不会触发失效。
  let changedFiles: string[] | undefined;
  if (baseline.snapshotPath) {
    try {
      const before = (await readEvidenceSnapshot(root, id, baseline.snapshotPath)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
      const after = (await snapshotGovernedRoots(root, config)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
      changedFiles = changedPaths(
        before,
        after,
      );
    } catch {
      changedFiles = undefined;
    }
  }
  const unownedDeliveryChange = changedFiles?.some((file) => state.workspace.ownership[file] === undefined) ?? true;
  // The feature-owned baseline is the source for ordinary delivery changes.
  // The initial full-workspace fingerprint is only useful when no per-file
  // snapshot exists; otherwise comparing against it would treat the feature's
  // own implementation writes as an unexplained external change.
  const fullDrift = baseline.snapshotPath
    ? unownedDeliveryChange
    : currentFull !== state.startBusinessFingerprint;
  if (current === baseline.fingerprint && !fullDrift) return undefined;

  const reviewEvidence = state.steps.code_review?.evidence as { fingerprint?: string } | undefined;
  const reviewReopened = state.steps.code_review !== undefined
    && (fullDrift || typeof reviewEvidence?.fingerprint !== "string" || reviewEvidence.fingerprint !== current);
  const verificationReopened = state.verification.verifiedFingerprint !== undefined
    && (fullDrift || state.verification.verifiedFingerprint !== current);
  // 风险接受绑定接受时的内容指纹（issue 22）：内容变化后旧接受自动失效，
  // 门禁与 next 不再放行，流程回到验证/审查步骤重新检查。
  const authorizationBound = (state.governance?.authorizations ?? []).some((authorization) =>
    authorization.authorizationType === "risk-acceptance"
    && authorization.basis?.kind === "content"
    && authorization.basis.sha256 !== current);
  let exceptionBound = authorizationBound;

  // 基准快照缺失/损坏时无法定位 → 完整回退。
  if (!baseline.snapshotPath && currentFull !== state.startBusinessFingerprint) {
    // Older risk authorizations have no per-file snapshot. Keep the safe
    // conservative behavior: report an unlocatable delivery change and reopen
    // the full evidence chain instead of asking ownership to hide it.
    changedFiles = undefined;
    exceptionBound = true;
  }
  // An unknown newly-added or renamed path is still a delivery change even if
  // the previous owned-only aggregate happens to remain equal. It must stale
  // risk authorization and force reconciliation.
  if ((changedFiles?.length ?? 0) > 0 && (state.governance?.authorizations ?? []).some((authorization) => authorization.authorizationType === "risk-acceptance")) {
    exceptionBound = true;
  }

  const checkpointed = (state.implementationUnits ?? []).filter((unit) => unit.status === "checkpointed");
  let reopenedUnits: string[] = [];
  let fallback = false;
  let reason = "";
  if (!changedFiles) {
    // 无法定位：缺少逐文件基准快照 → 完整重开（需求 5）。
    reopenedUnits = checkpointed.map((unit) => unit.unitId);
    fallback = reopenedUnits.length > 0;
    reason = reopenedUnits.length
      ? "无法定位变化影响：缺少逐文件基准快照，回退到完整实现重做"
      : "无实现单元记录，跳过单元重开";
  } else if (changedFiles.length > 0) {
    const matched = new Set<string>();
    for (const unit of checkpointed) {
      const manifest = await readCheckpointManifest(root, id, unit.checkpointId!);
      const unitFiles = new Set(manifest.files.map((record) => record.path));
      if (changedFiles.some((file) => unitFiles.has(file))) matched.add(unit.unitId);
    }
    reopenedUnits = [...matched].sort();
    if (reopenedUnits.length === 0) {
      // 变化文件不命中任何单元的实际写入集 → 无法定位 → 完整重开。
      reopenedUnits = checkpointed.map((unit) => unit.unitId);
      fallback = reopenedUnits.length > 0;
      reason = reopenedUnits.length
        ? "无法定位变化影响：变化文件未命中任何实现单元的实际写入范围，回退到完整实现重做"
        : "变化未命中任何实现单元";
    } else {
      reason = "受影响实现单元已重开";
    }
  } else {
    reason = "无文件级变化（仅元数据漂移），跳过单元重开";
  }

  if (reopenedUnits.length === 0 && !reviewReopened && !verificationReopened && !exceptionBound) return undefined;

  const invalidated: AffectedClaimsInvalidation = {
    changedFiles,
    reopenedUnits,
    reviewReopened,
    verificationReopened,
    fallback,
    reason,
  };
  await mutate(root, id, expectedRevision, "claims-invalidated", (draft) => {
    for (const unitId of reopenedUnits) {
      const unit = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
      if (!unit || unit.status !== "checkpointed") continue;
      reopenImplementationUnit(unit);
    }
    const liveReview = draft.steps.code_review?.evidence as { fingerprint?: string } | undefined;
    if (draft.steps.code_review !== undefined
      && (fullDrift || typeof liveReview?.fingerprint !== "string" || liveReview.fingerprint !== current)) {
      delete draft.steps.code_review;
    }
    if (verificationReopened) {
      delete draft.verification.satisfiedByAttemptId;
      delete draft.verification.verifiedFingerprint;
      draft.steps.verification = { status: "pending", evidence: { reason: "governed-files-changed", current } };
    }
    if (reopenedUnits.length > 0) delete draft.steps.implementation;
    if (draft.acceptance) {
      draft.acceptance.dispositions = draft.acceptance.dispositions.map((disposition) => ({
        ...disposition,
        status: "stale",
      }));
    }
    // 内容变化后旧风险接受失效（issue 22）：保留为不可变历史，自动重跑
    // 检查；问题在新内容上仍存在时才需要用户再次接受。
    draft.logicComplete = false;
    delete draft.steps.finalize;
    draft.lastInvalidation = {
      at: new Date().toISOString(),
      ...(changedFiles ? { changedFiles } : {}),
      reopenedUnits,
      reviewReopened,
      verificationReopened,
      fallback,
      reason,
    };
    draft.lastUpdatedBy = { host: state.lastUpdatedBy.host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { changedFiles, reopenedUnits, reviewReopened, verificationReopened, fallback, reason });
  return invalidated;
}

/** 记录一次"通过时刻"的逐文件快照，供失效传播定位变化影响。 */
export async function persistThroughSnapshot(
  root: string,
  id: string,
  snapshot: ProtectedFileSnapshot[],
  fingerprint: string,
  directory: "review" | "verification",
): Promise<string> {
  return writeEvidenceSnapshot(root, id, snapshot, fingerprint, directory);
}

/** 失效检测入口的通用错误构造（调用方统一抛出 WORKSPACE_CHANGED）。 */
export function workspaceChangedError(invalidated: AffectedClaimsInvalidation): DevFlowError {
  return new DevFlowError("WORKSPACE_CHANGED", "交付内容已变化，受影响的实现单元、代码审查或验证已重新打开。", {
    ...invalidated,
    recoveryHint: "按 dev_flow_status 显示的当前阶段继续：重做受影响实现单元，并重新完成代码审查与验证。",
  });
}
