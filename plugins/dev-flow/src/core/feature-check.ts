import { routeDefinitionForFeature, checkpointsEnforcementRequired, reviewEnforcementRequired } from "../policy/contract.js";
import { createHash } from "node:crypto";
import { EMPTY_GOVERNANCE_LEDGER } from "../policy/types.js";
import {
  missingRequiredEvidence,
  requiredEvidenceForStep,
  requiredEvidenceIsEmpty,
} from "../policy/evidence.js";
import type { RequiredEvidence } from "../policy/types.js";
import { assertArtifactIntegrity } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import {
  assertImplementationFilesExist,
  assertImplementationFilesInGovernedRoots,
  createDeliverySnapshot,
  deriveImplementationFiles,
  type DeliverySnapshot,
} from "./delivery-snapshot.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { assertHostHealth } from "./host-health.js";
import { assertWorkspaceOwnershipComplete, mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { assertCurrentStep, currentOpenStep, routeDefinitionForState } from "./step-order.js";
import { assertTraceGateCurrent } from "./traceability-gates.js";
import { readTraceability } from "./traceability-store.js";
import { requireReviewReady } from "./review-jobs.js";
import { captureAutomaticCheckpoint } from "./auto-checkpoint.js";
import { satisfyObligations } from "../policy/obligations.js";
import { hasCurrentQualityException, qualityExceptionCoversStep } from "./quality-exceptions.js";
import { fingerprintFeatureOwned, snapshotGovernedRoots } from "./fingerprint.js";
import { invalidateAffectedClaims, persistThroughSnapshot, workspaceChangedError } from "./change-invalidation.js";

function assertRequiredEvidence(step: string, required: RequiredEvidence, evidence: unknown): void {
  const missing = missingRequiredEvidence(required, evidence);
  if (requiredEvidenceIsEmpty(missing)) return;
  const details = { step, requiredEvidence: required, missing };
  if (missing.fields.reviewType !== undefined) {
    throw new DevFlowError("REVIEW_TYPE_MISMATCH", `${step} reviewType is missing or incorrect`, details);
  }
  throw new DevFlowError("RISK_EVIDENCE_INCOMPLETE", `${step} evidence is incomplete`, details);
}

function assertRecordableStep(state: FeatureState, step: string): void {
  if (state.lifecycle !== "active") {
    throw new DevFlowError("INVALID_LIFECYCLE", "only active features can record steps");
  }
  const route = routeDefinitionForState(state);
  if (["verification", "finalize"].includes(step)
    || !route.orderedSteps.includes(step)) {
    const recoveryHint = step === "verification"
      ? "请调用 dev_flow_verify"
      : step === "finalize"
        ? "请调用 dev_flow_finalize"
        : "请使用当前路线允许的 record_step 阶段";
    throw new DevFlowError("INVALID_STEP", step, { recoveryHint });
  }
  assertCurrentStep(state, step);
}

function satisfyStepObligations(state: FeatureState, route: ReturnType<typeof routeDefinitionForFeature>, step: string): void {
  // A formal recovery plan satisfies the route's rollback-strategy obligation.
  if (step === "planning" && state.classification.controls.recovery.some((kind) => kind !== "delivery-reverse")) {
    state.obligations = satisfyObligations(state.obligations, ["rollback"]);
  }
  // Routes without independent review use their explicit review evidence as
  // the single review-obligation completion source.
  const riskReviewTarget = route.orderedSteps.includes("code_review")
    ? "code_review"
    : route.orderedSteps.includes("planning")
      ? "planning"
      : route.orderedSteps.includes("verification") ? "verification" : undefined;
  if (step === riskReviewTarget
    && state.classification.riskLabels.length > 0) {
    if (!reviewEnforcementRequired(state.route, state.classification.controls)) {
      state.obligations = satisfyObligations(state.obligations, ["review"]);
    }
    if (state.classification.riskLabels.includes("irreversible_consequence")) {
      state.obligations = satisfyObligations(state.obligations, ["rollback"]);
    }
  }
}

export async function recordStep(
  root: string,
  id: string,
  expectedRevision: number,
  step: string,
  evidence: unknown,
): Promise<FeatureState> {
  let normalizedEvidence = evidence;
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision,
    });
  }
  const invalidated = await invalidateAffectedClaims(root, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
  assertRecordableStep(initial, step);
  if (step === "implementation") await assertHostHealth(root, initial.lastUpdatedBy.host, "implementation 推进");
  if (step === "implementation") {
    const config = await readProjectConfig(root);
    const files = await deriveImplementationFiles(root, initial, config);
    await assertWorkspaceOwnershipComplete(root, initial, config, "implementation 推进");
    assertImplementationFilesInGovernedRoots(files, config.governedRoots);
    // Validated before the mutation so a rejected registration leaves the step
    // open and can be re-recorded without a dead end.
    await assertImplementationFilesExist(root, files);
    normalizedEvidence = {
      derivedBy: "core",
      files,
    };
  }
  const next = await mutate(root, id, expectedRevision, "step-recorded", async (state) => {
    assertRecordableStep(state, step);
    const route = routeDefinitionForState(state);
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, step);
    if (step === "implementation" && (Number(state.schemaVersion) === 4 || Number(state.schemaVersion) === 5) && checkpointsEnforcementRequired(state.route, state.classification.controls)) {
      await assertImplementationUnitsComplete(root, state);
    }
    const required = requiredEvidenceForStep(
      state.route,
      state.classification.riskLabels,
      step,
      state.classification.controls,
    );
    if (required.fields.reviewBatch || step === "code_review") {
      // batch/basis/assurance are Core-owned; callers cannot provide substitutes.
      // 登记 plan 问 plan、登记 code_review 显式问 code，与 status 听到同一句“过/不过”。
      normalizedEvidence = await requireReviewReady(root, state, { phase: step === "code_review" ? "code" : "plan" });
    } else {
      assertRequiredEvidence(step, required, normalizedEvidence);
    }
    if (step === "code_review") {
      // 双轴审查结论绑定当前交付内容：记录整根指纹与逐文件快照，后续
      // 交付内容变化时失效传播可定位受影响单元并重开审查（issue 21）。
      const config = await readProjectConfig(root);
      // Keep the invalidation snapshot complete; the delivery fingerprint
      // remains feature-owned, while the full snapshot can detect an
      // unowned path that changes after review.
      const snapshot = await snapshotGovernedRoots(root, config);
      const fingerprint = await fingerprintFeatureOwned(root, config, state.workspace.ownership);
      const snapshotPath = await persistThroughSnapshot(root, id, snapshot, fingerprint, "review");
      normalizedEvidence = { ...(normalizedEvidence as Record<string, unknown>), fingerprint, snapshotPath };
      // 治理账本：双轴审查通过形成 review-complete 声明（spec §202，
      // 与验证通过形成 verification-current 声明对称）。
      const gov = state.governance ?? EMPTY_GOVERNANCE_LEDGER;
      const claimId = `CLAIM-${createHash("sha256").update(`review-complete|code_review|${fingerprint}`).digest("hex").slice(0, 16)}`;
      const claims = [...gov.claims];
      if (!claims.some((claim) => claim.recordId === claimId)) {
        claims.push({
          recordId: claimId,
          kind: "claim",
          claimType: "review-complete",
          subject: "code_review",
          basis: { kind: "content", sha256: fingerprint },
          recordedAt: new Date().toISOString(),
        });
      }
      state.governance = { ...gov, claims };
    }
    state.steps[step] = { status: "satisfied", evidence: normalizedEvidence };
    satisfyStepObligations(state, route, step);
    const next = route.orderedSteps.find((candidate) => state.steps[candidate]?.status !== "satisfied");
    state.currentStage = next;
  });
  if ((Number(next.schemaVersion) === 4 || Number(next.schemaVersion) === 5) && next.currentStage === "implementation" && !next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root, id, next.revision, "implementation", "implementation-entry");
  }
  if (step === "implementation" && (Number(next.schemaVersion) === 4 || Number(next.schemaVersion) === 5) && next.checkpoints?.length) {
    return captureAutomaticCheckpoint(root, id, next.revision, "implementation", "implementation-complete");
  }
  return next;
}

async function assertImplementationUnitsComplete(root: string, state: FeatureState): Promise<void> {
  const ledger = await readTraceability(root, state);
  const required = Object.values(ledger.nodes).filter((node) => node.kind === "implementation-unit" && node.status === "current");
  const units = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
  const incomplete = required
    .map((node) => node.id as `UNIT-${string}`)
    .filter((nodeId) => units.get(nodeId)?.status !== "checkpointed");
  if (incomplete.length) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_INCOMPLETE", "every implementation unit must be checkpointed before recording implementation", {
      incomplete,
    });
  }
}

async function invalidateBeforeFinalClaim(root: string, id: string, expectedRevision: number): Promise<void> {
  const invalidated = await invalidateAffectedClaims(root, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
}

function assertVerificationWasNotInvalidated(state: FeatureState): void {
  const evidence = state.steps.verification?.evidence as { reason?: unknown } | undefined;
  if (evidence?.reason === "governed-files-changed" && !hasCurrentQualityException(state, "verification")) {
    throw new DevFlowError("VERIFICATION_STALE", "governed 文件已变化，请重新运行验证。");
  }
}

export async function finalize(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<FeatureState> {
  const initial = await readState(root, id);
  await assertHostHealth(root, initial.lastUpdatedBy.host, "finalize");
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision,
    });
  }
  await assertRequirementsGrillSatisfied(root, id, initial);
  await invalidateBeforeFinalClaim(root, id, expectedRevision);
  await assertArtifactIntegrity(root, id);
  const config = await readProjectConfig(root);
  const reconciledWorkspace = await assertWorkspaceOwnershipComplete(root, initial, config, "finalize");
  let snapshot: DeliverySnapshot | undefined;
  return mutate(root, id, expectedRevision, "finalized", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    assertVerificationWasNotInvalidated(state);
    state.workspace = reconciledWorkspace;
    // 当前风险接受结论放行步骤顺序（issue 22）：用户接受过验证/审查风险时
    // 门禁允许完成，但步骤状态不被改写为通过，报告仍显示“风险已接受”。
    const open = currentOpenStep(state);
    if (open !== "finalize" && !(open && qualityExceptionCoversStep(state, open))) {
      assertCurrentStep(state, "finalize");
    }
    await assertTraceGateCurrent(root, state, "finalize");
    const requiredKinds = new Set(["approval", "checkpoint", "verification"]);
    for (const obligation of state.obligations ?? []) {
      if (["review", "rollback"].includes(obligation.kind)) requiredKinds.add(obligation.kind);
    }
    const pending = (state.obligations ?? [])
      .filter((obligation) => requiredKinds.has(obligation.kind) && obligation.status !== "satisfied")
      .map(({ id, kind, status, reason }) => ({ id, kind, status, reason }));
    if (pending.length) {
      throw new DevFlowError("OBLIGATIONS_INCOMPLETE", "required workflow obligations are not satisfied", {
        obligations: pending,
        recoveryHint: "请按 dev_flow_status 和对应 inspect 主题完成确认、审查、验证或回撤策略后重试完成",
      });
    }
    snapshot = await createDeliverySnapshot(root, id, state, config);
    if (snapshot) state.deliverySnapshot = snapshot;
    state.logicComplete = true;
    state.lifecycle = "finalized";
    state.steps.finalize = { status: "satisfied" };
    state.currentStage = "complete";
  }, () => snapshot ? { deliverySnapshot: snapshot } : {});
}
