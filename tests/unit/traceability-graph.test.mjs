import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const trace = await loadSource("plugins/dev-flow/src/core/traceability.ts");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function deltaInput(current, artifactKind, nodes, options = {}) {
  const route = options.route ?? "m";
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
    ...(options.verificationCommandHashes ? { verificationCommandHashes: options.verificationCommandHashes } : {}),
    nextStateRevision: current.stateRevision + 1,
  };
}

function empty(route = "m") {
  return { route, ledger: trace.emptyTraceabilityLedger("f", 0, "a".repeat(64)) };
}

function requirementsLedger() {
  let { ledger } = empty();
  return trace.applyTraceDelta(deltaInput(ledger, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
    { kind: "requirement", id: "REQ-002" },
    { kind: "acceptance-criterion", id: "AC-002", parentRequirement: "REQ-002" },
  ]));
}

function populatedLedger() {
  let ledger = requirementsLedger();
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
  // Same-artifact co-registered AC stays current; external dependents go stale.
  for (const id of ["TASK-001", "RU-001", "TEST-001"]) {
    assert.equal(next.nodes[id].status, "stale", id);
  }
  for (const id of ["REQ-001", "AC-001", "REQ-002", "AC-002", "TASK-002", "RU-002", "TEST-002"]) {
    assert.equal(next.nodes[id].status, "current", id);
  }
  assert.throws(
    () => trace.assertTraceabilityComplete(next, "m", "a".repeat(64)),
    /TRACE_SLICE_STALE/,
  );
});

test("re-registering dependents restores current status after an upstream block change", () => {
  let ledger = populatedLedger();
  ledger = trace.applyTraceDelta(deltaInput(ledger, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
    { kind: "requirement", id: "REQ-002" },
    { kind: "acceptance-criterion", id: "AC-002", parentRequirement: "REQ-002" },
  ], { salt: (node) => node.id === "REQ-001" ? "changed" : "" }));
  assert.equal(ledger.nodes["TASK-001"].status, "stale");
  assert.equal(ledger.nodes["TEST-001"].status, "stale");
  assert.equal(ledger.nodes["AC-001"].status, "current");

  ledger = trace.applyTraceDelta(deltaInput(ledger, "implementation-plan", [
    { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
    { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/one.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
    { kind: "task", id: "TASK-002", covers: ["AC-002"], rollbackUnit: "RU-002" },
    { kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src/two.ts"], covers: ["REQ-002"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
  ]));
  assert.equal(ledger.nodes["TASK-001"].status, "current");
  assert.equal(ledger.nodes["RU-001"].status, "current");
  assert.equal(ledger.nodes["TEST-001"].status, "stale");

  ledger = trace.applyTraceDelta(deltaInput(ledger, "coverage-matrix", [
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
    { kind: "test", id: "TEST-002", verifies: ["AC-002"] },
  ]));
  assert.equal(ledger.nodes["TEST-001"].status, "current");
  assert.doesNotThrow(() => trace.assertTraceabilityComplete(ledger, "m", "a".repeat(64)));
});

test("graph validation permits only standard L's partial deferred rollback reference", () => {
  let ledger = trace.emptyTraceabilityLedger("l", 0, "a".repeat(64));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
  ], { route: "l" }));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "implementation-plan", [
    { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
  ], { route: "l" }));
  assert.doesNotThrow(() => trace.validateTraceGraph(ledger, "l", "partial"));
  assert.throws(() => trace.validateTraceGraph(ledger, "l", "complete"), /TRACE_GRAPH_INVALID/);
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

test("delta validation rejects unsafe rollback fileScope patterns before graph registration", () => {
  const rollback = (fileScope) => ({
    kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope,
    covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"],
  });
  for (const fileScope of [["../x"], ["/abs"], ["C:/abs"], ["src\\x"], ["src/../../x"], ["src", "../x"]]) {
    assert.throws(() => trace.validateTraceDelta({ nodes: [rollback(fileScope)] }), /TRACE_GRAPH_INVALID/, JSON.stringify(fileScope));
  }
  assert.doesNotThrow(() => trace.validateTraceDelta({ nodes: [rollback(["src/**"])] }));
  assert.doesNotThrow(() => trace.validateTraceDelta({ nodes: [rollback(["."])] }));
});

test("trace registration persists rollback paths in NFC", () => {
  const current = requirementsLedger();
  const next = trace.applyTraceDelta(deltaInput(current, "implementation-plan", [
    { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
    { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/需求a\u0301.js"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
  ]));
  assert.deepEqual(next.nodes["RU-001"].fileScope, ["src/需求á.js"]);
});

test("graph validation rejects every missing or asymmetric Task to RU relationship", () => {
  const requirements = requirementsLedger();
  assert.throws(
    () => trace.applyTraceDelta(deltaInput(requirements, "implementation-plan", [
      { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
      { kind: "rollback", id: "RU-002", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/a.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
    ])),
    /TRACE_GRAPH_INVALID/,
  );
  assert.throws(
    () => trace.applyTraceDelta(deltaInput(requirements, "implementation-plan", [
      { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
      { kind: "task", id: "TASK-002", covers: ["AC-002"], rollbackUnit: "RU-001" },
      { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/a.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
    ])),
    /TRACE_GRAPH_INVALID/,
  );
});

test("graph validation rejects dangling references, orphan tasks, duplicate IDs, and rollback cycles", () => {
  assert.throws(
    () => trace.validateTraceDelta({ nodes: [{ kind: "requirement", id: "REQ-01" }] }),
    /TRACE_GRAPH_INVALID/,
  );
  assert.throws(
    () => trace.validateTraceDelta({ nodes: [
      { kind: "requirement", id: "REQ-001" },
      { kind: "requirement", id: "REQ-001" },
    ] }),
    /TRACE_GRAPH_INVALID/,
  );
  const requirements = requirementsLedger();
  assert.throws(
    () => trace.applyTraceDelta(deltaInput(requirements, "implementation-plan", [
      { kind: "task", id: "TASK-001", covers: [], rollbackUnit: "RU-001" },
      { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/a.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
    ])),
    /TRACE_GRAPH_INVALID/,
  );
  assert.throws(
    () => trace.applyTraceDelta(deltaInput(requirements, "coverage-matrix", [
      { kind: "test", id: "TEST-001", verifies: ["AC-999"] },
    ])),
    /TRACE_GRAPH_INVALID/,
  );
  assert.throws(
    () => trace.applyTraceDelta(deltaInput(requirements, "implementation-plan", [
      { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
      { kind: "task", id: "TASK-002", covers: ["AC-002"], rollbackUnit: "RU-002" },
      { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: ["RU-002"], fileScope: ["src/a.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
      { kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: ["RU-001"], fileScope: ["src/b.ts"], covers: ["REQ-002"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
    ])),
    /TRACE_GRAPH_INVALID/,
  );
});

test("historical tombstones do not prevent the remaining current graph from completing", () => {
  let ledger = populatedLedger();
  ledger = trace.applyTraceDelta(deltaInput(ledger, "coverage-matrix", [
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
  ]));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "implementation-plan", [
    { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
    { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/one.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
  ]));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "requirements", [
    { kind: "requirement", id: "REQ-001" },
    { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
  ]));
  assert.equal(ledger.summary.tombstoned, 5);
  assert.doesNotThrow(() => trace.assertTraceabilityComplete(ledger, "m", "a".repeat(64)));
});

test("slice checks reject stale config and require a complete current graph", () => {
  const ledger = populatedLedger();
  assert.doesNotThrow(() => trace.assertTraceabilityComplete(ledger, "m", "a".repeat(64)));
  assert.throws(
    () => trace.assertTraceSliceCurrent(ledger, "m", "implementation_plan", "b".repeat(64)),
    /TRACE_SLICE_STALE/,
  );
});

test("semantic trace config checks only referenced verification command identities", () => {
  let ledger = requirementsLedger();
  const unitHash = "1".repeat(64);
  const lintHash = "2".repeat(64);
  ledger = trace.applyTraceDelta(deltaInput(ledger, "implementation-plan", [
    { kind: "task", id: "TASK-001", covers: ["AC-001"], rollbackUnit: "RU-001" },
    { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/one.ts"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
    { kind: "task", id: "TASK-002", covers: ["AC-002"], rollbackUnit: "RU-002" },
    { kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src/two.ts"], covers: ["REQ-002"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
  ], { verificationCommandHashes: { unit: unitHash, lint: lintHash } }));
  ledger = trace.applyTraceDelta(deltaInput(ledger, "coverage-matrix", [
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
    { kind: "test", id: "TEST-002", verifies: ["AC-002"] },
  ], { verificationCommandHashes: { unit: unitHash, lint: lintHash } }));
  assert.doesNotThrow(() => trace.assertTraceabilityComplete(ledger, "m", "b".repeat(64), { unit: unitHash, lint: "3".repeat(64) }));
  assert.throws(() => trace.assertTraceabilityComplete(ledger, "m", "b".repeat(64), { unit: "4".repeat(64), lint: lintHash }), /TRACE_SLICE_STALE/);
});

test("validateTraceGraph fail-closes on missing TraceSource fields and invalid status", () => {
  const ledger = populatedLedger();
  ledger.nodes["REQ-001"] = {
    kind: "requirement",
    id: "REQ-001",
    status: "ghost",
  };
  assert.throws(() => trace.validateTraceGraph(ledger, "m", "partial"), /TRACE_GRAPH_INVALID/);

  const missingSource = populatedLedger();
  missingSource.nodes["AC-001"] = {
    kind: "acceptance-criterion",
    id: "AC-001",
    parentRequirement: "REQ-001",
    status: "current",
    sourceArtifact: "requirements",
    sourceSha256: "a".repeat(64),
    sourceAnchor: "<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->",
    // missing sourceBlockSha256
  };
  assert.throws(() => trace.validateTraceGraph(missingSource, "m", "partial"), /TRACE_GRAPH_INVALID/);

  const keyMismatch = populatedLedger();
  keyMismatch.nodes["REQ-001"] = {
    ...keyMismatch.nodes["REQ-001"],
    id: "REQ-002",
  };
  assert.throws(() => trace.validateTraceGraph(keyMismatch, "m", "partial"), /TRACE_GRAPH_INVALID/);
});
