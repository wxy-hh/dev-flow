# Dev Flow Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct approval invalidation, cross-platform test silence, delivery-snapshot baseline integrity, and Windows shortcut-property ordering.

**Architecture:** Keep each correction in its owning layer: the gate-basis table drives invalidation, a standalone Node test launcher owns environment setup, delivery snapshots compare repository identity before collecting changes, and the Windows registration script writes dependent shell properties in Microsoft-required order. All behavior is verified through deterministic tests without an OS notification service.

**Tech Stack:** TypeScript, Node.js, Node test runner, Git CLI, npm scripts, PowerShell/COM script generation, esbuild.

## Global Constraints

- Requirements edits must invalidate both requirement confirmation and implementation approval.
- Public test commands must work under Windows `cmd.exe` without adding a dependency or relying on shell environment-assignment syntax.
- Finalize must not create a delivery snapshot when Git HEAD differs from the feature's recorded baseline.
- Windows shortcut registration remains explicit, per-user, and nonblocking; `PreventPinning` precedes AUMID.
- Keep MCP notification delivery and all local-notification test suppression behavior unchanged.
- Do not stage or commit because the shared worktree contains user-owned pending changes.

---

### Task 1: Repair implementation-approval invalidation

**Files:**
- Modify: `plugins/dev-flow/src/core/gate-basis.ts:5-15`
- Modify: `tests/unit/artifacts.test.mjs:70-100`

**Interfaces:**
- Consumes: `gatesInvalidatedByArtifact(kind)` from the central basis table.
- Produces: `requirements` invalidates both `requirement_confirmation` and `implementation_approval`.

- [x] **Step 1: Add the failing regression test**

Create a standard M feature, complete requirements, present and confirm both human gates, modify and re-register `需求文档.md`, then assert both gate records and their steps are absent.

```js
state = await artifacts.recordArtifact(root, "f", state.revision, "requirements");
assert.equal(state.humanGates.requirement_confirmation, undefined);
assert.equal(state.humanGates.implementation_approval, undefined);
assert.equal(state.steps.implementation_approval, undefined);
```

- [x] **Step 2: Run the test to verify failure**

Run: `node --test tests/unit/artifacts.test.mjs`

Expected: FAIL because implementation approval remains after requirements are re-registered.

- [x] **Step 3: Add `requirements` to the implementation-approval basis**

Change the basis table to start the implementation approval list with `"requirements"`; no new invalidation code is required because `recordArtifact` already iterates this table.

- [x] **Step 4: Run the test to verify success**

Run: `node --test tests/unit/artifacts.test.mjs`

Expected: PASS and existing risk-card invalidation remains covered.

### Task 2: Make test silence cross-platform

**Files:**
- Create: `scripts/run-tests-silently.mjs`
- Modify: `package.json:16-20`

**Interfaces:**
- Consumes: one mode argument: `unit`, `routes`, `interop`, `e2e`, or `host-e2e`.
- Produces: a child Node process with `DEV_FLOW_DISABLE_ATTENTION=1` and `NODE_ENV=test`, preserving its exit code.

- [x] **Step 1: Implement deterministic test discovery**

Create a launcher that recursively collects sorted `*.test.mjs` paths from the mode's test directories and spawns `process.execPath --test ...files`. For `host-e2e`, spawn `process.execPath scripts/run-host-e2e.mjs`. Set the two environment variables in `spawn` options and forward stdio and exit code.

```js
const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1", NODE_ENV: "test" },
});
child.once("exit", (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
```

- [x] **Step 2: Replace package scripts**

Map each public test script to `node scripts/run-tests-silently.mjs <mode>`, removing every POSIX-style `NAME=value command` prefix.

- [x] **Step 3: Run representative and aggregate commands**

Run: `npm run test:unit && npm run test:e2e && npm run test:host-e2e && npm test`

Expected: all commands pass on the current platform; no command string depends on a POSIX shell and no local alert is invoked.

### Task 3: Reject delivery-snapshot baseline drift

**Files:**
- Modify: `plugins/dev-flow/src/core/delivery-snapshot.ts:151-180`
- Modify: `tests/unit/delivery-snapshot.test.mjs`

**Interfaces:**
- Consumes: `state.deliveryBaseline.gitHead`.
- Produces: `DELIVERY_BASELINE_CHANGED` when `git rev-parse HEAD` is not that recorded hash; otherwise existing snapshot generation is unchanged.

- [x] **Step 1: Add the failing committed-drift test**

Start a feature in a fixture Git repository, make and commit a protected-file change, record the implementation evidence, run verification, and assert finalize rejects with `DELIVERY_BASELINE_CHANGED` and leaves the feature active.

```js
await run("git", ["add", "src/app.js"], { cwd: root });
await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "drift"], { cwd: root });
await assert.rejects(() => checks.finalize(root, "f", state.revision), (error) => error.code === "DELIVERY_BASELINE_CHANGED");
```

- [x] **Step 2: Run the snapshot test to verify failure**

Run: `node --test tests/unit/delivery-snapshot.test.mjs`

Expected: FAIL because a clean worktree after a later commit currently produces an empty snapshot.

- [x] **Step 3: Compare current HEAD before dirty-path collection**

After validating a baseline exists, resolve `git rev-parse HEAD`; if it differs, throw `DevFlowError("DELIVERY_BASELINE_CHANGED", ...)` with the expected/current hashes and recovery guidance to start from a clean current baseline.

- [x] **Step 4: Run the snapshot test to verify success**

Run: `node --test tests/unit/delivery-snapshot.test.mjs`

Expected: PASS, including existing tracked/untracked reversible-patch tests.

### Task 4: Correct Windows shortcut property ordering and release verification

**Files:**
- Modify: `plugins/dev-flow/src/mcp/windows-notifications.ts:167-172`
- Modify: `tests/unit/windows-notifications.test.mjs`
- Modify: `plugins/dev-flow/dist/mcp-server.mjs` (generated)

**Interfaces:**
- Consumes: Windows property-store requirement that `PreventPinning` be set first.
- Produces: generated PowerShell with `PreventPinning` `SetValue` before AUMID `SetValue`.

- [x] **Step 1: Extend script-generation test**

Decode the registration command and assert the index of `PreventPinning` `SetValue` is less than the index of `AppUserModelId` `SetValue`.

- [x] **Step 2: Swap the two property-store writes**

```csharp
properties.SetValue(ref PreventPinning, ref preventPinningValue);
properties.SetValue(ref AppUserModelId, ref appIdValue);
```

- [x] **Step 3: Run full verification and inspect scope**

Run: `npm test && npm run test:host-e2e && git diff --check`

Expected: all tests and deterministic build checks pass; bundle reflects source; no whitespace errors.

## Self-Review

- Spec coverage: Tasks 1–4 map one-to-one to every reviewed issue.
- Placeholder scan: every source path, public command, error code, script mode, property order and expected result is defined.
- Type consistency: the launcher is JavaScript-only; snapshot errors use existing `DevFlowError`; no public feature-state schema changes are introduced.
