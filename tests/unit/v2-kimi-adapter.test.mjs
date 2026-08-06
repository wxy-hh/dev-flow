import assert from "node:assert/strict";
import test, { after } from "node:test";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { run } from "../helpers/host-runner.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const bundles = await buildTestBundles();
after(() => bundles.dispose());

async function invokeKimi(cwd, event) {
  return run(process.execPath, [bundles.pathFor("kimi-hook")], { cwd, input: `${JSON.stringify({ cwd, ...event })}\n` });
}

async function startIntakeKimi() {
  const fixture = await createTinyApp();
  await state.initProject(fixture.root, strictProjectConfig);
  await state.startFeature(fixture.root, {
    featureId: "kimi",
    objective: "验证 Kimi 宿主协议",
    scope: { inScope: ["src/counter.js"], outOfScope: [] },
    host: "kimi",
  });
  return fixture;
}

test("Kimi PreToolUse allow exits with no stdout", async () => {
  const fixture = await createTinyApp();
  try {
    const result = await invokeKimi(fixture.root, {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { path: "README.md" },
    });
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await fixture.dispose();
  }
});

test("Kimi PreToolUse block uses permissionDecision deny without hookEventName", async () => {
  const fixture = await startIntakeKimi();
  try {
    const result = await invokeKimi(fixture.root, {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/counter.js" },
    });
    const output = JSON.parse(result.stdout);
    assert.equal("hookEventName" in output.hookSpecificOutput, false);
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /原因：/);
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /影响：/);
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /解决方案：/);
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /继续方式：/);
  } finally {
    await fixture.dispose();
  }
});

test("Kimi PermissionRequest 只记账、永不输出 allow", async () => {
  const fixture = await startIntakeKimi();
  try {
    const result = await invokeKimi(fixture.root, {
      hook_event_name: "PermissionRequest",
      tool_call_id: "tool_kimi-perm-1",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src/generated" },
    });
    assert.equal(result.stdout, "");
    const events = await state.readHostAuthorizationEvents(fixture.root, "kimi");
    const pending = events.find((event) => event.type === "host-authorization-pending" && event.data.host === "kimi");
    assert.ok(pending, "kimi PermissionRequest should record host-authorization-pending");
    assert.equal(pending.data.riskClass, "task-reusable");
  } finally {
    await fixture.dispose();
  }
});

test("Kimi PermissionResult 记录真实决策到 result 事件", async () => {
  const fixture = await startIntakeKimi();
  try {
    const result = await invokeKimi(fixture.root, {
      hook_event_name: "PermissionResult",
      tool_call_id: "tool_kimi-perm-2",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src/generated" },
      decision: "allowed",
    });
    assert.equal(result.stdout, "");
    const events = await state.readFeatureEvents(fixture.root, "kimi");
    const record = events.find((event) => event.type === "host-authorization-result");
    assert.ok(record, "kimi PermissionResult should record host-authorization-result");
    assert.equal(record.data.decision, "allowed");
    assert.ok(record.data.decidedAt);
  } finally {
    await fixture.dispose();
  }
});

test("Kimi 成功的 PostToolUse 不写 granted(无授权记忆)", async () => {
  const fixture = await startIntakeKimi();
  try {
    await invokeKimi(fixture.root, {
      hook_event_name: "PermissionRequest",
      tool_call_id: "tool_kimi-tool-1",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src/generated" },
    });
    await invokeKimi(fixture.root, {
      hook_event_name: "PostToolUse",
      tool_call_id: "tool_kimi-tool-1",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src/generated" },
      tool_output: "done",
    });
    const events = await state.readHostAuthorizationEvents(fixture.root, "kimi");
    assert.equal(events.some((event) => event.type === "host-authorization-granted"), false, "kimi must never record granted");
  } finally {
    await fixture.dispose();
  }
});

test("Kimi UserPromptSubmit 从 prompt 数组提取文本并记录 user-prompt", async () => {
  const fixture = await startIntakeKimi();
  try {
    await invokeKimi(fixture.root, {
      hook_event_name: "UserPromptSubmit",
      prompt: [{ type: "text", text: "开始一个 feature" }],
    });
    const events = await state.readFeatureEvents(fixture.root, "kimi");
    const hostEvents = events.filter((event) => event.type === "host-event");
    const promptEvent = hostEvents.find((event) => event.data.type === "user-prompt");
    assert.ok(promptEvent, "kimi UserPromptSubmit should record a user-prompt host event");
    assert.equal(promptEvent.data.host, "kimi");
    assert.equal(promptEvent.data.text, "开始一个 feature");
  } finally {
    await fixture.dispose();
  }
});

test("Kimi PostToolUse 用 tool_call_id 作为事件 id 并记录 tool 事件", async () => {
  const fixture = await startIntakeKimi();
  try {
    await invokeKimi(fixture.root, {
      hook_event_name: "PostToolUse",
      tool_call_id: "tool_kimi-tool-7",
      tool_name: "Write",
      tool_input: { file_path: "src/ok.txt" },
      tool_output: "created",
    });
    const events = await state.readFeatureEvents(fixture.root, "kimi");
    const toolEvent = events.find((event) => event.type === "host-event" && event.data.type === "tool");
    assert.ok(toolEvent, "kimi PostToolUse should record a tool host event");
    assert.equal(toolEvent.data.eventId, "tool_kimi-tool-7");
    assert.equal(toolEvent.data.host, "kimi");
  } finally {
    await fixture.dispose();
  }
});
