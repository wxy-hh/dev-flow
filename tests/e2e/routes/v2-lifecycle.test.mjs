import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");

const config = {
  schemaVersion: 1,
  verification: {
    commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

function facts(level, execution = "light") {
  return {
    level,
    topology: "local",
    ...(level === "XS" || level === "S" ? {} : { execution }),
    requirements: "provided-confirmed",
    scopeFacts: ["变更范围已由用户确认"],
    topologyFacts: ["只影响本地模块，不涉及共享契约"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  };
}

async function preparedRoot(label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `dev-flow-v2-${label}-`));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "feature.txt"), "baseline\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "dev-flow@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Dev Flow Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
  await state.initProject(root, config);
  return root;
}

async function driveRoute(root, featureId, classification, routeSteps) {
  let current = await state.startFeature(root, {
    featureId,
    objective: "调整本地模块行为",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    host: "codex",
  });
  assert.equal(current.mode, "intake");
  current = await state.lockClassification(root, featureId, current.revision, classification);
  assert.equal(current.mode, "routed");
  assert.ok(current.route);

  await writeFile(path.join(root, "src", "feature.txt"), "implemented\n");
  for (const item of routeSteps) {
    const evidence = item === "implementation"
      ? { files: ["src/feature.txt"] }
      : item === "planning" ? { reviewType: "plan" }
        : item === "code_review" ? { reviewType: "code" }
          : undefined;
    current = await steps.recordStep(root, featureId, current.revision, item, evidence);
  }
  current = await verification.runVerification(root, featureId, current.revision, "codex", ["unit"]);
  assert.equal(current.steps.verification.status, "satisfied");
  current = await steps.finalize(root, featureId, current.revision);
  assert.equal(current.lifecycle, "finalized");
  assert.equal(current.logicComplete, true);
  assert.ok(current.deliverySnapshot?.baseHead);
  assert.ok((current.checkpoints?.length ?? 0) >= 1, "v2 routes capture an automatic implementation baseline");
  return current;
}

test("v2 XS 从 intake 到 finalize 可完整执行", async () => {
  const root = await preparedRoot("xs");
  const current = await driveRoute(root, "xs-feature", facts("XS"), ["locate", "implementation"]);
  assert.equal(current.route, "xs");
});

test("v2 light M 保留规划与代码审查但不增加确认门", async () => {
  const root = await preparedRoot("light-m");
  const current = await driveRoute(root, "light-m-feature", facts("M"), ["planning", "implementation", "code_review"]);
  assert.equal(current.route, "light-m");
  assert.equal(current.obligations?.some((obligation) => obligation.kind === "approval"), false);
});

test("v2 standard M 锁定后先进入需求资产与独立审查子状态", async () => {
  const root = await preparedRoot("standard-m");
  let current = await state.startFeature(root, {
    featureId: "standard-m-feature",
    objective: "调整共享模块行为",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    host: "codex",
  });
  current = await state.lockClassification(root, "standard-m-feature", current.revision, {
    ...facts("M", "standard"),
    topology: "shared-contract",
    topologyFacts: ["共享契约会影响多个调用方"],
  });
  assert.equal(current.route, "standard-m");
  const action = await next.nextAction(root, "standard-m-feature");
  assert.deepEqual(action, { kind: "scaffold-artifact", step: "requirements" });
});
