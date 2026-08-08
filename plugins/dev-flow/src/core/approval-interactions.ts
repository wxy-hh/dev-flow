import { createHash } from "node:crypto";
import { reviewEnforcementRequired } from "../policy/contract.js";
import { DevFlowError } from "./errors.js";
import {
  approvalPhrases,
  approvalReplyHint,
  isExplicitApproval,
  type ApprovalId,
} from "./approval.js";
import { approvalBasis, approvalIds } from "./approval-basis.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { assertTraceGateCurrent } from "./traceability-gates.js";
import { assertCurrentReviewProjection } from "./review-projection.js";
import { routeDefinitionForState } from "./step-order.js";
import { satisfyObligations } from "../policy/obligations.js";
import {
  clearInteractionsForTarget,
  createInteraction,
  decisionHint,
  getInteraction,
  normalizeReplyText,
  resolveNativeInteraction,
  resolveTextInteraction,
  toPublicInteraction,
  type InteractionResponse,
  type PublicInteraction,
} from "./user-interactions.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type ApprovalPresentation = FeatureState & { approvalReplyHint: string; approvalInteraction: PublicInteraction; approvalId: ApprovalId; interactionId: string };

function approvalId(value: string): ApprovalId {
  if (!/^approval:[a-f0-9]{16,}$/.test(value)) throw new DevFlowError("INVALID_APPROVAL", value);
  return value;
}

function approvalInteractionOptions() {
  return [
    { id: "confirm", label: "确认开始执行" },
    { id: "request-changes", label: "提出修改意见", requiresComment: true },
  ];
}

async function assertReviewProjectionForApproval(root: string, state: FeatureState): Promise<void> {
  if (reviewEnforcementRequired(state.route, state.classification.controls)) {
    await assertCurrentReviewProjection(root, state);
  }
}

export async function presentApproval(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<ApprovalPresentation> {
  const initial = await readState(root, id);
  const candidates = approvalIds(initial).filter((candidate) => {
    const obligation = initial.obligations?.find((item) => item.id === candidate);
    return obligation?.status !== "satisfied";
  });
  if (candidates.length !== 1) throw new DevFlowError("APPROVAL_NOT_UNIQUE", "Core 无法选择唯一的当前审批。", { approvalIds: candidates, recoveryHint: "刷新状态并修复重复或缺失的审批投影" });
  const selectedApproval = approvalId(candidates[0]);
  let interaction: ReturnType<typeof createInteraction> | undefined;
  const state = await mutate(root, id, expectedRevision, "approval-presented", async (state) => {
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "approval requires active feature");
    }
    const obligation = state.obligations?.find((candidate) => candidate.id === selectedApproval && candidate.kind === "approval");
    if (!obligation || obligation.status === "satisfied") throw new DevFlowError("INVALID_APPROVAL", selectedApproval);
    const definition = routeDefinitionForState(state);
    const implementationIndex = definition.orderedSteps.indexOf("implementation");
    if (implementationIndex < 0 || !definition.orderedSteps.slice(0, implementationIndex).every((step) => state.steps[step]?.status === "satisfied")) {
      throw new DevFlowError("APPROVAL_NOT_READY", "approval is only available after planning prerequisites are complete", { expectedStage: definition.orderedSteps[implementationIndex - 1] });
    }
    if (state.humanGates[selectedApproval]) {
      throw new DevFlowError("APPROVAL_ALREADY_PRESENTED", selectedApproval);
    }
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, "planning");
    await assertReviewProjectionForApproval(root, state);
    const basisHash = digest(approvalBasis(state, selectedApproval));
    state.humanGates[selectedApproval] = {
      status: "pending",
      presentedRevision: state.revision,
      presentedAt: new Date().toISOString(),
      basisHash,
      approvalId: selectedApproval,
    };
    interaction = createInteraction(state, {
      kind: "approval",
      target: `approval:${selectedApproval}`,
      basisHash,
      options: approvalInteractionOptions(),
    });
  }, () => ({
    approvalId: selectedApproval,
    replyHint: interaction ? decisionHint(interaction) : approvalReplyHint(),
    interactionId: interaction?.id,
  }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", selectedApproval);
  return { ...state, approvalId: selectedApproval, interactionId: interaction.id, approvalReplyHint: decisionHint(interaction), approvalInteraction: toPublicInteraction(interaction) };
}

type ApprovalConfirmation = {
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

function hostEventRecord(events: HostEventRecord[], eventId: string, expectedHost?: "claude" | "codex"): HostEventRecord | undefined {
  const record = events.find((item) => item.type === "host-event"
    && (item.data as { eventId?: string }).eventId === eventId);
  if (record && expectedHost && (record.data as { host?: unknown }).host !== expectedHost) {
    throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "host event belongs to a different host", {
      expectedHost,
      actualHost: (record.data as { host?: unknown }).host,
      eventId,
    });
  }
  return record;
}

function assertApprovalEvidenceTiming(
  eventRecord: HostEventRecord | undefined,
  event: { type?: string; text?: string; at?: string } | undefined,
  presented: { presentedRevision?: number; presentedAt?: string } | undefined,
  recoveryHint: string,
): void {
  if (!event || !presented?.presentedAt
    || (eventRecord?.revision ?? -1) <= (presented.presentedRevision ?? -1)
    || Date.parse(event.at ?? "") < Date.parse(presented.presentedAt)) {
    throw new DevFlowError("APPROVAL_SAME_TURN", "confirmation evidence must be later than approval presentation", {
      recoveryHint,
    });
  }
}

function assertApprovalPromptEvidence(
  event: { type?: string; text?: string } | undefined,
  userReply: string,
  recoveryHint: string,
): void {
  if (event?.type !== "user-prompt" || normalizeReplyText(String(event.text ?? "")) !== normalizeReplyText(userReply)) {
    throw new DevFlowError("APPROVAL_REPLY_MISMATCH", "userReply must match the captured prompt", {
      recoveryHint,
    });
  }
}

function assertApprovalTurnBoundaryEvidence(event: { type?: string } | undefined, recoveryHint?: string): void {
  if (event?.type !== "turn-boundary") {
    throw new DevFlowError("APPROVAL_PROVENANCE_UNAVAILABLE", "turn boundary was not captured", {
      ...(recoveryHint ? { recoveryHint } : {}),
    });
  }
}

function resolveProvenance(
  events: Array<{ revision: number; type: string; at: string; data: unknown }>,
  state: FeatureState,
  approval: ApprovalId,
  userReply: string,
  provenance: ApprovalConfirmation,
  host: "claude" | "codex",
): ApprovalConfirmation {
  if (provenance.promptEventId || provenance.turnBoundaryEventId) return provenance;

  const current = state.humanGates[approval] as { presentedAt?: string; presentedRevision?: number } | undefined;
  const consumed = new Set(Object.values(state.humanGates).flatMap(confirmationEventIds));
  const match = [...events].reverse().find((item) => {
    const event = item.data as { eventId?: unknown; type?: unknown; text?: unknown; at?: unknown; host?: unknown };
    return item.type === "host-event"
      && typeof event.eventId === "string"
      && !consumed.has(event.eventId)
      && event.type === "user-prompt"
      && event.host === host
      && normalizeReplyText(String(event.text ?? "")) === normalizeReplyText(userReply)
      && item.revision > (current?.presentedRevision ?? state.revision)
      && typeof current?.presentedAt === "string"
      && typeof event.at === "string"
      && Date.parse(event.at) >= Date.parse(current.presentedAt);
  });
  const eventId = (match?.data as { eventId?: unknown } | undefined)?.eventId;
  if (typeof eventId !== "string") {
    throw new DevFlowError(
      "APPROVAL_PROVENANCE_UNAVAILABLE",
      "no matching post-presentation user prompt was captured",
      { recoveryHint: "请确保宿主 UserPromptSubmit hook 已生效，然后在门禁呈现后提交一条准确的批准词（如“确认需求”）重试确认" },
    );
  }
  return { promptEventId: eventId };
}

function approvalFromInteraction(state: FeatureState, interactionId: string): ApprovalId {
  const interaction = getInteraction(state, interactionId);
  if (interaction.kind !== "approval" || !interaction.target.startsWith("approval:")) {
    throw new DevFlowError("INTERACTION_TARGET_INVALID", interactionId);
  }
  return approvalId(interaction.target.slice("approval:".length));
}

function assertTokenEvidence(
  events: Array<{ revision: number; type: string; at: string; data: unknown }>,
  state: FeatureState,
  approval: ApprovalId,
  userReply: string,
  provenance: ApprovalConfirmation,
  host: "claude" | "codex",
): ApprovalConfirmation {
  const resolved = resolveProvenance(events, state, approval, userReply, provenance, host);
  const current = state.humanGates[approval] as { presentedRevision?: number; presentedAt?: string } | undefined;
  if (resolved.promptEventId) {
    const eventRecord = hostEventRecord(events, resolved.promptEventId, host);
    const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
    assertApprovalEvidenceTiming(eventRecord, event, current, "请在确认呈现后的后续回合提交一次性回复或批准词");
    assertApprovalPromptEvidence(event, userReply, "请原样传递捕获到的用户回复文本（空格与大小写差异会自动归一化）");
  }
  if (resolved.turnBoundaryEventId) {
    const eventRecord = hostEventRecord(events, resolved.turnBoundaryEventId, host);
    const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
    assertApprovalEvidenceTiming(eventRecord, event, current, "请在确认呈现后的后续回合提交一次性回复或批准词");
    assertApprovalTurnBoundaryEvidence(event);
  }
  return resolved;
}

async function resolveApprovalResponse(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { action: string; comment?: string; source: "elicitation" }
    | { userReply: string; provenance: ApprovalConfirmation; source: "text" },
): Promise<FeatureState> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const approval = approvalFromInteraction(initial, interactionId);
  const events = input.source === "text" ? await readFeatureEvents(root, id) : [];
  const provenance = input.source === "text"
    ? assertTokenEvidence(events, initial, approval, input.userReply, input.provenance, host)
    : undefined;
  let response: InteractionResponse | undefined;
  return mutate(root, id, expectedRevision, "approval-interaction-resolved", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, "planning");
    await assertReviewProjectionForApproval(root, state);
    const current = state.humanGates[approval] as {
      status?: string;
      basisHash?: string;
      presentedRevision?: number;
      lastResponse?: InteractionResponse;
    } | undefined;
    if (current?.status !== "pending") throw new DevFlowError("APPROVAL_NOT_PENDING", approval);
    const interaction = getInteraction(state, interactionId);
    if (interaction.kind !== "approval" || interaction.target !== `approval:${approval}` || interaction.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
    }
    const basisHash = digest(approvalBasis(state, approval));
    if (basisHash !== current.basisHash || basisHash !== interaction.basisHash) {
      throw new DevFlowError("APPROVAL_BASIS_CHANGED", approval, {
        recoveryHint: "门禁依据已变更，请更新并登记相关资产后重新呈现门禁",
      });
    }
    if (input.source === "text") {
      // 与 confirmApproval 相同的跨门禁防重放：任一 provenance id 已被其他门禁消费即拒绝。
      const ids = [
        ...(provenance?.promptEventId ? [provenance.promptEventId] : []),
        ...(provenance?.turnBoundaryEventId ? [provenance.turnBoundaryEventId] : []),
      ];
      for (const [otherApproval, value] of Object.entries(state.humanGates)) {
        if (otherApproval === approval) continue;
        const replayed = confirmationEventIds(value).find((eventId) => ids.includes(eventId));
        if (replayed) throw new DevFlowError("APPROVAL_EVENT_CONSUMED", replayed);
      }
    }
    response = input.source === "elicitation"
      ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host)
      : resolveTextInteraction(
          state,
          interactionId,
          input.userReply,
          host,
          provenance!,
          // 动态 approval 支持自然语言批准词（如“确认需求”“批准实现”），映射为 confirm 选项；
          // Approval phrases are handled by the single natural-language answer path.
          isExplicitApproval(input.userReply) ? "confirm" : undefined,
        );
    if (response.action === "confirm") {
      state.humanGates[approval] = {
        ...current,
        status: "confirmed",
        confirmation: {
          interactionId,
          ...response,
          confirmedAt: new Date().toISOString(),
        },
      };
      state.obligations = satisfyObligations(state.obligations, ["approval"]);
    } else if (response.action === "request-changes") {
      state.humanGates[approval] = { ...current, status: "returned", lastResponse: response };
    } else {
      throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ approval, interactionId, response }));
}

export async function resolveApprovalElicitation(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return resolveApprovalResponse(root, id, expectedRevision, interactionId, host, { action, comment, source: "elicitation" });
}

export async function resolveApprovalToken(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  provenance: ApprovalConfirmation,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return resolveApprovalResponse(root, id, expectedRevision, interactionId, host, { userReply, provenance, source: "text" });
}

/** Public answer path: Core resolves prompt provenance from the trusted host event ledger. */
export async function resolveApprovalAnswer(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return resolveApprovalResponse(root, id, expectedRevision, interactionId, host, {
    userReply,
    provenance: {},
    source: "text",
  });
}

export async function confirmApproval(
  root: string,
  id: string,
  expectedRevision: number,
  approval: string,
  userReply: string,
  provenance: ApprovalConfirmation,
  host: "claude" | "codex",
): Promise<FeatureState> {
  const selectedApproval = approvalId(approval);
  if (!userReply.trim()) throw new DevFlowError("APPROVAL_REPLY_REQUIRED", "userReply is required");
  if (!isExplicitApproval(userReply)) {
    throw new DevFlowError(
      "APPROVAL_APPROVAL_NOT_EXPLICIT",
      "userReply is not an exact approval phrase",
      {
        approval: selectedApproval,
        allowed: approvalPhrases,
        recoveryHint: "请在门禁呈现后输入一条准确批准词（如“确认需求”）或复制一次性回复整行",
      },
    );
  }
  const currentState = await readState(root, id);
  const events = await readFeatureEvents(root, id);
  const resolvedProvenance = resolveProvenance(events, currentState, selectedApproval, userReply, provenance, host);
  const eventIds = [
    ...(resolvedProvenance.promptEventId ? [resolvedProvenance.promptEventId] : []),
    ...(resolvedProvenance.turnBoundaryEventId ? [resolvedProvenance.turnBoundaryEventId] : []),
  ];
  if (!eventIds.length) throw new DevFlowError("APPROVAL_PROVENANCE_UNAVAILABLE", "confirmation provenance is required");
  return mutate(root, id, expectedRevision, "approval-confirmed", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    await assertTraceGateCurrent(root, state, "planning");
    await assertReviewProjectionForApproval(root, state);
    const current = state.humanGates[selectedApproval] as {
      status?: string;
      basisHash?: string;
      presentedRevision?: number;
      presentedAt?: string;
    } | undefined;
    if (current?.status !== "pending") {
      throw new DevFlowError("APPROVAL_NOT_PENDING", selectedApproval, {
        recoveryHint: "请先呈现当前门禁再尝试确认",
      });
    }
    if ((current.presentedRevision ?? state.revision) >= state.revision) {
      throw new DevFlowError("APPROVAL_SAME_TURN", "confirmation must occur after presentation", {
        recoveryHint: "请等待门禁呈现后的新回合再确认",
      });
    }
    // Each event id is validated against its own event type and timing; a
    // prompt id must be a user-prompt and a turn-boundary id must be a boundary.
    if (resolvedProvenance.promptEventId) {
      const eventRecord = hostEventRecord(events, resolvedProvenance.promptEventId, host);
      const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
      assertApprovalEvidenceTiming(eventRecord, event, current, "请在确认呈现后的后续回合提交确认");
      assertApprovalPromptEvidence(event, userReply, "请原样传递捕获到的用户回复文本（空格与大小写差异会自动归一化）");
    }
    if (resolvedProvenance.turnBoundaryEventId) {
      const eventRecord = hostEventRecord(events, resolvedProvenance.turnBoundaryEventId, host);
      const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
      assertApprovalEvidenceTiming(eventRecord, event, current, "请在确认呈现后的后续回合提交确认");
      assertApprovalTurnBoundaryEvidence(event, "请使用已捕获的回合边界事件或后续用户回复");
    }
    for (const [otherApproval, value] of Object.entries(state.humanGates)) {
      if (otherApproval === selectedApproval) continue;
      const replayed = confirmationEventIds(value).find((eventId) => eventIds.includes(eventId));
      if (replayed) throw new DevFlowError("APPROVAL_EVENT_CONSUMED", replayed);
    }
    const basisHash = digest(approvalBasis(state, selectedApproval));
    if (basisHash !== current.basisHash) {
      throw new DevFlowError("APPROVAL_BASIS_CHANGED", selectedApproval, {
        recoveryHint: "门禁依据已变更，请更新并登记相关资产后重新呈现门禁",
      });
    }
    state.humanGates[selectedApproval] = {
      ...current,
      status: "confirmed",
      confirmation: { userReply, ...resolvedProvenance, host, confirmedAt: new Date().toISOString() },
    };
    clearInteractionsForTarget(state, `approval:${selectedApproval}`);
    state.obligations = satisfyObligations(state.obligations, ["approval"]);
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { approval: selectedApproval });
}
