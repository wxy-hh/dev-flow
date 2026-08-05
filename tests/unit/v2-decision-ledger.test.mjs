import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("grillme in intake records and resolves a decision without a requirements document", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-grill-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  const started = await state.startFeature(root, { featureId: "f", objective: "澄清一个需求", host: "codex" });
  const presented = await grill.requestGrillDecision(root, "f", started.revision, {
    questionId: "DEC-001", question: "是否保留现有兼容行为？", options: [
      { id: "keep", label: "保留" }, { id: "remove", label: "移除" },
    ], host: "codex",
  });
  assert.equal(presented.state.mode, "intake");
  const resolved = await grill.resolveGrillElicitation(root, "f", presented.state.revision, presented.interactionId, "keep", undefined, "codex");
  assert.equal(resolved.state.decisionLedger[0].status, "resolved");
});
