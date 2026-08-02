import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");

function standardMState() {
  return {
    mode: "routed",
    route: "standard-m",
    workflowCapabilities: { trace: 1, review: 1, checkpoints: 1, rollbackExecution: 1 },
    steps: {
      requirements_alignment: { status: "satisfied" },
      planning: { status: "satisfied" },
      implementation: { status: "pending" },
      code_review: { status: "pending" },
      verification: { status: "pending" },
      finalize: { status: "pending" },
    },
    obligations: [{ id: "approval:plan", kind: "approval", status: "satisfied" }],
    humanGates: { "approval:plan": { status: "confirmed" } },
    implementationUnits: [{ unitId: "RU-001", status: "active" }],
  };
}

test("活动回撤单元缺少当前 Trace 节点时必须 fail closed", () => {
  const block = units.implementationUnitWriteBlock(standardMState(), { nodes: {} }, "src/feature.ts");
  assert.equal(block?.code, "IMPLEMENTATION_UNIT_OUT_OF_SCOPE");
});
