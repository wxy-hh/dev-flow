# Attention Test Silence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep advisory MCP notifications intact while ensuring automated tests never invoke macOS notification banners or sounds.

**Architecture:** `emitAttention` remains responsible for emitting the protocol notification first. Its separate local-alert branch is disabled by an explicit environment override and by CI/test markers. Every repository test script explicitly sets the override so local runs are deterministic even when a test runner omits those markers.

**Tech Stack:** TypeScript, Node.js test runner, npm scripts, esbuild.

## Global Constraints

- Only local macOS `osascript` notifications are suppressed; `notifications/message` is always attempted.
- Interactive host use remains enabled by default on macOS.
- `DEV_FLOW_DISABLE_ATTENTION=1` remains the highest-priority switch for deterministic test execution.
- Do not alter workflow state, gate behavior, browser acceptance, or finalize semantics.

---

### Task 1: Make local-alert eligibility test-aware

**Files:**
- Modify: `plugins/dev-flow/src/mcp/attention.ts:10-50`
- Test: `tests/unit/attention.test.mjs`

**Interfaces:**
- Consumes: `emitAttention(event, options)` and `AttentionOptions`.
- Produces: unchanged notification output; `osascript` is skipped when `CI`/`NODE_ENV=test` applies unless a test explicitly chooses otherwise through injected environment values.

- [x] **Step 1: Write the failing test**

Add a test that supplies a macOS platform and test environment values, then asserts that `emit` receives `notifications/message` while `execute` is never called.

```js
await attention.emitAttention(event, {
  platform: "darwin",
  environment: { NODE_ENV: "test" },
  emit: (message) => emitted.push(message),
  execute: async () => executed.push(true),
});
assert.equal(emitted[0].method, "notifications/message");
assert.equal(executed.length, 0);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/unit/attention.test.mjs`

Expected: FAIL because `environment` is not yet recognized by `emitAttention`.

- [x] **Step 3: Implement the eligibility check**

Add an optional `environment?: NodeJS.ProcessEnv` test seam to `AttentionOptions`; derive local-alert eligibility as follows:

```ts
const environment = options.environment ?? process.env;
const automatedEnvironment = environment.CI === "true" || environment.CI === "1" || environment.NODE_ENV === "test";
const localAlertsEnabled = options.localAlertsEnabled
  ?? (environment.DEV_FLOW_DISABLE_ATTENTION !== "1" && !automatedEnvironment);
```

Keep the transport `emit` call before this condition and retain best-effort error swallowing.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/unit/attention.test.mjs`

Expected: PASS with macOS alerts preserved for the existing interactive test and suppressed for the automated-environment case.

### Task 2: Force every repository test command to be silent

**Files:**
- Modify: `package.json:16-21`
- Test: `package.json` scripts exercised by `npm test` and `npm run test:host-e2e`

**Interfaces:**
- Consumes: `DEV_FLOW_DISABLE_ATTENTION=1` in `emitAttention`.
- Produces: all public test scripts run their child processes with local attention disabled.

- [x] **Step 1: Update test scripts**

Prefix each public test script that runs Node tests or host E2E with `DEV_FLOW_DISABLE_ATTENTION=1`, including `test:unit`, `test:routes`, `test:interop`, `test:e2e`, and `test:host-e2e`.

```json
"test:unit": "DEV_FLOW_DISABLE_ATTENTION=1 node --test tests/unit/*.test.mjs"
```

The aggregate `test` script needs no duplicate prefix because it invokes these scripts.

- [x] **Step 2: Run the full verification suite**

Run: `npm test && npm run test:host-e2e && git diff --check`

Expected: all tests pass, host E2E emits no macOS alert/sound, and the diff has no whitespace errors.

## Self-Review

- Spec coverage: Task 1 preserves MCP notification delivery while disabling local alerts in automated environments; Task 2 guarantees every repository test script opts into silence.
- Placeholder scan: no implementation placeholders remain.
- Type consistency: `AttentionOptions.environment` is optional and defaults to `process.env`, so production call sites remain unchanged.
