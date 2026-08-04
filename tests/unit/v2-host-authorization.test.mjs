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

function request(command, eventId = "permission-1") {
  return {
    hook_event_name: "PermissionRequest",
    event_id: eventId,
    tool_name: "Bash",
    tool_input: { command },
  };
}

function post(command, eventId = "tool-1") {
  return {
    hook_event_name: "PostToolUse",
    event_id: eventId,
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { success: true },
  };
}

test("首次 task-reusable PermissionRequest 不代决，成功 PostToolUse 后生成 feature grant", async () => {
  const fixture = await createTinyApp();
  try {
    await startFeature(fixture.root);
    const first = await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated"), "codex");
    assert.equal(first?.kind, "defer");
    let events = await state.readHostAuthorizationEvents(fixture.root, "feature");
    assert.deepEqual(events.map((event) => event.type), ["host-authorization-pending"]);
    assert.equal("command" in events[0].data, false);

    await authorization.recordPermissionPostToolUse(fixture.root, post("rm -rf src/generated"), "codex");
    events = await state.readHostAuthorizationEvents(fixture.root, "feature");
    assert.deepEqual(events.map((event) => event.type), ["host-authorization-pending", "host-authorization-granted"]);
    assert.equal(events[1].data.riskClass, "task-reusable");
    assert.equal(events[1].data.featureId, "feature");
    assert.match(events[1].data.commandFingerprint, /^[a-f0-9]{64}$/);
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/generated", "permission-2"), "codex"))?.kind, "allow");
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/other", "permission-3"), "codex"))?.kind, "allow");
    assert.equal((await authorization.evaluatePermissionRequest(fixture.root, request("rm -rf src/third-party", "permission-4"), "claude"))?.kind, "allow");
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
