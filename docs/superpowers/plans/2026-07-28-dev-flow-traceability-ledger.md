# Dev Flow Traceability Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MCP-owned traceability ledger that atomically binds requirements, acceptance criteria, plan tasks, tests, and rollback units to the current Markdown artifact hashes.

**Architecture:** Human-readable Markdown remains the narrative layer. A new `traceability.json` sidecar is the machine contract, and FeatureState stores only its version, path, hash, revision, and summary. Trace-aware artifact registration updates the Markdown hash and ledger in one state transaction; approval and downstream evidence become stale when their source hash changes.

**Tech Stack:** TypeScript 5.9, Node.js 20+, JSON Schema 2020-12, esbuild, `node:test`.

## Global Constraints

- Existing active features without `traceability` remain readable and finish under the legacy contract.
- Newly started `standard-m` and `standard-l` features use traceability version 1.
- The MCP server is the only writer of `traceability.json`.
- Core validates structure and references; it does not claim to understand natural-language correctness.
- No runtime npm dependencies may be added.
- Every mutation uses the existing feature lock, expected revision CAS, fsync, and atomic rename path.

---

### Task 1: Define traceability types, contract rules, and JSON schema

**Files:**
- Modify: `plugins/dev-flow/src/policy/types.ts`
- Modify: `plugins/dev-flow/policy/contract.json`
- Modify: `plugins/dev-flow/src/policy/contract.ts`
- Create: `plugins/dev-flow/policy/traceability.schema.json`
- Create: `tests/unit/traceability-policy.test.mjs`

**Interfaces:**
- Consumes: existing `RouteId`, `RiskLabel`, and contract JSON loading.
- Produces: `TraceNodeKind`, `TraceNode`, `TraceEdge`, `TraceabilityLedger`, `TraceabilitySummary`, `TraceDelta`, `traceabilityRequired(route)`.

- [ ] **Step 1: Write the failing policy test**

```js
test("standard routes require traceability and expose stable ID rules", () => {
  assert.equal(policy.traceabilityRequired("standard-m"), true);
  assert.equal(policy.traceabilityRequired("standard-l"), true);
  assert.equal(policy.traceabilityRequired("light-m"), false);
  assert.deepEqual(policy.traceIdPatterns, {
    requirement: "^REQ-[0-9]{3}$",
    acceptance: "^AC-[0-9]{3}$",
    task: "^TASK-[0-9]{3}$",
    test: "^TEST-[0-9]{3}$",
    rollback: "^RU-[0-9]{3}$",
  });
});
```

- [ ] **Step 2: Run the test and verify the missing exports**

Run: `node --test tests/unit/traceability-policy.test.mjs`

Expected: FAIL because `traceabilityRequired` and `traceIdPatterns` do not exist.

- [ ] **Step 3: Add the policy types**

```ts
export type TraceNodeKind = "requirement" | "acceptance" | "task" | "test" | "rollback";
export type TraceNodeStatus = "current" | "stale" | "tombstone";

export interface TraceNode {
  id: string;
  kind: TraceNodeKind;
  sourceArtifact: string;
  sourceSha256: string;
  sourceAnchor: string;
  status: TraceNodeStatus;
  parent?: string;
  covers?: string[];
  verifies?: string[];
  rollbackUnit?: string;
}

export interface TraceEdge {
  from: string;
  type: "contains" | "covers" | "verifies" | "rollback";
  to: string;
}

export interface TraceabilitySummary {
  current: number;
  stale: number;
  tombstones: number;
  orphanRequirements: number;
  uncoveredAcceptance: number;
  orphanTasks: number;
}

export interface TraceabilityLedger {
  schemaVersion: 1;
  featureId: string;
  revision: number;
  nodes: Record<string, TraceNode>;
  edges: TraceEdge[];
}

export interface TraceDelta {
  upsert: TraceNode[];
  tombstone: string[];
}
```

- [ ] **Step 4: Add traceability policy to the contract**

```json
"traceability": {
  "routes": ["standard-m", "standard-l"],
  "idPatterns": {
    "requirement": "^REQ-[0-9]{3}$",
    "acceptance": "^AC-[0-9]{3}$",
    "task": "^TASK-[0-9]{3}$",
    "test": "^TEST-[0-9]{3}$",
    "rollback": "^RU-[0-9]{3}$"
  }
}
```

Extend `ContractShape` and export:

```ts
export const traceIdPatterns = Object.freeze(contract.traceability.idPatterns);

export function traceabilityRequired(route: RouteId): boolean {
  return contract.traceability.routes.includes(route);
}
```

- [ ] **Step 5: Add the sidecar schema**

The schema must require `schemaVersion`, `featureId`, `revision`, `nodes`, and `edges`; reject unknown node properties; constrain `status` and edge `type` to the TypeScript unions above.

- [ ] **Step 6: Run policy, type, and version checks**

Run: `node --test tests/unit/traceability-policy.test.mjs && npm run typecheck && npm run version:check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/dev-flow/src/policy/types.ts plugins/dev-flow/policy/contract.json plugins/dev-flow/src/policy/contract.ts plugins/dev-flow/policy/traceability.schema.json tests/unit/traceability-policy.test.mjs
git commit -m "feat(dev-flow): define traceability contract"
```

### Task 2: Implement ledger validation and persistence

**Files:**
- Create: `plugins/dev-flow/src/core/traceability.ts`
- Modify: `plugins/dev-flow/src/core/state-store.ts`
- Create: `tests/unit/traceability-store.test.mjs`

**Interfaces:**
- Consumes: `writeAtomic`, feature directory conventions, `TraceabilityLedger`, `TraceDelta`.
- Produces: `readTraceability(root, state)`, `applyTraceDelta(contents, state, ledger, delta)`, `writeTraceability(root, id, ledger)`, `traceabilitySummary(ledger)`, `assertTraceabilityComplete(ledger, route)`.

- [ ] **Step 1: Write failing validation tests**

```js
test("trace delta rejects duplicate, dangling, reused, and missing markdown ids", async () => {
  const ledger = emptyLedger("f");
  assert.throws(
    () => applyTraceDelta("# Requirements\n<!-- dev-flow:id=REQ-001 -->\n", state, ledger, {
      upsert: [
        requirement("REQ-001"),
        { ...acceptance("AC-001"), parent: "REQ-999" },
      ],
      tombstone: [],
    }),
    /TRACE_REFERENCE_DANGLING/,
  );
  assert.throws(
    () => applyTraceDelta("# Requirements\n", state, ledger, {
      upsert: [requirement("REQ-001")],
      tombstone: [],
    }),
    /TRACE_ID_NOT_IN_ARTIFACT/,
  );
});
```

Add a second test asserting a tombstoned `REQ-001` cannot be upserted with new content and a third test asserting `AC-001` must have exactly one requirement parent.

- [ ] **Step 2: Run the store test**

Run: `node --test tests/unit/traceability-store.test.mjs`

Expected: FAIL because `core/traceability.ts` does not exist.

- [ ] **Step 3: Implement ID and reference validation**

```ts
const error = (code: string, message: string, details: Record<string, unknown> = {}) =>
  new DevFlowError(code, message, details);

function ownedAnchorCount(contents: string, sourceAnchor: string): number {
  if (!sourceAnchor.startsWith("<!-- dev-flow:id=") || !sourceAnchor.endsWith(" -->")) {
    throw error("TRACE_SOURCE_ANCHOR_INVALID", "sourceAnchor must use the Dev Flow declaration marker");
  }
  return contents.split(sourceAnchor).length - 1;
}

function assertOwnedId(contents: string, node: TraceNode): void {
  const expected = `<!-- dev-flow:id=${node.id} -->`;
  if (node.sourceAnchor !== expected) {
    throw error("TRACE_SOURCE_ANCHOR_INVALID", `${node.id} has an invalid declaration marker`);
  }
  const count = ownedAnchorCount(contents, node.sourceAnchor);
  if (count !== 1) {
    throw error("TRACE_ID_NOT_IN_ARTIFACT", `${node.id} must occur once in ${node.sourceArtifact}`, { count });
  }
}
```

Validate only the declaration marker owned by the artifact against the once-only rule. Human-readable references such as `covers REQ-001` may occur repeatedly without becoming duplicate declarations.

- [ ] **Step 4: Implement completeness invariants**

```ts
export function assertTraceabilityComplete(ledger: TraceabilityLedger, route: RouteId): void {
  const current = Object.values(ledger.nodes).filter((node) => node.status === "current");
  const byId = new Map(current.map((node) => [node.id, node]));
  const requirements = current.filter((node) => node.kind === "requirement");
  const acceptance = current.filter((node) => node.kind === "acceptance");
  const tasks = current.filter((node) => node.kind === "task");
  const tests = current.filter((node) => node.kind === "test");
  const uncovered = requirements.filter((req) => !tasks.some((task) => task.covers?.includes(req.id)));
  const unverified = acceptance.filter((ac) => !tests.some((item) => item.verifies?.includes(ac.id)));
  const orphanTasks = tasks.filter((task) => !(task.covers ?? []).some((id) => byId.has(id)));
  const missingRollback = tasks.filter((task) => !task.rollbackUnit || byId.get(task.rollbackUnit)?.kind !== "rollback");
  if (uncovered.length || unverified.length || orphanTasks.length || missingRollback.length) {
    throw error("TRACE_COVERAGE_INCOMPLETE", "traceability invariants are incomplete", {
      uncovered: uncovered.map((node) => node.id),
      unverified: unverified.map((node) => node.id),
      orphanTasks: orphanTasks.map((node) => node.id),
      missingRollback: missingRollback.map((node) => node.id),
      route,
    });
  }
}
```

- [ ] **Step 5: Add state pointer and legacy-safe reads**

Extend `FeatureState`:

```ts
traceability?: {
  version: 1;
  path: "traceability.json";
  sha256: string;
  revision: number;
  summary: TraceabilitySummary;
};
```

Add an exported `writeAtomicJson` wrapper rather than duplicating fsync logic. `readTraceability` returns `undefined` only when `state.traceability` is absent; if the pointer exists and the file is absent, malformed, or hash-mismatched, throw `TRACE_LEDGER_UNREADABLE`.

- [ ] **Step 6: Run focused and state tests**

Run: `node --test tests/unit/traceability-store.test.mjs tests/unit/state-store.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/dev-flow/src/core/traceability.ts plugins/dev-flow/src/core/state-store.ts tests/unit/traceability-store.test.mjs
git commit -m "feat(dev-flow): persist traceability ledger"
```

### Task 3: Add atomic artifact and trace registration

**Files:**
- Modify: `plugins/dev-flow/src/core/artifacts.ts`
- Modify: `plugins/dev-flow/src/core/gate-basis.ts`
- Modify: `plugins/dev-flow/src/core/state-store.ts`
- Modify: `plugins/dev-flow/src/mcp/doctor.ts`
- Create: `tests/unit/traceability-artifacts.test.mjs`

**Interfaces:**
- Consumes: `applyTraceDelta`, `writeTraceability`, existing `mutate`.
- Produces: `recordArtifactWithTrace(root, id, expectedRevision, kind, delta)`.

- [ ] **Step 1: Write failing atomicity and stale-propagation tests**

Create tests that assert:

```js
await assert.rejects(
  () => artifacts.recordArtifactWithTrace(root, "f", state.revision, "requirements", invalidDelta),
  /TRACE_REFERENCE_DANGLING/,
);
assert.equal((await store.readState(root, "f")).revision, state.revision);
assert.equal(await readFile(requirementsPath, "utf8"), editedContents);
assert.equal(await fileExists(traceabilityPath), false);
```

Add a success test where changing `REQ-001` marks dependent `TASK-001`, `TEST-001`, and `RU-001` stale and removes both human gate step snapshots.

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/traceability-artifacts.test.mjs`

Expected: FAIL because `recordArtifactWithTrace` is missing.

- [ ] **Step 3: Extend the mutation commit mechanism**

Add a recoverable sidecar transaction rather than assuming two filesystem renames are atomic:

```ts
export interface TraceRegistrationTransaction {
  schemaVersion: 1;
  featureId: string;
  expectedRevision: number;
  oldLedgerSha256?: string;
  newLedgerSha256: string;
  phase: "prepared" | "ledger-written" | "state-written" | "completed";
  stateTempPath: string;
  ledgerTempPath: string;
}
```

Under the existing lock: validate values; write and fsync ledger/state temp files; write and fsync `trace-registration-transaction.json`; rename the ledger and advance to `ledger-written`; rename state and advance to `state-written`; append the event and update the active pointer; mark completed and remove the journal. Every trace-aware mutation first calls `resumeTraceRegistration`, and doctor reports an open or unreadable journal. A crash after one rename is therefore resumed instead of being mistaken for a valid atomic commit.

- [ ] **Step 4: Implement trace-aware registration**

```ts
export async function recordArtifactWithTrace(
  root: string,
  id: string,
  expectedRevision: number,
  kind: string,
  delta: TraceDelta,
): Promise<FeatureState> {
  return mutateWithTraceRegistration(root, id, expectedRevision, "artifact-trace-recorded", async (state) => {
    const artifact = state.artifacts[kind];
    if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
    const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8");
    const sourceSha256 = hash(contents);
    const current = await readTraceability(root, state) ?? emptyTraceability(id);
    const ledger = applyTraceDelta(contents, state, current, bindSource(delta, kind, sourceSha256));
    staleDependents(ledger, kind, state.artifacts[kind]?.sha256);
    state.artifacts[kind] = { ...artifact, sha256: sourceSha256 };
    state.traceability = pointerFor(ledger);
    invalidateArtifactDependents(state, kind);
    return ledger;
  });
}
```

Implement `recordArtifactWithTrace` through a dedicated `mutateWithTraceRegistration` wrapper so the normal `mutate` contract remains unchanged. Keep transaction helpers in `traceability.ts`; do not inline them into `server.ts`.

- [ ] **Step 5: Bind gates to the trace hash**

Add the traceability pointer to `gateBasis` for both requirement and implementation gates. A changed trace hash must prevent confirmation even if the Markdown artifact hash is unchanged.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/unit/traceability-artifacts.test.mjs tests/unit/artifacts.test.mjs tests/unit/human-gates.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/dev-flow/src/core/artifacts.ts plugins/dev-flow/src/core/gate-basis.ts plugins/dev-flow/src/core/state-store.ts plugins/dev-flow/src/mcp/doctor.ts tests/unit/traceability-artifacts.test.mjs
git commit -m "feat(dev-flow): register artifacts with trace data atomically"
```

### Task 4: Enforce traceability at approval, feature-check, and status

**Files:**
- Modify: `plugins/dev-flow/src/core/human-gates.ts`
- Modify: `plugins/dev-flow/src/core/feature-check.ts`
- Modify: `plugins/dev-flow/src/core/status.ts`
- Modify: `plugins/dev-flow/src/core/next.ts`
- Create: `tests/unit/traceability-gates.test.mjs`
- Modify: `tests/unit/status-progress.test.mjs`

**Interfaces:**
- Consumes: `readTraceability`, `assertTraceabilityComplete`, `traceabilitySummary`.
- Produces: `progress.traceability` and blocking errors before implementation approval and feature-check.

- [ ] **Step 1: Write failing gate and feature-check tests**

Create a standard-M feature whose ledger has `REQ-001` and `AC-001` but no task/test. Assert:

```js
await assert.rejects(
  () => gates.presentGate(root, "f", state.revision, "implementation_approval"),
  /TRACE_COVERAGE_INCOMPLETE/,
);
await assert.rejects(
  () => checks.featureCheck(root, "f", readyRevision),
  /TRACE_COVERAGE_INCOMPLETE/,
);
```

- [ ] **Step 2: Run focused tests**

Run: `node --test tests/unit/traceability-gates.test.mjs`

Expected: FAIL because gates and feature-check do not read the ledger.

- [ ] **Step 3: Add a single assertion helper**

```ts
export async function assertCurrentTraceability(root: string, state: FeatureState): Promise<TraceabilityLedger | undefined> {
  if (!traceabilityRequired(state.route)) return undefined;
  const ledger = await readTraceability(root, state);
  if (!ledger) throw new DevFlowError("TRACE_LEDGER_REQUIRED", state.route);
  assertTraceabilityComplete(ledger, state.route);
  return ledger;
}
```

Call it before presenting `implementation_approval`, in `featureCheck`, and in `finalize`.

- [ ] **Step 4: Publish read-only status**

Add:

```ts
traceability?: {
  version: 1;
  status: "missing" | "current" | "stale" | "incomplete";
  summary: TraceabilitySummary;
  recoveryHint?: string;
}
```

`readStatusView` must never mutate the ledger or feature revision.

- [ ] **Step 5: Run status, next, and feature tests**

Run: `node --test tests/unit/traceability-gates.test.mjs tests/unit/status-progress.test.mjs tests/unit/derive-next.test.mjs tests/unit/feature-check.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-flow/src/core/human-gates.ts plugins/dev-flow/src/core/feature-check.ts plugins/dev-flow/src/core/status.ts plugins/dev-flow/src/core/next.ts tests/unit/traceability-gates.test.mjs tests/unit/status-progress.test.mjs
git commit -m "feat(dev-flow): enforce traceability before approval"
```

### Task 5: Expose trace registration through MCP and Skills

**Files:**
- Modify: `plugins/dev-flow/src/mcp/server.ts`
- Modify: `plugins/dev-flow/skills/requirements/SKILL.md`
- Modify: `plugins/dev-flow/skills/plan/SKILL.md`
- Modify: `plugins/dev-flow/skills/coverage-review/SKILL.md`
- Modify: `plugins/dev-flow/skills/rollback-safety/SKILL.md`
- Modify: `plugins/dev-flow/skills/status/SKILL.md`
- Modify: `tests/unit/mcp-server.test.mjs`
- Modify: `tests/unit/skills.test.mjs`

**Interfaces:**
- Consumes: `recordArtifactWithTrace`.
- Produces: MCP tool `dev_flow_record_artifact_with_trace`.

- [ ] **Step 1: Write the failing MCP schema test**

```js
const tool = listed.tools.find((item) => item.name === "dev_flow_record_artifact_with_trace");
assert.deepEqual(tool.inputSchema.required, ["featureId", "expectedRevision", "kind", "traceDelta"]);
assert.equal(tool.inputSchema.properties.traceDelta.additionalProperties, false);
```

- [ ] **Step 2: Run MCP and Skill tests**

Run: `node --test tests/unit/mcp-server.test.mjs tests/unit/skills.test.mjs`

Expected: FAIL because the tool and instructions are absent.

- [ ] **Step 3: Add the exact MCP schema and dispatch**

The schema must require `traceDelta.upsert` and `traceDelta.tombstone`; each upsert node must use the fields defined in Task 1 and reject unknown properties.

Add:

```ts
case "dev_flow_record_artifact_with_trace":
  return recordArtifactWithTrace(root, a.featureId, a.expectedRevision, a.kind, a.traceDelta);
```

- [ ] **Step 4: Update Skills**

Requirements must create `REQ` and `AC`; plan must create `TASK`; coverage must create `TEST` edges; rollback-safety must create `RU`. Each Skill must use `dev_flow_record_artifact_with_trace` for a trace-aware feature and must not hand-edit `traceability.json`.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/unit/mcp-server.test.mjs tests/unit/skills.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-flow/src/mcp/server.ts plugins/dev-flow/skills/requirements/SKILL.md plugins/dev-flow/skills/plan/SKILL.md plugins/dev-flow/skills/coverage-review/SKILL.md plugins/dev-flow/skills/rollback-safety/SKILL.md plugins/dev-flow/skills/status/SKILL.md tests/unit/mcp-server.test.mjs tests/unit/skills.test.mjs
git commit -m "feat(dev-flow): expose traceability workflow"
```

### Task 6: Protect the sidecar and complete route coverage

**Files:**
- Modify: `plugins/dev-flow/src/hosts/adapter-policy.ts`
- Modify: `tests/unit/adapter-policy.test.mjs`
- Modify: `tests/helpers/route-flow.mjs`
- Modify: `tests/e2e/routes/standard-m.test.mjs`
- Modify: `tests/e2e/routes/standard-l.test.mjs`
- Modify: `docs/architecture.md`
- Modify: `docs/routes.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: new MCP tool and trace-aware standard routes.
- Produces: protected sidecar behavior and end-to-end standard route proof.

- [ ] **Step 1: Write failing Hook and route tests**

Add a direct write and Bash redirect test asserting `traceability.json` returns `DEV_FLOW_STATE_MUTATION_FORBIDDEN`. Update the route helper to register:

```js
const delta = {
  upsert: [
    requirement("REQ-001"),
    acceptance("AC-001", "REQ-001"),
    task("TASK-001", ["REQ-001", "AC-001"], "RU-001"),
    verificationCase("TEST-001", ["AC-001"]),
    rollbackUnit("RU-001"),
  ],
  tombstone: [],
};
```

Split the delta by the artifact that owns each node and register it at the corresponding route step.

- [ ] **Step 2: Run Hook and route tests**

Run: `node --test tests/unit/adapter-policy.test.mjs tests/e2e/routes/standard-m.test.mjs tests/e2e/routes/standard-l.test.mjs`

Expected: FAIL until Hook protection and the helper are updated.

- [ ] **Step 3: Protect the sidecar**

Add `traceability.json` and `trace-registration-transaction.json` to `controlFileNames`. Do not add either file to `allowedArtifacts`.

- [ ] **Step 4: Update documentation**

Document the dual-layer contract, ID rules, stale propagation, legacy active-feature behavior, and the distinction between structural coverage and semantic correctness.

- [ ] **Step 5: Run the complete verification suite**

Run: `npm test`

Expected: typecheck, unit tests, all route E2E tests, build, dist check, and version check PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-flow/src/hosts/adapter-policy.ts tests/unit/adapter-policy.test.mjs tests/helpers/route-flow.mjs tests/e2e/routes/standard-m.test.mjs tests/e2e/routes/standard-l.test.mjs docs/architecture.md docs/routes.md README.md plugins/dev-flow/dist/mcp-server.mjs plugins/dev-flow/dist/claude-hook.mjs plugins/dev-flow/dist/codex-hook.mjs
git commit -m "test(dev-flow): complete traceability rollout"
```

## Self-Review

- Spec coverage: ID model, atomic registration, stale propagation, gate/feature-check enforcement, legacy compatibility, Hook protection, status, docs, and route E2E are covered.
- Placeholder scan: no deferred implementation steps remain.
- Type consistency: `TraceabilityLedger`, `TraceDelta`, `TraceabilitySummary`, `recordArtifactWithTrace`, and `assertCurrentTraceability` use the same names throughout.
