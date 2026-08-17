// v6 Review phase/role-basis tests. The Phase 0 todos still present here are
// enabled one at a time by the owning Phase.
import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const basis = await loadSource("plugins/dev-flow/src/policy/review-basis.ts");

const expectedFields = [
  "featureId", "route", "workflowCapabilities", "classification", "artifacts",
  "traceability", "projectConfigSha256", "verificationCommandHashes",
  "scopeManifestSha256", "governedRootsFingerprint", "featureOwnedFingerprint",
];
const expectedRoles = [
  "code-quality", "requirement-fidelity", "requirements-coverage",
  "architecture-testability", "rollback-operability", "security",
  "data-irreversibility", "money-safety", "contract-failure",
  "recovery-observability", "critical-correctness",
];

test("every v5 ReviewBasis field has a typed three-layer ownership entry", () => {
  assert.deepEqual(Object.keys(basis.REVIEW_BASIS_FIELD_OWNERSHIP).sort(), [...expectedFields].sort());
  for (const field of expectedFields) {
    const entry = basis.REVIEW_BASIS_FIELD_OWNERSHIP[field];
    assert.ok(entry.layers.length > 0, `${field} must be assigned`);
    assert.ok(entry.layers.every((layer) => ["role-semantic", "orchestration", "capture-freshness"].includes(layer)));
  }
});

test("all eleven review roles have a semantic spec and specialty roles bind only their own risk labels", () => {
  assert.deepEqual(Object.keys(basis.REVIEW_ROLE_SEMANTIC_SPECS).sort(), [...expectedRoles].sort());
  for (const role of expectedRoles) {
    const spec = basis.REVIEW_ROLE_SEMANTIC_SPECS[role];
    assert.ok(["plan", "code"].includes(spec.phase));
    assert.ok(Array.isArray(spec.traceKinds) && spec.traceKinds.length > 0);
  }
  assert.deepEqual(basis.REVIEW_ROLE_SEMANTIC_SPECS.security.riskLabels, ["security"]);
  assert.deepEqual(basis.REVIEW_ROLE_SEMANTIC_SPECS["data-irreversibility"].riskLabels, ["data", "irreversible_consequence"]);
  assert.equal(basis.REVIEW_ROLE_SEMANTIC_SPECS["requirements-coverage"].bindNonBehaviorDispositions, true);
  assert.equal(basis.REVIEW_ROLE_SEMANTIC_SPECS["code-quality"].bindFeatureOwnedContent, true);
  assert.equal(basis.REVIEW_ROLE_SEMANTIC_SPECS["requirement-fidelity"].bindFeatureOwnedContent, true);
});

test("governed roots and project config hashes stay in capture freshness, not role reuse", () => {
  assert.deepEqual(basis.REVIEW_BASIS_FIELD_OWNERSHIP.governedRootsFingerprint.layers, ["capture-freshness"]);
  assert.deepEqual(basis.REVIEW_BASIS_FIELD_OWNERSHIP.projectConfigSha256.layers, ["capture-freshness"]);
  assert.deepEqual(basis.REVIEW_BASIS_FIELD_OWNERSHIP.traceability.layers, ["capture-freshness"]);
});


const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const { mkdir, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const os = await import("node:os");
const path = await import("node:path");
const { createTinyApp, strictProjectConfig } = await import("../helpers/fixture-repo.mjs");

function batch(batchId, phase, validity = "current", featureId = "f") {
  const basis = { featureId };
  return { batchId, phase, basis, basisHash: reviewStore.semanticReviewBasisHash(basis), validity, progress: "complete", executionMode: "parallel-execution", assuranceLevel: "multi-perspective", jobs: [] };
}

function ledger(batches, featureId = "f") {
  return { schemaVersion: 3, featureId, revision: 0, stateRevision: 0, batches, summary: summaryOf(batches), findingEvents: [] };
}

test("prepareReviewInvalidationPlan reopens only the phase whose current batch changed", () => {
  const before = ledger([batch("p1", "plan"), batch("c1", "code")]);
  const afterPlan = ledger([batch("p1", "plan", "stale"), batch("p2", "plan"), batch("c1", "code")]);
  const planChanged = reviewStore.prepareReviewInvalidationPlan(before, afterPlan);
  assert.deepEqual(planChanged.staleBatchIds, ["p1", "c1"], "plan semantic change stales plan and downstream code");
  assert.equal(planChanged.reopenPlanning, true);
  assert.equal(planChanged.reopenCodeReview, true);
  assert.equal(planChanged.restampPlanningBatchId, "p2");

  const afterCode = ledger([batch("p1", "plan"), batch("c1", "code", "stale"), batch("c2", "code")]);
  const codeChanged = reviewStore.prepareReviewInvalidationPlan(before, afterCode);
  assert.deepEqual(codeChanged.staleBatchIds, ["c1"]);
  assert.equal(codeChanged.reopenPlanning, false);
  assert.equal(codeChanged.reopenCodeReview, true);
  assert.equal(codeChanged.restampCodeReviewBatchId, "c2");

  const unchanged = reviewStore.prepareReviewInvalidationPlan(before, before);
  assert.deepEqual(unchanged.staleBatchIds, []);
  assert.equal(unchanged.reopenPlanning, false);
  assert.equal(unchanged.reopenCodeReview, false);
});

function summaryOf(batches) {
  return { batches: batches.length, current: batches.filter((b) => b.validity === "current").length, stale: batches.filter((b) => b.validity === "stale").length, open: batches.filter((b) => b.progress === "open").length, complete: batches.filter((b) => b.progress === "complete").length };
}

test("ReviewLedger requires phase and allows one current batch per phase simultaneously", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-phase-"));
  try {
    const base = { schemaVersion: 3, featureId: "f", revision: 0, stateRevision: 0, findingEvents: [] };
    const noPhase = { ...batch("b1", "plan"), phase: undefined };
    await assert.rejects(
      reviewStore.writeReviewSnapshot(root, { ...base, batches: [noPhase], summary: summaryOf([noPhase]) }),
      (error) => error.code === "REVIEW_INTEGRITY_FAILED" || error.code === "UNSUPPORTED_REVIEW_SCHEMA",
    );
    const badPhase = { ...batch("b1", "plan"), phase: "wat" };
    await assert.rejects(
      reviewStore.writeReviewSnapshot(root, { ...base, batches: [badPhase], summary: summaryOf([badPhase]) }),
      (error) => error.code === "REVIEW_INTEGRITY_FAILED",
    );
    const p1 = batch("p1", "plan");
    const p2 = batch("p2", "plan");
    await assert.rejects(
      reviewStore.writeReviewSnapshot(root, { ...base, batches: [p1, p2], summary: summaryOf([p1, p2]) }),
      (error) => error.code === "REVIEW_INTEGRITY_FAILED" && /per phase/.test(error.message),
    );
    const c1 = batch("c1", "code");
    const pointer = await reviewStore.writeReviewSnapshot(root, { ...base, batches: [p1, c1], summary: summaryOf([p1, c1]) });
    assert.ok(pointer.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("creating a code batch never stales a current plan batch", () => {
  const planBatch = batch("p1", "plan");
  const codeBatch = batch("c1", "code");
  const afterCode = reviewJobs.staleCurrentBatchesOfPhase([planBatch, codeBatch], "code");
  assert.equal(afterCode.find((b) => b.batchId === "p1").validity, "current", "plan batch must survive code batch creation");
  assert.equal(afterCode.find((b) => b.batchId === "c1").validity, "stale");
  const afterPlan = reviewJobs.staleCurrentBatchesOfPhase([planBatch, codeBatch], "plan");
  assert.equal(afterPlan.find((b) => b.batchId === "p1").validity, "stale");
  assert.equal(afterPlan.find((b) => b.batchId === "c1").validity, "current");
});

test("plan semantic change stales plan and downstream code; code change never stales plan", () => {
  const before = ledger([batch("p1", "plan"), batch("c1", "code")]);
  const planReplaced = ledger([batch("p1", "plan", "stale"), batch("p2", "plan"), batch("c1", "code")]);
  const planChange = reviewStore.prepareReviewInvalidationPlan(before, planReplaced);
  assert.deepEqual([...planChange.staleBatchIds].sort(), ["c1", "p1"]);
  assert.equal(planChange.reopenPlanning, true);
  assert.equal(planChange.reopenCodeReview, true, "plan semantic change must reopen downstream code");

  const codeReplaced = ledger([batch("p1", "plan"), batch("c1", "code", "stale"), batch("c2", "code")]);
  const codeChange = reviewStore.prepareReviewInvalidationPlan(before, codeReplaced);
  assert.deepEqual(codeChange.staleBatchIds, ["c1"]);
  assert.equal(codeChange.reopenPlanning, false, "code change must never stale plan");
  assert.equal(codeChange.reopenCodeReview, true);
});

test("planning evidence only accepts current complete plan-phase basis-matching batches", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, {
      featureId: "phase-gate",
      objective: "测试相位门禁",
      host: "codex",
      level: "M",
      topology: "local",
      classificationBasis: {
        scopeFacts: ["scope"],
        topologyFacts: ["topology"],
        uncertaintyFacts: [],
        riskFacts: {},
        decisionRefs: [],
        signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
        controlEnhancements: { planReview: true },
      },
    });
    const id = "phase-gate";
    // 手工写入一个只有 code phase current 批次的 ledger，并让 state.review 指向它
    const codeOnly = ledger([batch("c1", "code", "current", id)], id);
    const pointer = await reviewStore.writeReviewSnapshot(fixture.root, codeOnly);
    const stateFile = path.join(fixture.root, ".dev-flow", "features", id, "state.json");
    const stateJson = JSON.parse(await readFile(stateFile, "utf8"));
    stateJson.review = pointer;
    await writeFile(stateFile, JSON.stringify(stateJson));
    const state = await store.readState(fixture.root, id);
    const gate = await reviewJobs.reviewGate(fixture.root, state, { phase: "plan" });
    assert.equal(gate.status, "need-batch");
    assert.equal(gate.cause, "phase", "a code-phase batch must not satisfy planning evidence");
    const planCurrent = ledger([batch("p1", "plan", "current", id)], id);
    const planPointer = await reviewStore.writeReviewSnapshot(fixture.root, planCurrent);
    stateJson.review = planPointer;
    await writeFile(stateFile, JSON.stringify(stateJson));
    const state2 = await store.readState(fixture.root, id);
    const gate2 = await reviewJobs.reviewGate(fixture.root, state2, { phase: "plan" });
    assert.equal(gate2.status, "need-batch", "a plan batch whose basis no longer matches is not evidence");
    assert.equal(gate2.cause, "stale");
  } finally { await fixture.dispose(); }
});

test("pure source changes preserve all plan roles and planning evidence while code roles rebind content", async () => {
  // roleBasisHash 契约：plan 角色不绑定 feature-owned 内容；code 角色绑定内容。
  const specs = basis.REVIEW_ROLE_SEMANTIC_SPECS;
  for (const role of ["requirements-coverage", "architecture-testability", "rollback-operability"]) {
    assert.equal(specs[role].bindFeatureOwnedContent, false, `${role} must not rebind on source changes`);
  }
  for (const role of ["code-quality", "requirement-fidelity"]) {
    assert.equal(specs[role].bindFeatureOwnedContent, true, `${role} must rebind content`);
  }
  assert.deepEqual(basis.REVIEW_BASIS_FIELD_OWNERSHIP.featureOwnedFingerprint.layers, ["role-semantic"]);
  assert.deepEqual(basis.REVIEW_BASIS_FIELD_OWNERSHIP.featureOwnedFingerprint.roles, ["code-quality", "requirement-fidelity"]);
  assert.deepEqual(basis.REVIEW_BASIS_FIELD_OWNERSHIP.governedRootsFingerprint.layers, ["capture-freshness"]);
});

test("identical role semantic hashes always reuse regardless of freshness/orchestration drift", async () => {
  // 角色语义相等 → 可复用；freshness/orchestration 字段不进入 role hash。
  const entries = basis.REVIEW_BASIS_FIELD_OWNERSHIP;
  for (const field of ["governedRootsFingerprint", "projectConfigSha256", "traceability"]) {
    assert.ok(!entries[field].layers.includes("role-semantic"), `${field} must not affect role reuse`);
  }
  for (const field of ["featureId", "route", "workflowCapabilities"]) {
    assert.equal(entries[field].layers.length, 1);
    assert.equal(entries[field].layers[0], "orchestration", `${field} is orchestration-only`);
  }
  // spec 驱动的 roleBasisHash 不依赖这些字段（字段穷尽归属表是编译期合同）
  assert.equal(Object.keys(entries).length, 11);
});
