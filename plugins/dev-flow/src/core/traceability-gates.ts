import { readFile } from "node:fs/promises";
import path from "node:path";
import { traceEnforcementRequired } from "../policy/contract.js";
import type { TraceSummary, TraceabilityLedger } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import { assertTraceSliceCurrent } from "./traceability.js";
import { verificationCommandHashes } from "./project-config.js";
import { parseTraceSourceBlocks } from "./traceability-anchors.js";
import { normalizeUnicode } from "./path-normalization.js";

export interface TraceBlocker {
  code: "TRACE_SLICE_INCOMPLETE" | "TRACE_SLICE_STALE";
  step: string;
  details: Record<string, unknown>;
}

export interface TraceGateInspection {
  enforced: boolean;
  ledger?: TraceabilityLedger;
  effectiveSummary?: TraceSummary;
  blocker?: TraceBlocker;
}

/** Map user-facing workflow stages to the persisted Trace slice they consume. */
export function traceSliceForWorkflowStep(step: string): string {
  if (step === "requirements_alignment") return "requirements";
  if (step === "planning") return "implementation_plan";
  return step;
}

export function traceIsEnforced(state: FeatureState): boolean {
  return traceEnforcementRequired(state.route, state.classification.controls);
}

function blockerFor(step: string, error: unknown): TraceBlocker {
  const value = error as { code?: unknown; details?: unknown; message?: unknown };
  if (value?.code === "TRACE_SLICE_STALE" || value?.code === "TRACE_SLICE_INCOMPLETE") {
    return {
      code: value.code,
      step,
      details: typeof value.details === "object" && value.details !== null && !Array.isArray(value.details)
        ? value.details as Record<string, unknown>
        : {},
    };
  }
  return {
    code: "TRACE_SLICE_INCOMPLETE",
    step,
    details: {
      cause: typeof value?.code === "string" ? value.code : "TRACEABILITY_UNREADABLE",
      ...(typeof value?.message === "string" ? { message: value.message } : {}),
    },
  };
}

/** Reads and checks one stage slice; all Trace-aware Core entry points share this path. */
export async function inspectTraceGate(root: string, state: FeatureState, step: string): Promise<TraceGateInspection> {
  if (!traceIsEnforced(state)) return { enforced: false };
  const traceStep = traceSliceForWorkflowStep(step);
  let ledger: TraceabilityLedger | undefined;
  try {
    ledger = await readTraceability(root, state);
    const { config, sha256 } = await readProjectConfigSnapshot(root);
    assertTraceSliceCurrent(ledger, state.route, traceStep, sha256, verificationCommandHashes(config));
    if (traceStep === "implementation_plan") await assertImplementationPlanTraceCurrent(root, state, ledger);
    return { enforced: true, ledger, effectiveSummary: ledger.summary };
  } catch (error) {
    return {
      enforced: true,
      ...(ledger ? { ledger, effectiveSummary: ledger.summary } : {}),
      blocker: blockerFor(traceStep, error),
    };
  }
}

/** Full implementation-plan slice invariant: a zero-current plan slice never passes. */
export async function assertImplementationPlanTraceCurrent(root: string, state: FeatureState, ledger: TraceabilityLedger): Promise<void> {
  const artifact = state.artifacts["implementation-plan"];
  if (!artifact) return;
  const planNodes = Object.values(ledger.nodes)
    .filter((node) => node.sourceArtifact === "implementation-plan" && node.status !== "tombstoned");
  const currentPlanNodes = planNodes.filter((node) => node.status === "current");
  if (currentPlanNodes.length === 0) {
    if (planNodes.some((node) => node.status === "stale")) {
      throw new DevFlowError("TRACE_SLICE_STALE", "implementation-plan Trace slice has no current nodes and contains stale nodes", {
        stalePlanNodeIds: planNodes.filter((node) => node.status === "stale").map((node) => node.id).sort(),
        recoveryHint: "重新登记当前实施计划 Markdown 刷新 Trace 后再继续。",
      });
    }
    throw new DevFlowError("TRACE_SLICE_MISSING", "implementation-plan Trace slice has no current nodes", {
      recoveryHint: "登记实施计划 Markdown 生成 implementation-plan Trace slice 后再继续。",
    });
  }
  const stalePlanNodes = currentPlanNodes
    .filter((node) => node.sourceSha256 !== artifact.sha256)
    .map((node) => ({ id: node.id, traceSha256: node.sourceSha256, artifactSha256: artifact.sha256 }));
  if (stalePlanNodes.length) {
    throw new DevFlowError("TRACE_SLICE_STALE", "implementation plan artifact changed without re-registering its Trace slice", {
      stalePlanNodes,
      recoveryHint: "重新登记当前实施计划 Markdown；修订确认已原子登记 Trace，不再需要手工 record_artifact_with_trace。",
    });
  }
  const contents = await readFile(path.join(root, ".dev-flow", "features", state.featureId, normalizeUnicode(artifact.path)), "utf8");
  const blocks = new Map(parseTraceSourceBlocks(contents).map((block) => [`${block.kind}:${block.id}`, block]));
  for (const node of currentPlanNodes) {
    const block = blocks.get(`${node.kind}:${node.id}`);
    if (!block) {
      throw new DevFlowError("TRACE_SLICE_STALE", "implementation plan Markdown source manifest does not match Trace", {
        missingBlock: { id: node.id, kind: node.kind },
        recoveryHint: "重新登记当前实施计划 Markdown。",
      });
    }
    if (block.sourceBlockSha256 !== node.sourceBlockSha256) {
      throw new DevFlowError("TRACE_SLICE_STALE", "implementation plan block changed without re-registering Trace", {
        changedBlock: { id: node.id },
        recoveryHint: "重新登记当前实施计划 Markdown。",
      });
    }
  }
  const referenced = new Set<string>();
  for (const node of currentPlanNodes) {
    if (node.kind === "task") for (const id of node.covers) referenced.add(id);
    if (node.kind === "test") for (const id of node.verifies) referenced.add(id);
    if (node.kind === "implementation-unit") {
      for (const id of [...node.tasks, ...node.dependsOn, ...node.covers]) referenced.add(id);
    }
    if (node.kind === "recovery") referenced.add(node.stepRef);
  }
  const missingReferences = [...referenced].filter((id) => ledger.nodes[id]?.status !== "current").sort();
  if (missingReferences.length) {
    throw new DevFlowError("TRACE_SLICE_STALE", "implementation-plan Trace slice references stale or missing nodes", {
      missingReferences,
      recoveryHint: "重新登记上游 requirements 或计划 Markdown，使被引用节点恢复 current。",
    });
  }
}

/** Shared StatusView/Markdown projection view of the Trace requirement for the current route step. */
export async function inspectCurrentTrace(root: string, state: FeatureState): Promise<TraceGateInspection> {
  if (!traceIsEnforced(state)) return { enforced: false };
  const step = currentOpenStep(state);
  return step ? inspectTraceGate(root, state, step) : { enforced: true };
}

export async function assertTraceGateCurrent(root: string, state: FeatureState, step: string): Promise<TraceabilityLedger | undefined> {
  const inspection = await inspectTraceGate(root, state, step);
  if (!inspection.blocker) return inspection.ledger;
  throw new DevFlowError(
    inspection.blocker.code,
    `Trace slice is not ready for ${step}`,
    {
      ...inspection.blocker.details,
      recoveryHint: inspection.blocker.code === "TRACE_SLICE_STALE"
        ? "验证配置或 trace 证据已变更：若存在活动实现单元，先用 dev_flow_abandon_implementation_unit 取消，再重登记计划刷新 Trace 基线。"
        : "按当前阶段补齐 trace 证据后重试。",
    },
  );
}
