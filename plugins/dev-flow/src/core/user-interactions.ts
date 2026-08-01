import { randomBytes, randomUUID } from "node:crypto";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";

export type InteractionKind = "gate" | "grill" | "risk-acceptance" | "rollback-confirmation";
export type InteractionSource = "elicitation" | "text-token";

/** 比较用归一化：trim + 折叠连续空白 + 小写。仅用于匹配比较，存储始终保留原始输入。 */
export function normalizeReplyText(value: string): string {
  return value.trim().replace(/[\s\u00A0\uFEFF]+/g, " ").toLowerCase();
}

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
  turnBoundaryEventId?: string;
  userReply?: string;
  host: "claude" | "codex";
  respondedAt: string;
}

export interface UserInteraction {
  id: string;
  kind: InteractionKind;
  target: string;
  basisHash: string;
  /** Immutable, Core-owned context for a one-time risk-acceptance decision. */
  binding?: {
    batchId: string;
    findingIds: string[];
    findingSetHash: string;
  };
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
  status: "pending" | "resolved";
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
  binding?: UserInteraction["binding"];
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
    ...(input.binding ? {
      binding: {
        batchId: input.binding.batchId,
        findingIds: [...input.binding.findingIds],
        findingSetHash: input.binding.findingSetHash,
      },
    } : {}),
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

/**
 * 自然语言选项匹配：① 序号（a/b/c 或 1/2/3）；② “推荐”→ 推荐选项（skill 约定推荐放第一位）；
 * ③ 选项 label 精确匹配（归一化后）。仅用于比较，存储保留原始输入。
 */
function matchNaturalOption(interaction: UserInteraction, userReply: string): { option: InteractionOption; comment?: string } | undefined {
  const normalized = normalizeReplyText(userReply);
  if (!normalized) return undefined;
  const stripped = normalized.replace(/[.、)）\s]/g, "");
  const letter = stripped.match(/^([a-c])$/u);
  if (letter) {
    const option = interaction.options[letter[1].toLowerCase().charCodeAt(0) - 97];
    if (option) return { option };
  }
  const number = stripped.match(/^([1-9])$/u);
  if (number) {
    const option = interaction.options[Number(number[1]) - 1];
    if (option) return { option };
  }
  if (normalized === "推荐" || normalized === "按推荐" || normalized === "选推荐") {
    const recommended = interaction.options[0];
    if (recommended) return { option: recommended };
  }
  // 修改类前缀：「修改需求: <意见>」「修改计划: <意见>」→ request-changes + comment
  const editMatch = normalized.match(/^修改(?:需求|意见|计划|方案|)?[:：]?\s*([\s\S]*)$/u);
  if (editMatch) {
    const option = interaction.options.find((candidate) => candidate.id === "request-changes");
    if (option) return { option, comment: editMatch[1] || undefined };
  }
  // label 匹配：精确/缩写（用户回 label 的一部分，如「其他」）对所有交互生效；
  // 前缀 + 补充说明形式（label + comment）对 confirm 选项禁用（防“确认需求，但先别改”被误判为确认），其余选项允许
  for (const candidate of interaction.options) {
    const labelNorm = normalizeReplyText(candidate.label);
    if (!labelNorm) continue;
    if (labelNorm === normalized || (labelNorm.startsWith(normalized) && normalized.length >= 1)) {
      return { option: candidate };
    }
    if (candidate.id !== "confirm" && normalized.startsWith(labelNorm) && normalized.length > labelNorm.length) {
      return { option: candidate, comment: normalized.slice(labelNorm.length).trim() };
    }
  }
  return undefined;
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
  provenance: { promptEventId?: string; turnBoundaryEventId?: string } | string,
  phraseAction?: string,
): InteractionResponse {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  let match: { option: InteractionOption; comment?: string } | undefined;
  if (phraseAction) {
    // 自然语言批准词映射（仅 HUMAN GATE 交互由调用方传入）：跳过一次性 token 匹配，
    // 直接按批准词对应的选项构造响应；溯源（promptEventId 绑定）与存储仍走 text-token 路径。
    match = { option: optionFor(interaction, phraseAction) };
  } else if ((match = matchNaturalOption(interaction, userReply))) {
    // 自然语言选项（序号/推荐/label）直接命中；grill 与 gate 通用。
    // 落到此处说明用户没有走 token 行，无需再校验 token 前缀。
  } else {
    // 分词比较：首段 token、次段 action、其余为 comment（原样保留，仅去首尾空白）；
    // 比较时归一化，容忍复制时的首尾空格、多余空格与大小写差异。
    const trimmed = userReply.trim();
    const segments = trimmed.match(/^(\S+)\s+(\S+)(?:[\s]+([\s\S]*))?$/);
    if (segments) {
      const [, tokenPart, actionPart, rest] = segments;
      if (normalizeReplyText(tokenPart) === normalizeReplyText(interaction.fallbackToken)) {
        const option = interaction.options.find((candidate) => candidate.id === actionPart);
        if (option) match = { option, comment: rest?.trim() };
      }
    }
  }
  if (!match) {
    throw new DevFlowError("INTERACTION_TOKEN_MISMATCH", "response does not match the current one-time interaction token", {
      recoveryHint: "请原样复制提示中展示的一次性回复整行并发送，勿添加空格、前缀或标点；HUMAN GATE 也可直接输入批准词（如“确认需求”）",
    });
  }
  const normalizedComment = validateComment(match.option, match.comment);
  const ids = typeof provenance === "string" ? { promptEventId: provenance } : provenance;
  const response: InteractionResponse = {
    action: match.option.id,
    ...(normalizedComment ? { comment: normalizedComment } : {}),
    source: "text-token",
    ...(ids.promptEventId ? { promptEventId: ids.promptEventId } : {}),
    ...(ids.turnBoundaryEventId ? { turnBoundaryEventId: ids.turnBoundaryEventId } : {}),
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
    status: interaction.status,
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

/**
 * 面向用户的自然语言提示（替代 token 行格式）：agent 可直接转述，用户无需复制任何标识。
 * token 行保留在 PublicInteraction.fallback 中，仅在用户无法自然选择时由 skill 引导作为兜底展示。
 */
export function fallbackHint(interaction: UserInteraction): string {
  if (interaction.kind === "gate") {
    const confirm = interaction.options.find((option) => option.id === "confirm");
    const changes = interaction.options.find((option) => option.id === "request-changes");
    const gate = interaction.target.replace("gate:", "");
    const verb = gate === "requirement_confirmation" ? "确认需求" : "批准实现";
    const editWord = gate === "requirement_confirmation" ? "修改需求" : "修改计划";
    const parts: string[] = [];
    if (confirm) parts.push(`✅ 如需${verb}，直接回复：${confirm.label}（或「确认」）`);
    if (changes) parts.push(`✏️ 如需调整，请回复：${editWord}: <补充你的修改意见>`);
    return parts.join("；");
  }
  const lines = [interaction.question ?? "请选择方案："];
  interaction.options.forEach((option, index) => {
    const letter = String.fromCharCode(97 + index).toUpperCase();
    const recommended = index === 0 ? "（推荐）" : "";
    lines.push(`${letter}. ${option.label}${recommended}`);
  });
  lines.push("回复 A/B/C（或方案名称），也可以直接说出你的想法");
  return lines.join("\n");
}
