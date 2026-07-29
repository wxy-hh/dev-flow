import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const trace = await loadSource("plugins/dev-flow/src/core/traceability.ts");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function deltaInput(current, artifactKind, nodes, options = {}) {
  const route = options.route ?? "standard-m";
  const salt = options.salt ?? "";
  return {
    current,
    route,
    artifactKind,
    artifactSha256: digest(`${artifactKind}:${salt}`),
    sourceBlocks: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      sourceAnchor: `<!-- dev-flow:id=${node.id} kind=${node.kind} -->`,
      sourceBlockSha256: digest(`${JSON.stringify(node)}:${typeof salt === "function" ? salt(node) : salt}`),
    })),
    delta: { nodes },
    projectConfigSha256: options.projectConfigSha256 ?? "a".repeat(64),
    verificationCommandIds: options.verificationCommandIds ?? ["unit"],
    nextStateRevision: current.stateRevision + 1,
  };
}

function empty(route = "standard-m") {
  return { route, ledger: trace.emptyTraceabilityLedger("f", 0, "a".repeat(64)) };
}

function populatedLedger() {
  let { ledger } = empty();
  ledger = trace.applyTraceDelta(deltaInput(ledger, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
    { kind: "requirement", id: "REQ-002" },
    { kind: "acceptance-criterion", id: "AC-002", parentRequirement: "REQ-002" },
  ]));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "implementation-plan", [
    { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
    { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/one.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
    { kind: "task", id: "TASK-002", covers: ["AC-002"], rollbackUnit: "RU-002" },
    { kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src/two.ts"], covers: ["REQ-002"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
  ]));
  return trace.applyTraceDelta(deltaInput(ledger, "coverage-matrix", [
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
    { kind: "test", id: "TEST-002", verifies: ["AC-002"] },
  ]));
}

test("delta is a complete source replacement and caller cannot reuse tombstones", () => {
  const initial = trace.emptyTraceabilityLedger("f", 0, "a".repeat(64));
  const first = trace.applyTraceDelta(deltaInput(initial, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
  ]));
  const second = trace.applyTraceDelta(deltaInput(first, "requirements", [
    { kind: "requirement", id: "REQ-001" },
  ]));
  assert.equal(second.nodes["AC-001"].status, "tombstoned");
  assert.throws(
    () => trace.applyTraceDelta(deltaInput(second, "requirements", [
      { kind: "requirement", id: "REQ-001" },
      { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
    ])),
    /TRACE_GRAPH_INVALID/,
  );
});

test("changed source blocks stale only their reverse dependency closure", () => {
  const current = populatedLedger();
  const next = trace.applyTraceDelta(deltaInput(current, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
    { kind: "requirement", id: "REQ-002" },
    { kind: "acceptance-criterion", id: "AC-002", parentRequirement: "REQ-002" },
  ], { salt: (node) => node.id === "REQ-001" ? "changed" : "" }));
  for (const id of ["AC-001", "TASK-001", "RU-001", "TEST-001"]) {
    assert.equal(next.nodes[id].status, "stale", id);
  }
  for (const id of ["REQ-001", "REQ-002", "AC-002", "TASK-002", "RU-002", "TEST-002"]) {
    assert.equal(next.nodes[id].status, "current", id);
  }
  assert.throws(
    () => trace.assertTraceabilityComplete(next, "standard-m", "a".repeat(64)),
    /TRACE_SLICE_STALE/,
  );
});

test("graph validation permits only standard L's partial deferred rollback reference", () => {
  let ledger = trace.emptyTraceabilityLedger("l", 0, "a".repeat(64));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
  ], { route: "standard-l" }));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "implementation-plan", [
    { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
  ], { route: "standard-l" }));
  assert.doesNotThrow(() => trace.validateTraceGraph(ledger, "standard-l", "partial"));
  assert.throws(() => trace.validateTraceGraph(ledger, "standard-l", "complete"), /TRACE_GRAPH_INVALID/);
});

test("delta and graph validation reject caller-owned fields and broken rollback units", () => {
  assert.throws(
    () => trace.validateTraceDelta({ nodes: [{ kind: "requirement", id: "REQ-001", status: "current" }] }),
    /TRACE_GRAPH_INVALID/,
  );
  const initial = trace.emptyTraceabilityLedger("f", 0, "a".repeat(64));
  assert.throws(
    () => trace.applyTraceDelta(deltaInput(initial, "implementation-plan", [
      { kind: "task", id: "TASK-001", covers: ["REQ-001"], rollbackUnit: "RU-001" },
      { kind: "rollback", id: "RU-001", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src/a.ts"], covers: ["REQ-001"], forwardVerification: ["unknown"], rollbackVerification: ["unit"] },
    ])),
    /TRACE_GRAPH_INVALID/,
  );
});

test("slice checks reject stale config and require a complete current graph", () => {
  const ledger = populatedLedger();
  assert.doesNotThrow(() => trace.assertTraceabilityComplete(ledger, "standard-m", "a".repeat(64)));
  assert.throws(
    () => trace.assertTraceSliceCurrent(ledger, "standard-m", "implementation_plan", "b".repeat(64)),
    /TRACE_SLICE_STALE/,
  );
});
