import { createHash } from "node:crypto";
import { routeDefinition } from "../policy/contract.js";
import { DevFlowError } from "./errors.js";
import {
  gateApprovalPhrases,
  isExplicitGateApproval,
  type GateId,
} from "./gate-approval.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readFeatureEvents, type FeatureState } from "./state-store.js";
import { artifactsRequiredBeforeGate, assertCurrentStep } from "./step-order.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const gates = new Set<GateId>(["requirement_confirmation", "implementation_approval"]);

function gateId(value: string): GateId {
  if (!gates.has(value as GateId)) throw new DevFlowError("INVALID_GATE", value);
  return value as GateId;
}

function gateBasis(state: FeatureState, gate: GateId) {
  if (gate === "requirement_confirmation") {
    return {
      route: state.route,
      scope: state.scope,
      requirements: state.artifacts.requirements,
      classification: state.classification,
    };
  }
  return {
    route: state.route,
    scope: state.scope,
    classification: state.classification,
    plan: state.artifacts["implementation-plan"],
    coverage: state.artifacts["coverage-matrix"],
    rollback: state.artifacts["rollback-units"] ?? state.artifacts["rollback-safety"],
    risk: state.artifacts["risk-card"],
    boundary: state.artifacts["boundary-card"],
  };
}

export async function presentGate(
  root: string,
  id: string,
  expectedRevision: number,
  gate: string,
): Promise<FeatureState> {
  const selectedGate = gateId(gate);
  return mutate(root, id, expectedRevision, "gate-presented", async (state) => {
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "gate requires active feature");
    }
    if (!routeDefinition(state.route).orderedSteps.includes(selectedGate)) {
      throw new DevFlowError("INVALID_GATE", selectedGate);
    }
    if (state.humanGates[selectedGate]) {
      throw new DevFlowError("HUMAN_GATE_ALREADY_PRESENTED", selectedGate);
    }
    assertCurrentStep(state, selectedGate);
    const missing = artifactsRequiredBeforeGate(state, selectedGate).find((kind) => !state.artifacts[kind]);
    if (missing) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", missing);
    await assertRequirementsGrillSatisfied(root, id, state);
    state.humanGates[selectedGate] = {
      status: "pending",
      presentedRevision: state.revision,
      presentedAt: new Date().toISOString(),
      basisHash: digest(gateBasis(state, selectedGate)),
    };
  }, { gate: selectedGate });
}

export async function confirmGate(
  root: string,
  id: string,
  expectedRevision: number,
  gate: string,
  userReply: string,
  provenance: { promptEventId?: string; turnBoundaryEventId?: string },
  host: "claude" | "codex",
): Promise<FeatureState> {
  const selectedGate = gateId(gate);
  if (!userReply.trim()) throw new DevFlowError("HUMAN_GATE_REPLY_REQUIRED", "userReply is required");
  if (!isExplicitGateApproval(selectedGate, userReply)) {
    throw new DevFlowError(
      "HUMAN_GATE_APPROVAL_NOT_EXPLICIT",
      "userReply is not an exact approval phrase",
      {
        gate: selectedGate,
        allowed: gateApprovalPhrases[selectedGate],
        recoveryHint: "Reply with one exact approval phrase after the gate is presented",
      },
    );
  }
  if (!provenance.promptEventId && !provenance.turnBoundaryEventId) {
    throw new DevFlowError(
      "HUMAN_GATE_PROVENANCE_UNAVAILABLE",
      "a post-presentation prompt or turn boundary is required",
      { recoveryHint: "Capture a later user prompt or turn boundary, then confirm the gate" },
    );
  }
  const marker = provenance.promptEventId ?? provenance.turnBoundaryEventId;
  if (!marker) {
    throw new DevFlowError(
      "HUMAN_GATE_PROVENANCE_UNAVAILABLE",
      "a post-presentation prompt or turn boundary is required",
      { recoveryHint: "Capture a later user prompt or turn boundary, then confirm the gate" },
    );
  }
  const events = await readFeatureEvents(root, id);
  return mutate(root, id, expectedRevision, "gate-confirmed", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    const current = state.humanGates[selectedGate] as {
      status?: string;
      basisHash?: string;
      presentedRevision?: number;
      presentedAt?: string;
    } | undefined;
    if (current?.status !== "pending") {
      throw new DevFlowError("HUMAN_GATE_NOT_PENDING", selectedGate, {
        recoveryHint: "Present the current gate before attempting confirmation",
      });
    }
    if ((current.presentedRevision ?? state.revision) >= state.revision) {
      throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation must occur after presentation", {
        recoveryHint: "Wait for a later user turn before confirming the gate",
      });
    }
    const eventRecord = events.find((item) => item.type === "host-event"
      && (item.data as { eventId?: string }).eventId === marker);
    const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
    if (!event || !current.presentedAt
      || (eventRecord?.revision ?? -1) <= (current.presentedRevision ?? -1)
      || Date.parse(event.at ?? "") < Date.parse(current.presentedAt)) {
      throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation evidence must be later than gate presentation", {
        recoveryHint: "Capture confirmation from a later user turn",
      });
    }
    if (provenance.promptEventId && (event.type !== "user-prompt" || event.text !== userReply)) {
      throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt", {
        recoveryHint: "Pass the captured user prompt text exactly",
      });
    }
    if (provenance.turnBoundaryEventId && event.type !== "turn-boundary") {
      throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "turn boundary was not captured", {
        recoveryHint: "Use a captured turn-boundary event or later user prompt",
      });
    }
    for (const [otherGate, value] of Object.entries(state.humanGates)) {
      const confirmation = (value as {
        confirmation?: { promptEventId?: string; turnBoundaryEventId?: string };
      }).confirmation;
      if (otherGate !== selectedGate && confirmation && Object.values(confirmation).includes(marker)) {
        throw new DevFlowError("HUMAN_GATE_EVENT_CONSUMED", String(marker));
      }
    }
    const basisHash = digest(gateBasis(state, selectedGate));
    if (basisHash !== current.basisHash) {
      throw new DevFlowError("HUMAN_GATE_BASIS_CHANGED", selectedGate, {
        recoveryHint: "Present the gate again after updating its approval basis",
      });
    }
    state.humanGates[selectedGate] = {
      ...current,
      status: "confirmed",
      confirmation: { userReply, ...provenance, host, confirmedAt: new Date().toISOString() },
    };
    state.steps[selectedGate] = { status: "satisfied" };
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { gate: selectedGate });
}
