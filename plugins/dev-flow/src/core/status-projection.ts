import { nextAction } from "./next.js";
import { readState, type FeatureState } from "./state-store.js";
import { effectiveStage } from "../policy/stages.js";
import { routeDefinitionForFeature } from "../policy/contract.js";
import { lifecycleLabel, routeLabel, stageLabel } from "../policy/presentation.js";
import { pendingDecisionForState, publicPendingDecision } from "./decision-interactions.js";
import type { NextAction } from "../policy/types.js";

export const STATUS_SCHEMA_VERSION = 1;

export interface CompactStatus {
  statusSchemaVersion: number;
  状态: string;
  路线: string;
  当前阶段: string;
  进度: string;
  下一步: string;
  需要用户决定: boolean;
  健康状态: "正常" | "需要处理" | "需要修复";
  恢复提示: string;
  attention?: string;
  pendingDecision?: {
    question: string;
    options: Array<{ label: string; description?: string; answerCode?: "A" | "B" | "C"; recommended: boolean; requiresComment: boolean }>;
    recommendation?: { optionId: string; reason: string };
    presentation?: string;
  };
}

export interface StatusControl {
  featureId: string;
  expectedRevision: number;
  stage?: string;
  nextAction: NextAction;
  lifecycle: FeatureState["lifecycle"];
}

export interface StatusMcpView {
  contentView: CompactStatus;
  structuredContentView: CompactStatus & { control: StatusControl };
}

function actionText(state: FeatureState, action: NextAction): string {
  switch (action.kind) {
    case "done": return "当前任务已完成。";
    case "intake": return action.activity === "resolve-decision" ? "回答当前唯一待决问题。" : "调查事实后调用 dev_flow_lock_classification 锁定路线（锁定前不要调用 record_step 等步骤工具）。";
    case "scaffold-artifact": return `生成${artifactLabel(action.step)}，然后填写并登记。`;
    case "present-human-gate": return "回答当前执行确认问题。";
    case "wait-human-gate": return "等待当前用户决定。";
    case "waiting-user": return "按恢复提示处理当前阻塞。";
    case "stop": return "先处理当前阻塞，再继续流程。";
    case "create-review-batch": return "生成当前计划差异审查包。";
    case "review-jobs-pending": return "完成当前批次的必需角色审查。";
    case "repair-trace": return "重新登记当前需求或计划与追溯关系。";
    case "begin-implementation-unit": return "开始下一个实现单元。";
    case "checkpoint-implementation-unit": return "保存当前实现单元并完成单元验证。";
    case "finalize": return "进入交付收尾并生成最终交付快照。";
    case "run-step": return `继续${stageLabel(action.step)}。`;
    default: return "继续当前阶段。";
  }
}

function artifactLabel(kind: string): string {
  switch (kind) {
    case "requirements": return "需求文档";
    case "implementation-plan": return "实施计划";
    case "plan-review": return "计划审查包";
    default: return "当前阶段所需工件";
  }
}

function health(state: FeatureState, action: NextAction): CompactStatus["健康状态"] {
  if (state.workspace.reconciliationStatus === "blocked" || action.kind === "repair-trace") return "需要修复";
  if (action.kind === "waiting-user" || action.kind === "stop" || pendingDecisionForState(state)) return "需要处理";
  return "正常";
}

export async function readCompactStatus(root: string, featureId: string): Promise<StatusMcpView> {
  const state = await readState(root, featureId);
  const action = await nextAction(root, featureId);
  const stage = effectiveStage(state);
  const definition = state.mode === "routed" ? routeDefinitionForFeature(state.route, state.classification.controls) : undefined;
  const total = definition?.orderedSteps.length ?? 1;
  const completed = definition?.orderedSteps.filter((step) => state.steps[step]?.status === "satisfied").length ?? 0;
  const decision = pendingDecisionForState(state);
  const publicDecision = decision ? publicPendingDecision(state)! : undefined;
  const content: CompactStatus = {
    statusSchemaVersion: STATUS_SCHEMA_VERSION,
    状态: state.lifecycle === "finalized" && state.qualityExceptions.some((exception) => exception.status === "current")
      ? "已完成（用户接受风险）"
      : lifecycleLabel(state.lifecycle),
    路线: state.mode === "routed" ? routeLabel(state.route) : "路线尚未确定",
    当前阶段: stageLabel(state.lifecycle === "paused" ? "paused" : stage),
    进度: `已完成 ${completed}/${total} 个阶段`,
    下一步: actionText(state, action),
    需要用户决定: Boolean(decision),
    健康状态: health(state, action),
    恢复提示: state.resumeSummary ?? (state.lifecycle === "paused" ? "恢复后系统会先自动对账工作区。" : "下次可以从当前阶段继续。"),
    ...(decision ? {
      attention: "请只回答当前这一道问题。",
      pendingDecision: {
        question: publicDecision!.question,
        options: publicDecision!.options,
        ...(publicDecision!.recommendation ? { recommendation: publicDecision!.recommendation } : {}),
        ...(publicDecision!.presentation ? { presentation: publicDecision!.presentation } : {}),
      },
    } : {}),
  };
  const control: StatusControl = {
    featureId: state.featureId,
    expectedRevision: state.revision,
    ...(state.mode === "routed" ? { stage } : {}),
    nextAction: action,
    lifecycle: state.lifecycle,
  };
  return { contentView: content, structuredContentView: { ...content, control } };
}
