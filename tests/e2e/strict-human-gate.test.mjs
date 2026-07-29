import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { invokeHook, mcpCall } from "../helpers/host-runner.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";

const bundles = await buildTestBundles();
after(() => bundles.dispose());
const mcp = bundles.pathFor("mcp-server");
const claudeHook = bundles.pathFor("claude-hook");

test("a HUMAN GATE cannot confirm in the presentation turn and accepts a later hook-captured reply", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(mcp, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    let state = await mcpCall(mcp, fixture.root, "dev_flow_start", { featureId: "gate", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed" });
    state = await mcpCall(mcp, fixture.root, "dev_flow_scaffold_artifact", { featureId: "gate", expectedRevision: state.revision, kind: "requirements" });
    state = await mcpCall(mcp, fixture.root, "dev_flow_record_artifact_with_trace", {
      featureId: "gate",
      expectedRevision: state.revision,
      kind: "requirements",
      traceDelta: {
        nodes: [
          { kind: "requirement", id: "REQ-001" },
          { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
        ],
      },
    });
    state = await mcpCall(mcp, fixture.root, "dev_flow_record_step", { featureId: "gate", expectedRevision: state.revision, step: "requirements", evidence: {} });
    state = await mcpCall(mcp, fixture.root, "dev_flow_present_gate", { featureId: "gate", expectedRevision: state.revision, gate: "requirement_confirmation" });
    await assert.rejects(
      () => mcpCall(mcp, fixture.root, "dev_flow_confirm_gate", { featureId: "gate", expectedRevision: state.revision, gate: "requirement_confirmation", userReply: "approved", promptEventId: "later", host: "claude" }),
      (error) => error.code === "HUMAN_GATE_SAME_TURN",
    );
    assert.deepEqual(await invokeHook(claudeHook, fixture.root, { hook_event_name: "UserPromptSubmit", event_id: "later", prompt: "approved" }), { continue: true });
    state = await mcpCall(mcp, fixture.root, "dev_flow_confirm_gate", { featureId: "gate", expectedRevision: state.revision, gate: "requirement_confirmation", userReply: "approved", promptEventId: "later", host: "claude" });
    assert.equal(state.steps.requirement_confirmation.status, "satisfied");
  } finally { await fixture.dispose(); }
});
