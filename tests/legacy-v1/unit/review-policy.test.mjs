import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const review = await loadSource("plugins/dev-flow/src/policy/review.ts");
const evidence = await loadSource("plugins/dev-flow/src/policy/evidence.ts");
const types = await loadSource("plugins/dev-flow/src/policy/types.ts");

const traceOnly = Object.freeze({ trace: 1, review: 0, checkpoints: 0, rollbackExecution: 0 });
const reviewEnabled = Object.freeze({ ...traceOnly, review: 1 });

test("Core derives ordered, deduplicated review roles and full depth from the route and risk labels", () => {
  assert.deepEqual(review.deriveReviewJobRequirements("standard-m", []), [
    { role: "requirements-coverage", reviewDepth: "standard" },
    { role: "architecture-testability", reviewDepth: "standard" },
  ]);
  assert.deepEqual(review.deriveReviewJobRequirements("standard-l", ["security", "data"]), [
    { role: "requirements-coverage", reviewDepth: "standard" },
    { role: "architecture-testability", reviewDepth: "standard" },
    { role: "rollback-operability", reviewDepth: "standard" },
    { role: "security", reviewDepth: "standard" },
    { role: "data-irreversibility", reviewDepth: "standard" },
  ]);
  assert.deepEqual(review.deriveReviewJobRequirements("standard-m", ["critical_correctness", "security", "security"]), [
    { role: "requirements-coverage", reviewDepth: "full" },
    { role: "architecture-testability", reviewDepth: "full" },
    { role: "security", reviewDepth: "full" },
  ]);
  assert.deepEqual(review.deriveReviewJobRequirements("light-m", ["security"]), []);
});

test("review protocol parser rejects unknown, duplicate, and extra job fields", () => {
  assert.throws(
    () => review.parseReviewJobRequirements([{ role: "unknown", reviewDepth: "standard" }]),
    /REVIEW_PROTOCOL_INVALID/,
  );
  assert.throws(
    () => review.parseReviewJobRequirements([
      { role: "security", reviewDepth: "standard" },
      { role: "security", reviewDepth: "standard" },
    ]),
    /REVIEW_PROTOCOL_INVALID/,
  );
  assert.throws(
    () => review.parseReviewJobRequirements([{ role: "security", reviewDepth: "standard", executorId: "forged" }]),
    /REVIEW_PROTOCOL_INVALID/,
  );
});

test("a structured completion requires a coverage summary but permits an empty findings array", () => {
  assert.deepEqual(review.parseReviewJobCompletion({
    coverageSummary: "Reviewed requirement coverage and testability.",
    findings: [],
  }), {
    coverageSummary: "Reviewed requirement coverage and testability.",
    findings: [],
  });
  assert.throws(
    () => review.parseReviewJobCompletion({ coverageSummary: "", findings: [] }),
    /REVIEW_PROTOCOL_INVALID/,
  );
  assert.throws(
    () => review.parseReviewJobCompletion({ coverageSummary: "complete", findings: {}, executorId: "forged" }),
    /REVIEW_PROTOCOL_INVALID/,
  );
});

test("Review 2a assurance is always multi-perspective regardless of caller strings", () => {
  assert.equal(review.assuranceForReview2a({ executorId: "agent-a", contextId: "server-sampling" }), "multi-perspective");
  assert.equal(review.assuranceForReview2a({ executorId: "agent-b", contextId: "verified" }), "multi-perspective");
});

test("review capability changes plan-review evidence from editable reviewType to Core-only reviewBatch", () => {
  const legacy = evidence.requiredEvidenceForStep("standard-m", [], "plan_review", traceOnly);
  assert.deepEqual(legacy, { fields: { reviewType: "plan" }, checks: [], verificationKinds: [] });

  const generated = evidence.requiredEvidenceForStep("standard-m", [], "plan_review", reviewEnabled);
  assert.deepEqual(generated, { fields: { reviewBatch: true }, checks: [], verificationKinds: [] });
  assert.deepEqual(
    evidence.missingRequiredEvidence(generated, {
      batchId: "batch-forged",
      basisHash: "a".repeat(64),
      assuranceLevel: "multi-agent-verified",
    }),
    { fields: { reviewBatch: true }, checks: [], verificationKinds: [] },
  );
});

test("Task 4 releases review:1 only after Core batch/finding gates exist", () => {
  assert.equal(types.SUPPORTED_WORKFLOW_CAPABILITIES.review, 1);
});

test("review schema closes roles, categories, severity, and job shape", async () => {
  const schema = JSON.parse(await readFile(path.join(process.cwd(), "plugins/dev-flow/policy/review.schema.json"), "utf8"));
  assert.deepEqual(schema.$defs.reviewRole.enum, [
    "requirements-coverage",
    "architecture-testability",
    "rollback-operability",
    "security",
    "data-irreversibility",
  ]);
  assert.deepEqual(schema.$defs.reviewFindingCategory.enum, schema.$defs.reviewRole.enum);
  assert.deepEqual(schema.$defs.reviewFindingSeverity.enum, ["blocking", "warning", "note"]);
  assert.equal(schema.$defs.reviewJobRequirement.additionalProperties, false);
  assert.equal(schema.$defs.reviewJobCompletion.additionalProperties, false);
  assert.equal(schema.$defs.reviewJobCompletion.properties.findings.type, "array");
});
