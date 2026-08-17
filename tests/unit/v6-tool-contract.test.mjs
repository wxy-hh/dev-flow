import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const { publicTools, toolSchemas } = await loadSource("plugins/dev-flow/src/mcp/dispatch.ts");

test("v6 tools/list has no record_artifact_with_trace and validate_plan has no delta", () => {
  assert.equal(publicTools.includes("dev_flow_record_artifact_with_trace"), false);
  assert.equal("dev_flow_record_artifact_with_trace" in toolSchemas, false);
  const validate = toolSchemas.dev_flow_validate_plan;
  assert.ok(validate);
  assert.deepEqual(validate.inputSchema.required, ["featureId", "expectedRevision", "kind"]);
  assert.equal("traceDelta" in validate.inputSchema.properties, false);
  assert.deepEqual(validate.inputSchema.properties.kind.enum, ["requirements", "implementation-plan"]);
});

test("v6 tools/list no longer exposes per-job review mutation tools", () => {
  for (const name of [
    "dev_flow_claim_review_job",
    "dev_flow_release_review_job",
    "dev_flow_start_isolated_review",
    "dev_flow_submit_review_job",
    "dev_flow_sample_review_job",
    "dev_flow_record_review_execution_event",
  ]) {
    assert.equal(publicTools.includes(name), false, `${name} must not be public`);
    assert.equal(name in toolSchemas, false, `${name} must have no schema`);
  }
});


test("v6 trace artifact kind enum no longer exposes coverage-matrix or rollback-units", () => {
  const kinds = toolSchemas.dev_flow_validate_plan.inputSchema.properties.kind.enum;
  assert.deepEqual([...kinds].sort(), ["implementation-plan", "requirements"]);
});

test("v6 review execution start/complete tools are exposed with batch execution contracts", () => {
  assert.equal(publicTools.includes("dev_flow_start_review_execution"), true);
  assert.equal(publicTools.includes("dev_flow_complete_review_execution"), true);
  assert.deepEqual(toolSchemas.dev_flow_start_review_execution.inputSchema.required, ["featureId", "expectedRevision", "batchId", "executionRequestId", "host"]);
  assert.deepEqual(toolSchemas.dev_flow_complete_review_execution.inputSchema.required, ["featureId", "expectedRevision", "batchId", "executionRequestId"]);
});

test("v6 dev_flow_answer has no userReply input", () => {
  const answer = toolSchemas.dev_flow_answer;
  assert.deepEqual(answer.inputSchema.required, ["featureId", "expectedRevision", "host"]);
  assert.equal("userReply" in answer.inputSchema.properties, false);
});
