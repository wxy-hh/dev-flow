import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { hostE2EEnabled, invokeHook, mcpCall } from "../helpers/host-runner.mjs";
import { installNativeHosts } from "../helpers/native-hosts.mjs";

const boundaryAudit = {
  scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"],
  items: [],
};

async function trustedEdit(hook, root, file, transform, eventId) {
  const event = { event_id: eventId, tool_name: "Edit", tool_input: { file_path: file } };
  assert.equal(await invokeHook(hook, root, { ...event, hook_event_name: "PreToolUse" }), undefined);
  await writeFile(file, transform(await readFile(file, "utf8")));
  assert.equal(await invokeHook(hook, root, { ...event, hook_event_name: "PostToolUse", tool_response: { success: true } }), undefined);
}

async function finishS(startServer, finishServer, finishHook, starter, finisher) {
  const fixture = await createTinyApp();
  try {
    await mcpCall(startServer, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    let state = await mcpCall(startServer, fixture.root, "dev_flow_start", {
      featureId: "handoff", objective: "调整本地计数规则", host: starter,
      scope: { inScope: ["src/counter.js", "test/counter.test.js"], outOfScope: [] },
    });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_lock_classification", {
      featureId: "handoff",
      expectedRevision: state.revision,
      classification: {
        level: "S",
        topology: "local",
        requirements: "provided-confirmed",
        scopeFacts: ["计数器组件及其测试"],
        topologyFacts: ["没有共享契约"],
        uncertaintyFacts: [],
        riskFacts: {},
        decisionRefs: [],
        classificationBasis: {
          scopeFacts: ["计数器组件及其测试"],
          topologyFacts: ["没有共享契约"],
          uncertaintyFacts: [],
          riskFacts: {},
          decisionRefs: [],
          signals: {
            changeSurface: "single-component",
            behaviorChange: "bounded-rule",
            topology: "local",
            unitCount: 1,
            requirements: "provided-confirmed",
            operationalRecovery: false,
            executableRollback: false,
          },
        },
      },
      boundaryAudit,
    });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", {
      featureId: "handoff", expectedRevision: state.revision, step: "boundary", evidence: {},
    });

    await trustedEdit(finishHook, fixture.root, path.join(fixture.root, "src", "counter.js"), (source) => source.replace("value + 1", "value + 2"), `${finisher}-source`);
    await trustedEdit(finishHook, fixture.root, path.join(fixture.root, "test", "counter.test.js"), (source) => source.replace("increment(1), 2", "increment(1), 3"), `${finisher}-test`);
    const afterWrites = await mcpCall(finishServer, fixture.root, "dev_flow_status", { featureId: "handoff" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", {
      featureId: "handoff", expectedRevision: afterWrites.control.expectedRevision, step: "implementation", evidence: {},
    });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", {
      featureId: "handoff", expectedRevision: state.revision, step: "code_review", evidence: { reviewType: "code" },
    });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_verify", {
      featureId: "handoff", expectedRevision: state.revision, commandIds: ["unit"], host: finisher,
    });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_finalize", { featureId: "handoff", expectedRevision: state.revision });
    assert.equal(state.logicComplete, true);
    const finalStatus = await mcpCall(finishServer, fixture.root, "dev_flow_status", { featureId: "handoff" });
    assert.equal(finalStatus.状态, "已完成");
    const delivery = await mcpCall(finishServer, fixture.root, "dev_flow_inspect", { featureId: "handoff", topic: "delivery" });
    assert.equal(delivery.content.snapshot, "已生成");
  } finally {
    await fixture.dispose();
  }
}

test("marketplace-installed Claude and Codex exchange one v5 feature state in both directions", { skip: !hostE2EEnabled, timeout: 240_000 }, async () => {
  const hosts = await installNativeHosts();
  try {
    const claudeMcp = path.join(hosts.claudeRoot, "dist", "mcp-server.mjs");
    const codexMcp = path.join(hosts.codexRoot, "dist", "mcp-server.mjs");
    await finishS(claudeMcp, codexMcp, path.join(hosts.codexRoot, "dist", "codex-hook.mjs"), "claude", "codex");
    await finishS(codexMcp, claudeMcp, path.join(hosts.claudeRoot, "dist", "claude-hook.mjs"), "codex", "claude");
  } finally {
    await hosts.cleanup();
  }
});
