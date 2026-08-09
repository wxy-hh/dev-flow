import { traceEnforcementRequired } from "../policy/contract.js";
import type { TraceSummary, TraceabilityLedger } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import { assertTraceSliceCurrent } from "./traceability.js";
import { verificationCommandHashes } from "./project-config.js";

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
    return { enforced: true, ledger, effectiveSummary: ledger.summary };
  } catch (error) {
    return {
      enforced: true,
      ...(ledger ? { ledger, effectiveSummary: ledger.summary } : {}),
      blocker: blockerFor(traceStep, error),
    };
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
    inspection.blocker.details,
  );
}
