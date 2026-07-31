import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const rollback = await loadSource("plugins/dev-flow/src/policy/rollback.ts");
const types = await loadSource("plugins/dev-flow/src/policy/types.ts");

const sha = (letter) => letter.repeat(64);

const standardMNode = Object.freeze({
  kind: "rollback",
  id: "RU-001",
  tasks: ["TASK-001", "TASK-002"],
  dependsOn: [],
  fileScope: ["src/api/**"],
  covers: ["REQ-001", "AC-001"],
  forwardVerification: ["unit", "typecheck"],
  rollbackVerification: ["unit", "typecheck"],
  sourceArtifact: "implementation-plan",
  sourceSha256: sha("a"),
  sourceAnchor: "<!-- dev-flow:id=RU-001 kind=rollback -->",
  sourceBlockSha256: sha("b"),
  verificationConfigSha256: sha("c"),
  status: "current",
});

const standardLNode = Object.freeze({
  ...standardMNode,
  id: "RU-002",
  tasks: ["TASK-003"],
  dependsOn: ["RU-001"],
  sourceArtifact: "rollback-units",
});

test("fileScope patterns use one canonical safe relative-path contract", () => {
  for (const pattern of ["src", "src/**", "src/*.ts", "."]) {
    assert.equal(rollback.isSafeFileScopePattern(pattern), true, pattern);
  }
  for (const pattern of ["", "   ", " src", "src ", "/etc/passwd", "C:/temp/file", "C:temp/file", "src\\file", "../x", "src/../x", "src//x", "src/./x"]) {
    assert.equal(rollback.isSafeFileScopePattern(pattern), false, pattern);
    assert.equal(rollback.pathWithinFileScope("src/file.ts", [pattern]), false, pattern);
  }
});

test("implementationUnitForRollbackNode derives isomorphic pending units from standard M and L rollback nodes", () => {
  const basisHash = sha("d");
  assert.deepEqual(rollback.implementationUnitForRollbackNode(standardMNode, basisHash), {
    unitId: "RU-001",
    status: "pending",
    basisHash,
  });
  assert.deepEqual(rollback.implementationUnitForRollbackNode(standardLNode, basisHash), {
    unitId: "RU-002",
    status: "pending",
    basisHash,
  });
});

test("implementationUnitForRollbackNode rejects rollback nodes with missing required fields", () => {
  const basisHash = sha("d");
  const cases = [
    { ...standardMNode, id: undefined },
    { ...standardMNode, id: "TASK-001" },
    { ...standardMNode, tasks: undefined },
    { ...standardMNode, tasks: [] },
    { ...standardMNode, fileScope: undefined },
    { ...standardMNode, fileScope: [] },
    { ...standardMNode, forwardVerification: undefined },
    { ...standardMNode, forwardVerification: [] },
    { ...standardMNode, rollbackVerification: undefined },
    { ...standardMNode, rollbackVerification: [] },
    { ...standardMNode, status: "stale" },
    { ...standardMNode, status: "tombstoned" },
  ];
  for (const node of cases) {
    assert.throws(() => rollback.implementationUnitForRollbackNode(node, basisHash), /ROLLBACK_PROTOCOL_INVALID/);
  }
  assert.throws(() => rollback.implementationUnitForRollbackNode(standardMNode, "not-a-hash"), /ROLLBACK_PROTOCOL_INVALID/);
});

test("unit transition table permits the documented lifecycle and rejects skips", () => {
  const valid = [
    ["pending", "active"],
    ["active", "verified"],
    ["verified", "checkpointed"],
    ["verified", "active"],
    ["checkpointed", "rolled_back"],
    // 4A redo edge: a rolled_back unit re-begins as a fresh incarnation.
    ["rolled_back", "active"],
  ];
  for (const [from, to] of valid) {
    assert.equal(rollback.isValidUnitTransition(from, to), true, `${from} -> ${to} must be valid`);
  }
  const invalid = [
    ["pending", "verified"],
    ["pending", "checkpointed"],
    ["pending", "rolled_back"],
    ["pending", "pending"],
    ["active", "checkpointed"],
    ["active", "pending"],
    ["active", "rolled_back"],
    ["verified", "pending"],
    ["verified", "rolled_back"],
    ["checkpointed", "active"],
    ["checkpointed", "pending"],
    ["checkpointed", "verified"],
    ["rolled_back", "pending"],
    ["rolled_back", "verified"],
    ["rolled_back", "checkpointed"],
  ];
  for (const [from, to] of invalid) {
    assert.equal(rollback.isValidUnitTransition(from, to), false, `${from} -> ${to} must be invalid`);
  }
});

test("parseImplementationUnitState enforces closed shape and status-field consistency", () => {
  const basisHash = sha("d");
  assert.deepEqual(rollback.parseImplementationUnitState({ unitId: "RU-001", status: "pending", basisHash }), {
    unitId: "RU-001",
    status: "pending",
    basisHash,
  });
  // Pre-4A checkpointed unit: no beginNonce, still accepted.
  assert.deepEqual(rollback.parseImplementationUnitState({
    unitId: "RU-001",
    status: "checkpointed",
    basisHash,
    startedFingerprint: sha("e"),
    checkpointId: "CP-001",
  }), {
    unitId: "RU-001",
    status: "checkpointed",
    basisHash,
    startedFingerprint: sha("e"),
    checkpointId: "CP-001",
  });
  // 4A unit with beginNonce: preserved on round-trip.
  assert.deepEqual(rollback.parseImplementationUnitState({
    unitId: "RU-001",
    status: "active",
    basisHash,
    startedFingerprint: sha("e"),
    beginNonce: "nonce-1",
  }), {
    unitId: "RU-001",
    status: "active",
    basisHash,
    startedFingerprint: sha("e"),
    beginNonce: "nonce-1",
  });
  assert.deepEqual(rollback.parseImplementationUnitState({
    unitId: "RU-001",
    status: "checkpointed",
    basisHash,
    startedFingerprint: sha("e"),
    checkpointId: "CP-001",
    beginNonce: "nonce-2",
  }), {
    unitId: "RU-001",
    status: "checkpointed",
    basisHash,
    startedFingerprint: sha("e"),
    checkpointId: "CP-001",
    beginNonce: "nonce-2",
  });

  const invalid = [
    // extra caller-controlled fields
    { unitId: "RU-001", status: "pending", basisHash, assuranceLevel: "verified" },
    // malformed identifiers and hashes
    { unitId: "TASK-001", status: "pending", basisHash },
    { unitId: "RU-1", status: "pending", basisHash },
    { unitId: "RU-001", status: "pending", basisHash: "short" },
    { unitId: "RU-001", status: "approved", basisHash },
    // status-field consistency
    { unitId: "RU-001", status: "pending", basisHash, startedFingerprint: sha("e") },
    { unitId: "RU-001", status: "pending", basisHash, checkpointId: "CP-001" },
    { unitId: "RU-001", status: "pending", basisHash, beginNonce: "nonce" },
    { unitId: "RU-001", status: "active", basisHash },
    { unitId: "RU-001", status: "active", basisHash, startedFingerprint: sha("e"), checkpointId: "CP-001" },
    { unitId: "RU-001", status: "verified", basisHash, checkpointId: "CP-001" },
    { unitId: "RU-001", status: "checkpointed", basisHash, startedFingerprint: sha("e") },
    { unitId: "RU-001", status: "checkpointed", basisHash, checkpointId: "CP-001" },
    { unitId: "RU-001", status: "rolled_back", basisHash, startedFingerprint: sha("e") },
    // empty beginNonce is rejected
    { unitId: "RU-001", status: "active", basisHash, startedFingerprint: sha("e"), beginNonce: "" },
    { unitId: "RU-001", status: "active", basisHash, startedFingerprint: sha("e"), beginNonce: "   " },
  ];
  for (const state of invalid) {
    assert.throws(() => rollback.parseImplementationUnitState(state), /ROLLBACK_PROTOCOL_INVALID/);
  }
});

test("parseImplementationUnits rejects duplicate unit IDs, duplicate checkpoint IDs, and unknown units", () => {
  const basisHash = sha("d");
  const known = ["RU-001", "RU-002"];
  const pendingUnit = (unitId) => ({ unitId, status: "pending", basisHash });
  const checkpointedUnit = (unitId, checkpointId) => ({
    unitId,
    status: "checkpointed",
    basisHash,
    startedFingerprint: sha("e"),
    checkpointId,
  });

  assert.deepEqual(rollback.parseImplementationUnits([pendingUnit("RU-001"), checkpointedUnit("RU-002", "CP-002")], known), [
    pendingUnit("RU-001"),
    checkpointedUnit("RU-002", "CP-002"),
  ]);

  assert.throws(
    () => rollback.parseImplementationUnits([pendingUnit("RU-001"), pendingUnit("RU-001")], known),
    /ROLLBACK_PROTOCOL_INVALID/,
  );
  assert.throws(
    () => rollback.parseImplementationUnits([checkpointedUnit("RU-001", "CP-001"), checkpointedUnit("RU-002", "CP-001")], known),
    /ROLLBACK_PROTOCOL_INVALID/,
  );
  assert.throws(
    () => rollback.parseImplementationUnits([pendingUnit("RU-009")], known),
    /ROLLBACK_PROTOCOL_INVALID/,
  );
  assert.throws(() => rollback.parseImplementationUnits({}, known), /ROLLBACK_PROTOCOL_INVALID/);
});

function manifestFixture() {
  return {
    schemaVersion: 1,
    checkpointId: "CP-001",
    unitId: "RU-001",
    sequence: 1,
    basisHash: sha("d"),
    startedFingerprint: sha("e"),
    completedFingerprint: sha("f"),
    startedAt: "2026-07-30T01:00:00.000Z",
    completedAt: "2026-07-30T01:05:00.000Z",
    files: [
      {
        path: "src/api/handler.ts",
        change: "modified",
        beforeSha256: sha("1"),
        afterSha256: sha("2"),
        beforeBlobSha256: sha("3"),
        afterBlobSha256: sha("4"),
        beforeMode: "644",
        afterMode: "644",
      },
      { path: "src/api/added.ts", change: "added", afterSha256: sha("5"), afterBlobSha256: sha("6"), afterMode: "644" },
      { path: "src/api/deleted.ts", change: "deleted", beforeSha256: sha("7"), beforeBlobSha256: sha("8"), beforeMode: "644" },
      {
        path: "src/api/renamed.ts",
        change: "renamed",
        renamedFrom: "src/api/legacy.ts",
        beforeSha256: sha("9"),
        afterSha256: sha("9"),
        beforeBlobSha256: sha("a"),
        afterBlobSha256: sha("a"),
        beforeMode: "644",
        afterMode: "644",
      },
      {
        path: "src/api/script.sh",
        change: "mode-changed",
        beforeSha256: sha("b"),
        afterSha256: sha("b"),
        beforeBlobSha256: sha("c"),
        afterBlobSha256: sha("c"),
        beforeMode: "644",
        afterMode: "755",
      },
    ],
    forwardPatchSha256: sha("0"),
    reversePatchSha256: sha("1"),
    verificationAttempts: [
      {
        attemptId: "ATT-001",
        commandId: "unit",
        command: "npm run test:unit",
        status: "passed",
        startedAt: "2026-07-30T01:01:00.000Z",
        completedAt: "2026-07-30T01:03:00.000Z",
      },
    ],
    requirementsSha256: sha("2"),
    planSha256: sha("3"),
    traceabilitySha256: sha("4"),
    approvalBasisHash: sha("5"),
    projectConfigSha256: sha("6"),
    verificationCommands: [
      { commandId: "unit", command: "npm run test:unit" },
      { commandId: "typecheck", command: "npm run typecheck" },
    ],
  };
}

test("parseCheckpointManifest accepts a complete manifest and preserves every field", () => {
  assert.deepEqual(rollback.parseCheckpointManifest(manifestFixture()), manifestFixture());
});

test("parseCheckpointManifest rejects malformed manifests and per-change file record violations", () => {
  const fixture = manifestFixture();
  const modified = fixture.files[0];
  const added = fixture.files[1];
  const deleted = fixture.files[2];
  const renamed = fixture.files[3];

  const cases = [
    { ...fixture, schemaVersion: 2 },
    { ...fixture, checkpointId: "" },
    { ...fixture, unitId: "TASK-001" },
    { ...fixture, sequence: 0 },
    { ...fixture, forwardPatchSha256: "not-a-hash" },
    { ...fixture, executorId: "forged" },
    { ...fixture, startedAt: "not-a-date" },
    { ...fixture, files: [{ ...modified, beforeSha256: undefined }] },
    { ...fixture, files: [{ ...added, beforeSha256: sha("1") }] },
    { ...fixture, files: [{ ...added, afterSha256: undefined }] },
    { ...fixture, files: [{ ...deleted, afterSha256: sha("2") }] },
    { ...fixture, files: [{ ...deleted, beforeBlobSha256: undefined }] },
    { ...fixture, files: [{ ...renamed, renamedFrom: undefined }] },
    { ...fixture, files: [{ ...modified, renamedFrom: "src/api/legacy.ts" }] },
    { ...fixture, files: [{ ...modified, change: "copied" }] },
    { ...fixture, files: [{ ...modified, afterMode: "999" }] },
    { ...fixture, files: [{ ...modified, extra: true }] },
    { ...fixture, verificationAttempts: [{ ...fixture.verificationAttempts[0], status: "skipped" }] },
    { ...fixture, verificationAttempts: [{ ...fixture.verificationAttempts[0], commandId: "e2e" }] },
    { ...fixture, verificationCommands: [] },
    { ...fixture, verificationCommands: [{ commandId: "unit", command: "npm run test:unit", extra: true }] },
  ];
  for (const manifest of cases) {
    assert.throws(() => rollback.parseCheckpointManifest(manifest), /ROLLBACK_PROTOCOL_INVALID/);
  }
});

test("checkpoint schema closes unit status, file change kinds, and manifest shape", async () => {
  const schema = JSON.parse(await readFile(path.join(process.cwd(), "plugins/dev-flow/policy/checkpoint.schema.json"), "utf8"));
  assert.deepEqual(schema.$defs.implementationUnitStatus.enum, ["pending", "active", "verified", "checkpointed", "rolled_back"]);
  assert.deepEqual(schema.$defs.checkpointFileChange.enum, ["added", "modified", "deleted", "renamed", "mode-changed"]);
  assert.equal(schema.$defs.implementationUnitState.additionalProperties, false);
  assert.deepEqual(schema.$defs.implementationUnitState.required, ["unitId", "status", "basisHash"]);
  assert.equal(schema.$defs.checkpointManifest.additionalProperties, false);
  assert.equal(schema.$defs.checkpointFileRecord.additionalProperties, false);
  assert.equal(schema.$defs.checkpointVerificationAttempt.additionalProperties, false);
  assert.equal(schema.$defs.checkpointManifest.properties.schemaVersion.const, 1);
  assert.equal(schema.$defs.checkpointManifest.properties.sequence.minimum, 1);
});

test("Task 2 releases checkpoints:1 only for features started after phase 3", () => {
  assert.equal(types.SUPPORTED_WORKFLOW_CAPABILITIES.checkpoints, 1);
});
