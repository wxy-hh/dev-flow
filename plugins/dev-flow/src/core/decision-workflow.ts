import { createHash } from "node:crypto";
import { EMPTY_GOVERNANCE_LEDGER } from "../policy/types.js";
import { createDecision, resolveDecision } from "./decision-ledger.js";
import { DevFlowError } from "./errors.js";
import { consumedPromptEventIds, promptFrom, resolveInteractionPromptEvent } from "./interaction-provenance.js";
import { matchDecisionReply, pendingDecisionForState } from "./decision-interactions.js";
import { normalizeReplyText } from "./text-normalization.js";
import {
  createInteraction,
  getInteraction,
  resolveResponseForAnswer,
  toPublicInteraction,
  type InteractionResponse,
  type PublicInteraction,
  type UserInteraction,
} from "./user-interactions.js";
import { mutate, mutatePrepared, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import type { AnswerResolveContext, AnswerResolveResult } from "./interaction-answer.js";

export interface DecisionRatificationResult {
  state: FeatureState;
  interaction?: PublicInteraction;
  decisionId: string;
  interactionId?: string;
  ratifiedFrom?: string;
  question?: string;
  evidence?: string;
  conclusion?: string;
}

function commitDecision(
  draft: FeatureState,
  input: {
    decisionId: string;
    question: string;
    conclusion: string;
    credentialId: string;
    host: "claude" | "codex";
    recordedAt: string;
    source: "native-form" | "text";
    interactionId: string;
    promptEventId?: string;
    presentationEventId?: string;
    optionId?: string;
    rawText?: string;
  },
): void {
  const ledgerAfter = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
  const credentials = [...ledgerAfter.credentials];
  if (!credentials.some((existing) => existing.recordId === input.credentialId)) {
    credentials.push({
      recordId: input.credentialId,
      kind: "credential",
      source: input.source,
      host: input.host,
      interactionId: input.interactionId,
      ...(input.optionId ? { optionId: input.optionId } : {}),
      ...(input.rawText ? { rawText: input.rawText } : {}),
      ...(input.promptEventId
        ? { basis: { kind: "event" as const, eventId: input.promptEventId } }
        : input.presentationEventId
          ? { basis: { kind: "event" as const, eventId: input.presentationEventId } }
          : {}),
      recordedAt: input.recordedAt,
    });
  }
  const decisions = [...ledgerAfter.decisions];
  if (!decisions.some((existing) => existing.recordId === input.decisionId)) {
    decisions.push({
      recordId: input.decisionId,
      kind: "decision",
      question: input.question,
      conclusion: input.conclusion,
      credentialId: input.credentialId,
      ...(input.promptEventId
        ? { basis: { kind: "event" as const, eventId: input.promptEventId } }
        : input.presentationEventId
          ? { basis: { kind: "event" as const, eventId: input.presentationEventId } }
          : {}),
      recordedAt: input.recordedAt,
    });
  }
  draft.governance = { ...ledgerAfter, credentials, decisions };
}

function latestUnconsumedPrompt(
  events: Awaited<ReturnType<typeof readFeatureEvents>>,
  host: "claude" | "codex",
): { eventId: string; text: string; revision: number } | undefined {
  const consumed = consumedPromptEventIds(events);
  const matches = events.flatMap((record) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host !== host || consumed.has(prompt.eventId)) return [];
    return [{ eventId: prompt.eventId, text: prompt.text, revision: record.revision, at: prompt.at }];
  });
  matches.sort((left, right) => right.revision - left.revision || Date.parse(right.at) - Date.parse(left.at));
  return matches[0];
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
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const decision = resolveDecision(createDecision(question, factRefs), evidence, conclusion);
  const target = `decision-ratification:${decision.id}`;
  let existingPending = false;
  try {
    existingPending = Boolean(pendingDecisionForState(initial));
  } catch {
    existingPending = true;
  }
  const events = await readFeatureEvents(root, id);
  const latest = existingPending ? undefined : latestUnconsumedPrompt(events, host);
  const exactMatch = latest && normalizeReplyText(latest.text) === normalizeReplyText(evidence);
  if (latest && exactMatch) {
    const recordedAt = new Date().toISOString();
    const state = await mutate(root, id, expectedRevision, "decision-auto-ratified", (draft) => {
      commitDecision(draft, {
        decisionId: decision.id,
        question: question.trim(),
        conclusion: conclusion.trim(),
        credentialId: `CRED-auto-ratify-${decision.id}`,
        host,
        recordedAt,
        source: "text",
        interactionId: `auto-ratify:${decision.id}`,
        promptEventId: latest.eventId,
        rawText: evidence.trim(),
      });
      draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
    }, { decisionId: decision.id, promptEventId: latest.eventId });
    return {
      state,
      decisionId: decision.id,
      ratifiedFrom: latest.eventId,
      question: question.trim(),
      evidence: evidence.trim(),
      conclusion: conclusion.trim(),
    };
  }
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

export function ratifyDecision(draft: FeatureState, interaction: UserInteraction, response: InteractionResponse, promptEventId: string | undefined, host: "claude" | "codex"): void {
  const candidate = interaction.ratification;
  if (!candidate) throw new DevFlowError("INTERACTION_INVALID", "decision-ratification interaction is missing its candidate content", { interactionId: interaction.id });
  const decision = resolveDecision(createDecision(candidate.question, candidate.factRefs), candidate.evidence, candidate.conclusion);
  commitDecision(draft, {
    decisionId: decision.id,
    question: candidate.question,
    conclusion: candidate.conclusion,
    credentialId: `CRED-ratify-${interaction.id}`,
    host,
    recordedAt: response.respondedAt,
    source: response.source === "elicitation" ? "native-form" : "text",
    interactionId: interaction.id,
    promptEventId,
    presentationEventId: interaction.presentationEventId,
    optionId: response.source === "elicitation" ? (response.selectedOptionId ?? response.action) : response.selectedOptionId,
    rawText: response.rawReply,
  });
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

export function applyDecisionRevision(draft: FeatureState, interaction: UserInteraction, response: InteractionResponse, promptEventId: string | undefined, host: "claude" | "codex"): void {
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

/** 决策追认经统一回答入口落账（ADR-0019）：确认登记 / 不要登记。 */
export async function resolveRatificationForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "decision-ratification" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有待追认的决定。", { interactionId: interaction.id });
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  const pending = pendingDecisionForState(state);
  const matchedId = credential.source === "elicitation"
    ? credential.action
    : matchDecisionReply(pending!, promptText ?? credential.userReply).option.id;
  const confirms = matchedId === "confirm";
  let response: InteractionResponse | undefined;
  const next = await mutatePrepared(root, featureId, expectedRevision, confirms ? "decision-ratified" : "decision-ratification-rejected", async () => ({
    mutate: (draft) => {
      response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : undefined, comment: credential.source === "elicitation" ? credential.comment : undefined, userReply: credential.source === "text" ? credential.userReply : undefined, promptText, promptEventId, host });
      if (confirms) ratifyDecision(draft, draft.interactions![interaction.id] as UserInteraction, response, promptEventId, host);
      draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
    },
    eventData: () => ({ interactionId: interaction.id, action: matchedId }),
  }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...(response.comment ? { comment: response.comment } : {}) };
}

/** 决策修订经统一回答入口落账（ADR-0019）：确认修订 / 取消。 */
export async function resolveRevisionForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "decision-revision" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有待修订的决定。", { interactionId: interaction.id });
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root, featureId);
    const match = resolveInteractionPromptEvent(events, state, interaction, { host, userReply: credential.userReply });
    promptEventId = match.eventId;
    promptText = match.text;
  }
  const pending = pendingDecisionForState(state);
  const matchedId = credential.source === "elicitation"
    ? credential.action
    : matchDecisionReply(pending!, promptText ?? credential.userReply).option.id;
  const confirms = matchedId === "confirm";
  let response: InteractionResponse | undefined;
  const next = await mutatePrepared(root, featureId, expectedRevision, confirms ? "decision-revised" : "decision-revision-cancelled", async () => ({
    mutate: (draft) => {
      response = resolveResponseForAnswer(draft, interaction, { source: credential.source, action: credential.source === "elicitation" ? credential.action : undefined, comment: credential.source === "elicitation" ? credential.comment : undefined, userReply: credential.source === "text" ? credential.userReply : undefined, promptText, promptEventId, host });
      if (confirms) applyDecisionRevision(draft, draft.interactions![interaction.id] as UserInteraction, response, promptEventId, host);
      draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
    },
    eventData: () => ({ interactionId: interaction.id, action: matchedId }),
  }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...(response.comment ? { comment: response.comment } : {}) };
}
