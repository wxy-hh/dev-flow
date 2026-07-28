# Dev Flow Rollback Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn plan rollback units into implementation-time checkpoints that can safely restore the feature to any confirmed unit boundary without using `git reset --hard`.

**Architecture:** The route keeps one implementation step, while Core manages an ordered implementation-unit sub-state machine. Each checkpoint stores before/after file metadata and content-addressed blobs. Rollback is previewed, approved through a basis-bound human interaction, executed through a resumable file transaction, and followed by configured rollback verification.

**Tech Stack:** TypeScript 5.9, Node.js 20+, filesystem atomic rename/fsync, Git read-only inspection, JSON Schema 2020-12, esbuild, `node:test`.

## Global Constraints

- This plan starts after traceability and adaptive review jobs are released.
- Version 1 rollback supports only suffix rollback to a confirmed checkpoint.
- Core never uses `git reset --hard`, changes HEAD, stages files, or commits.
- A file whose current hash differs from the expected chain tip produces `ROLLBACK_CONFLICT` and is not overwritten.
- Checkpoint and transaction files are MCP-owned control files.
- Existing finalize delivery snapshots remain the feature-level rollback artifact.
- No runtime npm dependencies may be added.

---

### Task 1: Define rollback-unit and checkpoint schemas

**Files:**
- Modify: `plugins/dev-flow/src/policy/types.ts`
- Create: `plugins/dev-flow/policy/checkpoint.schema.json`
- Create: `plugins/dev-flow/policy/rollback-transaction.schema.json`
- Create: `tests/unit/rollback-policy.test.mjs`

**Interfaces:**
- Produces: `RollbackUnit`, `ImplementationUnitState`, `CheckpointManifest`, `CheckpointFile`, `RollbackTransaction`.

- [ ] **Step 1: Write failing schema/type behavior tests**

Assert duplicate RU IDs, cyclic dependencies, empty verification command lists, absolute file scopes, and unknown properties are rejected.

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/rollback-policy.test.mjs`

Expected: FAIL because the schemas and validators are absent.

- [ ] **Step 3: Add exact types**

```ts
export interface RollbackUnit {
  id: string;
  tasks: string[];
  dependsOn: string[];
  fileScope: string[];
  covers: string[];
  forwardVerification: string[];
  rollbackVerification: string[];
}

export interface ImplementationUnitState {
  unitId: string;
  status: "pending" | "active" | "verified" | "checkpointed" | "rolled_back";
  startedFingerprint?: string;
  checkpointId?: string;
}

export interface CheckpointFile {
  path: string;
  changeKind: "added" | "modified" | "deleted" | "renamed" | "mode-changed";
  renamedFrom?: string;
  beforeSha256: string | "missing";
  afterSha256: string | "missing";
  beforeBlob?: string;
  afterBlob?: string;
  beforeMode?: number;
  afterMode?: number;
}
```

Define `CheckpointManifest` with checkpoint/unit IDs, sequence, basis hash, start/end fingerprints, files, patch hashes, attempts, and timestamps.

- [ ] **Step 4: Implement DAG and scope validation**

Use a Kahn topological sort. Normalize scopes to project-relative POSIX paths; reject `..`, absolute paths, `.dev-flow`, empty arrays, and duplicate command IDs.

- [ ] **Step 5: Run checks and commit**

Run: `node --test tests/unit/rollback-policy.test.mjs && npm run typecheck`

Expected: PASS.

```bash
git add plugins/dev-flow/src/policy/types.ts plugins/dev-flow/policy/checkpoint.schema.json plugins/dev-flow/policy/rollback-transaction.schema.json tests/unit/rollback-policy.test.mjs
git commit -m "feat(dev-flow): define rollback checkpoint schemas"
```

### Task 2: Add implementation-unit lifecycle and Hook file scopes

**Files:**
- Create: `plugins/dev-flow/src/core/implementation-units.ts`
- Modify: `plugins/dev-flow/src/core/state-store.ts`
- Modify: `plugins/dev-flow/src/hosts/adapter-policy.ts`
- Create: `tests/unit/implementation-units.test.mjs`
- Modify: `tests/unit/adapter-policy.test.mjs`

**Interfaces:**
- Produces: `initializeImplementationUnits`, `beginImplementationUnit`, `activeImplementationUnit`, `matchesUnitScope`.

- [ ] **Step 1: Write failing lifecycle tests**

Test that RU-002 cannot begin before RU-001 is checkpointed, only one unit can be active, stale plan/review/approval prevents begin, and begin stores the current fingerprint.

- [ ] **Step 2: Write failing Hook scope tests**

With RU-001 active and `fileScope: ["src/api/**"]`, `Write src/api/client.ts` must pass and `Write src/ui/view.ts` must return `DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE`.

- [ ] **Step 3: Run focused tests**

Run: `node --test tests/unit/implementation-units.test.mjs tests/unit/adapter-policy.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Add state summary**

```ts
implementationUnits?: {
  basisHash: string;
  order: string[];
  units: Record<string, ImplementationUnitState>;
  activeUnitId?: string;
  latestCheckpointId?: string;
};
```

Initialize it when implementation first opens by reading current RU nodes from traceability and validating the DAG.

- [ ] **Step 5: Implement scope matching**

Support exact paths and terminal `/**` directory prefixes only. Do not add a general glob dependency.

```ts
export function matchesUnitScope(file: string, scopes: string[]): boolean {
  return scopes.some((scope) => scope.endsWith("/**")
    ? file.startsWith(scope.slice(0, -3) + "/")
    : file === scope);
}
```

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/unit/implementation-units.test.mjs tests/unit/adapter-policy.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/core/implementation-units.ts plugins/dev-flow/src/core/state-store.ts plugins/dev-flow/src/hosts/adapter-policy.ts tests/unit/implementation-units.test.mjs tests/unit/adapter-policy.test.mjs
git commit -m "feat(dev-flow): enforce implementation unit scopes"
```

### Task 3: Create content-addressed checkpoints

**Files:**
- Create: `plugins/dev-flow/src/core/checkpoints.ts`
- Modify: `plugins/dev-flow/src/core/implementation-units.ts`
- Create: `tests/unit/checkpoints.test.mjs`

**Interfaces:**
- Produces: `checkpointImplementationUnit`, `readCheckpoint`, `checkpointChain`, `blobPath`.

- [ ] **Step 1: Write failing file-kind tests**

Cover tracked text modification, binary modification, untracked addition, deletion, Git-detected rename with `renamedFrom`, and executable-bit change. Assert equal content writes no duplicate blob.

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/checkpoints.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement the blob store**

Store blobs at:

```text
.dev-flow/features/<id>/checkpoints/blobs/<sha256>
```

Write with `wx`, fsync the file, and verify an existing blob hash before reuse. A blob filename is always the SHA-256 of its bytes.

- [ ] **Step 4: Capture before and after**

At begin-unit, save the start manifest for paths currently in scope. At checkpoint, combine Git status inspection and scope traversal to find changes. Require every changed protected file since the previous checkpoint to belong to the active scope. Record before/after bytes and mode.

- [ ] **Step 5: Run forward verification**

Reuse configured verification command execution through a shared command runner extracted from `verification.ts`. Store attempts on the checkpoint. A non-zero exit leaves the unit `active` and throws `CHECKPOINT_VERIFICATION_FAILED`; it does not create a confirmed manifest.

- [ ] **Step 6: Generate audit patches**

Generate forward and reverse binary patches for human inspection, but make blob manifests the restoration authority.

- [ ] **Step 7: Run tests and commit**

Run: `node --test tests/unit/checkpoints.test.mjs tests/unit/verification-artifact.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/core/checkpoints.ts plugins/dev-flow/src/core/implementation-units.ts plugins/dev-flow/src/core/verification.ts tests/unit/checkpoints.test.mjs tests/unit/verification-artifact.test.mjs
git commit -m "feat(dev-flow): create implementation checkpoints"
```

### Task 4: Add rollback preview and human gate

**Files:**
- Create: `plugins/dev-flow/src/core/rollback.ts`
- Modify: `plugins/dev-flow/src/core/user-interactions.ts`
- Modify: `plugins/dev-flow/src/core/gate-basis.ts`
- Create: `tests/unit/rollback-preview.test.mjs`

**Interfaces:**
- Produces: `previewRollback`, `presentRollbackGate`, `resolveRollbackGate`, `RollbackPreview`.

- [ ] **Step 1: Write failing suffix and conflict tests**

For RU-001, RU-002, RU-003, previewing RU-001 must return undo order `[RU-003, RU-002]`. Previewing an uncheckpointed RU returns `ROLLBACK_TARGET_INVALID`. A current hash mismatch returns `ROLLBACK_CONFLICT`.

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/rollback-preview.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement preview**

```ts
export interface RollbackPreview {
  targetUnitId: string;
  targetCheckpointId: string;
  undoUnitIds: string[];
  files: Array<{ path: string; currentSha256: string | "missing"; restoreSha256: string | "missing" }>;
  verificationCommandIds: string[];
  basisHash: string;
}
```

Build the file result by folding checkpoint files in reverse sequence. Verify current files match the chain-tip after hashes before returning a preview.

- [ ] **Step 4: Add a dedicated interaction**

Create interaction kind `rollback` with target `rollback:<preview basisHash>` and actions `confirm` and `cancel`. Confirmation must use native elicitation or a later one-time token response and cannot reuse a requirement/implementation gate event.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/unit/rollback-preview.test.mjs tests/unit/user-interactions.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/core/rollback.ts plugins/dev-flow/src/core/user-interactions.ts plugins/dev-flow/src/core/gate-basis.ts tests/unit/rollback-preview.test.mjs
git commit -m "feat(dev-flow): preview and approve checkpoint rollback"
```

### Task 5: Execute resumable rollback transactions

**Files:**
- Modify: `plugins/dev-flow/src/core/rollback.ts`
- Modify: `plugins/dev-flow/src/core/state-store.ts`
- Modify: `plugins/dev-flow/src/mcp/doctor.ts`
- Create: `tests/unit/rollback-transaction.test.mjs`

**Interfaces:**
- Produces: `executeRollback`, `resumeRollbackTransaction`, doctor rollback report.

- [ ] **Step 1: Write failure-injection tests**

Inject failure after transaction prepare, after recovery backup, after first restore rename, during verification, and before final state commit. Assert each phase can resume without losing the pre-rollback bytes.

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/rollback-transaction.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Define transaction phases**

```ts
type RollbackPhase =
  | "prepared"
  | "backed-up"
  | "restoring"
  | "restored"
  | "verified"
  | "state-committed"
  | "completed";
```

Persist `nextFileIndex`, preview basis, backup directory, target checkpoint, current phase, and verification attempt IDs.

- [ ] **Step 4: Implement safe restoration**

For each file, first copy current bytes/mode to the transaction backup. Restore a blob through a same-directory temp file, fsync it, chmod it, and atomic rename. For a target `missing`, move the file into transaction recovery rather than unlinking it before the transaction commits.

- [ ] **Step 5: Handle verification failure**

If rollback verification fails, restore every file from transaction backup, run the same verification commands against the restored chain tip, and leave the transaction report with `outcome: "rolled-back-rollback"`. If compensation verification also fails, doctor reports a blocking recovery with both attempt IDs.

- [ ] **Step 6: Commit workflow state**

After successful rollback verification, mark undone units `rolled_back`, clear their checkpoint IDs from the active chain summary, make the first undone unit pending, and invalidate implementation completion, code review, verification, feature-check, logicComplete, and finalize.

- [ ] **Step 7: Run tests and commit**

Run: `node --test tests/unit/rollback-transaction.test.mjs tests/unit/doctor.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/core/rollback.ts plugins/dev-flow/src/core/state-store.ts plugins/dev-flow/src/mcp/doctor.ts tests/unit/rollback-transaction.test.mjs tests/unit/doctor.test.mjs
git commit -m "feat(dev-flow): execute resumable checkpoint rollback"
```

### Task 6: Add MCP tools, status, and Skills

**Files:**
- Modify: `plugins/dev-flow/src/mcp/server.ts`
- Modify: `plugins/dev-flow/src/core/status.ts`
- Modify: `plugins/dev-flow/src/core/next.ts`
- Modify: `plugins/dev-flow/skills/implement/SKILL.md`
- Modify: `plugins/dev-flow/skills/rollback-safety/SKILL.md`
- Modify: `plugins/dev-flow/skills/status/SKILL.md`
- Modify: `tests/unit/mcp-server.test.mjs`
- Modify: `tests/unit/status-progress.test.mjs`
- Modify: `tests/unit/skills.test.mjs`

**Interfaces:**
- Produces: begin/checkpoint/preview/present/execute rollback MCP tools and `progress.implementation`.

- [ ] **Step 1: Write failing MCP/status tests**

Assert tools/list includes:

```text
dev_flow_begin_implementation_unit
dev_flow_checkpoint_implementation_unit
dev_flow_preview_rollback
dev_flow_present_rollback_gate
dev_flow_execute_rollback
```

Assert status publishes active unit, latest checkpoint, remaining units, legal rollback targets, and open transaction.

- [ ] **Step 2: Run focused tests**

Run: `node --test tests/unit/mcp-server.test.mjs tests/unit/status-progress.test.mjs tests/unit/skills.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add strict schemas and dispatch**

Begin requires featureId, expectedRevision, unitId, host. Checkpoint additionally accepts no arbitrary command: Core reads command IDs from the approved RU. Preview is read-only. Present gate and execute require preview/interaction basis and host provenance.

- [ ] **Step 4: Update Skills**

Implement must begin exactly the next pending RU, edit only its scope, checkpoint it once, and continue until all units are checkpointed before recording the route implementation step. Rollback-safety handles preview/gate/execute. Status describes legal targets without implying rollback has run.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/unit/mcp-server.test.mjs tests/unit/status-progress.test.mjs tests/unit/skills.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/mcp/server.ts plugins/dev-flow/src/core/status.ts plugins/dev-flow/src/core/next.ts plugins/dev-flow/skills/implement/SKILL.md plugins/dev-flow/skills/rollback-safety/SKILL.md plugins/dev-flow/skills/status/SKILL.md tests/unit/mcp-server.test.mjs tests/unit/status-progress.test.mjs tests/unit/skills.test.mjs
git commit -m "feat(dev-flow): expose checkpoint rollback workflow"
```

### Task 7: Protect controls and verify end-to-end rollback

**Files:**
- Modify: `plugins/dev-flow/src/hosts/adapter-policy.ts`
- Modify: `tests/unit/adapter-policy.test.mjs`
- Create: `tests/e2e/routes/standard-m-rollback.test.mjs`
- Create: `tests/e2e/cross-host/checkpoint-rollback.test.mjs`
- Modify: `docs/architecture.md`
- Modify: `docs/routes.md`
- Modify: `README.md`

**Interfaces:**
- Produces: Hook protection, route proof, cross-host recovery proof, and user documentation.

- [ ] **Step 1: Add Hook control tests**

Direct and Bash writes to checkpoint manifests, blobs, rollback transactions, and recovery directories must return `DEV_FLOW_STATE_MUTATION_FORBIDDEN`.

- [ ] **Step 2: Add route E2E**

Implement three RUs, checkpoint each, preview rollback to RU-001, record a later human confirmation, execute rollback, assert RU-002/RU-003 are rolled back, reimplement them, run code review/verification/feature-check, and finalize with the existing delivery snapshot.

- [ ] **Step 3: Add cross-host E2E**

Claude begins and checkpoints RU-001; Codex reads status, checkpoints RU-002, previews rollback, and executes it after a captured later user response. Assert both hosts observe the same checkpoint chain revision.

- [ ] **Step 4: Document operational behavior**

Document legal rollback targets, conflict refusal, verification, transaction recovery, scope amendment, and the difference between unit checkpoints and the final feature patch.

- [ ] **Step 5: Run the complete suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-flow/src/hosts/adapter-policy.ts tests/unit/adapter-policy.test.mjs tests/e2e/routes/standard-m-rollback.test.mjs tests/e2e/cross-host/checkpoint-rollback.test.mjs docs/architecture.md docs/routes.md README.md plugins/dev-flow/dist/mcp-server.mjs plugins/dev-flow/dist/claude-hook.mjs plugins/dev-flow/dist/codex-hook.mjs
git commit -m "test(dev-flow): verify checkpoint rollback end to end"
```

## Self-Review

- Spec coverage: RU schema, DAG, implementation lifecycle, file scopes, content blobs, verification, preview, human gate, conflict refusal, transaction recovery, downstream invalidation, status, Hooks, routes, and cross-host execution are covered.
- Placeholder scan: no deferred rollback behavior remains.
- Type consistency: `RollbackUnit`, `ImplementationUnitState`, `CheckpointManifest`, `RollbackPreview`, `RollbackTransaction`, `checkpointImplementationUnit`, `previewRollback`, and `executeRollback` remain stable across tasks.
