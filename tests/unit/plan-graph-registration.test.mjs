import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");

const projectConfig = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function setupLightLFeature() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-plan-graph-"));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "plan-graph",
    host: "codex",
    level: "L",
    topology: "multi-chain",
    execution: "light",
    scopeFacts: ["scope"],
    topologyFacts: ["topology"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  });
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "implementation-plan");
  const planPath = path.join(root, ".dev-flow", "features", state.featureId, "实施计划.md");
  return { root, state, planPath };
}

test("light-l registers a template-scaffolded implementation plan", async () => {
  const { root, state, planPath } = await setupLightLFeature();
  try {
    const registered = await artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan");
    assert.ok(registered.artifacts["implementation-plan"].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("light-l rejects an implementation plan with a dangling task->RU reference", async () => {
  const { root, state, planPath } = await setupLightLFeature();
  try {
    const contents = await readFile(planPath, "utf8");
    await writeFile(planPath, contents.replace(/rollback_unit: RU-001/, "rollback_unit: RU-999"));
    await assert.rejects(
      () => artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan"),
      (error) => error.code === "PLAN_TASK_GRAPH_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("light-l rejects an implementation plan with a cyclic RU depends_on graph", async () => {
  const { root, state, planPath } = await setupLightLFeature();
  try {
    const contents = await readFile(planPath, "utf8");
    const withCycle = `${contents}
<!-- dev-flow:id=TASK-002 kind=task -->
### TASK-002：第二任务

- covers: [REQ-001]
- rollback_unit: RU-002

<!-- dev-flow:id=RU-002 kind=rollback -->
### RU-002：第二回撤单元

- tasks: [TASK-002]
- depends_on: [RU-001]
- file_scope: []
- covers: [REQ-001]
- forward_verification: [unit]
- rollback_verification: [unit]
`;
    // 让 RU-001 反向依赖 RU-002，形成 RU-001 → RU-002 → RU-001 的环。
    const cyclic = withCycle.replace(/depends_on: \[\]/, "depends_on: [RU-002]");
    await writeFile(planPath, cyclic);
    await assert.rejects(
      () => artifacts.recordArtifact(root, state.featureId, state.revision, "implementation-plan"),
      (error) => error.code === "PLAN_TASK_GRAPH_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
