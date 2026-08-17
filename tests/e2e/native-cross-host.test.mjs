import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { hostE2EEnabled, invokeHook, mcpCall } from "../helpers/host-runner.mjs";
import { installNativeHosts } from "../helpers/native-hosts.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

const boundaryAudit = {
  scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"],
  items: [],
};

/** 登记一条绑定既有受管文件的仓库事实（v5 分类引用事实记录，ADR-0018）。 */
async function registerFixtureFact(root, featureId, revision, host) {
  const registered = await store.registerRepositoryFact(root, featureId, revision, {
    assertion: "计数器组件及其测试",
    location: { kind: "positive", path: "src/counter.js" },
  }, host);
  return {
    factRef: registered.recordId,
    revision: registered.state.revision,
  };
}

async function trustedEdit(hook, root, file, transform, eventId) {
  const event = { event_id: eventId, tool_name: "Edit", tool_input: { file_path: file } };
  assert.equal(await invokeHook(hook, root, { ...event, hook_event_name: "PreToolUse" }), undefined);
  await writeFile(file, transform(await readFile(file, "utf8")));
  assert.equal(await invokeHook(hook, root, { ...event, hook_event_name: "PostToolUse", tool_response: { success: true } }), undefined);
}

async function completeReviewWithSubagents(server, hook, root, created) {
  const executionRequestId = `exec-cross-host-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = await mcpCall(server, root, "dev_flow_start_review_execution", {
    featureId: "handoff",
    expectedRevision: created.state.revision,
    batchId: created.batch.batchId,
    executionRequestId,
    host: "claude",
  });
  for (const job of started.jobs) {
    const completion = JSON.stringify({ coverageSummary: `${job.role} cross-host review complete`, findings: [] });
    await invokeHook(hook, root, {
      hook_event_name: "SubagentStop",
      event_id: `subagent-${job.jobId}`,
      session_id: "implementation-session",
      agent_id: `review-subagent-${job.jobId}`,
      last_assistant_message: `dev-flow:isolated-review:${job.declarationId}\n${completion}`,
    });
  }
  return mcpCall(server, root, "dev_flow_complete_review_execution", {
    featureId: "handoff",
    expectedRevision: started.state.revision,
    batchId: created.batch.batchId,
    executionRequestId,
  });
}

async function finishS(startServer, startHook, finishServer, finishHook, starter, finisher) {
  const fixture = await createTinyApp();
  try {
    await mcpCall(startServer, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    await invokeHook(startHook, fixture.root, { hook_event_name: "SessionStart", event_id: `${starter}-session-start` });
    let state = await mcpCall(startServer, fixture.root, "dev_flow_start", {
      featureId: "handoff", objective: "调整本地计数规则", host: starter,
      scope: { inScope: ["src/counter.js", "test/counter.test.js"], outOfScope: [] },
    }, { requireRealHostHealth: true });
    const { factRef, revision: afterFact } = await registerFixtureFact(fixture.root, "handoff", state.revision, starter);
    state = await mcpCall(finishServer, fixture.root, "dev_flow_lock_classification", {
      featureId: "handoff",
      expectedRevision: afterFact,
      classification: {
        level: "S",
        topology: "local",
        requirements: "provided-confirmed",
        classificationBasis: {
          scopeFactRefs: [factRef],
          topologyFactRefs: [factRef],
          uncertaintyFactRefs: [],
          riskFactRefs: {},
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

    await invokeHook(finishHook, fixture.root, { hook_event_name: "SessionStart", event_id: `${finisher}-session-start` });
    await trustedEdit(finishHook, fixture.root, path.join(fixture.root, "src", "counter.js"), (source) => source.replace("value + 1", "value + 2"), `${finisher}-source`);
    await trustedEdit(finishHook, fixture.root, path.join(fixture.root, "test", "counter.test.js"), (source) => source.replace("increment(1), 2", "increment(1), 3"), `${finisher}-test`);
    const afterWrites = await mcpCall(finishServer, fixture.root, "dev_flow_status", { featureId: "handoff" });
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", {
      featureId: "handoff", expectedRevision: afterWrites.control.expectedRevision, step: "implementation", evidence: {},
    });
    // 独立代码审查（ADR-0017）：S 路线 focused 审查先创建并完成 code 批次
    // （无隔离要求），再登记 code_review 步骤证据。
    const created = await mcpCall(finishServer, fixture.root, "dev_flow_create_review_batch", {
      featureId: "handoff", expectedRevision: state.revision,
    });
    assert.equal(created.batch.phase, "code");
    // v6 合同：start 一次领取全部 job，宿主 SubagentStop 捕获各自 envelope，
    // complete 一次批量提交。Codex 尚无 trusted sampling，因此两个方向的
    // review execution 都由 Claude MCP/hook 协调。
    const reviewServer = starter === "claude" ? startServer : finishServer;
    const reviewHook = starter === "claude" ? startHook : finishHook;
    const reviewState = await completeReviewWithSubagents(reviewServer, reviewHook, fixture.root, created);
    state = await mcpCall(finishServer, fixture.root, "dev_flow_record_step", {
      featureId: "handoff", expectedRevision: reviewState.state.revision, step: "code_review",
      evidence: {
        reviewType: "code",
        coverage: ["quality", "fidelity"],
        findings: [],
      },
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

test("source bundles replay two complete public cross-host journeys with real hook health", { timeout: 240_000 }, async () => {
  const bundles = await buildTestBundles();
  try {
    const mcp = bundles.pathFor("mcp-server");
    const claudeHook = bundles.pathFor("claude-hook");
    const codexHook = bundles.pathFor("codex-hook");
    await finishS(mcp, claudeHook, mcp, codexHook, "claude", "codex");
    await finishS(mcp, codexHook, mcp, claudeHook, "codex", "claude");
  } finally {
    await bundles.dispose();
  }
});

test("marketplace-installed Claude and Codex exchange one v6 feature state in both directions", { skip: !hostE2EEnabled, timeout: 240_000 }, async () => {
  const hosts = await installNativeHosts();
  try {
    const claudeMcp = path.join(hosts.claudeRoot, "dist", "mcp-server.mjs");
    const codexMcp = path.join(hosts.codexRoot, "dist", "mcp-server.mjs");
    await finishS(
      claudeMcp,
      path.join(hosts.claudeRoot, "dist", "claude-hook.mjs"),
      codexMcp,
      path.join(hosts.codexRoot, "dist", "codex-hook.mjs"),
      "claude",
      "codex",
    );
    await finishS(
      codexMcp,
      path.join(hosts.codexRoot, "dist", "codex-hook.mjs"),
      claudeMcp,
      path.join(hosts.claudeRoot, "dist", "claude-hook.mjs"),
      "codex",
      "claude",
    );
  } finally {
    await hosts.cleanup();
  }
});
