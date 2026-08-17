import { randomUUID } from "node:crypto";
import { matchNaturalDecision } from "./decision-language.js";
import { DevFlowError } from "./errors.js";
import { buildGrillPresentation, matchGrillReply } from "./grill-interaction.js";
import type {
  GrillAnswerCode,
  GrillRecommendation,
  InteractionKind,
  InteractionOption,
  InteractionResponse,
  UserInteraction,
} from "../policy/interaction.js";
import type { FeatureState } from "./state-store.js";

/** 比较用归一化与语义兼容判定：仅用于匹配比较，存储始终保留原始输入。 */
export { normalizeReplyText, textCompatible } from "./text-normalization.js";

export interface PublicInteraction {
  kind: InteractionKind;
  status: "pending" | "resolved";
  question?: string;
  options: Array<InteractionOption & { answerCode?: GrillAnswerCode; recommended?: boolean }>;
  recommendation?: GrillRecommendation;
  presentation?: string;
  /** 追认/修订候选内容只读投影（不暴露内部引用以外的敏感信息）。 */
  ratification?: { question: string; evidence: string; conclusion: string };
  revision?: { decisionId: string; oldConclusion: string; newConclusion: string; reason: string; affected: string[] };
  planRevision?: { affectedUnits: string[]; redoUnits: string[]; sideEffectUnits: string[]; reviewInvalidated: boolean; fallbackReason?: string };
  /** 副作用单元重跑确认候选（kind === "side-effect-rerun" 时存在）。 */
  sideEffectRerun?: { units: string[] };
  acceptanceConfirmation?: { acceptanceCriterionIds: string[]; deliveryFingerprint: string; dispositionHash: string };
}

/**
 * 呈现门禁的统一返回基座（ADR-0019）：状态 + 已公开交互 + 关联 id。
 * 各 present 函数返回 PresentedInteraction & 各自 extras——MCP 管道的
 * elicitAndAnswer 只消费这个基座，不再感知 per-case 形状。
 */
export interface PresentedInteraction {
  state: FeatureState;
  interaction: PublicInteraction;
  interactionId: string;
}

export interface InteractionInput {
  kind: InteractionKind;
  target: string;
  basisHash: string;
  binding?: UserInteraction["binding"];
  question?: string;
  options: InteractionOption[];
  recommendation?: GrillRecommendation;
  presentationEventId?: string;
  /** v6 presentation cursor; normally stamped by mutatePrepared, callers may pass it explicitly. */
  presentationEventSequence?: number;
  workspacePaths?: string[];
  workspaceBatchPaths?: string[];
  workspaceRemainingPaths?: string[];
  /** 决策追认候选：展示原话与拟登记结论，只有新的可信回答才能落账。 */
  ratification?: { question: string; evidence: string; conclusion: string; factRefs: string[] };
  /** 决策修订候选：展示旧决定、新决定与影响集，确认后追加修订链。 */
  revision?: { decisionId: string; oldConclusion: string; newConclusion: string; reason: string; affected: string[] };
  /** 实施中计划修订候选：展示受影响单元与副作用警示，确认后局部重做。 */
  planRevision?: { affectedUnits: string[]; redoUnits: string[]; sideEffectUnits: string[]; reviewInvalidated: boolean; fallbackReason?: string };
  planRevisionBasis?: UserInteraction["planRevisionBasis"];
  planRevisionProposal?: UserInteraction["planRevisionProposal"];
  /** 副作用单元重跑确认候选：计划修订后不会自动重跑有副作用的已完成单元。 */
  sideEffectRerun?: { units: string[] };
  acceptanceConfirmation?: { acceptanceCriterionIds: string[]; deliveryFingerprint: string; dispositionHash: string };
}

function interactions(state: FeatureState): Record<string, UserInteraction> {
  if (!state.interactions) state.interactions = {};
  return state.interactions;
}

function validateOptions(options: InteractionOption[]): void {
  if (!Array.isArray(options) || options.length < 2 || options.length > 3) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "每个用户问题必须只有 2-3 个选项。", { userMessage: "当前问题的选项数量不符合交互合同。", recoveryKind: "repair", recoveryInstruction: "将选项收敛为 2-3 个简明选择，并保留一个推荐答案。", retryOriginal: false });
  }
  const seen = new Set<string>();
  const seenLabels = new Set<string>();
  const invalidIds: string[] = [];
  const duplicateLabels: string[] = [];
  for (const option of options) {
    if (!option || !/^[a-z][a-z0-9-]{0,63}$/.test(option.id)) invalidIds.push(option?.id ?? "<missing>");
    const normalizedLabel = option?.label?.trim() ?? "";
    if (!option || !normalizedLabel || seen.has(option.id)) {
      throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "option ids must be unique lowercase action ids with labels", {
        pattern: "^[a-z][a-z0-9-]{0,63}$",
        examples: ["document-only", "inject-signal"],
        invalidIds,
        guidance: "A/B 是 Core 分配的 answerCode，不是输入 option id。",
        recoveryHint: "为每个选项提供唯一的、匹配上述正则的 action id 与非空 label。",
      });
    }
    if (seenLabels.has(normalizedLabel)) duplicateLabels.push(option.label.trim());
    seen.add(option.id);
    seenLabels.add(normalizedLabel);
  }
  if (duplicateLabels.length > 0) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "option labels must be unique after trimming", {
      duplicateLabels,
      recoveryHint: "为每个选项提供可区分、去空格后互不相同的 label，避免回答匹配歧义。",
    });
  }
}

export function createInteraction(state: FeatureState, input: InteractionInput): UserInteraction {
  validateOptions(input.options);
  if (input.kind === "grill") {
    if (!input.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", "grill requires one explicit recommendation");
    buildGrillPresentation({ question: input.question ?? "", options: input.options, recommendation: input.recommendation });
  }
  const pending = Object.values(state.interactions ?? {}).filter((value) => value.status === "pending");
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
    ...(input.recommendation ? { recommendation: { ...input.recommendation } } : {}),
    presentedAt: new Date().toISOString(),
    presentedRevision: state.revision,
    ...(input.presentationEventSequence !== undefined ? { presentationEventSequence: input.presentationEventSequence } : {}),
    presentationEventId: input.presentationEventId ?? randomUUID(),
    ...(input.workspacePaths ? { workspacePaths: [...input.workspacePaths] } : {}),
    ...(input.workspaceBatchPaths ? { workspaceBatchPaths: [...input.workspaceBatchPaths] } : {}),
    ...(input.workspaceRemainingPaths ? { workspaceRemainingPaths: [...input.workspaceRemainingPaths] } : {}),
    ...(input.ratification ? { ratification: { ...input.ratification, factRefs: [...input.ratification.factRefs] } } : {}),
    ...(input.revision ? { revision: { ...input.revision, affected: [...input.revision.affected] } } : {}),
    ...(input.planRevision ? { planRevision: { ...input.planRevision, affectedUnits: [...input.planRevision.affectedUnits], redoUnits: [...input.planRevision.redoUnits], sideEffectUnits: [...input.planRevision.sideEffectUnits] } } : {}),
    ...(input.planRevisionBasis ? { planRevisionBasis: { ...input.planRevisionBasis } } : {}),
    ...(input.planRevisionProposal ? { planRevisionProposal: { ...input.planRevisionProposal } } : {}),
    ...(input.sideEffectRerun ? { sideEffectRerun: { units: [...input.sideEffectRerun.units] } } : {}),
    ...(input.acceptanceConfirmation ? { acceptanceConfirmation: { ...input.acceptanceConfirmation, acceptanceCriterionIds: [...input.acceptanceConfirmation.acceptanceCriterionIds] } } : {}),
    status: "pending",
  };
  interactions(state)[interaction.id] = interaction;
  return interaction;
}

export function getInteraction(state: FeatureState, interactionId: string): UserInteraction {
  const interaction = state.interactions?.[interactionId];
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_FOUND", interactionId);
  return interaction;
}

/** Return an immutable copy for MCP callers without exposing mutable state internals. */
export function interactionResponse(state: FeatureState, interactionId: string): InteractionResponse | undefined {
  const response = getInteraction(state, interactionId).response;
  return response ? Object.freeze({ ...response }) : undefined;
}

export function findInteractionForTarget(state: FeatureState, target: string): UserInteraction | undefined {
  return Object.values(state.interactions ?? {}).find(
    (interaction) => interaction.target === target && interaction.status === "pending",
  );
}

export function clearInteractionsForTarget(state: FeatureState, target: string): void {
  if (!state.interactions) return;
  for (const [id, interaction] of Object.entries(state.interactions)) {
    if (interaction.target === target) delete state.interactions[id];
  }
  if (state.pendingDecision?.target === target) delete state.pendingDecision;
}

export function clearInteractionsByKind(state: FeatureState, kind: InteractionKind): void {
  if (!state.interactions) return;
  for (const [id, interaction] of Object.entries(state.interactions)) {
    if (interaction.kind === kind) delete state.interactions[id];
  }
  if (state.pendingDecision?.kind === (kind === "risk-acceptance" ? "review-risk" : kind)) delete state.pendingDecision;
}

function optionFor(interaction: UserInteraction, action: string): InteractionOption {
  const option = interaction.options.find((candidate) => candidate.id === action);
  if (!option) throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
  return option;
}

function matchNaturalOption(interaction: UserInteraction, userReply: string): { option: InteractionOption; comment?: string } | undefined {
  return matchNaturalDecision(interaction.kind, interaction.options, userReply);
}

function validateComment(option: InteractionOption, comment: string | undefined): string | undefined {
  const normalized = comment?.trim();
  if (option.requiresComment && !normalized) {
    throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", option.id, { recoveryHint: "Provide a concise modification comment before submitting" });
  }
  return normalized || undefined;
}

function resolveNativeInteraction(
  state: FeatureState,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): InteractionResponse {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  if (interaction.kind === "grill") {
    if (!interaction.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", interactionId);
    const presentation = buildGrillPresentation({ question: interaction.question ?? "", options: interaction.options, recommendation: interaction.recommendation });
    const normalizedComment = comment?.trim();
    const selected = presentation.options.find((candidate) => candidate.id === action);
    if (!selected && action !== "other") throw new DevFlowError("INTERACTION_ACTION_INVALID", action, { interactionId: interaction.id });
    if (action === "other" && !normalizedComment) throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", "other", { recoveryHint: "请补充你的方案和理由" });
    if (selected?.requiresComment && !normalizedComment) throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", selected.id);
    const response: InteractionResponse = action === "other" ? {
      action: "other",
      kind: "other",
      comment: normalizedComment!,
      rawReply: `其他：${normalizedComment}`,
      source: "elicitation",
      host,
      respondedAt: new Date().toISOString(),
    } : {
      action: selected!.id,
      kind: "option",
      answerCode: selected!.answerCode,
      selectedOptionId: selected!.id,
      rawReply: selected!.answerCode,
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

function resolveTextInteraction(
  state: FeatureState,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
  provenance: { promptEventId?: string; turnBoundaryEventId?: string },
  phraseAction?: string,
): InteractionResponse {
  const interaction = getInteraction(state, interactionId);
  if (interaction.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interactionId);
  const grillMatch = interaction.kind === "grill"
    ? matchGrillReply({ options: interaction.options, userReply })
    : undefined;
  let match: { option: InteractionOption; comment?: string } | undefined;
  if (grillMatch?.kind === "option") {
    match = { option: optionFor(interaction, grillMatch.selectedOptionId), ...(grillMatch.comment ? { comment: grillMatch.comment } : {}) };
  } else if (phraseAction) {
    // Approval phrases are normalized by the Core approval policy before this path.
    match = { option: optionFor(interaction, phraseAction) };
  } else if ((match = matchNaturalOption(interaction, userReply))) {
    // Other decisions require an exact option label.
  }
  if (!match && grillMatch?.kind !== "other") {
    const grillRecovery = interaction.kind === "grill"
      ? "请回复 A、B 或 C；如果都不合适，回复“其他：<你的方案和理由>”。"
      : "请换一种能唯一指向某个选项的简短说法，或直接回复完整选项。";
    throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "回答没有精确匹配当前问题的选项。", {
      userMessage: "没有识别出当前问题的有效回答。",
      cause: "回答无法唯一对应当前选项，也不是受支持的批准短语。",
      impact: "当前问题仍保持待回答，没有任何状态被改变。",
      recoveryKind: "retry",
      recoveryInstruction: grillRecovery,
      retryOriginal: true,
    });
  }
  const normalizedComment = grillMatch?.kind === "other"
    ? grillMatch.comment
    : validateComment(match!.option, match!.comment);
  const ids = provenance;
  const response: InteractionResponse = {
    action: grillMatch?.kind === "other" ? "other" : match!.option.id,
    ...(grillMatch ? grillMatch.kind === "other" ? {
      kind: "other" as const,
      rawReply: grillMatch.rawReply,
    } : {
      kind: "option" as const,
      answerCode: grillMatch.answerCode,
      selectedOptionId: grillMatch.selectedOptionId,
      rawReply: grillMatch.rawReply,
    } : {}),
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

/**
 * 统一回答的响应解析（ADR-0019）：结构化凭证按选中即信任，文本凭证用
 * 事件原文（promptText）而非 agent 转述做受控等价匹配。与
 * 标记 interaction resolved、写入 response 在同一笔事务内完成。
 */
export function resolveResponseForAnswer(
  draft: FeatureState,
  interaction: UserInteraction,
  input: {
    source: "elicitation" | "text";
    action?: string;
    comment?: string;
    userReply?: string;
    promptText?: string;
    promptEventId?: string;
    host: "claude" | "codex";
    phraseAction?: string;
  },
): InteractionResponse {
  const live = draft.interactions?.[interaction.id];
  if (!live || live.status !== "pending") {
    throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interaction.id);
  }
  if (input.source === "elicitation") {
    return resolveNativeInteraction(draft, interaction.id, input.action!, input.comment, input.host);
  }
  return resolveTextInteraction(
    draft,
    interaction.id,
    input.promptText ?? input.userReply!,
    input.host,
    { promptEventId: input.promptEventId },
    input.phraseAction,
  );
}

export function toPublicInteraction(interaction: UserInteraction): PublicInteraction {
  if (interaction.kind === "grill") {
    if (!interaction.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", interaction.id);
    const presentation = buildGrillPresentation({
      question: interaction.question ?? "",
      options: interaction.options,
      recommendation: interaction.recommendation,
    });
    return {
      kind: interaction.kind,
      status: interaction.status,
      question: presentation.question,
      options: presentation.options.map((option) => ({ ...option })),
      recommendation: { ...presentation.recommendation },
      presentation: presentation.text,
    };
  }
  return {
    kind: interaction.kind,
    status: interaction.status,
    ...(interaction.question ? { question: interaction.question } : {}),
    options: interaction.options.map((option) => ({ ...option })),
    ...(interaction.ratification ? { ratification: { ...interaction.ratification } } : {}),
    ...(interaction.revision ? { revision: { ...interaction.revision, affected: [...interaction.revision.affected] } } : {}),
    ...(interaction.planRevision ? { planRevision: { ...interaction.planRevision, affectedUnits: [...interaction.planRevision.affectedUnits], redoUnits: [...interaction.planRevision.redoUnits], sideEffectUnits: [...interaction.planRevision.sideEffectUnits] } } : {}),
    ...(interaction.acceptanceConfirmation ? { acceptanceConfirmation: { ...interaction.acceptanceConfirmation, acceptanceCriterionIds: [...interaction.acceptanceConfirmation.acceptanceCriterionIds] } } : {}),
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
  if (interaction.kind === "grill") {
    if (!interaction.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", interaction.id ?? interaction.target ?? "grill");
    return buildGrillPresentation({
      question: interaction.question ?? "",
      options: interaction.options,
      recommendation: interaction.recommendation,
    }).text;
  }
  const lines = [interaction.question ?? "请选择方案："];
  interaction.options.forEach((option, index) => {
    const recommended = index === 0 ? "（推荐）" : "";
    lines.push(`- ${option.label}${recommended}`);
  });
  lines.push("可直接回复完整选项、能唯一指向它的简称或同义说法；如需补充说明，请在选项后写明意见。");
  return lines.join("\n");
}
