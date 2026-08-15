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
    unitId: "UNIT-001",
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
      unitId: "UNIT-001", status: "checkpointed", basisHash: sha("1"),
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

test("high-impact governance changes are scoped to an active feature and unblocked by pausing", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const raw = await readFile(`${fixture.root}/.dev-flow/project.json`);
    const expectedSha256 = createHash("sha256").update(raw).digest("hex");

    // 没有任何 feature 时治理变更允许：否则初始化后 governedRoots/preflight
    // 永远无法调整，形成「policy 死宽度」。
    const governance = structuredClone(strictProjectConfig);
    governance.governedRoots = ["src"];
    const allowed = await store.updateProjectConfig(fixture.root, governance, expectedSha256);
    assert.equal(allowed.impact.governanceChanged, true);

    // 有 active feature 时治理变更为高影响：拒绝且同一调用可在暂停后重试。
    const started = await store.startFeature(fixture.root, { featureId: "high-impact", host: "codex", level: "XS", topology: "local" });
    const rawBeforeBlock = await readFile(`${fixture.root}/.dev-flow/project.json`);
    const blockedSha256 = createHash("sha256").update(rawBeforeBlock).digest("hex");
    const governance2 = structuredClone(governance);
    governance2.governedRoots = ["src", "test"];
    await assert.rejects(
      () => store.updateProjectConfig(fixture.root, governance2, blockedSha256),
      (error) => error.code === "PROJECT_CONFIG_HIGH_IMPACT"
        && error.details.retryOriginal === true
        && error.details.activeFeatureId === "high-impact",
    );

    // 暂停后重试同一调用成功；配置被写入且证据保持原样。
    const paused = await store.pauseFeature(fixture.root, "high-impact", started.revision, "更新治理配置前暂停", "codex");
    assert.equal(paused.lifecycle, "paused");
    const updated = await store.updateProjectConfig(fixture.root, governance2, blockedSha256);
    assert.equal(updated.previousSha256, blockedSha256);
    assert.equal(updated.impact.governanceChanged, true);
    assert.equal(updated.affectedEvidence.commandIds.length, 0);

    // preflight 变更走同一门禁：active 时拒绝，暂停后允许。
    // （保留一个非 preflight 命令提供 targeted，避免先被保证集校验拦截。）
    const rawBeforePreflight = await readFile(`${fixture.root}/.dev-flow/project.json`);
    const preflightSha256 = createHash("sha256").update(rawBeforePreflight).digest("hex");
    const withPreflight = structuredClone(governance2);
    withPreflight.verification.commands.push({
      id: "build", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"],
    });
    withPreflight.verification.preflightCommands = ["unit"];
    const preflightStarted = await store.startFeature(fixture.root, { featureId: "preflight-gate", host: "codex", level: "XS", topology: "local" });
    await assert.rejects(
      () => store.updateProjectConfig(fixture.root, withPreflight, preflightSha256),
      (error) => error.code === "PROJECT_CONFIG_HIGH_IMPACT",
    );
    await store.pauseFeature(fixture.root, "preflight-gate", preflightStarted.revision, "更新 preflight 前暂停", "codex");
    const preflightUpdated = await store.updateProjectConfig(fixture.root, withPreflight, preflightSha256);
    assert.equal(preflightUpdated.impact.preflightChanged, true);
  } finally { await fixture.dispose(); }
});

test("adding a full-guarantee command while a paused feature exists is a scoped command update", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "paused-full-gap", host: "codex", level: "XS", topology: "local" });
    await store.pauseFeature(fixture.root, "paused-full-gap", started.revision, "等待补齐 full 保证", "codex");
    const raw = await readFile(`${fixture.root}/.dev-flow/project.json`);
    const next = structuredClone(strictProjectConfig);
    next.verification.commands.push({
      id: "test-full", command: process.execPath, args: ["--test", "--full"], cwd: ".", provides: ["full"],
    });
    const updated = await store.updateProjectConfig(fixture.root, next, createHash("sha256").update(raw).digest("hex"));
    assert.deepEqual(updated.impact.addedCommandIds, ["test-full"]);
    assert.equal(updated.impact.governanceChanged, false);
    assert.equal(updated.impact.preflightChanged, false);
    // 新命令未被任何证据引用：受影响证据为空，不整包失效。
    assert.deepEqual(updated.affectedEvidence, {
      commandIds: [],
      traceNodeIds: [],
      checkpointIds: [],
      verificationAttemptIds: [],
      reviewRoles: [],
    });
  } finally { await fixture.dispose(); }
});
