import type { GovernanceControls, RequirementsState, RouteId } from "../policy/types.js";

export interface ArtifactTemplateContext {
  featureId: string;
  route: RouteId;
  requirementsState?: RequirementsState;
  controls?: GovernanceControls;
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
  return `${frontMatter(context, "requirements")}# 需求\n\n## 范围\n\n## 目标\n\n## 非目标\n\n## 验收条件\n\n<!-- dev-flow:id=REQ-001 kind=requirement -->\n### REQ-001：需求\n\n需求正文不参与机器语义。\n\n<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->\n### AC-001：验收条件\n\n- parent_requirement: REQ-001\n\n## 决策记录\n\n| ID | 问题 | 决策 | 来源 | 影响 |\n| --- | --- | --- | --- | --- |\n\n## 开放问题\n\n- 无\n`;
}

function implementationPlanTemplate(context: ArtifactTemplateContext): string {
  const formal = context.controls?.plan === "formal" || ["m", "l"].includes(context.route);
  const implementationUnit = formal
    ? "\n<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001：实现单元\n\n- tasks: [TASK-001]\n- depends_on: []\n- file_scope: [src]\n- covers: [REQ-001, AC-001]\n- forward_verification: [unit]\n"
    : "";
  const test = formal
    ? "\n<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001：验证场景\n\n- verifies: [AC-001]\n"
    : "";
  return `${frontMatter(context, "implementation-plan")}# 实现计划\n\n<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001：实现任务\n\n- covers: [REQ-001, AC-001]\n- implementation_unit: UNIT-001\n- tdd: test-first\n${test}${implementationUnit}`;
}

export function renderArtifactTemplate(
  context: ArtifactTemplateContext,
  kind: string,
): string {
  switch (kind) {
    case "requirements": return requirementsTemplate(context);
    case "implementation-plan": return implementationPlanTemplate(context);
    default: return `${frontMatter(context, kind)}# ${kind}\n\n`;
  }
}
