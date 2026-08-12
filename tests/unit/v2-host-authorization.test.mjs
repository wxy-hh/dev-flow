import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const risk = await loadSource("plugins/dev-flow/src/hosts/risk-policy.ts");
const authorization = await loadSource("plugins/dev-flow/src/hosts/host-authorization.ts");

async function startFeature(root, featureId = "feature") {
  await state.initProject(root, strictProjectConfig);
  return state.startFeature(root, {
    featureId,
    objective: "验证 feature 级宿主授权",
    scope: { inScope: ["src/counter.js"], outOfScope: [] },
    host: "codex",
  });
}

function request(command, eventId = "permission-1", ids = {}) {
  return {
    hook_event_name: "PermissionRequest",
    event_id: eventId,
    tool_name: "Bash",
    tool_input: { command },
    ...ids,
  };
}

function post(command, eventId = "tool-1", ids = {}) {
  return {
    hook_event_name: "PostToolUse",
    event_id: eventId,
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { success: true },
    ...ids,
  };
}

test("每次执行都重新确认：成功 PostToolUse 只留审计记录，相同命令或跨宿主再次执行仍 defer", async () => {
  const fixture = await createTinyApp();
  try {
    await startFeature(fixture.root);
    const first = await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-1", { tool_use_id: "exec-a" }), "codex");
    assert.equal(first?.kind, "defer");
    let events = await state.readHostAuthorizationEvents(fixture.root, "feature");
    assert.deepEqual(events.map((event) => event.type), ["host-authorization-pending"]);
    assert.equal("command" in events[0].data, false);

    await authorization.recordPermissionPostToolUse(fixture.root, post("rm -rf src/generated", "tool-a", { tool_use_id: "exec-a" }), "codex");
    events = await state.readHostAuthorizationEvents(fixture.root, "feature");
    assert.deepEqual(events.map((event) => event.type), ["host-authorization-pending", "host-authorization-granted"]);
    assert.equal(events[1].data.riskClass, "task-reusable");
    assert.equal(events[1].data.featureId, "feature");
    assert.match(events[1].data.commandFingerprint, /^[a-f0-9]{64}$/);

    // ADR-0004：授权不跨执行复用——相同命令、不同目标、跨宿主全部重新确认。
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-2", { tool_use_id: "exec-b" }), "codex"))?.kind, "defer");
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/other", "permission-3", { tool_use_id: "exec-c" }), "codex"))?.kind, "defer");
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/third-party", "permission-4", { tool_use_id: "exec-d" }), "claude"))?.kind, "defer");
    events = await state.readHostAuthorizationEvents(fixture.root, "feature");
    assert.deepEqual(events.map((event) => event.type), [
      "host-authorization-pending", "host-authorization-granted",
      "host-authorization-pending", "host-authorization-pending", "host-authorization-pending",
    ]);
  } finally {
    await fixture.dispose();
  }
});

test("同一次执行的重复 PermissionRequest 通知只产生一次确认和一组审计事件", async () => {
  const fixture = await createTinyApp();
  try {
    await startFeature(fixture.root);
    // 同一 permission_request_id（同一执行）的重复通知：第一次 defer，之后静默去重。
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-1", { permission_request_id: "permission-same" }), "codex"))?.kind, "defer");
    assert.equal(await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-1", { permission_request_id: "permission-same" }), "codex"), undefined);
    assert.equal(await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-1", { permission_request_id: "permission-same" }), "codex"), undefined);
    const events = await state.readHostAuthorizationEvents(fixture.root, "feature");
    assert.deepEqual(events.map((event) => event.type), ["host-authorization-pending"]);
    assert.equal(events[0].data.executionKey, "permission-same");
  } finally {
    await fixture.dispose();
  }
});

test("相同命令两次执行需要两次确认，host 通知按 executionKey 配对审计闭环", async () => {
  const fixture = await createTinyApp();
  try {
    await startFeature(fixture.root);
    // 第一次执行：defer → 成功 → granted（审计）；PermissionRequest 与 PostToolUse 共享 tool_use_id。
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-1", { tool_use_id: "exec-1" }), "codex"))?.kind, "defer");
    await authorization.recordPermissionPostToolUse(fixture.root, post("rm -rf src/generated", "tool-1", { tool_use_id: "exec-1" }), "codex");
    // 第二次执行（相同命令、新 tool_use_id）：仍然 defer，必须再次确认
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-2", { tool_use_id: "exec-2" }), "codex"))?.kind, "defer");
    await authorization.recordPermissionPostToolUse(fixture.root, post("rm -rf src/generated", "tool-2", { tool_use_id: "exec-2" }), "codex");
    const events = await state.readHostAuthorizationEvents(fixture.root, "feature");
    assert.deepEqual(events.map((event) => event.type), [
      "host-authorization-pending", "host-authorization-granted",
      "host-authorization-pending", "host-authorization-granted",
    ]);
    assert.deepEqual(events.map((event) => event.data.executionKey), ["exec-1", "exec-1", "exec-2", "exec-2"]);
  } finally {
    await fixture.dispose();
  }
});

test("没有 PostToolUse 或工具失败时不生成 grant", async () => {
  const fixture = await createTinyApp();
  try {
    await startFeature(fixture.root);
    await authorization.evaluatePermissionRequest(fixture.root, request("git reset --hard HEAD"), "claude");
    await authorization.recordPermissionPostToolUse(fixture.root, {
      ...post("git reset --hard HEAD"),
      tool_response: { success: false, error: "denied" },
    }, "claude");
    assert.deepEqual((await state.readHostAuthorizationEvents(fixture.root, "feature")).map((event) => event.type), ["host-authorization-pending"]);
  } finally {
    await fixture.dispose();
  }
});

test("切换 active feature 后旧 grant 不复用，abandon 后也不复用", async () => {
  const fixture = await createTinyApp();
  try {
    let current = await startFeature(fixture.root, "first");
    await authorization.evaluatePermissionRequest(fixture.root, request("git clean -fd"), "codex");
    await authorization.recordPermissionPostToolUse(fixture.root, post("git clean -fd"), "codex");
    await state.startFeature(fixture.root, {
      featureId: "second",
      objective: "切换 feature",
      activation: "paused",
      scope: { inScope: ["src/counter.js"], outOfScope: [] },
      host: "codex",
    });
    current = await state.switchActive(fixture.root, "first", "second", "authorization test");
    assert.equal(current.featureId, "second");
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("git clean -fd", "permission-2"), "codex")), undefined);
    await state.abandonFeature(fixture.root, "second", current.revision, "test", "user confirmed test abandon");
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("git clean -fd", "permission-3"), "codex")), undefined);
  } finally {
    await fixture.dispose();
  }
});

test("always-confirm 外部动作即使成功也不生成 grant", async () => {
  const fixture = await createTinyApp();
  try {
    await startFeature(fixture.root);
    const assessment = risk.classifyRisk({ toolName: "Bash", toolInput: { command: "git push origin main" } }, fixture.root);
    assert.equal(assessment?.riskClass, "always-confirm");
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("git push origin main"), "codex"))?.kind, "defer");
    await authorization.recordPermissionPostToolUse(fixture.root, post("git push origin main"), "codex");
    assert.deepEqual((await state.readHostAuthorizationEvents(fixture.root, "feature")).map((event) => event.type), ["host-authorization-pending"]);
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("git push origin main", "permission-2"), "codex"))?.kind, "defer");
  } finally {
    await fixture.dispose();
  }
});

test("仓库外或无法静态确定的 destructive target 不进入可复用授权", () => {
  const root = "/tmp/dev-flow-risk-root";
  assert.equal(risk.classifyRisk({ toolName: "Bash", toolInput: { command: "rm -rf /tmp/other" } }, root)?.riskClass, "always-confirm");
  assert.equal(risk.classifyRisk({ toolName: "Bash", toolInput: { command: "rm -rf $TARGET" } }, root)?.riskClass, "always-confirm");
});
