import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { hostE2EEnabled, invokeHook, mcpCall } from "../helpers/host-runner.mjs";
import { installNativeHosts } from "../helpers/native-hosts.mjs";

async function finishLightL(startServer, finishServer, approvalHook, starter, finisher) {
  const fixture = await createTinyApp();
  try {
    await mcpCall(startServer, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    let state = await mcpCall(startServer, fixture.root, "dev_flow_start", { featureId: "handoff", host: starter, level: "L", topology: "multi-chain", execution: "light" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_scaffold_artifact", { featureId: "handoff", expectedRevision: state.revision, kind: "boundary-card" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", { featureId: "handoff", expectedRevision: state.revision, step: "boundary", evidence: {} });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_scaffold_artifact", { featureId: "handoff", expectedRevision: state.revision, kind: "rollback-safety" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", { featureId: "handoff", expectedRevision: state.revision, step: "rollback_safety", evidence: {} });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_present_gate", { featureId: "handoff", expectedRevision: state.revision, gate: "implementation_approval" });
    const promptEventId = `${finisher}-approval`;
    assert.deepEqual(await invokeHook(approvalHook, fixture.root, { hook_event_name: "UserPromptSubmit", event_id: promptEventId, prompt: "approve implementation" }), { continue: true });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_confirm_gate", { featureId: "handoff", expectedRevision: state.revision, gate: "implementation_approval", userReply: "approve implementation", promptEventId, host: finisher });
    const source = path.join(fixture.root, "src", "counter.js");
    await writeFile(source, (await readFile(source, "utf8")).replace("value + 1", "value + 2"));
    const sourceTest = path.join(fixture.root, "test", "counter.test.js");
    await writeFile(sourceTest, (await readFile(sourceTest, "utf8")).replace("increment(1), 2", "increment(1), 3"));
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", { featureId: "handoff", expectedRevision: state.revision, step: "implementation", evidence: { changed: ["src/counter.js"] } });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", { featureId: "handoff", expectedRevision: state.revision, step: "code_review", evidence: { reviewType: "code" } });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_scaffold_artifact", { featureId: "handoff", expectedRevision: state.revision, kind: "verification" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_verify", { featureId: "handoff", expectedRevision: state.revision, host: finisher });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_feature_check", { featureId: "handoff", expectedRevision: state.revision });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_finalize", { featureId: "handoff", expectedRevision: state.revision });
    assert.equal(state.logicComplete, true);
    assert.equal(state.lastUpdatedBy.host, finisher);
  } finally { await fixture.dispose(); }
}

test("marketplace-installed Claude and Codex exchange one feature state in both directions", { skip: !hostE2EEnabled, timeout: 240_000 }, async () => {
  const hosts = await installNativeHosts();
  try {
    const claudeMcp = path.join(hosts.claudeRoot, "dist", "mcp-server.mjs");
    const codexMcp = path.join(hosts.codexRoot, "dist", "mcp-server.mjs");
    await finishLightL(claudeMcp, codexMcp, path.join(hosts.codexRoot, "dist", "codex-hook.mjs"), "claude", "codex");
    await finishLightL(codexMcp, claudeMcp, path.join(hosts.claudeRoot, "dist", "claude-hook.mjs"), "codex", "claude");
  } finally { await hosts.cleanup(); }
});
