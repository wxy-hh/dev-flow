import type { RequirementsState, RouteId } from "../policy/types.js";

export interface ArtifactTemplateContext {
  featureId: string;
  route: RouteId;
  requirementsState?: RequirementsState;
}

function frontMatter(context: ArtifactTemplateContext, kind: string): string {
  return [
    "---",
    "dev_flow:",
    "  schema_version: 3",
    `  feature_id: ${context.featureId}`,
    `  route: ${context.route}`,
    `  kind: ${kind}`,
    "---",
    "",
  ].join("\n");
}

function requirementsTemplate(context: ArtifactTemplateContext): string {
  void context.requirementsState;
  return `${frontMatter(context, "requirements")}# 需求\n\n## 范围\n\n## 目标\n\n## 非目标\n\n## 验收条件\n\n<!-- dev-flow:id=REQ-001 kind=requirement -->\n### REQ-001：需求\n\n- 描述：\n\n<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->\n#### AC-001：验收条件（parent: REQ-001）\n\n- 验收条件：\n\n## 决策记录\n\n| ID | 问题 | 决策 | 来源 | 影响 |\n| --- | --- | --- | --- | --- |\n\n## 开放问题\n\n- 无\n`;
}

function implementationPlanTemplate(context: ArtifactTemplateContext): string {
  const rollback = ["standard-m", "standard-l"].includes(context.route)
    ? "\n<!-- dev-flow:id=RU-001 kind=rollback -->\n### RU-001：回撤单元\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: []\n- covers: [REQ-001]\n- forward_verification: [unit]\n- rollback_verification: [unit]\n"
    : "";
  const test = ["standard-m", "standard-l"].includes(context.route)
    ? "\n<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001：验证场景（verifies: AC-001）\n\n- 验证方法：\n"
    : "";
  return `${frontMatter(context, "implementation-plan")}# 实现计划\n\n<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001：实现任务\n\n- covers: [REQ-001]\n- rollback_unit: RU-001\n${test}${rollback}`;
}

function coverageMatrixTemplate(context: ArtifactTemplateContext): string {
  return `${frontMatter(context, "coverage-matrix")}# 覆盖矩阵\n\n<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001：验证场景（verifies: AC-001）\n\n- 验证方法：\n`;
}

function rollbackUnitsTemplate(context: ArtifactTemplateContext): string {
  return `${frontMatter(context, "rollback-units")}# 回撤单元\n\n<!-- dev-flow:id=RU-001 kind=rollback -->\n### RU-001：回撤单元\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: []\n- covers: [REQ-001]\n- forward_verification: [unit]\n- rollback_verification: [unit]\n`;
}

export function renderArtifactTemplate(
  context: ArtifactTemplateContext,
  kind: string,
): string {
  switch (kind) {
    case "requirements": return requirementsTemplate(context);
    case "implementation-plan": return implementationPlanTemplate(context);
    case "coverage-matrix": return coverageMatrixTemplate(context);
    case "rollback-units": return rollbackUnitsTemplate(context);
    default: return `${frontMatter(context, kind)}# ${kind}\n\n`;
  }
}
