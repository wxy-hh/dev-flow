import assert from "node:assert/strict";
import test from "node:test";
import { runRoute } from "../helpers/route-flow.mjs";

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

test("claim/submit review completion satisfies the persisted review obligation", async () => {
  const result = await runRoute({
    level: "M",
    topology: "shared-contract",
    execution: "standard",
    requirements: "provided-confirmed",
    scopeFacts: ["共享协议字段需要兼容"],
    topologyFacts: ["存在共享契约"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, "standard-m", {
    config,
    featureId: "review-obligation",
    implementationFiles: { "src/protocol.js": "export const value = 1;\n" },
    returnObservations: true,
    expectSnapshot: true,
  });
  const review = result.state.obligations.find((obligation) => obligation.kind === "review");
  assert.equal(review?.status, "satisfied");
});

test("risk review and rollback overlays are satisfied by their declared evidence", async () => {
  const state = await runRoute({
    level: "XS",
    topology: "local",
    riskLabels: ["security", "irreversible_consequence"],
    classificationBasis: {
      scopeFacts: ["仅修改一个本地模块"],
      topologyFacts: ["无共享契约"],
      uncertaintyFacts: [],
      riskFacts: {
        security: ["权限边界会改变"],
        irreversible_consequence: ["失败后无法安全恢复原状态"],
      },
      decisionRefs: [],
    },
    }, "xs", {
    config,
    featureId: "risk-obligations",
    implementationFiles: { "src/risk.js": "export const safe = true;\n" },
  });
  assert.ok(state.obligations
    .filter((obligation) => ["review", "rollback", "verification"].includes(obligation.kind))
    .every((obligation) => obligation.status === "satisfied"));
});
