import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createTinyApp } from "../helpers/fixture-repo.mjs";
import { driveUntil, routeFlowConfig } from "../helpers/route-flow.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const run = promisify(execFile);
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const rollback = await loadSource("plugins/dev-flow/src/core/rollback.ts");

test("tracked in-repository symlink survives checkpoint and is atomically restored by rollback", async () => {
  const fixture = await createTinyApp();
  try {
    await writeFile(path.join(fixture.root, "target-a.js"), "export const target = 'a';\n");
    await writeFile(path.join(fixture.root, "target-b.js"), "export const target = 'b';\n");
    await writeFile(path.join(fixture.root, "src", "one.ts"), "export const one = 0;\n");
    await symlink("../target-a.js", path.join(fixture.root, "src", "two.ts"));
    await run("git", ["add", "target-a.js", "target-b.js", "src/one.ts", "src/two.ts"], { cwd: fixture.root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "symlink baseline"], { cwd: fixture.root });
    await store.initProject(fixture.root, routeFlowConfig);
    const classificationBasis = {
      scopeFacts: ["src/one.ts and src/two.ts"], topologyFacts: ["two implementation units"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [],
      signals: {
        changeSurface: "multi-component", behaviorChange: "bounded-rule", topology: "local", unitCount: 2,
        requirements: "provided-confirmed", operationalRecovery: false, executableRollback: true, upwardLevel: "M",
      },
      controlEnhancements: { checkpoints: "unit-chain", recovery: ["executable-rollback"] },
    };
    let state = await store.startFeature(fixture.root, {
      featureId: "symlink-rollback", host: "codex", level: "M", topology: "local", requirements: "provided-confirmed", classificationBasis,
    });
    const driven = await driveUntil(fixture.root, state.featureId, state, {
      input: { requirements: "provided-confirmed" },
      twoClosures: true,
      unitWriter: async (root, current, unitId) => {
        const file = unitId === "UNIT-001" ? "src/one.ts" : "src/two.ts";
        await store.recordTrustedWriteIntent(root, [file], "codex", `trusted-${unitId}`);
        if (unitId === "UNIT-001") await writeFile(path.join(root, "src", "one.ts"), "export const one = 1;\n");
        if (unitId === "UNIT-002") {
          await rm(path.join(root, "src", "two.ts"));
          await symlink("../target-b.js", path.join(root, "src", "two.ts"));
        }
        await store.recordTrustedWriteOwnership(root, [file], "codex", `trusted-${unitId}`);
        current = await store.readState(root, current.featureId);
        current = await store.reconcileWorkspace(root, current.featureId, current.revision, "codex");
        // 写入后 checkpoint freshness 暂时失效；下一次 driveUntil 循环会立即执行 checkpoint。
        assert.equal(current.evidenceFreshness.checkpoint, "stale");
        return current;
      },
      stopAt: (_action, current) => current.implementationUnits?.length === 2
        && current.implementationUnits.every((unit) => unit.status === "checkpointed"),
    });
    state = driven.state;
    assert.equal(await readlink(path.join(fixture.root, "src", "two.ts")), "../target-b.js");
    const [first, second] = state.implementationUnits;
    assert.ok(first.checkpointId);
    assert.ok(second.checkpointId);
    const presented = await rollback.presentRollbackGate(fixture.root, state.featureId, state.revision, first.checkpointId);
    state = (await store.answer({
      root: fixture.root, featureId: state.featureId, expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "confirm" },
    })).state;
    const result = await rollback.executeRollback(fixture.root, state.featureId, state.revision, first.checkpointId);
    assert.equal(result.outcome, "committed");
    assert.equal(await readlink(path.join(fixture.root, "src", "two.ts")), "../target-a.js");
  } finally { await fixture.dispose(); }
});
