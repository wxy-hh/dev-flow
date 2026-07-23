import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("reclassification only becomes stricter and invalidates downstream evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-reclassify-"));
  try {
    await store.initProject(root, config);
    const feature = await store.startFeature(root, { featureId: "m", level: "M", topology: "local", execution: "light", host: "claude" });
    const raised = await store.reclassifyFeature(root, "m", feature.revision, { level: "M", topology: "local", execution: "light", riskLabels: ["security"] }, "security impact found");
    assert.equal(raised.route, "risk-minimal");
    assert.equal(raised.logicComplete, false);
    await assert.rejects(
      () => store.reclassifyFeature(root, "m", raised.revision, { level: "XS", topology: "local" }, "downgrade"),
      /RECLASSIFICATION_DOWNGRADE_FORBIDDEN|RECLASSIFICATION_NOT_STRICTER/,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standard-M can downgrade to light-M with userEvidence before implementation approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-reclassify-down-"));
  try {
    await store.initProject(root, config);
    await writeFile(path.join(root, "src", "keep.txt"), "x\n", { flag: "a" }).catch(async () => {
      await (await import("node:fs/promises")).mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src", "keep.txt"), "x\n");
    });
    let state = await store.startFeature(root, {
      featureId: "m", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear", host: "claude",
    });
    assert.ok(state.startBusinessFingerprint);
    state = await artifacts.scaffoldArtifact(root, "m", state.revision, "requirements");
    const lowered = await store.reclassifyFeature(
      root,
      "m",
      state.revision,
      { level: "M", topology: "local", execution: "light" },
      "too heavy",
      "太重了，改 light",
    );
    assert.equal(lowered.route, "light-m");
    assert.ok(lowered.reclassifyNotice);
    assert.equal(lowered.artifacts.requirements, undefined);
    const events = await store.readFeatureEvents(root, "m");
    const last = events.at(-1);
    assert.equal(last.type, "reclassified");
    assert.equal(last.data.userEvidence, "太重了，改 light");
    assert.equal(last.data.nextRoute, "light-m");
    // physical file may still exist from scaffold
    await readFile(path.join(root, ".dev-flow", "features", "m", "requirements.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("downgrade rejects presented approval, missing evidence, fingerprint change, and M→S", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-reclassify-reject-"));
  try {
    await store.initProject(root, config);
    await (await import("node:fs/promises")).mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.txt"), "1\n");
    let state = await store.startFeature(root, {
      featureId: "m", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed", host: "claude",
    });
    await assert.rejects(
      () => store.reclassifyFeature(root, "m", state.revision, { level: "M", topology: "local", execution: "light" }, "x"),
      (error) => error.code === "RECLASSIFICATION_EVIDENCE_REQUIRED",
    );
    await assert.rejects(
      () => store.reclassifyFeature(root, "m", state.revision, { level: "S", topology: "local" }, "x", "user"),
      (error) => error.code === "RECLASSIFICATION_DOWNGRADE_FORBIDDEN",
    );

    const file = path.join(root, ".dev-flow", "features", "m", "state.json");
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.humanGates = { implementation_approval: { status: "pending" } };
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    state = await store.readState(root, "m");
    await assert.rejects(
      () => store.reclassifyFeature(root, "m", state.revision, { level: "M", topology: "local", execution: "light" }, "x", "user"),
      (error) => error.code === "RECLASSIFICATION_DOWNGRADE_FORBIDDEN",
    );

    // reset gates and change protected fingerprint
    raw.humanGates = {};
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    state = await store.readState(root, "m");
    await writeFile(path.join(root, "src", "a.txt"), "changed\n");
    await assert.rejects(
      () => store.reclassifyFeature(root, "m", state.revision, { level: "M", topology: "local", execution: "light" }, "x", "user"),
      (error) => error.code === "RECLASSIFICATION_PROTECTED_ROOTS_CHANGED",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("downgrade rejects historical implementation approval and unreadable event history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-reclassify-history-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "m", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed", host: "claude",
    });
    const events = path.join(root, ".dev-flow", "features", "m", "events.jsonl");
    await writeFile(events, `${JSON.stringify({ revision: state.revision, type: "gate-presented", at: new Date().toISOString(), data: { gate: "implementation_approval" } })}\n`, { flag: "a" });
    await assert.rejects(
      () => store.reclassifyFeature(root, "m", state.revision, { level: "M", topology: "local", execution: "light" }, "x", "user"),
      (error) => error.code === "RECLASSIFICATION_DOWNGRADE_FORBIDDEN",
    );

    await writeFile(events, "not-json\n", { flag: "a" });
    await assert.rejects(
      () => store.reclassifyFeature(root, "m", state.revision, { level: "M", topology: "local", execution: "light" }, "x", "user"),
      (error) => error.code === "RECLASSIFICATION_HISTORY_UNREADABLE",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});
