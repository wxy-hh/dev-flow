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
import { resolveOwnershipForAnswer } from "./ownership-workflow.js";
import { resolveRouteConfirmationForAnswer } from "./route-workflow.js";
import {
  toPublicInteraction,
  type PublicInteraction,
  type UserInteraction,
} from "./user-interactions.js";
import { readState, type FeatureState } from "./state-store.js";

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
  | { source: "text"; userReply: string };

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
  credential: AnswerCredential;
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

/** 第一刀 kind 表：新增验收/回撤等只加行，不改 answer 或调用方。 */
const kindResolvers: Record<string, AnswerKindResolver> = {
  "decision-ratification": resolveRatificationForAnswer,
  "decision-revision": resolveRevisionForAnswer,
  "plan-revision": resolvePlanRevisionForAnswer,
  "side-effect-rerun": resolveSideEffectRerunForAnswer,
  grill: resolveGrillForAnswer,
  approval: resolveApprovalForAnswer,
  "workspace-ownership": resolveOwnershipForAnswer,
  "route-confirmation": resolveRouteConfirmationForAnswer,
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
  const result = await resolver({ root, featureId, expectedRevision, host, credential, interaction, state });
  const pending = pendingAfter(result.state);
  return {
    state: result.state,
    action: result.action,
    ...(result.comment ? { comment: result.comment } : {}),
    ...(pending ? { pending } : {}),
  };
}
