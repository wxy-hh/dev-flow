import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createTinyApp } from "../helpers/fixture-repo.mjs";
import { driveUntil, routeFlowConfig } from "../helpers/route-flow.mjs";
import { loadSource } from "../helpers/load-source.mjs";

// ADR-0019：rollback-confirmation 只经 `answer` 落账。这里在 answer 层覆盖
// 门禁证明分支：stale 清理、later-turn 文本凭证、宿主不匹配、非 user-prompt、
// 文本不兼容，以及 confirm / request-changes 两条 apply 路径。

const run = promisify(execFile);
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const rollback = await loadSource("plugins/dev-flow/src/core/rollback.ts");

/**
 * 经生产 next 驱动构建 standard-m feature：两个链式实现单元全部 checkpointed，
 * 回撤门禁可指向第一个 checkpoint（undo 第二单元）。
 */
async function checkpointedFeature(fixture) {
  await writeFile(path.join(fixture.root, "src/one.ts"), "export const one = 0;\n");
  await writeFile(path.join(fixture.root, "src/two.ts"), "export const two = 0;\n");
  await run("git", ["add", "src/one.ts", "src/two.ts"], { cwd: fixture.root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "rollback fixture baseline"], { cwd: fixture.root });
  await store.initProject(fixture.root, routeFlowConfig);
  const classificationBasis = {
    scopeFacts: ["src/one.ts and src/two.ts"], topologyFacts: ["two implementation units"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [],
    signals: {
      changeSurface: "multi-component", behaviorChange: "bounded-rule", topology: "local", unitCount: 2,
      requirements: "provided-confirmed", operationalRecovery: false, executableRollback: true, upwardLevel: "M",
    },
    controlEnhancements: { checkpoints: "unit-chain", recovery: ["executable-rollback"] },
  };
  const state = await store.startFeature(fixture.root, {
    featureId: "f", host: "codex", level: "M", topology: "local", requirements: "provided-confirmed", classificationBasis,
  });
  const driven = await driveUntil(fixture.root, state.featureId, state, {
    input: { requirements: "provided-confirmed" },
    twoClosures: true,
    unitWriter: async (root, current, unitId) => {
      const file = unitId === "UNIT-001" ? "src/one.ts" : "src/two.ts";
      await store.recordTrustedWriteIntent(root, [file], "codex", `trusted-${unitId}`);
      await writeFile(path.join(root, file), `export const ${unitId === "UNIT-001" ? "one" : "two"} = 1;\n`);
      await store.recordTrustedWriteOwnership(root, [file], "codex", `trusted-${unitId}`);
      current = await store.readState(root, current.featureId);
      return store.reconcileWorkspace(root, current.featureId, current.revision, "codex");
    },
    stopAt: (_action, current) => current.implementationUnits?.length === 2
      && current.implementationUnits.every((unit) => unit.status === "checkpointed"),
  });
  const [first] = driven.state.implementationUnits;
  assert.ok(first.checkpointId);
  return { state: driven.state, targetCheckpointId: first.checkpointId };
}

async function withFeature(runTest) {
  const fixture = await createTinyApp();
  try {
    return await runTest(fixture.root, await checkpointedFeature(fixture));
  } finally {
    await fixture.dispose();
  }
}

test("elicitation confirm 经 answer 落账：门禁 confirmed、交互 resolved", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    const result = await store.answer({
      root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "confirm" },
    });
    assert.equal(result.action, "confirm");
    assert.equal(result.state.rollbackGate.status, "confirmed");
    assert.ok(result.state.rollbackGate.confirmedAt, "confirmedAt must be set");
    assert.equal(result.state.rollbackGate.interactionId, presented.interactionId);
    const resolved = result.state.interactions[presented.interactionId];
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.response.action, "confirm");
  });
});

test("elicitation request-changes 经 answer 清门禁并允许重新呈现", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    const returned = await store.answer({
      root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "request-changes", comment: "需要重新审查范围" },
    });
    assert.equal(returned.action, "request-changes");
    assert.equal(returned.state.rollbackGate, undefined);
    assert.equal(returned.state.interactions[presented.interactionId], undefined, "request-changes 清除目标交互");

    // Re-presentation should work.
    const represented = await rollback.presentRollbackGate(root, "f", returned.state.revision, targetCheckpointId);
    assert.equal(represented.state.rollbackGate.status, "pending");
  });
});

test("依据已变时 answer 失败并清门禁，修复后可重新呈现", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    // Modify a file tracked by the chain tip — this changes the preview basis.
    await writeFile(path.join(root, "src/two.ts"), "unauthorized change\n");

    await assert.rejects(
      () => store.answer({
        root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
        credential: { source: "elicitation", action: "confirm" },
      }),
      (error) => error.code === "ROLLBACK_GATE_BASIS_CHANGED",
    );

    // Gate must have been cleared from state.
    const afterFailed = await store.readState(root, "f");
    assert.equal(afterFailed.rollbackGate, undefined);

    // After reverting the change, re-presentation should succeed.
    await writeFile(path.join(root, "src/two.ts"), "export const two = 1;\n");
    const represented = await rollback.presentRollbackGate(root, "f", afterFailed.revision, targetCheckpointId);
    assert.equal(represented.state.rollbackGate.status, "pending");
  });
});

test("文本凭证绑定呈现之后的用户事件：门禁 confirmed", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    // Record a host event at a revision AFTER the gate presentation.
    const bumped = await store.mutate(root, "f", presented.state.revision, "bump-revision", (draft) => {
      draft.objective = "bump for later-turn proof";
    });
    await store.recordHostEvent(root, {
      eventId: "post-gate-event-confirm",
      type: "user-prompt",
      host: "codex",
      text: "确认回撤",
      at: new Date().toISOString(),
    });

    const result = await store.answerFromHostEvents({
      root, featureId: "f", expectedRevision: bumped.revision, host: "codex",
    });
    assert.equal(result.action, "confirm");
    assert.equal(result.state.rollbackGate.status, "confirmed");
    assert.ok(result.state.rollbackGate.confirmedAt);
    const resolved = result.state.interactions[presented.interactionId];
    assert.equal(resolved.response.promptEventId, "post-gate-event-confirm");
  });
});

test("呈现之前的用户事件不能确认门禁（later-turn 证明失败关闭）", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    // Record a host event BEFORE presenting the gate, simulating a past turn.
    await store.recordHostEvent(root, {
      eventId: "pre-gate-event",
      type: "user-prompt",
      host: "codex",
      text: "确认回撤",
      at: new Date().toISOString(),
    });
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
      }),
      (error) => error.code === "INTERACTION_EVENT_MISSING",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, presented.state.revision, "失败不得推进 revision");
    assert.equal(unchanged.rollbackGate.status, "pending");
  });
});

test("来自其他宿主的用户事件不能确认门禁", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    const bumped = await store.mutate(root, "f", presented.state.revision, "bump-revision", (draft) => {
      draft.objective = "bump for host-mismatch proof";
    });
    await store.recordHostEvent(root, {
      eventId: "other-host-event",
      type: "user-prompt",
      host: "claude",
      text: "确认回撤",
      at: new Date().toISOString(),
    });

    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: bumped.revision, host: "codex",
      }),
      (error) => error.code === "INTERACTION_EVENT_MISSING",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.rollbackGate.status, "pending");
  });
});

test("工具事件不能确认门禁（非 user-prompt 失败关闭）", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    const bumped = await store.mutate(root, "f", presented.state.revision, "bump-revision", (draft) => {
      draft.objective = "bump for tool-event proof";
    });
    await store.recordHostEvent(root, {
      eventId: "tool-callback-event",
      type: "tool",
      host: "codex",
      text: "确认回撤",
      at: new Date().toISOString(),
    });

    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: bumped.revision, host: "codex",
      }),
      (error) => error.code === "INTERACTION_EVENT_MISSING",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.rollbackGate.status, "pending");
  });
});

test("文本与捕获事件不兼容时拒绝且门禁保持 pending", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    const bumped = await store.mutate(root, "f", presented.state.revision, "bump-revision", (draft) => {
      draft.objective = "bump for mismatch proof";
    });
    await store.recordHostEvent(root, {
      eventId: "mismatch-event",
      type: "user-prompt",
      host: "codex",
      text: "一些无关的话",
      at: new Date().toISOString(),
    });

    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: bumped.revision, host: "codex",
      }),
      (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.rollbackGate.status, "pending");
  });
});

test("已确认后再次 answer 失败关闭（INTERACTION_NOT_PENDING），门禁保持 confirmed", async () => {
  await withFeature(async (root, { state, targetCheckpointId }) => {
    const presented = await rollback.presentRollbackGate(root, "f", state.revision, targetCheckpointId);

    const confirmed = await store.answer({
      root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "confirm" },
    });
    await assert.rejects(
      () => store.answer({
        root, featureId: "f", expectedRevision: confirmed.state.revision, host: "codex",
        credential: { source: "elicitation", action: "confirm" },
      }),
      (error) => error.code === "INTERACTION_NOT_PENDING",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, confirmed.state.revision);
    assert.equal(unchanged.rollbackGate.status, "confirmed");
  });
});
