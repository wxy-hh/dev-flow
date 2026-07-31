import { assertArtifactCurrent } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import {
  createInteraction,
  findInteractionForTarget,
  getInteraction,
  resolveNativeInteraction,
  resolveTokenInteraction,
  toPublicInteraction,
  type InteractionOption,
  type InteractionResponse,
  type PublicInteraction,
} from "./user-interactions.js";

const statuses = ["not_required", "pending", "in_progress", "complete"] as const;
export type GrillStatus = typeof statuses[number];

export interface GrillFrontMatter {
  status: GrillStatus;
  questionId?: string;
  responseHint?: string;
}

export interface GrillDecisionInput {
  questionId: string;
  question: string;
  options: InteractionOption[];
  host: "claude" | "codex";
}

/** Core-injected option: confirm the current question plus all remaining ones at recommended answers. */
export const MERGE_REMAINING_OPTION: InteractionOption = {
  id: "merge-remaining",
  label: "合并剩余（剩余问题按推荐答案一次确认）",
  description: "当前题与剩余问题全部按各题推荐答案确认，一次性完成 grill。",
};

function withMergeRemaining(options: InteractionOption[]): InteractionOption[] {
  return options.some((option) => option.id === MERGE_REMAINING_OPTION.id) ? options : [...options, MERGE_REMAINING_OPTION];
}

export interface GrillDecisionResult {
  state: FeatureState;
  interaction: PublicInteraction;
  response?: InteractionResponse;
}

function allowedStatuses(state: FeatureState): GrillStatus[] {
  return state.classification.requirements === "provided-confirmed" ? ["not_required", "complete"] : ["complete"];
}

function invalidStatus(details: Record<string, unknown>): never {
  throw new DevFlowError("GRILL_STATUS_INVALID", "requirements grill_status must be a supported enum", {
    allowed: statuses,
    recoveryHint: "Set grill_status to a supported value and re-record the requirements artifact",
    ...details,
  });
}

function parseNestedDevFlow(contents: string): Record<string, string> {
  const frontMatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontMatter) invalidStatus({ reason: "MISSING_FRONT_MATTER" });
  const lines = frontMatter.split(/\r?\n/);
  const devFlowIndexes = lines.map((line, index) => line === "dev_flow:" ? index : -1).filter((index) => index >= 0);
  if (devFlowIndexes.length !== 1) invalidStatus({ reason: "MISSING_OR_DUPLICATE_DEV_FLOW" });
  const fields: Record<string, string> = {};
  for (const line of lines.slice(devFlowIndexes[0] + 1)) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  ([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (fields[key] !== undefined) invalidStatus({ reason: "DUPLICATE_FIELD", field: key });
    fields[key] = value;
  }
  return fields;
}

function readStatus(fields: Record<string, string>): GrillStatus {
  const status = fields.grill_status;
  if (!status || !statuses.includes(status as GrillStatus)) invalidStatus({ actual: status, reason: "MISSING_OR_INVALID_GRILL_STATUS" });
  return status as GrillStatus;
}

/** Parse grill front matter for progress. in_progress should carry question fields when reporting wait. */
export function parseGrillFrontMatter(contents: string): GrillFrontMatter {
  const fields = parseNestedDevFlow(contents);
  const status = readStatus(fields);
  const result: GrillFrontMatter = { status };
  if (fields.grill_question_id) result.questionId = fields.grill_question_id;
  if (fields.grill_response_hint) result.responseHint = fields.grill_response_hint;
  if (status === "in_progress" && (!result.questionId || !result.responseHint)) {
    throw new DevFlowError("GRILL_STATUS_INVALID", "in_progress grill requires grill_question_id and grill_response_hint", {
      recoveryHint: "Set the current Q-id and response hint, record the requirements artifact, then ask the user",
    });
  }
  if (status === "complete" || status === "not_required") {
    if (result.questionId || result.responseHint) {
      throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
        recoveryHint: "Clear grill_question_id and grill_response_hint when grill is finished",
      });
    }
  }
  return result;
}

async function currentGrillQuestion(root: string, id: string, state: FeatureState): Promise<GrillFrontMatter> {
  if (!state.artifacts.requirements) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "requirements");
  const grill = parseGrillFrontMatter(await assertArtifactCurrent(root, id, state, "requirements"));
  if (grill.status !== "in_progress" || !grill.questionId) {
    throw new DevFlowError("GRILL_DECISION_NOT_PENDING", "there is no current grill question");
  }
  return grill;
}

export async function requestGrillDecision(
  root: string,
  id: string,
  expectedRevision: number,
  input: GrillDecisionInput,
): Promise<GrillDecisionResult> {
  if (!input.question.trim()) throw new DevFlowError("GRILL_QUESTION_REQUIRED", "question is required");
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const grill = await currentGrillQuestion(root, id, initial);
  if (grill.questionId !== input.questionId) {
    throw new DevFlowError("GRILL_QUESTION_MISMATCH", input.questionId, { expectedQuestionId: grill.questionId });
  }
  const target = `grill:${input.questionId}`;
  const existing = findInteractionForTarget(initial, target);
  if (existing) return { state: initial, interaction: toPublicInteraction(existing) };
  let interaction: ReturnType<typeof createInteraction> | undefined;
  const state = await mutate(root, id, expectedRevision, "grill-decision-presented", (draft) => {
    interaction = createInteraction(draft, {
      kind: "grill",
      target,
      basisHash: draft.artifacts.requirements.sha256,
      question: input.question,
      options: withMergeRemaining(input.options),
    });
    draft.lastUpdatedBy = { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ questionId: input.questionId, interactionId: interaction?.id, options: input.options }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction) };
}

function resolveGrillTextPrompt(
  events: Array<{ revision: number; type: string; at: string; data: unknown }>,
  interactionId: string,
  userReply: string,
  promptEventId?: string,
): string {
  const matches = (item: { type: string; at: string; data: unknown }) => {
    const event = item.data as { eventId?: unknown; type?: unknown; text?: unknown; at?: unknown };
    return item.type === "host-event" && event.type === "user-prompt" && event.text === userReply && typeof event.eventId === "string";
  };
  const selected = promptEventId
    ? events.find((item) => matches(item) && (item.data as { eventId?: string }).eventId === promptEventId)
    : [...events].reverse().find(matches);
  if (!selected) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interactionId, {
      recoveryHint: "Ensure the UserPromptSubmit hook captured the exact one-time reply, then retry",
    });
  }
  const event = selected.data as { eventId: string; at?: string };
  const interaction = interactionId;
  if (typeof event.at !== "string") throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interaction);
  return event.eventId;
}

async function resolveGrillDecision(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { source: "elicitation"; action: string; comment?: string }
    | { source: "text-token"; userReply: string; promptEventId?: string },
): Promise<GrillDecisionResult> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "grill" || interaction.status !== "pending") throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
  const grill = await currentGrillQuestion(root, id, initial);
  if (interaction.target !== `grill:${grill.questionId}` || interaction.basisHash !== initial.artifacts.requirements.sha256) {
    throw new DevFlowError("GRILL_BASIS_CHANGED", interactionId, { recoveryHint: "Record the current requirements and request a new decision" });
  }
  let promptEventId: string | undefined;
  if (input.source === "text-token") {
    const events = await readFeatureEvents(root, id);
    promptEventId = resolveGrillTextPrompt(events, interactionId, input.userReply, input.promptEventId);
    const event = events.find((item) => (item.data as { eventId?: string }).eventId === promptEventId)?.data as { at?: string } | undefined;
    if (!event?.at || Date.parse(event.at) < Date.parse(interaction.presentedAt)) {
      throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interactionId, { recoveryHint: "Use a reply submitted after the decision was shown" });
    }
  }
  let response: InteractionResponse | undefined;
  const state = await mutate(root, id, expectedRevision, "grill-decision-resolved", (draft) => {
    response = input.source === "elicitation"
      ? resolveNativeInteraction(draft, interactionId, input.action, input.comment, host)
      : resolveTokenInteraction(draft, interactionId, input.userReply, host, promptEventId!);
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ interactionId, response }));
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interactionId);
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), response };
}

export async function resolveGrillElicitation(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): Promise<GrillDecisionResult> {
  return resolveGrillDecision(root, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}

export async function resolveGrillToken(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  promptEventId: string | undefined,
  host: "claude" | "codex",
): Promise<GrillDecisionResult> {
  return resolveGrillDecision(root, id, expectedRevision, interactionId, host, { source: "text-token", userReply, promptEventId });
}

/** Enforces the requirements-step grill contract after the artifact is registered. */
export async function assertRequirementsGrillSatisfied(root: string, id: string, state: FeatureState): Promise<void> {
  if (state.route !== "standard-m" && state.route !== "standard-l") return;
  const contents = await assertArtifactCurrent(root, id, state, "requirements");
  const fields = parseNestedDevFlow(contents);
  const status = readStatus(fields);
  const allowed = allowedStatuses(state);
  if (!allowed.includes(status)) {
    throw new DevFlowError("GRILL_INCOMPLETE", "requirements grill is not complete", {
      requirementsState: state.classification.requirements,
      status,
      allowedStatuses: allowed,
      recoveryHint: "Continue grillme until grill_status is complete, record the artifact, then record the requirements step",
    });
  }
  if (fields.grill_question_id || fields.grill_response_hint) {
    throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
      recoveryHint: "Clear grill_question_id and grill_response_hint when grill is finished",
    });
  }
}
