import { assertArtifactCurrent } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { resolveDecision } from "./decision-ledger.js";
import { decisionBasisHash } from "../policy/obligations.js";
import {
  createInteraction,
  findInteractionForTarget,
  getInteraction,
  normalizeReplyText,
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
    recoveryHint: "请将 grill_status 设为受支持的值并重新登记需求文档",
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
      recoveryHint: "请设置当前题号与回复提示、登记需求文档后再询问用户",
    });
  }
  if (status === "complete" || status === "not_required") {
    if (result.questionId || result.responseHint) {
      throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
        recoveryHint: "grill 完成后请清除当前题字段",
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
  if (initial.mode === "intake") {
    const target = `grill:${input.questionId}`;
    const existing = findInteractionForTarget(initial, target);
    if (existing) return { state: initial, interaction: toPublicInteraction(existing) };
    let interaction: ReturnType<typeof createInteraction> | undefined;
    const state = await mutate(root, id, expectedRevision, "intake-decision-presented", (draft) => {
      interaction = createInteraction(draft, {
        kind: "grill",
        target,
        basisHash: decisionBasisHash({ objective: draft.objective, questionId: input.questionId }),
        question: input.question,
        options: withMergeRemaining(input.options),
      });
      const ledger = draft.decisionLedger ?? [];
      if (!ledger.some((decision) => decision.id === input.questionId)) ledger.push({ id: input.questionId, question: input.question, status: "open" });
    }, { questionId: input.questionId, mode: "intake" });
    if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
    return { state, interaction: toPublicInteraction(interaction) };
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
    return item.type === "host-event" && event.type === "user-prompt"
      && normalizeReplyText(String(event.text ?? "")) === normalizeReplyText(userReply) && typeof event.eventId === "string";
  };
  const selected = promptEventId
    ? events.find((item) => matches(item) && (item.data as { eventId?: string }).eventId === promptEventId)
    : [...events].reverse().find(matches);
  if (!selected) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interactionId, {
      recoveryHint: "请确保宿主 hook 捕获到本次一次性回复（空格与大小写差异会自动归一化），再重试",
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
  if (initial.mode === "intake") {
    let response: InteractionResponse | undefined;
    const state = await mutate(root, id, expectedRevision, "intake-decision-resolved", (draft) => {
      response = input.source === "elicitation"
        ? resolveNativeInteraction(draft, interactionId, input.action, input.comment, host)
        : resolveTokenInteraction(draft, interactionId, input.userReply, host, "intake");
      const index = (draft.decisionLedger ?? []).findIndex((decision) => decision.id === interaction.target.slice("grill:".length));
      if (index >= 0 && response) {
        const next = [...(draft.decisionLedger ?? [])];
        next[index] = resolveDecision(next[index], input.source === "elicitation" ? (input.comment ?? "用户选择") : input.userReply, response.action);
        draft.decisionLedger = next;
      }
      draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
    }, { interactionId, mode: "intake" });
    if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interactionId);
    return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), response };
  }
  const grill = await currentGrillQuestion(root, id, initial);
  if (interaction.target !== `grill:${grill.questionId}` || interaction.basisHash !== initial.artifacts.requirements.sha256) {
    throw new DevFlowError("GRILL_BASIS_CHANGED", interactionId, { recoveryHint: "需求文档已变更，请重新登记后请求新的决策" });
  }
  let promptEventId: string | undefined;
  if (input.source === "text-token") {
    const events = await readFeatureEvents(root, id);
    promptEventId = resolveGrillTextPrompt(events, interactionId, input.userReply, input.promptEventId);
    const event = events.find((item) => (item.data as { eventId?: string }).eventId === promptEventId)?.data as { at?: string } | undefined;
    if (!event?.at || Date.parse(event.at) < Date.parse(interaction.presentedAt)) {
      throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", interactionId, { recoveryHint: "请使用决策呈现之后提交的回复" });
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
      recoveryHint: "请继续 grillme 直到 grill_status 为 complete，登记资产后记录 requirements 步骤",
    });
  }
  if (fields.grill_question_id || fields.grill_response_hint) {
    throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
      recoveryHint: "grill 完成后请清除当前题字段",
    });
  }
}
