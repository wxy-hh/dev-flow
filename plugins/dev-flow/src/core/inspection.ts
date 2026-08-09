import { readState, readFeatureEvents } from "./state-store.js";
import { inspectCurrentTrace } from "./traceability-gates.js";
import { readReviewLedger } from "./review-store.js";
import { reviewEnforcementRequired, traceEnforcementRequired } from "../policy/contract.js";
import { routeLabel, stageLabel } from "../policy/presentation.js";
import { effectiveStage } from "../policy/stages.js";
import { unresolvedBlockingFindings } from "./review-findings.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";
import { pendingDecisionForState } from "./decision-interactions.js";

export const inspectionTopics = ["classification", "artifacts", "trace", "review", "implementation", "verification", "delivery", "history", "diagnostics"] as const;
export type InspectionTopic = typeof inspectionTopics[number];

function topic(value: unknown): InspectionTopic {
  if (typeof value === "string" && inspectionTopics.includes(value as InspectionTopic)) return value as InspectionTopic;
  throw new DevFlowError("INSPECTION_TOPIC_INVALID", "inspect topic 必须是受支持的主题，不能使用 all。", { userMessage: "请选择一个明确的检查主题。", recoveryKind: "retry", recoveryInstruction: "从分类、工件、追溯、审查、实现、验证、交付、历史或诊断中选择一个主题。", retryOriginal: true });
}

async function classification(state: FeatureState) {
  return {
    objective: state.objective ?? "未命名需求",
    scope: state.scope,
    ...(state.mode === "routed" ? { route: routeLabel(state.route), stage: stageLabel(effectiveStage(state)) } : { route: "路线尚未确定", stage: "需求了解" }),
    decisionStatus: (state.decisionLedger ?? []).reduce((summary, decision) => {
      summary[decision.status] = (summary[decision.status] ?? 0) + 1;
      return summary;
    }, {} as Record<string, number>),
  };
}

async function artifacts(state: FeatureState) {
  return {
    items: Object.entries(state.artifacts).map(([kind, artifact]) => ({ kind, path: artifact.path, registered: true })),
  };
}

async function trace(root: string, state: FeatureState) {
  if (state.mode === "intake" || !traceEnforcementRequired(state.route, state.classification.controls)) return { enforced: false, blocker: undefined };
  const inspection = await inspectCurrentTrace(root, state);
  return {
    enforced: true,
    summary: inspection.effectiveSummary,
    blocker: inspection.blocker ? "追溯证据需要修复" : undefined,
  };
}

async function review(root: string, state: FeatureState) {
  if (state.mode === "intake" || !reviewEnforcementRequired(state.route, state.classification.controls)) return { enforced: false };
  const ledger = await readReviewLedger(root, state);
  const current = ledger.batches.find((batch) => batch.validity === "current");
  const roleBasis = (origin: import("../policy/review.js").ReviewFindingEvent & { type: "origin" }) => current?.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
  return {
    enforced: true,
    currentBatch: current ? { progress: current.progress, roles: current.jobs.map((job) => ({ role: job.role, status: job.status })) } : undefined,
    unresolvedBlockingCount: unresolvedBlockingFindings({ findingEvents: ledger.findingEvents }, roleBasis).length,
    staleBatchCount: ledger.batches.filter((batch) => batch.validity === "stale").length,
  };
}

async function implementation(state: FeatureState) {
  const units = state.implementationUnits ?? [];
  return { total: units.length, completed: units.filter((unit) => unit.status === "checkpointed").length, active: units.find((unit) => unit.status === "active") ? "有一个实现单元正在进行" : "无" };
}

async function verification(state: FeatureState) {
  return {
    attempts: state.verification.attempts.length,
    freshness: state.evidenceFreshness.verification,
    passed: Boolean(state.verification.satisfiedByAttemptId !== undefined),
  };
}

async function delivery(state: FeatureState) {
  return {
    lifecycle: state.lifecycle,
    workspace: state.workspace.reconciliationStatus,
    snapshot: state.deliverySnapshot ? "已生成" : "未生成",
    featureOwnedPathCount: Object.values(state.workspace.ownership).filter((value) => value === "feature").length,
  };
}

async function history(root: string, state: FeatureState) {
  const events = await readFeatureEvents(root, state.featureId);
  return {
    count: events.length,
    recent: events.slice(-10).map((event) => ({ at: event.at, type: event.type })),
  };
}

async function diagnostics(root: string, state: FeatureState) {
  const events = await readFeatureEvents(root, state.featureId);
  return {
    featureId: state.featureId,
    revision: state.revision,
    schemaVersion: state.schemaVersion,
    workspace: state.workspace,
    artifacts: state.artifacts,
    traceability: state.traceability,
    review: state.review,
    pendingDecision: pendingDecisionForState(state),
    recentEvents: events.slice(-20),
  };
}

export async function inspectFeature(root: string, featureId: string, requestedTopic: string): Promise<{ topic: InspectionTopic; content: unknown }> {
  const selected = topic(requestedTopic);
  const state = await readState(root, featureId);
  const content = selected === "classification"
    ? await classification(state)
    : selected === "artifacts"
      ? await artifacts(state)
      : selected === "trace"
        ? await trace(root, state)
        : selected === "review"
          ? await review(root, state)
          : selected === "implementation"
            ? await implementation(state)
            : selected === "verification"
              ? await verification(state)
              : selected === "delivery"
                ? await delivery(state)
                : selected === "history"
                  ? await history(root, state)
                  : await diagnostics(root, state);
  return { topic: selected, content };
}
