import assert from "node:assert/strict";
import test from "node:test";
import { runRoute } from "../../helpers/route-flow.mjs";

const config = {
  schemaVersion: 1,
  verification: {
    commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }],
    behaviorCommands: [],
  },
  enforcement: {
    mode: "strict",
    gitWriteRequiresLogicComplete: true,
    oneActiveFeature: true,
    requireExplicitHumanReply: true,
  },
  protectedRoots: ["src"],
};

test("v2 standard M runs one dynamic approval and automatic unit checkpoints", async () => {
  const result = await runRoute({
    level: "M",
    topology: "shared-contract",
    execution: "standard",
    requirements: "provided-confirmed",
    scopeFacts: ["两个调用方需要兼容"],
    topologyFacts: ["共享协议字段影响调用方"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, "standard-m", {
    config,
    featureId: "standard-m-live",
    host: "claude",
    implementationFiles: { "src/protocol.js": "export const call = (value) => value;\n" },
    returnObservations: true,
    expectSnapshot: true,
  });
  assert.equal(result.state.lifecycle, "finalized");
  assert.equal(Object.keys(result.state.humanGates).filter((id) => id.startsWith("approval:")).length, 1);
  assert.ok((result.state.checkpoints?.length ?? 0) >= 2);
  assert.deepEqual(result.review.roles, ["requirements-coverage", "architecture-testability"]);
});

test("v2 light L runs the risk overlay without adding a second confirmation route", async () => {
  const result = await runRoute({
    level: "L",
    topology: "multi-chain",
    execution: "light",
    requirements: "provided-confirmed",
    scopeFacts: ["两个链路调用方需要兼容"],
    topologyFacts: ["存在跨链调用关系"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, "light-l", {
    config,
    featureId: "light-l-live",
    host: "codex",
    implementationFiles: { "src/fallback.js": "export const fallback = () => \"degraded\";\n" },
    returnObservations: true,
    expectSnapshot: true,
  });
  assert.equal(result.state.lifecycle, "finalized");
  assert.equal(Object.keys(result.state.humanGates).filter((id) => id.startsWith("approval:")).length, 1);
  assert.equal(result.review.createSeen, false);
});

test("v2 standard L derives rollback and coverage projections from the implementation plan", async () => {
  const result = await runRoute({
    level: "L",
    topology: "multi-chain",
    execution: "standard",
    requirements: "provided-confirmed",
    scopeFacts: ["两个链路调用方需要兼容"],
    topologyFacts: ["存在跨链调用关系"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, "standard-l", {
    config,
    featureId: "standard-l-live",
    host: "codex",
    implementationFiles: { "src/fallback.js": "export const fallback = () => \"degraded\";\n" },
    returnObservations: true,
    expectSnapshot: true,
  });
  assert.equal(result.state.lifecycle, "finalized");
  assert.equal(Object.keys(result.state.humanGates).filter((id) => id.startsWith("approval:")).length, 1);
  assert.ok((result.state.checkpoints?.length ?? 0) >= 2);
  assert.deepEqual(result.review.roles, ["requirements-coverage", "architecture-testability", "rollback-operability"]);
});
