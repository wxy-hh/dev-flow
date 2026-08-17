/**
 * 变更失效传播（issue 21）：审查之后交付内容再次变化时，自动重开受影响的
 * 实现单元（checkpoint）、代码审查与验证，确保最终交付内容与通过记录使用
 * 相同依据。无法定位变化影响时保守完整重开，并记录诊断原因。
 *
 * 基准选择：最近一次"通过记录"的全局逐文件快照——验证通过优先，其次代码
 * 审查。两者都不存在时（早期阶段）短路返回，零快照开销。
 */
import { fingerprintFeatureOwned, snapshotGovernedRoots, type ProtectedFileSnapshot } from "./fingerprint.js";
import { DevFlowError } from "./errors.js";
import { mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { routeDefinitionForState } from "./step-order.js";
import { readCheckpointManifest } from "./checkpoint-store.js";
import { readEvidenceSnapshot, writeEvidenceSnapshot } from "./evidence-snapshot-store.js";
import { readEvidenceObject } from "./evidence-store.js";
import { featureOwnedSnapshotHash } from "./evidence-baseline.js";
import { parseEvidenceBaselineManifest } from "../policy/evidence-baseline.js";
import { parseWorkspaceSnapshotManifest } from "../policy/evidence-store.js";
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

type RecordedBaseline = { recordId: string; kind: "claim" | "authorization" | "legacy"; fingerprint: string; snapshotPath?: string; snapshotFiles?: ProtectedFileSnapshot[] };

/** 一条内容绑定的治理记录 → 其 baseline 快照（baselineRef 缺失时退化为聚合指纹）。 */
async function baselineForRecord(
  root: string,
  state: FeatureState,
  kind: "claim" | "authorization",
  recordId: string,
  baselineRef: unknown,
  aggregateFingerprint: string | undefined,
): Promise<RecordedBaseline | undefined> {
  if (!baselineRef || typeof baselineRef !== "object" || baselineRef === null || Array.isArray(baselineRef)) {
    return aggregateFingerprint ? { recordId, kind, fingerprint: aggregateFingerprint } : undefined;
  }
  const ref = baselineRef as { kind?: unknown; sha256?: unknown; size?: unknown };
  if (typeof ref.sha256 !== "string") return aggregateFingerprint ? { recordId, kind, fingerprint: aggregateFingerprint } : undefined;
  try {
    const manifestBytes = await readEvidenceObject(root, state.featureId, ref as never);
    const manifest = parseEvidenceBaselineManifest(JSON.parse(manifestBytes.toString("utf8")));
    const snapshotBytes = await readEvidenceObject(root, state.featureId, manifest.snapshotRef);
    const snapshot = parseWorkspaceSnapshotManifest(JSON.parse(snapshotBytes.toString("utf8")));
    return {
      recordId,
      kind,
      fingerprint: manifest.contentFingerprint,
      snapshotFiles: snapshot.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        mode: file.mode,
        kind: file.kind,
        ...(file.linkTarget !== undefined ? { linkTarget: file.linkTarget } : {}),
      })),
    };
  } catch {
    // Baseline corruption must never fail open; keep aggregate fingerprint as
    // the conservative fallback.
    return aggregateFingerprint ? { recordId, kind, fingerprint: aggregateFingerprint } : undefined;
  }
}

/**
 * Phase 6（GPT-007）：内容绑定的治理记录各自持有 baseline，失效传播按记录
 * 独立比较并取并集。review-complete / verification-current claim 与内容绑定
 * 的 risk-acceptance authorization 都在集合内；没有任何 baselineRef 时回退
 * 到 5.x 的"最近一次通过记录"选择器（legacy 行为保持不变）。
 */
/**
 * Phase 6（GPT-007）：内容绑定的治理记录各自持有 baseline，失效传播按记录
 * 独立比较并取并集。只有"活跃"记录参与：非 superseded 且步骤证据仍引用它
 * （review-complete ↔ steps.code_review 证据、verification-current ↔ verifiedFingerprint、
 * risk-acceptance ↔ 最近一次失效之后仍未被取代的接受）。重开后的旧记录不再
 * 参与比较，redo 中途不会再次触发失效（issue 21 的幂等传播）。
 */
async function contentBoundBaselines(root: string, state: FeatureState): Promise<RecordedBaseline[]> {
  const records: RecordedBaseline[] = [];
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  for (const claim of state.governance?.claims ?? []) {
    if (claim.supersededBy !== undefined) continue;
    if (claim.claimType !== "review-complete" && claim.claimType !== "verification-current") continue;
    const basis = claim.basis?.kind === "content" ? claim.basis.sha256 : undefined;
    if (basis === undefined) continue;
    // 步骤证据仍引用该声明时才活跃：失效传播重开后证据被删除，旧声明
    // 必须立即退出比较，避免 redo 中途被同一份旧 baseline 反复阻断。
    const live = claim.claimType === "review-complete"
      ? (state.steps.code_review?.evidence as { fingerprint?: string } | undefined)?.fingerprint === basis
      : state.verification.verifiedFingerprint === basis;
    if (!live) continue;
    const record = await baselineForRecord(root, state, "claim", claim.recordId, claim.baselineRef, basis);
    if (record) records.push(record);
  }
  for (const authorization of state.governance?.authorizations ?? []) {
    if (authorization.supersededBy !== undefined) continue;
    if (authorization.authorizationType !== "risk-acceptance") continue;
    const basis = authorization.basis?.kind === "content" ? authorization.basis.sha256 : undefined;
    if (basis === undefined) continue;
    // 与 legacy 选择器一致：失效传播之后才记录的接受才算活跃（接受晚于
    // 最近一次失效，说明它针对的是当前内容；否则旧接受只作历史保留）。
    if (Number.isFinite(invalidatedAt) && authorization.recordedAt && Date.parse(authorization.recordedAt) < invalidatedAt) continue;
    const record = await baselineForRecord(root, state, "authorization", authorization.recordId, authorization.baselineRef, basis);
    if (record) records.push(record);
  }
  if (records.length > 0) return records;
  // Legacy 5.x 选择器（无任何 baselineRef 的旧 feature）：
  const verificationEvidence = state.steps.verification?.evidence as { snapshotPath?: string } | undefined;
  if (state.verification.verifiedFingerprint) {
    return [{ recordId: "", kind: "legacy", fingerprint: state.verification.verifiedFingerprint, snapshotPath: verificationEvidence?.snapshotPath }];
  }
  const reviewEvidence = state.steps.code_review?.evidence as { fingerprint?: string; snapshotPath?: string } | undefined;
  if (typeof reviewEvidence?.fingerprint === "string") {
    return [{ recordId: "", kind: "legacy", fingerprint: reviewEvidence.fingerprint, snapshotPath: reviewEvidence.snapshotPath }];
  }
  const accepted = (state.governance?.authorizations ?? []).find((authorization) =>
    authorization.authorizationType === "risk-acceptance"
    && authorization.supersededBy === undefined
    && authorization.basis?.kind === "content"
    && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt));
  if (accepted?.basis?.kind !== "content") return [];
  return baselineForRecord(root, state, "authorization", accepted.recordId, accepted.baselineRef, accepted.basis.sha256).then((record) => record ? [record] : []);
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
  const baselines = await contentBoundBaselines(root, state);
  if (!baselines.length) return undefined;
  const config = await readProjectConfig(root);
  const current = await fingerprintFeatureOwned(root, config, state.workspace.ownership);

  // 先计算逐文件差异，再决定是否短路。每条内容绑定记录独立比较自己的
  // baseline，变化文件取并集（GPT-007：review/verification/risk 各自持有
  // baseline，互不覆盖）。
  let changedFiles: string[] | undefined;
  let afterFiles: ProtectedFileSnapshot[] | undefined;
  const hasSnapshot = baselines.some((baseline) => Boolean(baseline.snapshotFiles || baseline.snapshotPath));
  const unionChanged = new Set<string>();
  let anyPerRecordFingerprintMismatch = false;
  for (const baseline of baselines) {
    let recordChanged: string[] | undefined;
    if (baseline.snapshotFiles) {
      afterFiles ??= (await snapshotGovernedRoots(root, config)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
      recordChanged = changedPaths(
        baseline.snapshotFiles.filter((file) => state.workspace.ownership[file.path] !== "excluded"),
        afterFiles,
      );
      if (featureOwnedSnapshotHash(afterFiles, state.workspace.ownership) !== baseline.fingerprint) anyPerRecordFingerprintMismatch = true;
    } else if (baseline.snapshotPath) {
      try {
        const before = (await readEvidenceSnapshot(root, id, baseline.snapshotPath)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
        afterFiles ??= (await snapshotGovernedRoots(root, config)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
        recordChanged = changedPaths(before, afterFiles);
      } catch {
        recordChanged = undefined;
      }
    }
    if (recordChanged === undefined) { changedFiles = undefined; break; }
    for (const file of recordChanged) unionChanged.add(file);
  }
  changedFiles = unionChanged.size > 0 ? [...unionChanged].sort() : [];
  const unownedDeliveryChange = changedFiles?.some((file) => state.workspace.ownership[file] === undefined) ?? true;
  // The feature-owned baseline is the source for ordinary delivery changes.
  // The initial full-workspace fingerprint is only useful when no per-file
  // snapshot exists; otherwise comparing against it would treat the feature's
  // own implementation writes as an unexplained external change.
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const fullDrift = hasSnapshot ? unownedDeliveryChange : true;
  const firstBaseline = baselines[0]!;
  const comparableCurrent = firstBaseline.snapshotFiles && afterFiles
    ? featureOwnedSnapshotHash(afterFiles, state.workspace.ownership)
    : current;
  const recordMismatch = anyPerRecordFingerprintMismatch || baselines.some((baseline) => baseline.fingerprint !== comparableCurrent);
  if (!recordMismatch && !fullDrift) return undefined;

  const reviewEvidence = state.steps.code_review?.evidence as { fingerprint?: string } | undefined;
  const reviewReopened = state.steps.code_review !== undefined
    && (fullDrift || typeof reviewEvidence?.fingerprint !== "string" || reviewEvidence.fingerprint !== current);
  const verificationReopened = state.verification.verifiedFingerprint !== undefined
    && (fullDrift || state.verification.verifiedFingerprint !== current);
  // 风险接受绑定接受时的内容指纹（issue 22）：内容变化后旧接受自动失效，
  // 门禁与 next 不再放行，流程回到验证/审查步骤重新检查。只比较活跃接受：
  // 非 superseded 且晚于最近一次失效（旧接受只作不可变历史，不参与重开）。
  const liveAuthorizations = (state.governance?.authorizations ?? []).filter((authorization) =>
    authorization.authorizationType === "risk-acceptance"
    && authorization.supersededBy === undefined
    && authorization.basis?.kind === "content"
    && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt));
  const authorizationBound = liveAuthorizations.some((authorization) => {
    const basis = authorization.basis;
    return basis?.kind === "content" && basis.sha256 !== current;
  });
  let exceptionBound = authorizationBound;


  // 基准快照缺失/损坏时无法定位 → 完整回退。
  if (!hasSnapshot) {
    changedFiles = undefined;
    exceptionBound = true;
  }
  // An unknown newly-added or renamed path is still a delivery change even if
  // the previous owned-only aggregate happens to remain equal. It must stale
  // risk authorization and force reconciliation.
  if ((changedFiles?.length ?? 0) > 0 && liveAuthorizations.length > 0) {
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