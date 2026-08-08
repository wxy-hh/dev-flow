import type {
  ClassificationReason,
  Lifecycle,
  ObligationStatus,
  RecoveryAction,
  ReviewAssurance,
  RouteId,
} from "./types.js";

const stageLabels: Record<string, string> = {
  intake: "需求了解",
  locate: "需求了解",
  boundary: "需求确认",
  requirements: "需求确认",
  requirements_alignment: "需求确认",
  planning: "实施规划",
  plan_review: "计划审查",
  execution_approval: "执行确认",
  implementation: "开发实现",
  code_review: "代码审查",
  verification: "验证",
  finalize: "交付收尾",
  complete: "已完成",
  abandoned: "已终止",
  paused: "已暂停",
};

const lifecycleLabels: Record<Lifecycle, string> = {
  active: "进行中",
  paused: "已暂停",
  finalized: "已完成",
  abandoned: "已终止",
};

const obligationLabels: Record<ObligationStatus, string> = {
  pending: "待处理",
  satisfied: "已满足",
  stale: "已失效",
};

const assuranceLabels: Record<ReviewAssurance, string> = {
  "multi-perspective": "已完成多视角审查",
  "independent-sampling": "已完成独立抽样审查",
  "multi-agent-attested": "已完成多代理佐证审查",
  "multi-agent-verified": "已完成多代理验证审查",
};

function exhaustive(value: never): never {
  throw new Error(`unmapped presentation value: ${String(value)}`);
}

export function routeLabel(route: RouteId): string {
  switch (route) {
    case "xs": return "XS：极小改动";
    case "s": return "S：小型改动";
    case "m": return "M：中型变更（动态治理）";
    case "l": return "L：大型变更（动态治理）";
    default: return exhaustive(route);
  }
}

export function stageLabel(stage: string): string {
  return stageLabels[stage] ?? "当前阶段";
}

export function lifecycleLabel(lifecycle: Lifecycle): string {
  switch (lifecycle) {
    case "active": return lifecycleLabels.active;
    case "paused": return lifecycleLabels.paused;
    case "finalized": return lifecycleLabels.finalized;
    case "abandoned": return lifecycleLabels.abandoned;
    default: return exhaustive(lifecycle);
  }
}

export function obligationStatusLabel(status: ObligationStatus): string {
  switch (status) {
    case "pending": return obligationLabels.pending;
    case "satisfied": return obligationLabels.satisfied;
    case "stale": return obligationLabels.stale;
    default: return exhaustive(status);
  }
}

export function reviewAssuranceLabel(assurance: ReviewAssurance): string {
  switch (assurance) {
    case "multi-perspective": return assuranceLabels["multi-perspective"];
    case "independent-sampling": return assuranceLabels["independent-sampling"];
    case "multi-agent-attested": return assuranceLabels["multi-agent-attested"];
    case "multi-agent-verified": return assuranceLabels["multi-agent-verified"];
    default: return exhaustive(assurance);
  }
}

export function recoveryActionLabel(action: RecoveryAction): string {
  switch (action.kind) {
    case "retry":
      return "重试当前动作";
    case "refresh-status":
      return "刷新当前状态";
    case "use-equivalent-operation":
      return "改用等价操作继续";
    case "repair-current-unit":
      return "修复当前实现单元";
    case "revise-plan":
      return "修订计划后重新审查";
    case "reclassify":
      return "重新确认路线";
    case "ask-user":
      return action.recommendation;
    default:
      return exhaustive(action);
  }
}

export function routeReason(reasons: ClassificationReason[]): string {
  const first = reasons[0]?.message;
  return first && first.trim().length > 0
    ? first
    : "根据已记录的范围、拓扑和治理事实确定当前路线。";
}

export function routePresentation(route: RouteId, reasons: ClassificationReason[] = []): {
  label: string;
  reason: string;
} {
  return { label: routeLabel(route), reason: routeReason(reasons) };
}
