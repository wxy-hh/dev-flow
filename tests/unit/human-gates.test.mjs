import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

test("human confirmation is explicit, later, and tied to the artifact basis", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-gate-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" });
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), /STEP_OUT_OF_ORDER/);
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const file = path.join(root, ".dev-flow", "features", "f", "requirements.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
    state = await (await loadSource("plugins/dev-flow/src/core/feature-check.ts")).recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await assert.rejects(() => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "", { promptEventId: "p1" }, "claude"), /HUMAN_GATE_REPLY_REQUIRED/);
    await assert.rejects(() => gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "approved", {}, "claude"), /HUMAN_GATE_PROVENANCE_UNAVAILABLE/);
    await store.recordHostEvent(root, { eventId: "p1", type: "user-prompt", host: "claude", text: "approved" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "approved", { promptEventId: "p1" }, "claude");
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
  } finally { await rm(root, { recursive: true, force: true }); }
});
