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
    let state = await mcpCall(startServer, fixture.root, "dev_flow_start", {
      featureId: "handoff", objective: "调整本地模块行为", host: starter,
      scope: { inScope: ["src/counter.js", "test/counter.test.js"], outOfScope: [] },
    });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_lock_classification", {
      featureId: "handoff", expectedRevision: state.revision,
      classification: {
        level: "L", topology: "multi-chain", execution: "light",
        scopeFacts: ["仅修改计数器及其测试"], topologyFacts: ["存在多链调用关系"], uncertaintyFacts: [],
        riskFacts: {}, decisionRefs: [],
      },
    });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_scaffold_artifact", { featureId: "handoff", expectedRevision: state.revision, kind: "implementation-plan" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_artifact", { featureId: "handoff", expectedRevision: state.revision, kind: "implementation-plan" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", { featureId: "handoff", expectedRevision: state.revision, step: "planning", evidence: { reviewType: "plan", checks: ["rollback-strategy"] } });
    const beforeApproval = await mcpCall(finishServer, fixture.root, "dev_flow_status", { featureId: "handoff" });
    const approvalId = beforeApproval.control.nextAction.step;
    state = await mcpCall(finishServer, fixture.root, "dev_flow_present_approval", { featureId: "handoff", expectedRevision: state.revision, approvalId, host: finisher });
    const promptEventId = `${finisher}-approval`;
    assert.equal(await invokeHook(approvalHook, fixture.root, { hook_event_name: "UserPromptSubmit", event_id: promptEventId, prompt: "批准实现" }), undefined);
    state = await mcpCall(finishServer, fixture.root, "dev_flow_answer", { featureId: "handoff", expectedRevision: state.revision, userReply: "批准实现", host: finisher });
    const source = path.join(fixture.root, "src", "counter.js");
    await writeFile(source, (await readFile(source, "utf8")).replace("value + 1", "value + 2"));
    const sourceTest = path.join(fixture.root, "test", "counter.test.js");
    await writeFile(sourceTest, (await readFile(sourceTest, "utf8")).replace("increment(1), 2", "increment(1), 3"));
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", { featureId: "handoff", expectedRevision: state.revision, step: "implementation", evidence: { files: ["src/counter.js", "test/counter.test.js"] } });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", { featureId: "handoff", expectedRevision: state.revision, step: "code_review", evidence: { reviewType: "code" } });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_verify", { featureId: "handoff", expectedRevision: state.revision, commandIds: ["unit"], host: finisher });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_finalize", { featureId: "handoff", expectedRevision: state.revision });
    assert.equal(state.logicComplete, true);
    const finalStatus = await mcpCall(finishServer, fixture.root, "dev_flow_status", { featureId: "handoff" });
    assert.equal(finalStatus.状态, "已完成");
    const delivery = await mcpCall(finishServer, fixture.root, "dev_flow_inspect", { featureId: "handoff", topic: "delivery" });
    assert.equal(delivery.content.snapshot, "已生成");
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
