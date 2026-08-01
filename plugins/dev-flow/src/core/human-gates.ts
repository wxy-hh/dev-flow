import { createHash } from "node:crypto";
import { reviewEnforcementRequired, routeDefinitionForFeature } from "../policy/contract.js";
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
import { assertTraceGateCurrent } from "./traceability-gates.js";
import { assertCurrentReviewProjection } from "./review-projection.js";
import {
  clearInteractionsForTarget,
  createInteraction,
  fallbackHint,
  getInteraction,
  normalizeReplyText,
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

async function assertReviewProjectionForGate(root: string, state: FeatureState, gate: GateId): Promise<void> {
  if (gate === "implementation_approval" && reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
    await assertCurrentReviewProjection(root, state);
  }
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
    if (!routeDefinitionForFeature(state.route, state.workflowCapabilities).orderedSteps.includes(selectedGate)) {
      throw new DevFlowError("INVALID_GATE", selectedGate);
    }
    if (state.humanGates[selectedGate]) {
      throw new DevFlowError("HUMAN_GATE_ALREADY_PRESENTED", selectedGate);
    }
    assertCurrentStep(state, selectedGate);
    const missing = artifactsRequiredBeforeGate(state, selectedGate).find((kind) => !state.artifacts[kind]);
    if (missing) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", missing);
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, selectedGate);
    await assertReviewProjectionForGate(root, state, selectedGate);
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

/** Collects every confirmation event id (both prompt and turn-boundary slots). */
function confirmationEventIds(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const confirmation = (value as { confirmation?: unknown }).confirmation;
  if (typeof confirmation !== "object" || confirmation === null || Array.isArray(confirmation)) return [];
  const record = confirmation as { promptEventId?: unknown; turnBoundaryEventId?: unknown };
  const ids: string[] = [];
  if (typeof record.promptEventId === "string") ids.push(record.promptEventId);
  if (typeof record.turnBoundaryEventId === "string") ids.push(record.turnBoundaryEventId);
  return ids;
}

type HostEventRecord = { revision: number; type: string; at: string; data: unknown };

function hostEventRecord(events: HostEventRecord[], eventId: string): HostEventRecord | undefined {
  return events.find((item) => item.type === "host-event"
    && (item.data as { eventId?: string }).eventId === eventId);
}

function assertGateEvidenceTiming(
  eventRecord: HostEventRecord | undefined,
  event: { type?: string; text?: string; at?: string } | undefined,
  presented: { presentedRevision?: number; presentedAt?: string } | undefined,
  recoveryHint: string,
): void {
  if (!event || !presented?.presentedAt
    || (eventRecord?.revision ?? -1) <= (presented.presentedRevision ?? -1)
    || Date.parse(event.at ?? "") < Date.parse(presented.presentedAt)) {
    throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation evidence must be later than gate presentation", {
      recoveryHint,
    });
  }
}

function assertPromptEvidence(
  event: { type?: string; text?: string } | undefined,
  userReply: string,
  recoveryHint: string,
): void {
  if (event?.type !== "user-prompt" || normalizeReplyText(String(event.text ?? "")) !== normalizeReplyText(userReply)) {
    throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt", {
      recoveryHint,
    });
  }
}

function assertTurnBoundaryEvidence(event: { type?: string } | undefined, recoveryHint?: string): void {
  if (event?.type !== "turn-boundary") {
    throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "turn boundary was not captured", {
      ...(recoveryHint ? { recoveryHint } : {}),
    });
  }
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
  const consumed = new Set(Object.values(state.humanGates).flatMap(confirmationEventIds));
  const match = [...events].reverse().find((item) => {
    const event = item.data as { eventId?: unknown; type?: unknown; text?: unknown; at?: unknown };
    return item.type === "host-event"
      && typeof event.eventId === "string"
      && !consumed.has(event.eventId)
      && event.type === "user-prompt"
      && normalizeReplyText(String(event.text ?? "")) === normalizeReplyText(userReply)
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
      { recoveryHint: "请确保宿主 UserPromptSubmit hook 已生效，然后在门禁呈现后提交一条准确的批准词（如“确认需求”）重试确认" },
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
  const current = state.humanGates[gate] as { presentedRevision?: number; presentedAt?: string } | undefined;
  if (resolved.promptEventId) {
    const eventRecord = hostEventRecord(events, resolved.promptEventId);
    const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
    assertGateEvidenceTiming(eventRecord, event, current, "请在门禁呈现后的后续回合提交一次性回复或批准词");
    assertPromptEvidence(event, userReply, "请原样传递捕获到的用户回复文本（空格与大小写差异会自动归一化）");
  }
  if (resolved.turnBoundaryEventId) {
    const eventRecord = hostEventRecord(events, resolved.turnBoundaryEventId);
    const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
    assertGateEvidenceTiming(eventRecord, event, current, "请在门禁呈现后的后续回合提交一次性回复或批准词");
    assertTurnBoundaryEvidence(event);
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
    await assertTraceGateCurrent(root, state, gate);
    await assertReviewProjectionForGate(root, state, gate);
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
        recoveryHint: "门禁依据已变更，请更新并登记相关资产后重新呈现门禁",
      });
    }
    if (input.source === "text-token") {
      // 与 confirmGate 相同的跨门禁防重放：任一 provenance id 已被其他门禁消费即拒绝。
      const ids = [
        ...(provenance?.promptEventId ? [provenance.promptEventId] : []),
        ...(provenance?.turnBoundaryEventId ? [provenance.turnBoundaryEventId] : []),
      ];
      for (const [otherGate, value] of Object.entries(state.humanGates)) {
        if (otherGate === gate) continue;
        const replayed = confirmationEventIds(value).find((eventId) => ids.includes(eventId));
        if (replayed) throw new DevFlowError("HUMAN_GATE_EVENT_CONSUMED", replayed);
      }
    }
    response = input.source === "elicitation"
      ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host)
      : resolveTokenInteraction(
          state,
          interactionId,
          input.userReply,
          host,
          provenance!,
          // HUMAN GATE 支持自然语言批准词（如“确认需求”“批准实现”），映射为 confirm 选项；
          // 一次性 token 行仍作为兜底通道。grill 等动态选项交互不映射。
          isExplicitGateApproval(gate, input.userReply) ? "confirm" : undefined,
        );
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
        recoveryHint: "请在门禁呈现后输入一条准确批准词（如“确认需求”）或复制一次性回复整行",
      },
    );
  }
  const currentState = await readState(root, id);
  const events = await readFeatureEvents(root, id);
  const resolvedProvenance = resolveProvenance(events, currentState, selectedGate, userReply, provenance);
  const eventIds = [
    ...(resolvedProvenance.promptEventId ? [resolvedProvenance.promptEventId] : []),
    ...(resolvedProvenance.turnBoundaryEventId ? [resolvedProvenance.turnBoundaryEventId] : []),
  ];
  if (!eventIds.length) throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "confirmation provenance is required");
  return mutate(root, id, expectedRevision, "gate-confirmed", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, selectedGate);
    await assertReviewProjectionForGate(root, state, selectedGate);
    const current = state.humanGates[selectedGate] as {
      status?: string;
      basisHash?: string;
      presentedRevision?: number;
      presentedAt?: string;
    } | undefined;
    if (current?.status !== "pending") {
      throw new DevFlowError("HUMAN_GATE_NOT_PENDING", selectedGate, {
        recoveryHint: "请先呈现当前门禁再尝试确认",
      });
    }
    if ((current.presentedRevision ?? state.revision) >= state.revision) {
      throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation must occur after presentation", {
        recoveryHint: "请等待门禁呈现后的新回合再确认",
      });
    }
    // Each event id is validated against its own event type and timing; a
    // prompt id must be a user-prompt and a turn-boundary id must be a boundary.
    if (resolvedProvenance.promptEventId) {
      const eventRecord = hostEventRecord(events, resolvedProvenance.promptEventId);
      const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
      assertGateEvidenceTiming(eventRecord, event, current, "请在门禁呈现后的后续回合提交确认");
      assertPromptEvidence(event, userReply, "请原样传递捕获到的用户回复文本（空格与大小写差异会自动归一化）");
    }
    if (resolvedProvenance.turnBoundaryEventId) {
      const eventRecord = hostEventRecord(events, resolvedProvenance.turnBoundaryEventId);
      const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
      assertGateEvidenceTiming(eventRecord, event, current, "请在门禁呈现后的后续回合提交确认");
      assertTurnBoundaryEvidence(event, "请使用已捕获的回合边界事件或后续用户回复");
    }
    for (const [otherGate, value] of Object.entries(state.humanGates)) {
      if (otherGate === selectedGate) continue;
      const replayed = confirmationEventIds(value).find((eventId) => eventIds.includes(eventId));
      if (replayed) throw new DevFlowError("HUMAN_GATE_EVENT_CONSUMED", replayed);
    }
    const basisHash = digest(gateBasis(state, selectedGate));
    if (basisHash !== current.basisHash) {
      throw new DevFlowError("HUMAN_GATE_BASIS_CHANGED", selectedGate, {
        recoveryHint: "门禁依据已变更，请更新并登记相关资产后重新呈现门禁",
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
