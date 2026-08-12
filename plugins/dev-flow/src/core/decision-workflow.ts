import { createHash } from "node:crypto";
import { EMPTY_GOVERNANCE_LEDGER } from "../policy/types.js";
import { createDecision, resolveDecision } from "./decision-ledger.js";
import { DevFlowError } from "./errors.js";
import { resolveInteractionPromptEvent } from "./interaction-provenance.js";
import { matchDecisionReply, pendingDecisionForState } from "./decision-interactions.js";
import {
  createInteraction,
  getInteraction,
  resolveNativeInteraction,
  resolveTextInteraction,
  toPublicInteraction,
  type InteractionKind,
  type InteractionResponse,
  type PublicInteraction,
  type UserInteraction,
} from "./user-interactions.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";

export interface DecisionRatificationResult {
  state: FeatureState;
  interaction: PublicInteraction;
  decisionId: string;
  interactionId: string;
}

export async function recordDecision(
  root: string,
  id: string,
  expectedRevision: number,
  question: string,
  evidence: string,
  conclusion: string,
  factRefs: string[] = [],
  host: "claude" | "codex",
): Promise<DecisionRatificationResult> {
  if (!question.trim()) throw new DevFlowError("DECISION_QUESTION_REQUIRED", "decision question cannot be empty");
  if (!evidence.trim() || !conclusion.trim()) throw new DevFlowError("DECISION_EVIDENCE_REQUIRED", "ratified decisions require the user's original words and the intended conclusion");
  const decision = resolveDecision(createDecision(question, factRefs), evidence, conclusion);
  const target = `decision-ratification:${decision.id}`;
  let interaction: UserInteraction | undefined;
  const state = await mutate(root, id, expectedRevision, "decision-ratification-presented", (draft) => {
    interaction = createInteraction(draft, {
      kind: "decision-ratification",
      target,
      basisHash: createHash("sha256").update(`${decision.id}\n${evidence.trim()}\n${conclusion.trim()}`).digest("hex"),
      question: `较早对话中你表示“${evidence.trim()}”。将把它登记为针对“${question.trim()}”的当前决定“${conclusion.trim()}”。确认登记吗？`,
      options: [
        { id: "confirm", label: "确认登记" },
        { id: "reject", label: "不要登记" },
      ],
      ratification: { question: question.trim(), evidence: evidence.trim(), conclusion: conclusion.trim(), factRefs: [...factRefs] },
    });
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ decisionId: decision.id, presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), decisionId: decision.id, interactionId: interaction.id };
}

function ratifyDecision(draft: FeatureState, interaction: UserInteraction, response: InteractionResponse, promptEventId: string | undefined, host: "claude" | "codex"): void {
  const candidate = interaction.ratification;
  if (!candidate) throw new DevFlowError("INTERACTION_INVALID", "decision-ratification interaction is missing its candidate content", { interactionId: interaction.id });
  const decision = resolveDecision(createDecision(candidate.question, candidate.factRefs), candidate.evidence, candidate.conclusion);
  const ledgerAfter = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
  const credentialId = `CRED-ratify-${interaction.id}`;
  const credentials = [...ledgerAfter.credentials];
  if (!credentials.some((existing) => existing.recordId === credentialId)) {
    credentials.push({
      recordId: credentialId,
      kind: "credential",
      source: response.source === "elicitation" ? "native-form" : "text",
      host,
      interactionId: interaction.id,
      ...(response.source === "elicitation" ? { optionId: response.selectedOptionId ?? response.action } : response.selectedOptionId ? { optionId: response.selectedOptionId } : {}),
      ...(response.rawReply ? { rawText: response.rawReply } : {}),
      ...(promptEventId ? { basis: { kind: "event" as const, eventId: promptEventId } } : interaction.presentationEventId ? { basis: { kind: "event" as const, eventId: interaction.presentationEventId } } : {}),
      recordedAt: response.respondedAt,
    });
  }
  const decisions = [...ledgerAfter.decisions];
  if (!decisions.some((existing) => existing.recordId === decision.id)) {
    decisions.push({
      recordId: decision.id,
      kind: "decision",
      question: candidate.question,
      conclusion: candidate.conclusion,
      credentialId,
      ...(promptEventId ? { basis: { kind: "event" as const, eventId: promptEventId } } : interaction.presentationEventId ? { basis: { kind: "event" as const, eventId: interaction.presentationEventId } } : {}),
      recordedAt: response.respondedAt,
    });
  }
  draft.governance = { ...ledgerAfter, credentials, decisions };
}

/** 交互回答的统一解析骨架：领域模块共享同一可信回答与 CAS seam。 */
export async function resolveInteractionDecision(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { source: "elicitation"; action: string; comment?: string } | { source: "text"; userReply: string },
  config: {
    kind: InteractionKind;
    notPendingMessage: string;
    confirmReply: string;
    declineReply: string;
    confirmOperation: string;
    declineOperation: string;
    apply: (draft: FeatureState, interaction: UserInteraction, response: InteractionResponse, promptEventId: string | undefined) => void;
  },
): Promise<{ state: FeatureState; response: InteractionResponse; interaction: UserInteraction }> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== config.kind || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", config.notPendingMessage, { interactionId });
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (input.source === "text") {
    const events = await readFeatureEvents(root, id);
    const match = resolveInteractionPromptEvent(events, initial, interaction, { host, userReply: input.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  const pending = pendingDecisionForState(initial);
  if (!pending) throw new DevFlowError("DECISION_NOT_PENDING", "当前没有待决问题。");
  const matched = matchDecisionReply(pending, input.source === "elicitation" ? (input.action === "confirm" ? config.confirmReply : config.declineReply) : promptText ?? input.userReply);
  let response: InteractionResponse | undefined;
  const state = await mutate(root, id, expectedRevision, matched.option.id === "confirm" ? config.confirmOperation : config.declineOperation, (draft) => {
    const live = draft.interactions?.[interactionId] as UserInteraction | undefined;
    if (!live || live.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
    response = input.source === "elicitation"
      ? resolveNativeInteraction(draft, interactionId, input.action, input.comment, host)
      : resolveTextInteraction(draft, interactionId, promptText ?? input.userReply, host, { promptEventId });
    if (matched.option.id === "confirm") config.apply(draft, live, response!, promptEventId);
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { interactionId, action: matched.option.id });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interactionId);
  return { state, response, interaction };
}

async function resolveRatificationDecision(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { source: "elicitation"; action: string; comment?: string } | { source: "text"; userReply: string },
): Promise<DecisionRatificationResult> {
  const { state, interaction } = await resolveInteractionDecision(root, id, expectedRevision, interactionId, host, input, {
    kind: "decision-ratification",
    notPendingMessage: "当前没有待追认的决定。",
    confirmReply: "确认登记",
    declineReply: "不要登记",
    confirmOperation: "decision-ratified",
    declineOperation: "decision-ratification-rejected",
    apply: (draft, live, response, promptEventId) => {
      ratifyDecision(draft, live, response, promptEventId, host);
    },
  });
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), decisionId: interaction.target.slice("decision-ratification:".length), interactionId };
}

export function resolveRatificationAnswer(root: string, id: string, expectedRevision: number, interactionId: string, userReply: string, host: "claude" | "codex"): Promise<DecisionRatificationResult> {
  return resolveRatificationDecision(root, id, expectedRevision, interactionId, host, { source: "text", userReply });
}

export function resolveRatificationElicitation(root: string, id: string, expectedRevision: number, interactionId: string, action: string, comment: string | undefined, host: "claude" | "codex"): Promise<DecisionRatificationResult> {
  return resolveRatificationDecision(root, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}

export interface DecisionRevisionResult {
  state: FeatureState;
  interaction: PublicInteraction;
  decisionId: string;
  interactionId: string;
}

const revisionAffectedLabels: Record<string, string> = {
  classification: "分类（需要重新分类并重新确认路线）",
  requirements: "需求文档（需要重新登记）",
  plan: "实施计划与 Trace（需要重新登记）",
};

function revisionSuccessorId(question: string, newConclusion: string, reason: string): string {
  return `DEC-${createHash("sha256").update(`${question}\n${newConclusion.trim()}\n${reason.trim()}`).digest("hex").slice(0, 16)}`;
}

export async function reviseDecision(
  root: string,
  id: string,
  expectedRevision: number,
  decisionId: string,
  newConclusion: string,
  reason: string,
  host: "claude" | "codex",
): Promise<DecisionRevisionResult> {
  if (!newConclusion.trim()) throw new DevFlowError("DECISION_EVIDENCE_REQUIRED", "revised decision needs a new conclusion");
  if (!reason.trim()) throw new DevFlowError("DECISION_DISMISS_REASON_REQUIRED", "revised decision needs a reason");
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const oldGovernance = (initial.governance?.decisions ?? []).find((candidate) => candidate.recordId === decisionId && !candidate.supersededBy);
  const old = oldGovernance ? { id: oldGovernance.recordId, question: oldGovernance.question, status: "resolved" as const, conclusion: oldGovernance.conclusion, evidence: "", factRefs: [] } : undefined;
  if (!old) throw new DevFlowError("DECISION_NOT_FOUND", decisionId);
  if (old.status !== "resolved") throw new DevFlowError("DECISION_NOT_REVISABLE", `decision status ${old.status} cannot be revised`);
  const affected: string[] = [];
  if ((initial.classificationBasis?.decisionRefs ?? []).includes(decisionId)) affected.push("classification");
  if (initial.artifacts.requirements) affected.push("requirements");
  if (initial.artifacts["implementation-plan"] || initial.traceability) affected.push("plan");
  const target = `decision-revision:${decisionId}`;
  const successorId = revisionSuccessorId(old.question, newConclusion, reason);
  let interaction: UserInteraction | undefined;
  const state = await mutate(root, id, expectedRevision, "decision-revision-presented", (draft) => {
    const affectedText = affected.length ? affected.map((key) => revisionAffectedLabels[key]).join("；") : "无——只有决策记录本身变化";
    interaction = createInteraction(draft, {
      kind: "decision-revision",
      target,
      basisHash: createHash("sha256").update(`${decisionId}\n${newConclusion.trim()}\n${reason.trim()}`).digest("hex"),
      question: `将把“${old.question}”的当前决定“${old.conclusion ?? old.question}”修订为“${newConclusion.trim()}”。\n原因：${reason.trim()}\n预计影响：${affectedText}\n确认修订吗？`,
      options: [
        { id: "confirm", label: "确认修订" },
        { id: "cancel", label: "取消" },
      ],
      revision: { decisionId, oldConclusion: old.conclusion ?? old.question, newConclusion: newConclusion.trim(), reason: reason.trim(), affected },
    });
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ decisionId, successorId, presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), decisionId: successorId, interactionId: interaction.id };
}

function applyDecisionRevision(draft: FeatureState, interaction: UserInteraction, response: InteractionResponse, promptEventId: string | undefined, host: "claude" | "codex"): void {
  const rev = interaction.revision;
  if (!rev) throw new DevFlowError("INTERACTION_INVALID", "decision-revision interaction is missing its candidate content", { interactionId: interaction.id });
  const gov = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
  const decisions = [...gov.decisions];
  const index = decisions.findIndex((candidate) => candidate.recordId === rev.decisionId && !candidate.supersededBy);
  if (index < 0) throw new DevFlowError("DECISION_NOT_FOUND", rev.decisionId);
  const old = decisions[index];
  const successorId = revisionSuccessorId(old.question, rev.newConclusion, rev.reason);
  decisions[index] = { ...decisions[index], supersededBy: successorId };
  const credentialId = `CRED-rev-${interaction.id}`;
  if (!decisions.some((candidate) => candidate.recordId === successorId)) {
    decisions.push({
      recordId: successorId,
      kind: "decision",
      question: old.question,
      conclusion: rev.newConclusion,
      credentialId,
      ...(promptEventId ? { basis: { kind: "event" as const, eventId: promptEventId } } : interaction.presentationEventId ? { basis: { kind: "event" as const, eventId: interaction.presentationEventId } } : {}),
      recordedAt: response.respondedAt,
    });
  }
  const credentials = [...gov.credentials];
  if (!credentials.some((candidate) => candidate.recordId === credentialId)) {
    credentials.push({
      recordId: credentialId,
      kind: "credential",
      source: response.source === "elicitation" ? "native-form" : "text",
      host,
      interactionId: interaction.id,
      ...(response.source === "elicitation" ? { optionId: response.selectedOptionId ?? response.action } : response.selectedOptionId ? { optionId: response.selectedOptionId } : {}),
      ...(response.rawReply ? { rawText: response.rawReply } : {}),
      ...(promptEventId ? { basis: { kind: "event" as const, eventId: promptEventId } } : interaction.presentationEventId ? { basis: { kind: "event" as const, eventId: interaction.presentationEventId } } : {}),
      recordedAt: response.respondedAt,
    });
  }
  draft.governance = { ...gov, decisions, credentials };
  if (rev.affected.includes("classification")) {
    if (draft.mode === "routed") {
      draft.mode = "intake";
      const intakeDraft = draft as Partial<FeatureState>;
      delete intakeDraft.route;
      delete intakeDraft.classification;
      delete intakeDraft.classificationBasis;
      delete intakeDraft.obligations;
      delete intakeDraft.currentStage;
      delete intakeDraft.routeConfirmation;
      delete intakeDraft.traceability;
      delete intakeDraft.review;
      delete intakeDraft.pendingDecision;
      draft.steps = {};
      draft.humanGates = {};
    }
  }
  if (rev.affected.includes("requirements") && draft.artifacts.requirements) delete draft.artifacts.requirements;
  if (rev.affected.includes("plan")) {
    if (draft.artifacts["implementation-plan"]) delete draft.artifacts["implementation-plan"];
    delete draft.traceability;
  }
}

async function resolveRevisionDecision(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { source: "elicitation"; action: string; comment?: string } | { source: "text"; userReply: string },
): Promise<DecisionRevisionResult> {
  const { state, interaction } = await resolveInteractionDecision(root, id, expectedRevision, interactionId, host, input, {
    kind: "decision-revision",
    notPendingMessage: "当前没有待修订的决定。",
    confirmReply: "确认修订",
    declineReply: "取消",
    confirmOperation: "decision-revised",
    declineOperation: "decision-revision-cancelled",
    apply: (draft, live, response, promptEventId) => {
      applyDecisionRevision(draft, live, response, promptEventId, host);
    },
  });
  const oldDecisionId = interaction.revision?.decisionId ?? "";
  const successorId = (state.governance?.decisions ?? []).find((decision) => decision.recordId === oldDecisionId)?.supersededBy ?? oldDecisionId;
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), decisionId: successorId, interactionId };
}

export function resolveRevisionAnswer(root: string, id: string, expectedRevision: number, interactionId: string, userReply: string, host: "claude" | "codex"): Promise<DecisionRevisionResult> {
  return resolveRevisionDecision(root, id, expectedRevision, interactionId, host, { source: "text", userReply });
}

export function resolveRevisionElicitation(root: string, id: string, expectedRevision: number, interactionId: string, action: string, comment: string | undefined, host: "claude" | "codex"): Promise<DecisionRevisionResult> {
  return resolveRevisionDecision(root, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}
