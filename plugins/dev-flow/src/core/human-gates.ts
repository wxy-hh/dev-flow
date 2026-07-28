import { createHash } from "node:crypto";
import { routeDefinition } from "../policy/contract.js";
import { DevFlowError } from "./errors.js";
import {
  gateApprovalPhrases,
  gateReplyHint,
  isExplicitGateApproval,
  type GateId,
} from "./gate-approval.js";
import { gateBasis } from "./gate-basis.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { artifactsRequiredBeforeGate, assertCurrentStep } from "./step-order.js";
import {
  clearInteractionsForTarget,
  createInteraction,
  fallbackHint,
  getInteraction,
  resolveNativeInteraction,
  resolveTokenInteraction,
  toPublicInteraction,
  type InteractionResponse,
  type PublicInteraction,
} from "./user-interactions.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const gates = new Set<GateId>(["requirement_confirmation", "implementation_approval"]);

export type GatePresentation = FeatureState & { gateReplyHint: string; gateInteraction: PublicInteraction };

function gateId(value: string): GateId {
  if (!gates.has(value as GateId)) throw new DevFlowError("INVALID_GATE", value);
  return value as GateId;
}

function gateInteractionOptions(gate: GateId) {
  return [
    { id: "confirm", label: gate === "requirement_confirmation" ? "确认需求" : "确认执行" },
    { id: "request-changes", label: "提出修改意见", requiresComment: true },
  ];
}

export async function presentGate(
  root: string,
  id: string,
  expectedRevision: number,
  gate: string,
): Promise<GatePresentation> {
  const selectedGate = gateId(gate);
  let interaction: ReturnType<typeof createInteraction> | undefined;
  const state = await mutate(root, id, expectedRevision, "gate-presented", async (state) => {
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
    const basisHash = digest(gateBasis(state, selectedGate));
    state.humanGates[selectedGate] = {
      status: "pending",
      presentedRevision: state.revision,
      presentedAt: new Date().toISOString(),
      basisHash,
    };
    interaction = createInteraction(state, {
      kind: "gate",
      target: `gate:${selectedGate}`,
      basisHash,
      options: gateInteractionOptions(selectedGate),
    });
  }, () => ({
    gate: selectedGate,
    replyHint: interaction ? fallbackHint(interaction) : gateReplyHint(selectedGate),
    interactionId: interaction?.id,
  }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", selectedGate);
  return { ...state, gateReplyHint: fallbackHint(interaction), gateInteraction: toPublicInteraction(interaction) };
}

type GateConfirmation = {
  promptEventId?: string;
  turnBoundaryEventId?: string;
};

function eventIdFromConfirmation(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const confirmation = (value as { confirmation?: unknown }).confirmation;
  if (typeof confirmation !== "object" || confirmation === null || Array.isArray(confirmation)) return undefined;
  const record = confirmation as { promptEventId?: unknown; turnBoundaryEventId?: unknown };
  return typeof record.promptEventId === "string"
    ? record.promptEventId
    : typeof record.turnBoundaryEventId === "string"
      ? record.turnBoundaryEventId
      : undefined;
}

function resolveProvenance(
  events: Array<{ revision: number; type: string; at: string; data: unknown }>,
  state: FeatureState,
  gate: GateId,
  userReply: string,
  provenance: GateConfirmation,
): GateConfirmation {
  if (provenance.promptEventId || provenance.turnBoundaryEventId) return provenance;

  const current = state.humanGates[gate] as { presentedAt?: string; presentedRevision?: number } | undefined;
  const consumed = new Set(
    Object.values(state.humanGates)
      .map(eventIdFromConfirmation)
      .filter((eventId): eventId is string => Boolean(eventId)),
  );
  const match = [...events].reverse().find((item) => {
    const event = item.data as { eventId?: unknown; type?: unknown; text?: unknown; at?: unknown };
    return item.type === "host-event"
      && typeof event.eventId === "string"
      && !consumed.has(event.eventId)
      && event.type === "user-prompt"
      && event.text === userReply
      && item.revision > (current?.presentedRevision ?? state.revision)
      && typeof current?.presentedAt === "string"
      && typeof event.at === "string"
      && Date.parse(event.at) >= Date.parse(current.presentedAt);
  });
  const eventId = (match?.data as { eventId?: unknown } | undefined)?.eventId;
  if (typeof eventId !== "string") {
    throw new DevFlowError(
      "HUMAN_GATE_PROVENANCE_UNAVAILABLE",
      "no matching post-presentation user prompt was captured",
      { recoveryHint: "Ensure the host UserPromptSubmit hook is active, then submit one exact approval phrase and retry confirmation" },
    );
  }
  return { promptEventId: eventId };
}

function gateFromInteraction(state: FeatureState, interactionId: string): GateId {
  const interaction = getInteraction(state, interactionId);
  if (interaction.kind !== "gate" || !interaction.target.startsWith("gate:")) {
    throw new DevFlowError("INTERACTION_TARGET_INVALID", interactionId);
  }
  return gateId(interaction.target.slice("gate:".length));
}

function assertTokenEvidence(
  events: Array<{ revision: number; type: string; at: string; data: unknown }>,
  state: FeatureState,
  gate: GateId,
  userReply: string,
  provenance: GateConfirmation,
): GateConfirmation {
  const resolved = resolveProvenance(events, state, gate, userReply, provenance);
  const marker = resolved.promptEventId ?? resolved.turnBoundaryEventId;
  const current = state.humanGates[gate] as { presentedRevision?: number; presentedAt?: string } | undefined;
  const eventRecord = events.find((item) => item.type === "host-event"
    && (item.data as { eventId?: string }).eventId === marker);
  const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
  if (!marker || !event || !current?.presentedAt
    || (eventRecord?.revision ?? -1) <= (current.presentedRevision ?? -1)
    || Date.parse(event.at ?? "") < Date.parse(current.presentedAt)) {
    throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation evidence must be later than gate presentation", {
      recoveryHint: "Submit the exact one-time reply in a later user turn",
    });
  }
  if (resolved.promptEventId && (event.type !== "user-prompt" || event.text !== userReply)) {
    throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt", {
      recoveryHint: "Pass the captured user prompt text exactly",
    });
  }
  if (resolved.turnBoundaryEventId && event.type !== "turn-boundary") {
    throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "turn boundary was not captured");
  }
  return resolved;
}

async function resolveGateResponse(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { action: string; comment?: string; source: "elicitation" }
    | { userReply: string; provenance: GateConfirmation; source: "text-token" },
): Promise<FeatureState> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const gate = gateFromInteraction(initial, interactionId);
  const events = input.source === "text-token" ? await readFeatureEvents(root, id) : [];
  const provenance = input.source === "text-token"
    ? assertTokenEvidence(events, initial, gate, input.userReply, input.provenance)
    : undefined;
  let response: InteractionResponse | undefined;
  return mutate(root, id, expectedRevision, "gate-interaction-resolved", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    const current = state.humanGates[gate] as {
      status?: string;
      basisHash?: string;
      presentedRevision?: number;
      lastResponse?: InteractionResponse;
    } | undefined;
    if (current?.status !== "pending") throw new DevFlowError("HUMAN_GATE_NOT_PENDING", gate);
    const interaction = getInteraction(state, interactionId);
    if (interaction.kind !== "gate" || interaction.target !== `gate:${gate}` || interaction.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
    }
    const basisHash = digest(gateBasis(state, gate));
    if (basisHash !== current.basisHash || basisHash !== interaction.basisHash) {
      throw new DevFlowError("HUMAN_GATE_BASIS_CHANGED", gate, {
        recoveryHint: "Present the gate again after updating its approval basis",
      });
    }
    response = input.source === "elicitation"
      ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host)
      : resolveTokenInteraction(state, interactionId, input.userReply, host, provenance!.promptEventId ?? provenance!.turnBoundaryEventId!);
    if (response.action === "confirm") {
      state.humanGates[gate] = {
        ...current,
        status: "confirmed",
        confirmation: {
          interactionId,
          ...response,
          confirmedAt: new Date().toISOString(),
        },
      };
      state.steps[gate] = { status: "satisfied" };
    } else if (response.action === "request-changes") {
      state.humanGates[gate] = { ...current, status: "returned", lastResponse: response };
    } else {
      throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ gate, interactionId, response }));
}

export async function resolveGateElicitation(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return resolveGateResponse(root, id, expectedRevision, interactionId, host, { action, comment, source: "elicitation" });
}

export async function resolveGateToken(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  provenance: GateConfirmation,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return resolveGateResponse(root, id, expectedRevision, interactionId, host, { userReply, provenance, source: "text-token" });
}

export async function confirmGate(
  root: string,
  id: string,
  expectedRevision: number,
  gate: string,
  userReply: string,
  provenance: GateConfirmation,
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
  const currentState = await readState(root, id);
  const events = await readFeatureEvents(root, id);
  const resolvedProvenance = resolveProvenance(events, currentState, selectedGate, userReply, provenance);
  const marker = resolvedProvenance.promptEventId ?? resolvedProvenance.turnBoundaryEventId;
  if (!marker) throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "confirmation provenance is required");
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
    if (resolvedProvenance.promptEventId && (event.type !== "user-prompt" || event.text !== userReply)) {
      throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt", {
        recoveryHint: "Pass the captured user prompt text exactly",
      });
    }
    if (resolvedProvenance.turnBoundaryEventId && event.type !== "turn-boundary") {
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
      confirmation: { userReply, ...resolvedProvenance, host, confirmedAt: new Date().toISOString() },
    };
    clearInteractionsForTarget(state, `gate:${selectedGate}`);
    state.steps[selectedGate] = { status: "satisfied" };
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { gate: selectedGate });
}
