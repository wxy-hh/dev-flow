import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const rollback = await loadSource("plugins/dev-flow/src/core/rollback.ts");
const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");

const sha = (letter) => letter.repeat(64);

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-rollback-gate-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function satisfyPreImplementation(draft) {
  const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
  for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
    draft.steps[step] = { status: "satisfied" };
  }
  draft.humanGates.implementation_approval = { status: "confirmed" };
}

function threeClosurePlanDelta() {
  const rollbackNode = (id, tasks, dependsOn, fileScope, covers) => ({
    kind: "rollback", id, tasks, dependsOn, fileScope, covers,
    forwardVerification: ["unit"], rollbackVerification: ["unit"],
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

function appendThirdTraceClosure(markdown) {
  const taskBlock = (id, ru) => `\n<!-- dev-flow:id=${id} kind=task -->\n### ${id}：实现任务\n\n- covers: REQ-001, AC-001\n- rollback_unit: ${ru}\n`;
  const ruBlock = (id, tasks, dependsOn, scope) =>
    `\n<!-- dev-flow:id=${id} kind=rollback -->\n### ${id}：回撤单元\n\n- tasks: ${tasks}\n- depends_on: ${dependsOn}\n- file_scope: ${scope}\n- covers: REQ-001, AC-001\n- forward_verification: unit\n- rollback_verification: unit\n`;
  return markdown
    + taskBlock("TASK-002", "RU-002")
    + taskBlock("TASK-003", "RU-003")
    + ruBlock("RU-002", "TASK-002", "RU-001", "src/two")
    + ruBlock("RU-003", "TASK-003", "RU-002", "src/three");
}

/**
 * Creates a standard-m feature with three chained RUs and rollbackExecution
 * capability set to the given value (default 1). Lands approved on the
 * implementation step with all three units checkpointed.
 */
async function checkpointedFeature(root, { rollbackExecution = 1 } = {}) {
  await stateStore.initProject(root, strictProjectConfig);
  await mkdir(path.join(root, "src/one"), { recursive: true });
  await mkdir(path.join(root, "src/two"), { recursive: true });
  await mkdir(path.join(root, "src/three"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test/counter.test.js"), "const test = require('node:test');\ntest('fixture passes', () => {});\n");
  await writeFile(path.join(root, "src/one/a.txt"), "one v1\n");
  await writeFile(path.join(root, "src/two/b.txt"), "two v1\n");
  await writeFile(path.join(root, "src/three/c.txt"), "three v1\n");
  await writeFile(path.join(root, "src/one/gone.txt"), "will be deleted\n");

  let state = await stateStore.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  // Override review:0 since these tests don't need review projections, but
  // keep rollbackExecution from the release constant (1) — except for the
  // legacy-simulation path where it's explicitly set to 0 below.
  state = await stateStore.mutate(root, "f", state.revision, "gate-test-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await stateStore.mutate(root, "f", state.revision, "gate-test-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan", delta: threeClosurePlanDelta(), edit: appendThirdTraceClosure });
  state = await stateStore.mutate(root, "f", state.revision, "gate-test-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  state = await stateStore.mutate(root, "f", state.revision, "gate-test-approval", satisfyPreImplementation);

  // Run all three units through begin → edit → checkpoint.
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
  await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
  await rm(path.join(root, "src/one/gone.txt"));
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
  await writeFile(path.join(root, "src/two/b.txt"), "two v2\n");
  await writeFile(path.join(root, "src/two/new.txt"), "two added\n");
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-003");
  await writeFile(path.join(root, "src/three/c.txt"), "three v2\n");
  return (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-003")).state;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("fresh feature from startFeature gets rollbackExecution:1 automatically", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "test/counter.test.js"), "");
    const state = await stateStore.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    assert.equal(state.workflowCapabilities?.rollbackExecution, 1);
    assert.equal(state.workflowCapabilities?.checkpoints, 1);
    assert.equal(state.workflowCapabilities?.trace, 1);
  });
});

test("rollback gate can be presented for a valid target on rollbackExecution:1 feature", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);

    const result = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");
    const rollbackGate = result.state.rollbackGate;

    assert.ok(rollbackGate, "rollbackGate must be set after presentation");
    assert.equal(rollbackGate.status, "pending");
    assert.equal(rollbackGate.targetCheckpointId, "CP-003");
    assert.equal(rollbackGate.targetUnitId, "RU-003");
    assert.match(rollbackGate.previewBasisHash, /^[a-f0-9]{64}$/);
    assert.ok(rollbackGate.interactionId, "interactionId must be set");
    assert.equal(rollbackGate.stateRevision, state.revision);

    assert.equal(result.interaction.kind, "rollback-confirmation");
    assert.equal(result.interaction.options.length, 2);
    assert.equal(result.interaction.options[0].id, "confirm");
    assert.equal(result.interaction.options[1].id, "request-changes");

    assert.ok(result.preview.previewBasisHash, "preview basis must be computed");
    assert.equal(result.preview.targetCheckpointId, "CP-003");
  });
});

test("rollback:1 feature can present gate to an older checkpoint after a suffix", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);

    // Present gate targeting the middle checkpoint (CP-001 → undo RU-003, RU-002).
    const result = await rollback.presentRollbackGate(root, "f", state.revision, "CP-001");
    assert.equal(result.state.rollbackGate.status, "pending");
    assert.equal(result.preview.targetCheckpointId, "CP-001");
    assert.equal(result.preview.targetUnitId, "RU-001");
    assert.deepEqual(result.preview.undoOrder, ["RU-003", "RU-002"]);
    assert.deepEqual(result.preview.undoCheckpoints, ["CP-003", "CP-002"]);
  });
});

test("rollback:0 feature cannot present rollback gate", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root, { rollbackExecution: 0 });

    await assert.rejects(
      () => rollback.presentRollbackGate(root, "f", state.revision, "CP-003"),
      (error) => error.code === "ROLLBACK_EXECUTION_NOT_ALLOWED",
    );
  });
});

test("double presentation is rejected", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    await assert.rejects(
      () => rollback.presentRollbackGate(root, "f", state.revision + 1, "CP-003"),
      (error) => error.code === "ROLLBACK_GATE_ALREADY_PRESENTED",
    );
  });
});

test("invalid target checkpoint is rejected by preview before gate", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);

    await assert.rejects(
      () => rollback.presentRollbackGate(root, "f", state.revision, "CP-999"),
      (error) => error.code === "ROLLBACK_TARGET_INVALID",
    );
  });
});

test("confirm via elicitation resolves gate to confirmed", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    const final = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.revision, pub.id, "confirm", undefined, "codex",
    );
    assert.equal(final.rollbackGate.status, "confirmed");
    assert.ok(final.rollbackGate.confirmedAt, "confirmedAt must be set");
    assert.equal(final.rollbackGate.interactionId, pub.id);

    // Interaction must be resolved.
    const interaction = interactions.getInteraction(final, pub.id);
    assert.equal(interaction.status, "resolved");
    assert.equal(interaction.response.action, "confirm");
  });
});

test("request-changes clears the gate for re-presentation", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    const returned = await rollback.resolveRollbackGateElicitation(
      root, "f", presented.revision, pub.id, "request-changes", "需要重新审查范围", "codex",
    );
    // Gate must be cleared.
    assert.equal(returned.rollbackGate, undefined);

    // Re-presentation should work.
    const represented = await rollback.presentRollbackGate(root, "f", returned.revision, "CP-003");
    assert.equal(represented.state.rollbackGate.status, "pending");
  });
});

test("workspace conflict clears the gate and allows re-presentation", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    // Modify a file tracked by the chain tip — this changes the preview basis.
    await writeFile(path.join(root, "src/one/a.txt"), "unauthorized change\n");

    await assert.rejects(
      () => rollback.resolveRollbackGateElicitation(root, "f", presented.revision, pub.id, "confirm", undefined, "codex"),
      (error) => error.code === "ROLLBACK_GATE_BASIS_CHANGED",
    );

    // Gate must have been cleared from state.
    const afterFailed = await stateStore.readState(root, "f");
    assert.equal(afterFailed.rollbackGate, undefined);

    // After reverting the change, re-presentation should succeed.
    await writeFile(path.join(root, "src/one/a.txt"), "one v2\n");
    const represented = await rollback.presentRollbackGate(root, "f", afterFailed.revision, "CP-003");
    assert.equal(represented.state.rollbackGate.status, "pending");
  });
});

test("text-token resolution requires later-turn provenance", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);

    // Record a host event BEFORE presenting the gate, simulating a past turn.
    await stateStore.recordHostEvent(root, {
      eventId: "pre-gate-event",
      type: "user-prompt",
      host: "codex",
      text: `${"dummy"} confirm`,
      at: new Date().toISOString(),
    });

    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    await assert.rejects(
      () => rollback.resolveRollbackGateToken(root, "f", presented.revision, pub.id, `${pub.fallback.token} confirm`, "codex", "pre-gate-event"),
      (error) => error.code === "ROLLBACK_GATE_SAME_TURN",
    );
  });
});

test("wrong interactionId or already-resolved interaction is rejected", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    // Resolve once.
    await rollback.resolveRollbackGateElicitation(root, "f", presented.revision, pub.id, "confirm", undefined, "codex");

    // Second resolution should fail because the interaction is already resolved.
    await assert.rejects(
      () => rollback.resolveRollbackGateElicitation(root, "f", state.revision + 2, pub.id, "confirm", undefined, "codex"),
      (error) => error.code === "INTERACTION_ALREADY_RESOLVED" || error.code === "ROLLBACK_GATE_NOT_PENDING",
    );
  });
});

test("STATE_REVISION_CONFLICT when expectedRevision does not match", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);

    await assert.rejects(
      () => rollback.presentRollbackGate(root, "f", 999, "CP-003"),
      (error) => error.code === "STATE_REVISION_CONFLICT",
    );
  });
});

test("text-token with tool-event type is rejected", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    // Record a tool event (not user-prompt) after gate presentation.
    await stateStore.mutate(root, "f", presented.revision, "bump-rev", (draft) => {
      draft.blockingFindings = [];
    });
    await stateStore.recordHostEvent(root, {
      eventId: "tool-callback-event",
      type: "tool", // not user-prompt
      host: "codex",
      text: `${pub.fallback.token} confirm`,
      at: new Date().toISOString(),
    });

    await assert.rejects(
      () => rollback.resolveRollbackGateToken(root, "f", presented.revision + 1, pub.id, `${pub.fallback.token} confirm`, "codex", "tool-callback-event"),
      (error) => error.code === "ROLLBACK_GATE_PROVENANCE_UNAVAILABLE",
    );
  });
});

test("text-token with mismatched reply text is rejected", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    // Record a user-prompt with different reply text after gate presentation.
    await stateStore.mutate(root, "f", presented.revision, "bump-rev", (draft) => {
      draft.blockingFindings = [];
    });
    await stateStore.recordHostEvent(root, {
      eventId: "mismatch-event",
      type: "user-prompt",
      host: "codex",
      text: `some other text`,
      at: new Date().toISOString(),
    });

    await assert.rejects(
      () => rollback.resolveRollbackGateToken(root, "f", presented.revision + 1, pub.id, `${pub.fallback.token} confirm`, "codex", "mismatch-event"),
      (error) => error.code === "ROLLBACK_GATE_REPLY_MISMATCH",
    );
  });
});

test("text-token with missing eventId is rejected", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    await assert.rejects(
      () => rollback.resolveRollbackGateToken(root, "f", presented.revision, pub.id, `${pub.fallback.token} confirm`, "codex", ""),
      (error) => error.code === "ROLLBACK_GATE_PROVENANCE_UNAVAILABLE",
    );
  });
});

test("gate resolved via text-token with post-presentation event succeeds", async () => {
  await withRoot(async (root) => {
    const state = await checkpointedFeature(root);
    const { state: presented, interaction: pub } = await rollback.presentRollbackGate(root, "f", state.revision, "CP-003");

    // Record a host event at a revision AFTER the gate presentation.
    const laterRevision = presented.revision + 1;
    const laterEventId = "post-gate-event-confirm";
    await stateStore.mutate(root, "f", presented.revision, "bump-revision", (draft) => {
      // No-op state change to advance revision.
      draft.blockingFindings = [];
    });
    await stateStore.recordHostEvent(root, {
      eventId: laterEventId,
      type: "user-prompt",
      host: "codex",
      text: `${pub.fallback.token} confirm`,
      at: new Date().toISOString(),
    });

    const final = await rollback.resolveRollbackGateToken(
      root, "f", laterRevision, pub.id, `${pub.fallback.token} confirm`, "codex", laterEventId,
    );
    assert.equal(final.rollbackGate.status, "confirmed");
    assert.ok(final.rollbackGate.confirmedAt);
  });
});
