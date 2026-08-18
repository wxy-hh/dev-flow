import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const validation = await loadSource("plugins/dev-flow/src/mcp/input-validation.ts");

const schemas = {
  record: {
    inputSchema: {
      type: "object",
      required: ["featureId", "expectedRevision"],
      properties: {
        featureId: { type: "string", minLength: 1 },
        expectedRevision: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
};

test("runtime validation reports missing and unknown fields without invoking a handler", () => {
  assert.throws(() => validation.validateToolInput("record", { featureId: "f", revision: 1 }, schemas), (error) => {
    assert.equal(error.code, "INVALID_TOOL_INPUT");
    assert.equal(error.details.mutationApplied, false);
    assert.deepEqual(error.details.issues.map(({ path, keyword }) => ({ path, keyword })), [
      { path: "$.expectedRevision", keyword: "required" },
      { path: "$.revision", keyword: "additionalProperties" },
    ]);
    return true;
  });
});

test("empty schemas accept arbitrary JSON values", () => {
  assert.doesNotThrow(() => validation.validateToolInput("any", { nested: [1, true] }, { any: { inputSchema: {} } }));
});

test("record_step evidence must be an object, not a JSON string", async () => {
  const { toolSchemas } = await loadSource("plugins/dev-flow/src/mcp/dispatch.ts");
  assert.throws(() => validation.validateToolInput("dev_flow_record_step", {
    featureId: "f",
    expectedRevision: 1,
    step: "planning",
    evidence: JSON.stringify({ reviewType: "plan" }),
  }, toolSchemas), (error) => {
    assert.equal(error.code, "INVALID_TOOL_INPUT");
    const evidenceIssue = error.details.issues.find((issue) => issue.path === "$.evidence" && issue.keyword === "type");
    assert.ok(evidenceIssue);
    assert.equal(evidenceIssue.actualType, "string");
    assert.equal(evidenceIssue.receivedShape, "json-string");
    assert.equal(evidenceIssue.expectedPath, "$.evidence");
    assert.deepEqual(evidenceIssue.example, { reviewType: "plan" });
    return true;
  });
  assert.doesNotThrow(() => validation.validateToolInput("dev_flow_record_step", {
    featureId: "f",
    expectedRevision: 1,
    step: "planning",
    evidence: { reviewType: "plan" },
  }, toolSchemas));
});
