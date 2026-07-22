import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

test("enforces one active feature, paused creation, switch, abandon and CAS", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-state-"));
  try {
    await store.initProject(root, config);
    const first = await store.startFeature(root, { level: "XS", topology: "local", host: "claude", featureId: "a" });
    await assert.rejects(() => store.startFeature(root, { level: "XS", topology: "local", host: "codex", featureId: "b" }), /ACTIVE_FEATURE_CONFLICT/);
    const paused = await store.startFeature(root, { level: "XS", topology: "local", host: "codex", featureId: "b", activation: "paused" });
    assert.equal(paused.lifecycle, "paused");
    await store.switchActive(root, "a", "b", "handoff");
    assert.equal((await store.readState(root, "a")).lifecycle, "paused");
    const active = await store.readState(root, "b"); assert.equal(active.lifecycle, "active");
    await assert.rejects(() => store.mutate(root, "b", 0, "test", () => {}), /STATE_REVISION_CONFLICT/);
    const abandoned = await store.abandonFeature(root, "b", active.revision, "cancelled", "user asked to cancel");
    assert.equal(abandoned.lifecycle, "abandoned");
  } finally { await rm(root, { recursive: true, force: true }); }
});
