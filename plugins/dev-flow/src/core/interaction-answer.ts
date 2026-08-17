import { DevFlowError } from "./errors.js";
import {
  pendingDecisionForState,
  pendingInteractionForDecision,
} from "./decision-interactions.js";
import {
  resolveRatificationForAnswer,
  resolveRevisionForAnswer,
} from "./decision-workflow.js";
import {
  resolvePlanRevisionForAnswer,
  resolveSideEffectRerunForAnswer,
} from "./plan-revision.js";
import { resolveGrillForAnswer } from "./requirements-grill.js";
import { resolveApprovalForAnswer } from "./approval-interactions.js";
import { resolveOwnershipForAnswer, resolveTaskSwitchForAnswer } from "./ownership-workflow.js";
import { resolveRouteConfirmationForAnswer } from "./route-workflow.js";
import { resolveQualityExceptionForAnswer } from "./quality-exceptions.js";
import { resolveAcceptanceConfirmationForAnswer } from "./acceptance.js";
import { resolveRollbackGateForAnswer } from "./rollback.js";
import { resolveReviewRiskAcceptanceForAnswer } from "./review-jobs.js";
import {
  toPublicInteraction,
  type PublicInteraction,
} from "./user-interactions.js";
import type { UserInteraction } from "../policy/interaction.js";
import { readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { assertHostHealth } from "./host-health.js";
import { latestUnconsumedPromptEvent } from "./interaction-provenance.js";

/**
 * 交互以一份凭证落账（ADR-0019）。
 *
 * 唯一公开回答入口：caller 只传宿主捕获的一份凭证（表单选中或原文），
 * 系统在唯一 pending 的正式交互上证明它可信、语义解析到选项，并在同一笔
 * mutatePrepared 中执行该 kind 的领域落账。失败整笔不写。
 *
 * caller 不传交互编号，不传 kind；零条正式交互则失败关闭。
 */
export type AnswerCredential =
  | { source: "elicitation"; action: string; comment?: string }
  | {
      source: "text";
      /** Already resolved host-event fields. Omit them to select the last unconsumed same-host event. */
      promptEventId?: string;
      promptText?: string;
      promptAt?: string;
    };

/** Credential handed to kind resolvers: text provenance has already been resolved centrally. */
export type ResolvedAnswerCredential =
  | { source: "elicitation"; action: string; comment?: string }
  | { source: "text"; promptEventId: string; promptText: string; promptAt: string };

export interface AnswerInput {
  root: string;
  featureId: string;
  expectedRevision: number;
  host: "claude" | "codex";
  credential: AnswerCredential;
}

export interface AnswerResult {
  state: FeatureState;
  action: string;
  comment?: string;
  /** apply 又呈现了下一题时携带其公共投影，否则无。 */
  pending?: PublicInteraction;
}

export interface AnswerResolveContext {
  root: string;
  featureId: string;
  expectedRevision: number;
  host: "claude" | "codex";
  credential: ResolvedAnswerCredential;
  /** 唯一 pending 的正式交互（answer 已定位，各 kind 只验证归属与 pending）。 */
  interaction: UserInteraction;
  /** answer 读到的已提交状态，revision 与 expectedRevision 一致。 */
  state: FeatureState;
}

export interface AnswerResolveResult {
  state: FeatureState;
  action: string;
  comment?: string;
}

export type AnswerKindResolver = (ctx: AnswerResolveContext) => Promise<AnswerResolveResult>;

/** kind 表：13 种交互全部经统一入口落账；新增 kind 只加行，不改 answer 或调用方。 */
const kindResolvers: Record<string, AnswerKindResolver> = {
  "decision-ratification": resolveRatificationForAnswer,
  "decision-revision": resolveRevisionForAnswer,
  "plan-revision": resolvePlanRevisionForAnswer,
  "side-effect-rerun": resolveSideEffectRerunForAnswer,
  grill: resolveGrillForAnswer,
  approval: resolveApprovalForAnswer,
  "workspace-ownership": resolveOwnershipForAnswer,
  "route-confirmation": resolveRouteConfirmationForAnswer,
  "quality-exception": resolveQualityExceptionForAnswer,
  "acceptance-confirmation": resolveAcceptanceConfirmationForAnswer,
  "rollback-confirmation": resolveRollbackGateForAnswer,
  "risk-acceptance": resolveReviewRiskAcceptanceForAnswer,
  "task-switch": resolveTaskSwitchForAnswer,
};

function pendingInteraction(state: FeatureState): UserInteraction | undefined {
  const decision = pendingDecisionForState(state);
  return decision ? pendingInteractionForDecision(state, decision) : undefined;
}

function pendingAfter(state: FeatureState): PublicInteraction | undefined {
  const interaction = pendingInteraction(state);
  return interaction ? toPublicInteraction(interaction) : undefined;
}

/**
 * 用一份宿主凭证回答当前唯一待决问题。失败整笔不写：不改 state、
 * 不追加事件、不推进 revision、不消费凭证。
 */
export async function answer(input: AnswerInput): Promise<AnswerResult> {
  const { root, featureId, expectedRevision, host, credential } = input;
  const state = await readState(root, featureId);
  if (state.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  }
  const interaction = pendingInteraction(state);
  if (!interaction) {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有需要回答的问题。", {
      userMessage: "当前没有需要回答的问题。",
      cause: "没有待决的正式交互账本。",
      impact: "流程将按当前阶段自动继续，不会锁定或改写路线。",
      recoveryKind: "refresh",
      recoveryInstruction: "刷新状态后继续当前步骤。",
      retryOriginal: false,
    });
  }
  const resolver = kindResolvers[interaction.kind];
  if (!resolver) {
    throw new DevFlowError("DECISION_KIND_UNSUPPORTED", "当前问题类型还没有可用的统一回答入口。", {
      userMessage: "当前问题暂时不能通过统一入口回答。",
      cause: `决策类型为 ${interaction.kind}，尚未接入 answer。`,
      impact: "流程保持在当前阶段，任何状态都没有被改变。",
      recoveryKind: "repair",
      recoveryInstruction: "运行 dev_flow_doctor 检查插件版本与状态，或刷新后重试。",
      retryOriginal: false,
    });
  }
  // 单一凭证解析点：text credential 在此处证明唯一宿主事件并冻结
  // promptEventId/promptText，13 个 resolver 不再各自解析 provenance。
  let resolvedCredential: ResolvedAnswerCredential = credential.source === "elicitation"
    ? credential
    : {
        source: "text",
        promptEventId: credential.promptEventId ?? "",
        promptText: credential.promptText ?? "",
        promptAt: credential.promptAt ?? "",
      };
  if (credential.source === "text") {
    if (credential.promptEventId === undefined || credential.promptText === undefined || credential.promptAt === undefined) {
      const events = await readFeatureEvents(root, featureId);
      const selected = latestUnconsumedPromptEvent(events, state, interaction, host);
      if (!selected) {
        throw new DevFlowError("INTERACTION_EVENT_MISSING", "没有找到呈现问题之后、来自当前宿主的未消费用户消息。", {
          userMessage: "当前问题仍未回答。",
          recoveryKind: "retry",
          recoveryInstruction: "请用户重新发送一次完整回答；不要由调用方转述原文。",
          retryOriginal: true,
        });
      }
      resolvedCredential = {
        source: "text",
        promptEventId: selected.eventId,
        promptText: selected.text,
        promptAt: selected.at,
      };
    } else {
      resolvedCredential = {
        source: "text",
        promptEventId: credential.promptEventId,
        promptText: credential.promptText,
        promptAt: credential.promptAt,
      };
    }
  }
  const result = await resolver({ root, featureId, expectedRevision, host, credential: resolvedCredential, interaction, state });
  const pending = pendingAfter(result.state);
  return {
    state: result.state,
    action: result.action,
    ...(result.comment ? { comment: result.comment } : {}),
    ...(pending ? { pending } : {}),
  };
}

export interface HostEventAnswerInput {
  root: string;
  featureId: string;
  expectedRevision: number;
  host: "claude" | "codex";
}

/**
 * v6 public text answer path: caller supplies no userReply. Core selects the
 * last unconsumed same-host user-prompt event after the presentation cursor
 * and passes it as the internal host-event credential.
 */
export async function answerFromHostEvents(input: HostEventAnswerInput): Promise<AnswerResult> {
  const { root, featureId, expectedRevision, host } = input;
  const state = await readState(root, featureId);
  if (state.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  }
  const interaction = pendingInteraction(state);
  if (!interaction) {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有需要回答的问题。", {
      userMessage: "当前没有需要回答的问题。",
      recoveryKind: "refresh",
      recoveryInstruction: "刷新状态后继续当前步骤。",
      retryOriginal: false,
    });
  }
  const events = await readFeatureEvents(root, featureId);
  const selected = latestUnconsumedPromptEvent(events, state, interaction, host);
  if (!selected) {
    // 分型恢复（GPT-012）：零事件但 hook 健康 → 让用户重答；hook 缺失/过期 →
    // 先恢复 hook（doctor）再重答，避免把宿主接线问题伪装成“用户没回答”。
    let health: "fresh" | "stale" | "missing" = "fresh";
    try {
      await assertHostHealth(root, host, "回答当前问题");
    } catch (error) {
      if (error instanceof DevFlowError && (error.code === "HOOK_HEALTH_STALE" || error.code === "HOOK_HEALTH_REQUIRED")) {
        health = error.code === "HOOK_HEALTH_STALE" ? "stale" : "missing";
      } else {
        throw error;
      }
    }
    throw new DevFlowError("INTERACTION_EVENT_MISSING", "没有找到呈现问题之后、来自当前宿主的未消费用户消息。", {
      userMessage: "当前问题仍未回答。",
      cause: health === "fresh"
        ? "宿主 hook 健康但未捕获到呈现后的用户消息，或该消息已被消费。"
        : health === "stale"
          ? "宿主 hook 的最近可信信号已过期，事件捕获不可信。"
          : "尚未发现当前宿主的可信 hook 健康信号，事件捕获不可信。",
      recoveryKind: "retry",
      recoveryInstruction: health === "fresh"
        ? "请用户重新发送一次完整回答；若反复失败再运行 doctor 检查 UserPromptSubmit hook。"
        : "先运行 dev_flow_doctor 恢复宿主 hook 并重新开启会话，再让用户重新回答；hook 恢复前回答无法落账。",
      retryOriginal: true,
      health,
    });
  }
  return answer({
    root,
    featureId,
    expectedRevision,
    host,
    credential: {
      source: "text",
      promptEventId: selected.eventId,
      promptText: selected.text,
      promptAt: selected.at,
    },
  });
}

