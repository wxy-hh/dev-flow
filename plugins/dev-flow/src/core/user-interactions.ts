import { randomBytes, randomUUID } from "node:crypto";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";

export type InteractionKind = "gate" | "grill";
export type InteractionSource = "elicitation" | "text-token";

export interface InteractionOption {
  id: string;
  label: string;
  description?: string;
  requiresComment?: boolean;
}

export interface InteractionResponse {
  action: string;
  comment?: string;
  source: InteractionSource;
  promptEventId?: string;
  userReply?: string;
  host: "claude" | "codex";
  respondedAt: string;
}

export interface UserInteraction {
  id: string;
  kind: InteractionKind;
  target: string;
  basisHash: string;
  question?: string;
  options: InteractionOption[];
  fallbackToken: string;
  presentedAt: string;
  status: "pending" | "resolved";
  response?: InteractionResponse;
}

export interface PublicInteraction {
  id: string;
  kind: InteractionKind;
  question?: string;
  options: InteractionOption[];
  fallback: {
    token: string;
    replies: Array<{ action: string; reply: string; requiresComment: boolean }>;
  };
}

export interface InteractionInput {
  kind: InteractionKind;
  target: string;
  basisHash: string;
  question?: string;
  options: InteractionOption[];
}

function interactions(state: FeatureState): Record<string, UserInteraction> {
  if (!state.interactions) state.interactions = {};
  return state.interactions as Record<string, UserInteraction>;
}

function validateOptions(options: InteractionOption[]): void {
  if (!Array.isArray(options) || options.length < 2 || options.length > 8) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "an interaction requires 2-8 options");
  }
  const seen = new Set<string>();
  for (const option of options) {
    if (!option || !/^[a-z][a-z0-9-]{0,63}$/.test(option.id) || !option.label.trim() || seen.has(option.id)) {
      throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "option ids must be unique lowercase action ids with labels");
    }
    seen.add(option.id);
  }
}

export function createInteraction(state: FeatureState, input: InteractionInput): UserInteraction {
  validateOptions(input.options);
  const current = findInteractionForTarget(state, input.target);
  if (current?.status === "pending") {
    throw new DevFlowError("INTERACTION_ALREADY_PENDING", input.target, { interactionId: current.id });
  }
  const interaction: UserInteraction = {
    id: randomUUID(),
    kind: input.kind,
    target: input.target,
    basisHash: input.basisHash,
    question: input.question,
    options: input.options.map((option) => ({ ...option })),
    fallbackToken: `DF-${randomBytes(9).toString("base64url").toUpperCase()}`,
    presentedAt: new Date().toISOString(),
    status: "pending",
  };
  interactions(state)[interaction.id] = interaction;
  return interaction;
}

export function getInteraction(state: FeatureState, interactionId: string): UserInteraction {
  const interaction = state.interactions?.[interactionId] as UserInteraction | undefined;
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_FOUND", interactionId);
  return interaction;
}

/** Return an immutable copy for MCP callers without exposing mutable state internals. */
export function interactionResponse(state: FeatureState, interactionId: string): InteractionResponse | undefined {
  const response = getInteraction(state, interactionId).response;
  return response ? Object.freeze({ ...response }) : undefined;
}

export function findInteractionForTarget(state: FeatureState, target: string): UserInteraction | undefined {
  return Object.values(state.interactions ?? {}).find((value) => {
    const interaction = value as UserInteraction;
    return interaction.target === target && interaction.status === "pending";
  }) as UserInteraction | undefined;
}

export function clearInteractionsForTarget(state: FeatureState, target: string): void {
  if (!state.interactions) return;
  for (const [id, value] of Object.entries(state.interactions)) {
    const interaction = value as UserInteraction;
    if (interaction.target === target) delete state.interactions[id];
  }
}

export function clearInteractionsByKind(state: FeatureState, kind: InteractionKind): void {
  if (!state.interactions) return;
  for (const [id, value] of Object.entries(state.interactions)) {
    if ((value as UserInteraction).kind === kind) delete state.interactions[id];
  }
}

function optionFor(interaction: UserInteraction, action: string): InteractionOption {
  const option = interaction.options.find((candidate) => candidate.id === action);
  if (!option) throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
  return option;
}

function validateComment(option: InteractionOption, comment: string | undefined): string | undefined {
  const normalized = comment?.trim();
  if (option.requiresComment && !normalized) {
    throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", option.id, { recoveryHint: "Provide a concise modification comment before submitting" });
  }
  return normalized || undefined;
}

export function resolveNativeInteraction(
  state: FeatureState,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): InteractionResponse {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  const option = optionFor(interaction, action);
  const normalizedComment = validateComment(option, comment);
  const response: InteractionResponse = {
    action,
    ...(normalizedComment ? { comment: normalizedComment } : {}),
    source: "elicitation",
    host,
    respondedAt: new Date().toISOString(),
  };
  interaction.status = "resolved";
  interaction.response = response;
  return response;
}

export function resolveTokenInteraction(
  state: FeatureState,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
  promptEventId: string,
): InteractionResponse {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  let match: { option: InteractionOption; comment?: string } | undefined;
  for (const option of interaction.options) {
    const prefix = `${interaction.fallbackToken} ${option.id}`;
    if (option.requiresComment) {
      if (userReply === prefix) match = { option };
      else if (userReply.startsWith(`${prefix} `)) match = { option, comment: userReply.slice(prefix.length).trim() };
    } else if (userReply === prefix) {
      match = { option };
    }
    if (match) break;
  }
  if (!match) {
    throw new DevFlowError("INTERACTION_TOKEN_MISMATCH", "response does not match the current one-time interaction token", {
      recoveryHint: `Use the exact reply shown for interaction ${interactionId}`,
    });
  }
  const normalizedComment = validateComment(match.option, match.comment);
  const response: InteractionResponse = {
    action: match.option.id,
    ...(normalizedComment ? { comment: normalizedComment } : {}),
    source: "text-token",
    promptEventId,
    userReply,
    host,
    respondedAt: new Date().toISOString(),
  };
  interaction.status = "resolved";
  interaction.response = response;
  return response;
}

export function toPublicInteraction(interaction: UserInteraction): PublicInteraction {
  return {
    id: interaction.id,
    kind: interaction.kind,
    ...(interaction.question ? { question: interaction.question } : {}),
    options: interaction.options.map((option) => ({ ...option })),
    fallback: {
      token: interaction.fallbackToken,
      replies: interaction.options.map((option) => ({
        action: option.id,
        reply: `${interaction.fallbackToken} ${option.id}${option.requiresComment ? " <修改意见>" : ""}`,
        requiresComment: Boolean(option.requiresComment),
      })),
    },
  };
}

export function fallbackHint(interaction: UserInteraction): string {
  const replies = toPublicInteraction(interaction).fallback.replies;
  return interaction.options
    .map((option) => {
      const reply = replies.find((candidate) => candidate.action === option.id)!;
      return `${option.label}: ${reply.reply}`;
    })
    .join("；");
}
