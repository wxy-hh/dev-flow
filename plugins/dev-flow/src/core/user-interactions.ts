import { randomUUID } from "node:crypto";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";
import type { PendingDecisionKind } from "../policy/types.js";

export type InteractionKind = "approval" | "grill" | "risk-acceptance" | "rollback-confirmation" | "quality-exception" | "workspace-ownership" | "task-switch";
export type InteractionSource = "elicitation" | "text";

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
  presentedAt: string;
  status: "pending" | "resolved";
  response?: InteractionResponse;
}

export interface PublicInteraction {
  kind: InteractionKind;
  status: "pending" | "resolved";
  question?: string;
  options: InteractionOption[];
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
  if (!Array.isArray(options) || options.length < 2 || options.length > 3) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "每个用户问题必须只有 2-3 个选项。", { userMessage: "当前问题的选项数量不符合交互合同。", recoveryKind: "repair", recoveryInstruction: "将选项收敛为 2-3 个简明选择，并保留一个推荐答案。", retryOriginal: false });
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
  const pending = Object.values(state.interactions ?? {}).filter((value) => (value as UserInteraction).status === "pending");
  if (pending.length) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "同一 feature 只能存在一个待决问题。", { userMessage: "当前已有一个问题等待回答。", cause: "系统拒绝并行创建第二个 pending decision。", impact: "新问题没有被创建，原问题仍等待回答。", recoveryKind: "refresh", recoveryInstruction: "先回答当前问题，下一回合再处理新问题。", retryOriginal: false });
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
    presentedAt: new Date().toISOString(),
    status: "pending",
  };
  interactions(state)[interaction.id] = interaction;
  const kind: PendingDecisionKind = input.kind === "risk-acceptance" ? "review-risk" : input.kind;
  state.pendingDecision = {
    kind,
    question: input.question ?? "请选择一个方案。",
    options: input.options.map((option, index) => ({ ...option, recommended: index === 0 })),
    basisHash: input.basisHash,
    presentedAt: interaction.presentedAt,
    presentedRevision: state.revision,
    source: "core",
    target: input.target,
  };
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
  if (state.pendingDecision?.target === target) delete state.pendingDecision;
}

export function clearInteractionsByKind(state: FeatureState, kind: InteractionKind): void {
  if (!state.interactions) return;
  for (const [id, value] of Object.entries(state.interactions)) {
    if ((value as UserInteraction).kind === kind) delete state.interactions[id];
  }
  if (state.pendingDecision?.kind === (kind === "risk-acceptance" ? "review-risk" : kind)) delete state.pendingDecision;
}

function optionFor(interaction: UserInteraction, action: string): InteractionOption {
  const option = interaction.options.find((candidate) => candidate.id === action);
  if (!option) throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
  return option;
}

/**
 * 用户回答只按完整中文选项匹配；内部 option id 和序号不是用户合同。
 */
function matchNaturalOption(interaction: UserInteraction, userReply: string): { option: InteractionOption; comment?: string } | undefined {
  const normalized = normalizeReplyText(userReply);
  if (!normalized) return undefined;
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
    if (labelNorm === normalized) {
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
  if (state.pendingDecision?.target === interaction.target) delete state.pendingDecision;
  return response;
}

export function resolveTextInteraction(
  state: FeatureState,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
  provenance: { promptEventId?: string; turnBoundaryEventId?: string },
  phraseAction?: string,
): InteractionResponse {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  let match: { option: InteractionOption; comment?: string } | undefined;
  if (phraseAction) {
    // Approval phrases are normalized by the Core approval policy before this path.
    match = { option: optionFor(interaction, phraseAction) };
  } else if ((match = matchNaturalOption(interaction, userReply))) {
    // Other decisions require an exact option label.
  }
  if (!match) {
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "回答没有精确匹配当前问题的选项。", {
      userMessage: "没有识别出当前问题的有效回答。",
      cause: "回答不是完整选项，也不是受支持的批准短语。",
      impact: "当前问题仍保持待回答，没有任何状态被改变。",
      recoveryKind: "retry",
      recoveryInstruction: "请直接回复一个完整中文选项。",
      retryOriginal: true,
    });
  }
  const normalizedComment = validateComment(match.option, match.comment);
  const ids = provenance;
  const response: InteractionResponse = {
    action: match.option.id,
    ...(normalizedComment ? { comment: normalizedComment } : {}),
    source: "text",
    ...(ids.promptEventId ? { promptEventId: ids.promptEventId } : {}),
    ...(ids.turnBoundaryEventId ? { turnBoundaryEventId: ids.turnBoundaryEventId } : {}),
    userReply,
    host,
    respondedAt: new Date().toISOString(),
  };
  interaction.status = "resolved";
  interaction.response = response;
  if (state.pendingDecision?.target === interaction.target) delete state.pendingDecision;
  return response;
}

export function toPublicInteraction(interaction: UserInteraction): PublicInteraction {
  return {
    kind: interaction.kind,
    status: interaction.status,
    ...(interaction.question ? { question: interaction.question } : {}),
    options: interaction.options.map((option) => ({ ...option })),
  };
}

/** 面向用户的自然语言提示；不生成或展示内部标识。 */
export function decisionHint(interaction: UserInteraction): string {
  if (interaction.kind === "approval") {
    const confirm = interaction.options.find((option) => option.id === "confirm");
    const changes = interaction.options.find((option) => option.id === "request-changes");
    const parts: string[] = [];
    if (confirm) parts.push("✅ 如需确认开始执行，直接回复以下任一短语：确认 / 确认需求 / 需求已确认 / 同意需求 / 确认执行 / 批准实现 / 同意实现 / 开始实现 / 开始执行 / 确认开始执行 / 同意开始执行 / 批准执行 / 同意执行 / approved / LGTM");
    if (changes) parts.push(`✏️ 如需调整，请回复：修改计划: <补充你的修改意见>`);
    return parts.join("；");
  }
  const lines = [interaction.question ?? "请选择方案："];
  interaction.options.forEach((option, index) => {
    const recommended = index === 0 ? "（推荐）" : "";
    lines.push(`- ${option.label}${recommended}`);
  });
  lines.push("请直接回复一个完整选项；如需补充说明，请在选项后写明意见。");
  return lines.join("\n");
}
