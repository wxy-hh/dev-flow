import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const revision = await loadSource("plugins/dev-flow/src/core/plan-revision.ts");

const requirement = (id) => ({ kind: "requirement", id, status: "current" });
const criterion = (id, parent) => ({ kind: "acceptance-criterion", id, status: "current", parentRequirement: parent });
const task = (id, covers, unit) => ({ kind: "task", id, status: "current", covers, implementationUnit: unit });
const testNode = (id, verifies) => ({ kind: "test", id, status: "current", verifies });
const unit = (id, tasks, fileScope, covers) => ({
  kind: "implementation-unit", id, status: "current", tasks, dependsOn: [], fileScope, covers, forwardVerification: ["unit"],
});

function ledger(entries) {
  const nodes = Object.fromEntries(entries.map((node) => [node.id, node]));
  return {
    schemaVersion: 1,
    featureId: "f",
    revision: 0,
    stateRevision: 0,
    projectConfigSha256: "0".repeat(64),
    nodes,
    edges: [],
    summary: { total: entries.length, current: entries.length, stale: 0, tombstoned: 0 },
  };
}

const baseNodes = () => [
  requirement("REQ-001"),
  criterion("AC-001", "REQ-001"),
  task("TASK-001", ["REQ-001", "AC-001"], "UNIT-001"),
  testNode("TEST-001", ["AC-001"]),
  unit("UNIT-001", ["TASK-001"], ["src"], ["REQ-001", "AC-001"]),
];

test("unit-level semantic changes project to the affected unit without a fallback", () => {
  const oldLedger = ledger(baseNodes());
  const newLedger = ledger(baseNodes().map((node) =>
    node.kind === "implementation-unit" ? { ...node, fileScope: ["src", "src/new.ts"] } : node));
  const impact = revision.computePlanRevisionImpact(oldLedger, newLedger);
  assert.deepEqual(impact.affectedIds, ["UNIT-001"]);
  assert.equal(impact.fallbackReason, undefined);
});

test("AC disposition and TEST.verifies changes project via unit covers", () => {
  const oldLedger = ledger(baseNodes());
  // AC 验证处置从行为测试改为文件核对 + 对应 TEST 删除。
  const newLedger = ledger([
    requirement("REQ-001"),
    { ...criterion("AC-001", "REQ-001"), verificationDisposition: { kind: "file-check", reason: "仅核对导出" } },
    task("TASK-001", ["REQ-001", "AC-001"], "UNIT-001"),
    unit("UNIT-001", ["TASK-001"], ["src"], ["REQ-001", "AC-001"]),
  ]);
  const impact = revision.computePlanRevisionImpact(oldLedger, newLedger);
  assert.deepEqual(impact.affectedIds, ["UNIT-001"]);
  assert.equal(impact.fallbackReason, undefined);
});

test("unmappable changes fall back to a full redo with a diagnosable reason (issue 17 acceptance 6)", () => {
  const oldLedger = ledger(baseNodes());
  // 新增 requirement 节点：不属于 task/AC/test/recovery/unit 切片，无法局部定位。
  const newLedger = ledger([...baseNodes(), requirement("REQ-002")]);
  const impact = revision.computePlanRevisionImpact(oldLedger, newLedger);
  assert.ok(impact.fallbackReason, "fallback reason must be present");
  assert.match(impact.fallbackReason, /requirement/);
  assert.match(impact.fallbackReason, /REQ-002/);
  assert.match(impact.fallbackReason, /完整重审/);
  // 兜底：全部实现单元重做。
  assert.deepEqual(impact.affectedIds, ["UNIT-001"]);
});

test("an unchanged plan produces no affected units and no fallback", () => {
  const oldLedger = ledger(baseNodes());
  const impact = revision.computePlanRevisionImpact(oldLedger, ledger(baseNodes()));
  assert.deepEqual(impact.affectedIds, []);
  assert.equal(impact.fallbackReason, undefined);
});
