import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mcpCall } from "../helpers/host-runner.mjs";

const server = path.resolve("plugins/dev-flow/dist/mcp-server.mjs");

test("MCP rejects silently ignored fields before invoking state handlers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-input-validation-"));
  try {
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_record_decision", {
        featureId: "f",
        question: "q",
        host: "codex",
        revision: 1,
      }),
      (error) => {
        assert.equal(error.code, "INVALID_TOOL_INPUT");
        assert.equal(error.details.mutationApplied, false);
        assert.ok(error.details.issues.some((item) => item.path === "$.expectedRevision" && item.keyword === "required"));
        assert.ok(error.details.issues.some((item) => item.path === "$.revision" && item.keyword === "additionalProperties"));
        return true;
      },
    );
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_classify", { level: "M", topology: "local", riskFacts: { security: ["wrong nesting"] } }),
      (error) => {
        assert.equal(error.code, "INVALID_TOOL_INPUT");
        assert.ok(error.details.issues.some((item) => item.path === "$.classificationBasis.riskFacts"));
        return true;
      },
    );
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_reclassify", {
        featureId: "f",
        expectedRevision: 0,
        reason: "tighten",
        classification: { level: "M", topology: "local", ignoredField: true },
      }),
      (error) => error.code === "INVALID_TOOL_INPUT" && error.details.issues.some((item) => item.path === "$.classification.ignoredField"),
    );
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_lock_classification", {
        featureId: "f",
        expectedRevision: 0,
        classification: { level: "M", topology: "local", signals: { impactScope: "single-module" } },
      }),
      (error) => error.code === "INVALID_TOOL_INPUT" && error.details.issues.some((item) => item.path === "$.classification.signals"),
    );
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_verify", {
        featureId: "f",
        expectedRevision: 0,
        host: "codex",
        manualAcceptance: { mode: "user-signoff", source: "prompt", scenarios: [{ name: "ok", evidence: "ok" }] },
      }),
      (error) => error.code === "INVALID_TOOL_INPUT" && error.details.issues.some((item) => item.path === "$.manualAcceptance.promptEventId"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
