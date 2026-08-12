import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setupFormalFeature() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-plan-graph-"));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "plan-graph",
    host: "codex",
    level: "M",
    topology: "local",
    scopeFacts: ["scope"],
    topologyFacts: ["topology"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  });
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
  state = await artifacts.recordArtifact(root, state.featureId, state.revision, "requirements");
  state = await steps.recordStep(root, state.featureId, state.revision, "requirements_alignment", {});
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", state.featureId, "实施计划.md");
  return { root, state, planPath };
}

test("a formal v5 plan registers after its required requirements evidence", async () => {
  const { root, state, planPath } = await setupFormalFeature();
  try {
    const registered = await artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan");
    assert.ok(registered.artifacts["implementation-plan"].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a formal v5 plan rejects a dangling task-to-UNIT reference", async () => {
  const { root, state, planPath } = await setupFormalFeature();
  try {
    const contents = await readFile(planPath, "utf8");
    await writeFile(planPath, contents.replace(/implementation_unit: UNIT-001/, "implementation_unit: UNIT-999"));
    await assert.rejects(
      () => artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan"),
      (error) => error.code === "PLAN_TASK_GRAPH_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a formal v5 plan rejects a cyclic UNIT dependency graph", async () => {
  const { root, state, planPath } = await setupFormalFeature();
  try {
    const contents = await readFile(planPath, "utf8");
    const withCycle = `${contents}
<!-- dev-flow:id=TASK-002 kind=task -->
### TASK-002：第二任务

- covers: [REQ-001]
- implementation_unit: UNIT-002

<!-- dev-flow:id=UNIT-002 kind=implementation-unit -->
### UNIT-002：第二实现单元

- tasks: [TASK-002]
- depends_on: [UNIT-001]
- file_scope: []
- covers: [REQ-001]
- forward_verification: [unit]
- forward_verification: [unit]
`;
    // 让 UNIT-001 反向依赖 UNIT-002，形成环。
    const cyclic = withCycle.replace(/depends_on: \[\]/, "depends_on: [UNIT-002]");
    await writeFile(planPath, cyclic);
    await assert.rejects(
      () => artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan"),
      (error) => error.code === "PLAN_TASK_GRAPH_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
