import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const trace = await loadSource("plugins/dev-flow/src/core/traceability.ts");

function rollback(overrides = {}) {
  return {
    kind: "rollback",
    id: "RU-001",
    tasks: ["TASK-001"],
    dependsOn: [],
    fileScope: ["src"],
    covers: ["REQ-001"],
    forwardVerification: [{ command: "node", args: ["-e", "process.exit(0)"], cwd: "." }],
    rollbackVerification: ["unit"],
    ...overrides,
  };
}

test("trace delta rejects rollback nodes and inline verification commands", () => {
  assert.throws(() => trace.validateTraceDelta({ nodes: [rollback()] }), /rollback nodes are not a v6 Trace kind/);
  assert.throws(
    () => trace.validateTraceDelta({
      nodes: [{
        kind: "implementation-unit",
        id: "UNIT-001",
        tasks: ["TASK-001"],
        dependsOn: [],
        fileScope: ["src"],
        covers: ["REQ-001"],
        forwardVerification: [{ command: "node", args: ["-e", "process.exit(0)"], cwd: "." }],
      }],
    }),
    /TRACE_GRAPH_INVALID/,
  );
});

test("trace delta rejects inline command cwd escaping the project", () => {
  assert.throws(() => trace.validateTraceDelta({ nodes: [rollback({ forwardVerification: [{ command: "node", cwd: "../outside" }] })] }), /TRACE_GRAPH_INVALID/);
});
