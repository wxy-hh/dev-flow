import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";
import { registerTraceFixture } from "../../helpers/trace-fixtures.mjs";

function initGit(root) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "initial"', { cwd: root, stdio: "pipe" });
}

const hash = (value) => createHash("sha256").update(value).digest("hex");

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const rollback = await loadSource("plugins/dev-flow/src/core/rollback.ts");

const config = {
  schemaVersion: 1,
  verification: {
    commands: [
      { id: "unit", command: process.execPath, args: ["--test", "test/counter.test.js"], cwd: "." },
      { id: "rb-check", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." },
    ],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src", "test"],
};

const statusArtifactName = "状态文档.md";

function statusArtifactContent(featureId, route) {
  return `---\ndev_flow:\n  schema_version: 1\n  feature_id: ${featureId}\n  route: ${route}\n  kind: status\n---\n\n# status\n\n`;
}

async function writeStatusArtifact(root, featureId, route) {
  const name = statusArtifactName;
  const content = statusArtifactContent(featureId, route);
  await writeFile(path.join(root, ".dev-flow", "features", featureId, name), content);
  return hash(content);
}

function threeClosurePlanDelta() {
  const rollbackNode = (id, tasks, dependsOn, fileScope, covers) => ({
    kind: "rollback", id, tasks, dependsOn, fileScope, covers,
    forwardVerification: ["unit"], rollbackVerification: ["rb-check"],
  });
  return {
    nodes: [
      { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
      { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-002" },
      { kind: "task", id: "TASK-003", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-003" },
      rollbackNode("RU-001", ["TASK-001"], [], ["src/one"], ["REQ-001", "AC-001"]),
      rollbackNode("RU-002", ["TASK-002"], ["RU-001"], ["src/two"], ["REQ-001", "AC-001"]),
      rollbackNode("RU-003", ["TASK-003"], ["RU-002"], ["src/three"], ["REQ-001", "AC-001"]),
    ],
  };
}

function appendSecondTraceClosure(markdown) {
  const taskBlock = (id, ru) => `\n<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: REQ-001, AC-001\n- rollback_unit: ${ru}\n`;
  const ruBlock = (id, tasks, dependsOn, scope) =>
    `\n<!-- dev-flow:id=${id} kind=rollback -->\n### ${id}：回撤单元\n\n- tasks: ${tasks}\n- depends_on: ${dependsOn}\n- file_scope: ${scope}\n- covers: REQ-001, AC-001\n- forward_verification: unit\n- rollback_verification: unit\n`;
  return markdown
    + taskBlock("TASK-002", "RU-002")
    + ruBlock("RU-002", "TASK-002", "RU-001", "src/two");
}

function appendThirdTraceClosure(markdown) {
  const taskBlock = (id, ru) => `\n<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: REQ-001, AC-001\n- rollback_unit: ${ru}\n`;
  const ruBlock = (id, tasks, dependsOn, scope) =>
    `\n<!-- dev-flow:id=${id} kind=rollback -->\n### ${id}：回撤单元\n\n- tasks: ${tasks}\n- depends_on: ${dependsOn}\n- file_scope: ${scope}\n- covers: REQ-001, AC-001\n- forward_verification: unit\n- rollback_verification: rb-check\n`;
  return markdown
    + taskBlock("TASK-002", "RU-002")
    + taskBlock("TASK-003", "RU-003")
    + ruBlock("RU-002", "TASK-002", "RU-001", "src/two")
    + ruBlock("RU-003", "TASK-003", "RU-002", "src/three");
}

function satisfyPreImplementation(draft) {
  const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
  for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
    draft.steps[step] = { status: "satisfied", ...(step === "plan_review" ? { evidence: { reviewType: "plan" } } : {}) };
  }
  draft.humanGates.implementation_approval = { status: "confirmed" };
}

test("Claude checkpoints RU-001; Codex checkpoints RU-002, RU-003; Claude gates and executes rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-xhost-rollback-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src/one"), { recursive: true });
    await mkdir(path.join(root, "src/two"), { recursive: true });
    await mkdir(path.join(root, "src/three"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
    await writeFile(path.join(root, "src/one/a.txt"), "one v1\n");
    await writeFile(path.join(root, "src/two/b.txt"), "two v1\n");
    await writeFile(path.join(root, "src/three/c.txt"), "three v1\n");
    initGit(root);

    // ── Claude starts the feature ──
    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    assert.equal(state.workflowCapabilities.rollbackExecution, 1);

    state = await store.mutate(root, "f", state.revision, "xhost-rb-capabilities", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 1 };
    });

    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "xhost-rb-req", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: threeClosurePlanDelta(), edit: appendThirdTraceClosure });
    state = await store.mutate(root, "f", state.revision, "xhost-rb-plan", (draft) => {
      draft.steps.implementation_plan = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    const statusSha = await writeStatusArtifact(root, "f", state.route);
    state = await store.mutate(root, "f", state.revision, "xhost-rb-approval", (draft) => {
      satisfyPreImplementation(draft);
      draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
    });

    // ── Claude checkpoints RU-001 ──
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;

    const next = await loadSource("plugins/dev-flow/src/core/next.ts");

    // ── Codex reads the same feature and checkpoints RU-002 ──
    let codexNext = await next.nextAction(root, "f");
    assert.equal(codexNext.kind, "begin-implementation-unit");
    assert.equal(codexNext.unitId, "RU-002");

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
    await writeFile(path.join(root, "src/two/new.txt"), "two added\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

    // ── Codex also checkpoints RU-003 ──
    codexNext = await next.nextAction(root, "f");
    assert.equal(codexNext.kind, "begin-implementation-unit");
    assert.equal(codexNext.unitId, "RU-003");

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
    await writeFile(path.join(root, "src/three/c.txt"), "three v2\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;

    // ── Claude reads status: all checkpoints visible ──
    let view = await status.readStatusView(root, "f");
    assert.equal(view.rollback.chain.length, 3);
    assert.deepEqual(view.rollback.validTargets, ["CP-001", "CP-002"]);

    // ── Claude presents gate and confirms ──
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    state = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.state.revision, presented.interaction.id, "confirm", undefined, "claude",
    );

    // ── Claude executes rollback ──
    const result = await rollback.executeRollback(root, "f", state.revision, "CP-001");
    assert.equal(result.outcome, "committed");
    state = result.state;

    // ── Verify cross-host rollback state ──
    assert.equal(await readFile(path.join(root, "src/one/a.txt"), "utf8"), "one v2\n");
    assert.equal(await readFile(path.join(root, "src/two/b.txt"), "utf8"), "two v1\n");
    await assert.rejects(readFile(path.join(root, "src/two/new.txt"), "utf8"), { code: "ENOENT" }, "RU-002 addition should be removed");
    assert.equal(await readFile(path.join(root, "src/three/c.txt"), "utf8"), "three v1\n");

    const ru2 = (state.implementationUnits ?? []).find((u) => u.unitId === "RU-002");
    assert.equal(ru2.status, "pending");
    assert.equal(ru2.checkpointId, undefined);

    // ── Codex reads the post-rollback state ──
    view = await status.readStatusView(root, "f");
    assert.equal(view.rollback.openTransaction, undefined, "transaction is finished");
    assert.equal(view.rollback.gateStatus, undefined, "gate is consumed");

    // ── Codex resumes: begins RU-002 ──
    codexNext = await next.nextAction(root, "f");
    assert.equal(codexNext.kind, "begin-implementation-unit");
    assert.equal(codexNext.unitId, "RU-002");

    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src/two/b.txt"), "two v3\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

    // Codex checkpoints RU-003.
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
    await writeFile(path.join(root, "src/three/c.txt"), "three v3\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;

    view = await status.readStatusView(root, "f");
    assert.deepEqual(view.implementation.remainingUnitIds, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CAS prevents concurrent rollback execution across hosts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-xhost-cas-"));
  try {
    await store.initProject(root, config);
    await mkdir(path.join(root, "src/one"), { recursive: true });
    await mkdir(path.join(root, "src/two"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
    await writeFile(path.join(root, "src/one/a.txt"), "one v1\n");
    await writeFile(path.join(root, "src/two/b.txt"), "two v1\n");
    initGit(root);

    let state = await store.startFeature(root, {
      featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });

    state = await store.mutate(root, "f", state.revision, "xhost-cas-capabilities", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 1 };
    });

    const twoRuDelta = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
        { kind: "task", id: "TASK-002", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-002" },
        {
          kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/one"],
          covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"],
        },
        {
          kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: ["RU-001"], fileScope: ["src/two"],
          covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"],
        },
      ],
    };

    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "xhost-cas-req", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: twoRuDelta, edit: appendSecondTraceClosure });
    state = await store.mutate(root, "f", state.revision, "xhost-cas-plan", (draft) => {
      draft.steps.implementation_plan = { status: "satisfied" };
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
    const statusSha = await writeStatusArtifact(root, "f", state.route);
    state = await store.mutate(root, "f", state.revision, "xhost-cas-approval", (draft) => {
      satisfyPreImplementation(draft);
      draft.artifacts.status = { path: statusArtifactName, sha256: statusSha };
    });

    // Checkpoint both RUs.
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
    await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
    state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
    await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
    state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;

    // Confirm gate.
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    const confirmed = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.state.revision, presented.interaction.id, "confirm", undefined, "claude",
    );

    // Concurrent execution: two callers race with the same confirmed revision.
    // Both calls are in-process on the same loaded module — they exercise lease
    // + CAS contention for the same-version path only. OS-level process mutual
    // exclusion comes from the state-store mkdir lock; legacy-host dual-lease
    // interop (active/stale legacy lease) is covered by unit tests in
    // tests/unit/rollback-transaction.test.mjs.
    const results = await Promise.allSettled([
      rollback.executeRollback(root, "f", confirmed.revision, "CP-001"),
      rollback.executeRollback(root, "f", confirmed.revision, "CP-001"),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    assert.equal(succeeded.length, 1, "exactly one concurrent execution succeeds");
    assert.equal(failed.length, 1, "exactly one concurrent execution is rejected");
    assert.equal(succeeded[0].value.outcome, "committed");

    // Second execution on the same (now-stale) revision is also rejected.
    await assert.rejects(
      () => rollback.executeRollback(root, "f", confirmed.revision, "CP-001"),
      (error) => error.code === "ROLLBACK_GATE_NOT_CONFIRMED" || error.code === "STATE_REVISION_CONFLICT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
