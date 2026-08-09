import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const projectConfig = await loadSource("plugins/dev-flow/src/core/project-config.ts");

const sha = (letter) => letter.repeat(64);

function checkpointManifest() {
  return {
    schemaVersion: 2,
    checkpointId: "CP-001",
    unitId: "RU-001",
    sequence: 1,
    basisHash: sha("1"),
    startedFingerprint: sha("2"),
    completedFingerprint: sha("3"),
    startedAt: "2026-08-09T01:00:00.000Z",
    completedAt: "2026-08-09T01:01:00.000Z",
    files: [],
    forwardPatchSha256: sha("4"),
    reversePatchSha256: sha("5"),
    verificationAttempts: [],
    requirementsSha256: sha("6"),
    planSha256: sha("7"),
    traceabilitySha256: sha("8"),
    approvalBasisHash: sha("9"),
    projectConfigSha256: sha("a"),
    verificationCommands: [{ commandId: "unit", command: "node --test" }],
    verificationCommandHashes: { unit: sha("b") },
  };
}

async function activeEvidenceFixture(root) {
  const started = await store.startFeature(root, { featureId: "config-impact", host: "codex", level: "XS", topology: "local" });
  await store.mutate(root, "config-impact", started.revision, "test-evidence", (draft) => {
    draft.verification.attempts = [{ id: 7, verificationCommandHashes: { unit: sha("b") } }];
    draft.implementationUnits = [{
      unitId: "RU-001", status: "checkpointed", basisHash: sha("1"),
      startedFingerprint: sha("2"), checkpointId: "CP-001",
    }];
  });
  const directory = `${root}/.dev-flow/features/config-impact/checkpoints/manifests`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/CP-001.json`, `${JSON.stringify(checkpointManifest(), null, 2)}\n`);
}

test("project configuration update uses sha256 CAS and init never overwrites a changed config", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await assert.doesNotReject(() => store.initProject(fixture.root, structuredClone(strictProjectConfig)));
    const raw = await readFile(`${fixture.root}/.dev-flow/project.json`);
    const expectedSha256 = createHash("sha256").update(raw).digest("hex");
    const nextConfig = structuredClone(strictProjectConfig);
    nextConfig.verification.commands[0].args = ["--test", "--changed-command-argument"];
    const updated = await store.updateProjectConfig(fixture.root, nextConfig, expectedSha256);
    assert.equal(updated.previousSha256, expectedSha256);
    assert.notEqual(updated.sha256, expectedSha256);
    assert.deepEqual(updated.impact.modifiedCommandIds, ["unit"]);
    assert.deepEqual(updated.impact.addedCommandIds, []);
    assert.equal(updated.impact.verificationCapabilityChanged, false);
    await assert.rejects(
      () => store.updateProjectConfig(fixture.root, strictProjectConfig, expectedSha256),
      (error) => error.code === "PROJECT_CONFIG_REVISION_CONFLICT"
        && error.details.currentSha256 === updated.sha256,
    );
    await assert.rejects(
      () => store.initProject(fixture.root, strictProjectConfig),
      (error) => error.code === "PROJECT_CONFIG_UPDATE_REQUIRED",
    );
  } finally { await fixture.dispose(); }
});

test("project configuration impact separates additive commands and capability-only changes", () => {
  const additive = structuredClone(strictProjectConfig);
  additive.verification.commands.push({
    id: "lint", command: process.execPath, args: ["--version"], cwd: ".", provides: ["targeted"],
  });
  const addedImpact = projectConfig.projectConfigImpact(strictProjectConfig, additive);
  assert.deepEqual(addedImpact.addedCommandIds, ["lint"]);
  assert.deepEqual(addedImpact.changedCommandIds, ["lint"]);
  assert.equal(addedImpact.verificationCapabilityChanged, true);

  const capabilityOnly = structuredClone(strictProjectConfig);
  capabilityOnly.verification.commands[0].provides = ["targeted", "behavior"];
  const capabilityImpact = projectConfig.projectConfigImpact(strictProjectConfig, capabilityOnly);
  assert.deepEqual(capabilityImpact.modifiedCommandIds, []);
  assert.deepEqual(capabilityImpact.capabilityOnlyCommandIds, ["unit"]);
  assert.deepEqual(capabilityImpact.changedCommandIds, ["unit"]);
  assert.equal(capabilityImpact.verificationCapabilityChanged, true);
});

test("configuration update reports affected verification attempts and checkpoints", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await activeEvidenceFixture(fixture.root);
    const raw = await readFile(`${fixture.root}/.dev-flow/project.json`);
    const expectedSha256 = createHash("sha256").update(raw).digest("hex");
    const next = structuredClone(strictProjectConfig);
    next.verification.commands[0].args = ["--test", "--changed"];
    const result = await store.updateProjectConfig(fixture.root, next, expectedSha256);
    assert.deepEqual(result.affectedEvidence.commandIds, ["unit"]);
    assert.deepEqual(result.affectedEvidence.verificationAttemptIds, [7]);
    assert.deepEqual(result.affectedEvidence.checkpointIds, ["CP-001"]);
  } finally { await fixture.dispose(); }
});

test("configuration update fails closed when referenced checkpoint evidence is corrupt", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await activeEvidenceFixture(fixture.root);
    const file = `${fixture.root}/.dev-flow/project.json`;
    const before = await readFile(file, "utf8");
    await writeFile(`${fixture.root}/.dev-flow/features/config-impact/checkpoints/manifests/CP-001.json`, "{broken");
    const next = structuredClone(strictProjectConfig);
    next.verification.commands[0].args = ["--test", "--changed"];
    await assert.rejects(
      () => store.updateProjectConfig(fixture.root, next, createHash("sha256").update(before).digest("hex")),
      (error) => error.code === "CHECKPOINT_INTEGRITY_FAILED",
    );
    assert.equal(await readFile(file, "utf8"), before);
  } finally { await fixture.dispose(); }
});
