import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const planGraph = await loadSource("plugins/dev-flow/src/core/plan-graph.ts");

const HEADER = `---
dev_flow:
  schema_version: 3
  feature_id: f
  route: light-l
  kind: implementation-plan
---
# 实现计划
`;

function taskBlock(id, rollbackUnit) {
  return `<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: [REQ-001]\n- rollback_unit: ${rollbackUnit}\n\n`;
}

function rollbackBlock(id, tasks, dependsOn = []) {
  const tasksList = tasks.length ? `[${tasks.join(", ")}]` : "[]";
  const dependsList = dependsOn.length ? `[${dependsOn.join(", ")}]` : "[]";
  return `<!-- dev-flow:id=${id} kind=rollback -->\n### ${id}：回撤单元\n\n- tasks: ${tasksList}\n- depends_on: ${dependsList}\n- file_scope: []\n- covers: [REQ-001]\n- forward_verification: [unit]\n- rollback_verification: [unit]\n\n`;
}

test("valid single task + RU graph passes", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "RU-001")}${rollbackBlock("RU-001", ["TASK-001"])}`;
  assert.deepEqual(planGraph.validatePlanTaskGraph(markdown), []);
});

test("valid multi-RU chain with depends_on passes", () => {
  const markdown = [
    HEADER,
    taskBlock("TASK-001", "RU-001"),
    taskBlock("TASK-002", "RU-002"),
    rollbackBlock("RU-001", ["TASK-001"], ["RU-002"]),
    rollbackBlock("RU-002", ["TASK-002"]),
  ].join("\n");
  assert.deepEqual(planGraph.validatePlanTaskGraph(markdown), []);
});

test("task referencing a missing RU fails", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "RU-999")}${rollbackBlock("RU-001", ["TASK-001"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("TASK-001") && error.includes("RU-999")));
});

test("RU tasks list that omits a referencing task fails (asymmetry)", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "RU-001")}${taskBlock("TASK-002", "RU-001")}${rollbackBlock("RU-001", ["TASK-001"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("TASK-002")));
});

test("RU listing a task that declares a different rollback_unit fails (asymmetry)", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "RU-001")}${taskBlock("TASK-002", "RU-001")}${rollbackBlock("RU-002", ["TASK-002"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("RU-002") && error.includes("TASK-002")));
});

test("dangling depends_on target fails", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "RU-001")}${rollbackBlock("RU-001", ["TASK-001"], ["RU-999"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("RU-001") && error.includes("RU-999")));
});

test("cyclic depends_on graph fails", () => {
  const markdown = [
    HEADER,
    taskBlock("TASK-001", "RU-001"),
    taskBlock("TASK-002", "RU-002"),
    rollbackBlock("RU-001", ["TASK-001"], ["RU-002"]),
    rollbackBlock("RU-002", ["TASK-002"], ["RU-001"]),
  ].join("\n");
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("成环")));
});

test("empty plan (no anchors) fails", () => {
  assert.ok(planGraph.validatePlanTaskGraph("# 实现计划\n\n- 无任务\n").length > 0);
});

test("task without rollback_unit fails", () => {
  const markdown = `${HEADER}\n<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001：实现任务\n\n- covers: [REQ-001]\n`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("TASK-001") && error.includes("rollback_unit")));
});
