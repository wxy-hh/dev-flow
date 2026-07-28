# Dev Flow Adaptive Review Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plan-review marker with immutable review batches, capability-adaptive independent jobs, structured findings, explicit assurance levels, and blocking-finding dispositions.

**Architecture:** MCP owns review batches and findings. Each batch is bound to the current requirements, plan, coverage, rollback, traceability, classification, scope, and protected-root fingerprint. Review execution uses MCP sampling when available, host subagents otherwise, and an explicitly degraded multi-perspective path as the final fallback.

**Tech Stack:** TypeScript 5.9, Node.js 20+, MCP JSON-RPC, JSON Schema 2020-12, esbuild, `node:test`.

## Global Constraints

- This plan starts after the traceability ledger plan is released.
- Reviewers cannot see sibling findings until their own job is submitted.
- Only distinct executor/context identities qualify for `multi-agent`.
- The degraded path is allowed but must be visible as `multi-perspective`.
- Aggregation cannot silently downgrade a blocking finding.
- No runtime npm dependencies may be added.

---

### Task 1: Define review policy, roles, and schemas

**Files:**
- Modify: `plugins/dev-flow/src/policy/types.ts`
- Modify: `plugins/dev-flow/policy/contract.json`
- Modify: `plugins/dev-flow/src/policy/contract.ts`
- Create: `plugins/dev-flow/policy/review.schema.json`
- Create: `tests/unit/review-policy.test.mjs`

**Interfaces:**
- Produces: `ReviewRole`, `ReviewExecutionMode`, `ReviewAssurance`, `ReviewFinding`, `ReviewJob`, `ReviewBatch`, `requiredReviewRoles(route, riskLabels)`.

- [ ] **Step 1: Write the failing role derivation test**

```js
assert.deepEqual(requiredReviewRoles("standard-m", []), ["architecture-testability", "requirement-coverage"]);
assert.deepEqual(requiredReviewRoles("standard-l", ["security"]), [
  "architecture-testability",
  "requirement-coverage",
  "rollback-operability",
  "security",
]);
assert.deepEqual(requiredReviewRoles("standard-l", ["irreversible_consequence"]), [
  "architecture-testability",
  "data-irreversibility",
  "requirement-coverage",
  "rollback-operability",
]);
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/review-policy.test.mjs`

Expected: FAIL because review policy is not defined.

- [ ] **Step 3: Add exact types**

```ts
export type ReviewRole =
  | "requirement-coverage"
  | "architecture-testability"
  | "rollback-operability"
  | "security"
  | "data-irreversibility";
export type ReviewExecutionMode = "mcp-sampling" | "native-subagent" | "isolated-sequential";
export type ReviewAssurance = "multi-agent" | "multi-perspective";
export type FindingSeverity = "blocking" | "important" | "advisory";
export type FindingStatus = "open" | "resolved" | "accepted";
```

Define `ReviewFinding` with `findingId`, `jobId`, `severity`, `category`, `targets`, `evidence`, `claim`, `recommendation`, and `status`. Define `ReviewJob` with immutable `basisHash`, role, execution mode, executor/context IDs, and timestamps.

- [ ] **Step 4: Add review role policy**

Place route defaults, risk additions, and `critical_correctness`/`irreversible_consequence` review-depth overrides in `contract.json`. Sort derived roles and reject unknown roles during contract load. `critical_correctness` sets `reviewDepth: "full"` for every required role; it does not invent a redundant role name.

- [ ] **Step 5: Add strict JSON schema and run checks**

Run: `node --test tests/unit/review-policy.test.mjs && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-flow/src/policy/types.ts plugins/dev-flow/policy/contract.json plugins/dev-flow/src/policy/contract.ts plugins/dev-flow/policy/review.schema.json tests/unit/review-policy.test.mjs
git commit -m "feat(dev-flow): define adaptive review policy"
```

### Task 2: Implement immutable review batches and job submission

**Files:**
- Create: `plugins/dev-flow/src/core/review-jobs.ts`
- Modify: `plugins/dev-flow/src/core/state-store.ts`
- Create: `tests/unit/review-jobs.test.mjs`

**Interfaces:**
- Produces: `createReviewBatch`, `readReviewBatch`, `claimReviewJob`, `submitReviewJob`, `reviewAssurance`.

- [ ] **Step 1: Write failing isolation and basis tests**

Test that the batch basis changes when any bound artifact or trace hash changes, that a pending job response omits sibling findings, and that submission with a mismatched basis returns `REVIEW_JOB_BASIS_MISMATCH`.

- [ ] **Step 2: Run the tests**

Run: `node --test tests/unit/review-jobs.test.mjs`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the basis**

```ts
export async function reviewBasis(root: string, state: FeatureState): Promise<Record<string, unknown>> {
  const config = await readProjectConfig(root);
  const protectedFingerprint = await fingerprintProtectedRoots(root, config.protectedRoots);
  return {
    route: state.route,
    classification: state.classification,
    scope: state.scope,
    protectedFingerprint,
    traceability: state.traceability,
    artifacts: Object.fromEntries(
      ["requirements", "implementation-plan", "coverage-matrix", "rollback-units", "rollback-safety"]
        .map((kind) => [kind, state.artifacts[kind]]),
    ),
  };
}
```

Hash the canonical JSON representation with SHA-256.

- [ ] **Step 4: Implement job lifecycle**

Allowed transitions:

```text
pending → claimed → submitted
pending/claimed/submitted → stale
```

`claimReviewJob` stores execution mode, executor ID, and context ID. `submitReviewJob` requires the same identities and basis hash, then records findings. The public pending-job view includes only its review package and never the batch findings array.

- [ ] **Step 5: Calculate assurance**

```ts
export function reviewAssurance(jobs: ReviewJob[]): ReviewAssurance {
  const contextIds = new Set(
    jobs.filter((job) => job.status === "submitted")
      .map((job) => job.contextId)
      .filter((value): value is string => Boolean(value)),
  );
  return contextIds.size >= 2 ? "multi-agent" : "multi-perspective";
}
```

An empty identity never qualifies as independent. Different executor labels inside one context remain multi-perspective; repeated calls by the same model qualify as independent only when the client supplies distinct context IDs.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/unit/review-jobs.test.mjs && npm run typecheck`

Expected: PASS.

```bash
git add plugins/dev-flow/src/core/review-jobs.ts plugins/dev-flow/src/core/state-store.ts tests/unit/review-jobs.test.mjs
git commit -m "feat(dev-flow): persist isolated review jobs"
```

### Task 3: Add MCP capability negotiation and review job tools

**Files:**
- Modify: `plugins/dev-flow/src/mcp/server.ts`
- Modify: `tests/unit/mcp-server.test.mjs`

**Interfaces:**
- Produces: `dev_flow_create_review_batch`, `dev_flow_claim_review_job`, `dev_flow_submit_review_job`, `dev_flow_get_review_job`; MCP sampling capability detection.

- [ ] **Step 1: Write failing capability and tool-list tests**

Assert initialize with `{ sampling: {} }` selects `mcp-sampling`, initialize without sampling exposes host-claim tools, and all four tools reject additional properties.

- [ ] **Step 2: Run the MCP test**

Run: `node --test tests/unit/mcp-server.test.mjs`

Expected: FAIL because review tools and sampling detection are absent.

- [ ] **Step 3: Extend connection capabilities**

```ts
class McpConnection {
  private supportsFormElicitation = false;
  private supportsSampling = false;

  configure(capabilities: unknown): void {
    this.supportsFormElicitation = hasObjectCapability(capabilities, "elicitation");
    this.supportsSampling = hasObjectCapability(capabilities, "sampling");
  }

  reviewExecutionMode(): ReviewExecutionMode {
    return this.supportsSampling ? "mcp-sampling" : "native-subagent";
  }
}
```

Keep elicitation behavior compatible with v1.7.0.

- [ ] **Step 4: Add job tools**

`create_review_batch` takes feature mutation fields and host. `get_review_job` is read-only and takes featureId/jobId. `claim_review_job` requires jobId, executionMode, executorId, contextId. `submit_review_job` requires jobId, basisHash, executorId, contextId, and findings.

- [ ] **Step 5: Add sampling execution**

For each job, send one `sampling/createMessage` request containing the immutable package and strict JSON response contract. Do not include sibling job output. Parse the response through the same `submitReviewJob` validator used by host subagents. If sampling fails, leave the job pending and return a recovery hint for native-subagent or isolated-sequential claim; do not silently mark it complete.

- [ ] **Step 6: Run MCP tests and commit**

Run: `node --test tests/unit/mcp-server.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/mcp/server.ts tests/unit/mcp-server.test.mjs
git commit -m "feat(dev-flow): expose adaptive review jobs"
```

### Task 4: Implement finding aggregation and dispositions

**Files:**
- Modify: `plugins/dev-flow/src/core/review-jobs.ts`
- Modify: `plugins/dev-flow/src/core/user-interactions.ts`
- Modify: `plugins/dev-flow/src/core/human-gates.ts`
- Create: `tests/unit/review-findings.test.mjs`

**Interfaces:**
- Produces: `aggregateReviewFindings`, `resolveReviewFinding`, `acceptReviewFinding`, `assertReviewComplete`.

- [ ] **Step 1: Write failing blocking-finding tests**

Assert duplicate findings remain linked to both source jobs, aggregation never changes `blocking` to a lower severity, and implementation approval fails with `REVIEW_BLOCKING_FINDINGS`.

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/review-findings.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic aggregation**

Use a fingerprint of `category`, sorted targets, normalized claim, and evidence locations. Store `sourceFindingIds` on an aggregate; severity is the maximum where blocking outranks important and important outranks advisory.

- [ ] **Step 4: Implement disposition rules**

`resolveReviewFinding` requires a submitted job with the same role and current batch basis. `acceptReviewFinding` creates an interaction with target `review-finding:<id>`, requires an explicit later user response, and stores prompt/interaction provenance. Only blocking findings require the dedicated acceptance interaction.

- [ ] **Step 5: Gate plan review completion**

`recordStep(plan_review)` must call `assertReviewComplete`: all required roles submitted, batch current, no open blocking findings. Persist `{ batchId, assuranceLevel }` as plan-review evidence instead of accepting only `{ reviewType: "plan" }`.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/unit/review-findings.test.mjs tests/unit/human-gates.test.mjs tests/unit/user-interactions.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/core/review-jobs.ts plugins/dev-flow/src/core/user-interactions.ts plugins/dev-flow/src/core/human-gates.ts tests/unit/review-findings.test.mjs
git commit -m "feat(dev-flow): enforce adversarial review findings"
```

### Task 5: Integrate stale propagation, status, projection, and Skills

**Files:**
- Modify: `plugins/dev-flow/src/core/artifacts.ts`
- Modify: `plugins/dev-flow/src/core/status.ts`
- Modify: `plugins/dev-flow/src/core/next.ts`
- Modify: `plugins/dev-flow/src/core/gate-basis.ts`
- Modify: `plugins/dev-flow/skills/plan-review/SKILL.md`
- Modify: `plugins/dev-flow/skills/status/SKILL.md`
- Modify: `plugins/dev-flow/templates/plan-review.md`
- Modify: `tests/unit/status-progress.test.mjs`
- Modify: `tests/unit/skills.test.mjs`

**Interfaces:**
- Produces: `progress.review` with batch, assurance, pending roles, blocking count, and stale state.

- [ ] **Step 1: Write failing stale and status tests**

Create a current submitted batch, change `implementation-plan`, record the artifact with trace, and assert all jobs become stale, implementation approval is revoked, and status reports `review.status === "stale"`.

- [ ] **Step 2: Run focused tests**

Run: `node --test tests/unit/status-progress.test.mjs tests/unit/skills.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add batch invalidation**

Any artifact or traceability pointer in `reviewBasis` changing marks the active batch and its jobs stale. Preserve findings and dispositions for audit; never delete the batch.

- [ ] **Step 4: Generate the plan-review projection**

Replace the editable plan-review artifact with a generated projection containing batch ID, basis hash, assurance level, each role/executor, findings, and dispositions. Add it to generated read-only artifact handling.

- [ ] **Step 5: Update plan-review Skill**

The Skill must create/read the batch, dispatch or claim exactly the pending jobs, submit each independently, handle blocking findings, and only record plan review after `assertReviewComplete`. It must label the fallback as multi-perspective.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/unit/status-progress.test.mjs tests/unit/skills.test.mjs tests/unit/artifacts.test.mjs`

Expected: PASS.

```bash
git add plugins/dev-flow/src/core/artifacts.ts plugins/dev-flow/src/core/status.ts plugins/dev-flow/src/core/next.ts plugins/dev-flow/src/core/gate-basis.ts plugins/dev-flow/skills/plan-review/SKILL.md plugins/dev-flow/skills/status/SKILL.md plugins/dev-flow/templates/plan-review.md tests/unit/status-progress.test.mjs tests/unit/skills.test.mjs
git commit -m "feat(dev-flow): surface review assurance and findings"
```

### Task 6: Complete route, cross-host, docs, and build verification

**Files:**
- Modify: `tests/helpers/route-flow.mjs`
- Modify: `tests/e2e/routes/standard-m.test.mjs`
- Modify: `tests/e2e/routes/standard-l.test.mjs`
- Modify: `tests/e2e/cross-host/claude-to-codex.test.mjs`
- Modify: `tests/e2e/cross-host/codex-to-claude.test.mjs`
- Modify: `docs/architecture.md`
- Modify: `docs/routes.md`
- Modify: `README.md`

**Interfaces:**
- Produces: end-to-end proof for sampling, native-subagent claims, degraded fallback, stale re-review, and cross-host handoff.

- [ ] **Step 1: Add route scenarios**

Standard-M must complete with two different executor/context pairs and report `multi-agent`. Standard-L fallback must complete all required roles with one identity and report `multi-perspective`. A security route must include the security job.

- [ ] **Step 2: Add cross-host scenarios**

Claude creates the batch and submits requirement coverage; Codex claims architecture/testability with a different identity, submits it, and completes plan review. Add the reverse direction.

- [ ] **Step 3: Document guarantees and limits**

State that multi-agent is an audited assurance level, not a label inferred from role count. Document capability order and the allowed degraded path.

- [ ] **Step 4: Run the complete suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/route-flow.mjs tests/e2e/routes/standard-m.test.mjs tests/e2e/routes/standard-l.test.mjs tests/e2e/cross-host/claude-to-codex.test.mjs tests/e2e/cross-host/codex-to-claude.test.mjs docs/architecture.md docs/routes.md README.md plugins/dev-flow/dist/mcp-server.mjs plugins/dev-flow/dist/claude-hook.mjs plugins/dev-flow/dist/codex-hook.mjs
git commit -m "test(dev-flow): verify adaptive review workflow"
```

## Self-Review

- Spec coverage: immutable basis, role policy, three capability paths, independent identities, findings, dispositions, assurance, stale propagation, projection, routes, and cross-host handoff are covered.
- Placeholder scan: no deferred review behavior remains.
- Type consistency: `ReviewBatch`, `ReviewJob`, `ReviewFinding`, `ReviewAssurance`, `createReviewBatch`, `submitReviewJob`, and `assertReviewComplete` remain stable across tasks.
