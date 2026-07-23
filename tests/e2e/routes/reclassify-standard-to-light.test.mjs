import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("e2e standard-M downgrades to light-M and next is boundary_plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-e2e-reclass-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "x.js"), "export {}\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "feature",
      host: "claude",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "missing-or-unclear",
    });
    assert.equal(state.route, "standard-m");
    state = await store.reclassifyFeature(
      root,
      "feature",
      state.revision,
      { level: "M", topology: "local", execution: "light" },
      "too heavy for visual tweak",
      "太重了，改 light",
    );
    assert.equal(state.route, "light-m");
    const action = await next.nextAction(root, "feature");
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "boundary_plan");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
