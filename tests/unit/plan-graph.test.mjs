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

function taskBlock(id, implementationUnit) {
  return `<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: [REQ-001]\n- implementation_unit: ${implementationUnit}\n\n`;
}

function implementationUnitBlock(id, tasks, dependsOn = []) {
  const tasksList = tasks.length ? `[${tasks.join(", ")}]` : "[]";
  const dependsList = dependsOn.length ? `[${dependsOn.join(", ")}]` : "[]";
  return `<!-- dev-flow:id=${id} kind=implementation-unit -->\n### ${id}：实现单元\n\n- tasks: ${tasksList}\n- depends_on: ${dependsList}\n- file_scope: src\n- covers: [REQ-001]\n- forward_verification: [unit]\n\n`;
}

test("valid single task + UNIT graph passes", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "UNIT-001")}${implementationUnitBlock("UNIT-001", ["TASK-001"])}`;
  assert.deepEqual(planGraph.validatePlanTaskGraph(markdown), []);
});

test("valid multi-UNIT chain with depends_on passes", () => {
  const markdown = [
    HEADER,
    taskBlock("TASK-001", "UNIT-001"),
    taskBlock("TASK-002", "UNIT-002"),
    implementationUnitBlock("UNIT-001", ["TASK-001"], ["UNIT-002"]),
    implementationUnitBlock("UNIT-002", ["TASK-002"]),
  ].join("\n");
  assert.deepEqual(planGraph.validatePlanTaskGraph(markdown), []);
});

test("task referencing a missing UNIT fails", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "UNIT-999")}${implementationUnitBlock("UNIT-001", ["TASK-001"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("TASK-001") && error.includes("UNIT-999")));
});

test("UNIT tasks list that omits a referencing task fails (asymmetry)", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "UNIT-001")}${taskBlock("TASK-002", "UNIT-001")}${implementationUnitBlock("UNIT-001", ["TASK-001"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("TASK-002")));
});

test("UNIT listing a task that declares a different implementation_unit fails (asymmetry)", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "UNIT-001")}${taskBlock("TASK-002", "UNIT-001")}${implementationUnitBlock("UNIT-002", ["TASK-002"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("UNIT-002") && error.includes("TASK-002")));
});

test("dangling depends_on target fails", () => {
  const markdown = `${HEADER}\n${taskBlock("TASK-001", "UNIT-001")}${implementationUnitBlock("UNIT-001", ["TASK-001"], ["UNIT-999"])}`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("UNIT-001") && error.includes("UNIT-999")));
});

test("cyclic depends_on graph fails", () => {
  const markdown = [
    HEADER,
    taskBlock("TASK-001", "UNIT-001"),
    taskBlock("TASK-002", "UNIT-002"),
    implementationUnitBlock("UNIT-001", ["TASK-001"], ["UNIT-002"]),
    implementationUnitBlock("UNIT-002", ["TASK-002"], ["UNIT-001"]),
  ].join("\n");
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("成环")));
});

test("empty plan (no anchors) fails", () => {
  assert.ok(planGraph.validatePlanTaskGraph("# 实现计划\n\n- 无任务\n").length > 0);
});

test("task without implementation_unit fails", () => {
  const markdown = `${HEADER}\n<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001：实现任务\n\n- covers: [REQ-001]\n`;
  const errors = planGraph.validatePlanTaskGraph(markdown);
  assert.ok(errors.some((error) => error.includes("TASK-001") && error.includes("implementation_unit")));
});
