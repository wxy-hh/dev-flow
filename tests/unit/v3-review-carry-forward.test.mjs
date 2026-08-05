import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const findings = await loadSource("plugins/dev-flow/src/core/review-findings.ts");

const origin = {
  type: "origin",
  batchId: "batch-1",
  role: "architecture-testability",
  basisHash: "a".repeat(64),
  at: "2026-08-05T00:00:00.000Z",
  finding: {
    findingId: "F-1",
    jobId: "job-1",
    severity: "blocking",
    category: "architecture-testability",
    targets: ["src/app.ts"],
    evidence: [{ path: "src/app.ts", line: 10 }],
    claim: "缺少边界测试",
    recommendation: "补充边界测试",
  },
};

test("finding reduction keeps an unresolved blocker visible until an explicit event", () => {
  const ledger = { findingEvents: [origin] };
  assert.equal(findings.effectiveFindingState(ledger, "F-1").status, "unresolved");
  assert.deepEqual(findings.unresolvedBlockingFindings(ledger).map((item) => item.findingId), ["F-1"]);
  const next = { findingEvents: [...ledger.findingEvents, {
    type: "still-blocking",
    findingId: "F-1",
    successorBatchId: "batch-2",
    resolutionJobId: "job-2",
    basisHash: "b".repeat(64),
    reason: "仍缺少测试",
    at: "2026-08-05T01:00:00.000Z",
  }] };
  assert.equal(findings.effectiveFindingState(next, "F-1").status, "still-blocking");
  assert.equal(findings.unresolvedBlockingFindings(next).length, 1);
});

test("resolved and risk-accepted findings leave the blocker gate", () => {
  const resolved = { findingEvents: [origin, {
    type: "resolved",
    findingId: "F-1",
    successorBatchId: "batch-2",
    resolutionJobId: "job-2",
    basisHash: "b".repeat(64),
    evidence: { findingId: "F-1", evidence: [{ path: "src/app.ts", line: 20 }], note: "已补测试" },
    at: "2026-08-05T01:00:00.000Z",
  }] };
  assert.equal(findings.unresolvedBlockingFindings(resolved).length, 0);
  const accepted = { findingEvents: [origin, {
    type: "risk-accepted",
    findingId: "F-1",
    batchId: "batch-1",
    interactionId: "internal-only",
    basisHash: "a".repeat(64),
    findingSetHash: "c".repeat(64),
    userEvidence: "我已了解风险",
    at: "2026-08-05T01:00:00.000Z",
  }] };
  assert.equal(findings.unresolvedBlockingFindings(accepted).length, 0);
  assert.equal(findings.effectiveFindingState(accepted, "F-1", "d".repeat(64)).status, "unresolved");
});
