import { checkpointsEnforcementRequired, routeDefinition } from "../policy/contract.js";
import { requiredEvidenceForStep, requiredEvidenceIsEmpty } from "../policy/evidence.js";
import { firstOpenStep } from "../policy/stages.js";
import type { DeriveState, NextAction, PendingDecision, RequiredEvidence } from "../policy/types.js";
import { readState, type FeatureState } from "./state-store.js";
import { nextReadyImplementationUnit } from "./implementation-units.js";
import { inspectTraceGate } from "./traceability-gates.js";
import { readTraceability } from "./traceability-store.js";
import { verificationIsStale } from "./verification.js";
import { reviewGate } from "./review-jobs.js";
import { assertCurrentReviewProjection } from "./review-projection.js";
import { routeDefinitionForState } from "./step-order.js";
import { hasCurrentQualityException } from "./quality-exceptions.js";
import { pendingDecisionForState } from "./decision-interactions.js";
import { openQuestionsAdvisory } from "./requirements-grill.js";

function toDerivedState(state: FeatureState, verificationStale: boolean) {
  const definition = routeDefinitionForState(state);
  const steps: Record<string, { status: "pending" | "satisfied"; artifactReady?: boolean }> = { ...state.steps };
  if (verificationStale) steps.verification = { status: "pending" };
  // 当前风险接受结论与门禁共用（issue 22）：用户接受验证风险后，验证不再
  // 阻塞推进，但 state.steps 不被改写——显示上始终是“风险已接受”。
  else if (hasCurrentQualityException(state, "verification")) steps.verification = { status: "satisfied" };
  for (const [approvalId, snapshot] of Object.entries(state.humanGates)) {
    const value = snapshot as { status?: string };
    if (approvalId.startsWith("approval:") && (value.status === "pending" || value.status === "returned")) {
      steps[approvalId] = { status: "pending", artifactReady: true };
    }
  }
  return {
    schemaVersion: state.schemaVersion,
    lifecycle: state.lifecycle,
    route: state.route,
    orderedSteps: definition.orderedSteps,
    steps,
    obligations: state.obligations,
    blockingFindings: state.blockingFindings,
    logicComplete: state.logicComplete,
    repair: state.repair,
  } as const;
}

/**
 * Pure route-loop policy over a derived state: the ordered-step schedule.
 * Private to nextAction (ADR-0021) — not a public contract. Anyone asking
 * "what now" goes through nextAction only.
 */
function deriveRouteAction(state: DeriveState): NextAction {
  if (Number(state.schemaVersion) !== 6) throw new Error("UNSUPPORTED_STATE_SCHEMA");
  if (state.lifecycle === "finalized") return { kind: "done" };
  if (state.repair?.status === "waiting-user" || state.repair?.status === "stalled") {
    return {
      kind: "waiting-user",
      reason: state.repair.recoveryAction?.reason ?? "自动修复需要用户决策",
      recoveryAction: state.repair.recoveryAction ?? { kind: "ask-user", reason: "自动修复已暂停", facts: [], impact: "当前单元未完成", recommendation: "请确认修订、回滚或调整计划" },
    };
  }
  if (state.classificationViolatesTopology) return { kind: "stop", reason: "reclassification-required" };
  if (state.blockingFindings?.some((finding) => finding.blocking)) return { kind: "stop", reason: "resolve-blocking-findings" };

  const definition = routeDefinition(state.route);
  const orderedSteps = state.orderedSteps ?? definition.orderedSteps;
  // Approval is a dynamic obligation, never a fixed route stage. Present it
  // only when all route work before implementation is complete; this keeps
  // artifact scaffolding and plan review ahead of the user decision.
  const approval = state.obligations?.find((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
  const implementationIndex = orderedSteps.indexOf("implementation");
  const implementationReady = implementationIndex >= 0
    && orderedSteps.slice(0, implementationIndex).every((step) => state.steps[step]?.status === "satisfied");
  if (approval && implementationReady) {
    return { kind: "present-human-gate", step: approval.id };
  }

  const openStep = firstOpenStep(orderedSteps, state.steps);
  if (openStep) {
    const snapshot = state.steps[openStep];
    if (snapshot && snapshot.artifactReady === false) return { kind: "scaffold-artifact", step: openStep };
    return { kind: "run-step", step: openStep };
  }

  if (!state.logicComplete) return { kind: "finalize" };
  return { kind: "done" };
}

function enrichRunStep(state: FeatureState, step: string): { kind: "run-step"; step: string; requiredEvidence?: RequiredEvidence } {
  const requiredEvidence = requiredEvidenceForStep(
    state.route,
    state.classification.riskLabels,
    step,
    state.classification.controls,
  );
  return requiredEvidenceIsEmpty(requiredEvidence)
    ? { kind: "run-step", step }
    : { kind: "run-step", step, requiredEvidence };
}

function traceStepForAction(action: NextAction): string | undefined {
  if (action.kind === "run-step") {
    if (action.step === "requirements_alignment") return "requirements";
    if (action.step === "planning") return "implementation_plan";
    return action.step;
  }
  if (action.kind === "present-human-gate") return action.step.startsWith("approval:") ? "implementation_plan" : action.step;
  if (action.kind === "finalize") return "finalize";
  return undefined;
}

/**
 * Review jobs are state-machine actions, not a suggestion embedded in a Skill.
 * The gate is the single readiness verdict: next schedules from its structured
 * result without a second ledger read. Isolation/blocking carry their ids from
 * the result, never thrown through the scheduler.
 */
async function reviewPlanAction(root: string, state: FeatureState): Promise<NextAction | undefined> {
  const gate = await reviewGate(root, state);
  if (gate.status === "ready" || gate.status === "waived") {
    // planning evidence must reference the current plan batch. If an older
    // plan batch satisfied planning before the current one was created, next
    // returns the recordable planning step so the agent restamps evidence.
    const planningEvidence = state.steps.planning?.evidence as { batchId?: string } | undefined;
    const expectedBatchId = gate.status === "ready" ? gate.stamp?.batchId : gate.batchId;
    if (state.steps.planning?.status === "satisfied" && planningEvidence?.batchId !== expectedBatchId) {
      return { kind: "run-step", step: "planning" };
    }
    return undefined;
  }
  if (gate.status === "need-batch") return { kind: "create-review-batch", step: "planning" };
  if (gate.status === "jobs-open") {
    return { kind: "review-jobs-pending", step: "planning", batchId: gate.batchId, jobs: gate.jobs };
  }
  if (gate.status === "isolation") {
    return { kind: "review-jobs-pending", step: "planning", batchId: gate.batchId, jobIds: gate.jobIds };
  }
  return { kind: "review-jobs-pending", step: "planning", batchId: gate.batchId, findingIds: gate.findingIds };
}

/**
 * During the implementation step of a checkpoints:1 feature, the next action
 * is the unit lifecycle itself: checkpoint the active unit, or begin the
 * first pending unit whose dependencies are all checkpointed. Only when every
 * implementation unit is checkpointed may the route record implementation.
 */
async function unitLifecycleAction(root: string, state: FeatureState): Promise<NextAction | undefined> {
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) return undefined;
  const units = state.implementationUnits ?? [];
  const active = units.find((unit) => unit.status === "active");
  if (active) return { kind: "checkpoint-implementation-unit", unitId: active.unitId };
  const ledger = await readTraceability(root, state);
  const ready = nextReadyImplementationUnit(state, ledger);
  return ready ? { kind: "begin-implementation-unit", unitId: ready.id } : undefined;
}

export async function nextAction(root: string, id: string): Promise<NextAction> {
  const state = await readState(root, id);
  if (state.mode === "intake") {
    const pending = pendingDecisionForState(state);
    return pending
      ? { kind: "intake", activity: "resolve-decision", reason: "当前有一个决策仍待用户确认" }
      : { kind: "intake", activity: "investigate", reason: "读取需求、代码、文档和测试完成调查后，调用 dev_flow_lock_classification 锁定路线（锁定前不要调用 record_step 等路线步骤工具）" };
  }
  let pending: PendingDecision | undefined;
  try {
    pending = pendingDecisionForState(state);
  } catch (error) {
    // Legacy grill state cannot be projected as a pending decision (its old
    // contract has no recommendation). Fail soft here so next/status still
    // report the route schedule and doctor/recover carry the restart guidance.
    if ((error as { code?: unknown }).code !== "GRILL_INTERACTION_RESTART_REQUIRED") throw error;
    pending = undefined;
  }
  if (pending) {
    // A unique pending interaction preempts every other next step in routed
    // mode too — the next action is to answer it (issue 02).
    return { kind: "intake", activity: "resolve-decision", reason: "当前有一个决策仍待用户确认" };
  }
  const action = deriveRouteAction(toDerivedState(state, await verificationIsStale(root, state)));

  if (action.kind === "run-step" || action.kind === "present-human-gate") {
    const definition = routeDefinitionForState(state);
    const requiredNow = [
      ...(definition.artifactSteps?.[action.step] ?? []),
      ...(definition.generatedArtifactSteps?.[action.step] ?? []),
    ];
    const missing = requiredNow.find((artifact) => !state.artifacts[artifact]);
    if (missing) return { kind: "scaffold-artifact", step: missing };
  }

  // Check trace gate before any review scheduling: a missing/stale plan slice
  // must return repair-trace and must never create or reuse a review batch.
  const traceStep = traceStepForAction(action);
  if (traceStep) {
    const trace = await inspectTraceGate(root, state, traceStep);
    if (trace.blocker) return { kind: "repair-trace", ...trace.blocker };
  }

  // A rollback can stale the review batch while planning evidence remains
  // satisfied and implementation becomes the derived route step. Review is
  // still a prerequisite of beginning a replacement unit. Artifact
  // scaffolding must happen first so the immutable review basis always
  // includes the current implementation plan.
  if (action.kind === "run-step" && (action.step === "planning" || action.step === "implementation")) {
    const reviewAction = await reviewPlanAction(root, state);
    if (reviewAction) return reviewAction;
    if (action.step === "planning") {
      // A complete ledger is necessary but not sufficient: the generated
      // projection is a registered artifact and must still be readable/current.
      await assertCurrentReviewProjection(root, state);
    }
  }

  if (action.kind === "run-step" && action.step === "implementation") {
    const unitAction = await unitLifecycleAction(root, state);
    if (unitAction) return unitAction;
  }

  if (action.kind === "run-step" && action.step === "finalize") return { kind: "finalize" };
  if (action.kind === "run-step") {
    const enriched = enrichRunStep(state, action.step);
    // 非阻塞提示（grill 仍是主动工具调用，Core 不自动创建交互）：需求文档
    // 「开放问题」还有未收敛条目且无待答 grill 时，建议先收敛再进入 planning。
    if (action.step === "requirements_alignment") {
      const advisory = await openQuestionsAdvisory(root, state);
      if (advisory) {
        return {
          kind: "run-step",
          step: enriched.step,
          ...(enriched.requiredEvidence !== undefined ? { requiredEvidence: enriched.requiredEvidence } : {}),
          advisory,
        };
      }
    }
    return enriched;
  }
  return action;
}
