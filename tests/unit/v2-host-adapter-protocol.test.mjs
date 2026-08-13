import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test, { after } from "node:test";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { run } from "../helpers/host-runner.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const bundles = await buildTestBundles();
after(() => bundles.dispose());

async function invokeRaw(hook, cwd, event) {
  return run(process.execPath, [hook], { cwd, input: `${JSON.stringify({ cwd, ...event })}\n` });
}

async function startIntake() {
  const fixture = await createTinyApp();
  await state.initProject(fixture.root, strictProjectConfig);
  await state.startFeature(fixture.root, {
    featureId: "protocol",
    objective: "验证宿主协议",
    scope: { inScope: ["src/counter.js"], outOfScope: [] },
    host: "codex",
  });
  return fixture;
}

test("Claude PreToolUse allow exits with no stdout", async () => {
  const fixture = await createTinyApp();
  try {
    const result = await invokeRaw(bundles.pathFor("claude-hook"), fixture.root, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "node verification-script.mjs | tee /tmp/dev-flow-verification.log" },
    });
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await fixture.dispose();
  }
});

test("Claude PreToolUse block uses current hookSpecificOutput deny protocol", async () => {
  const fixture = await startIntake();
  try {
    const result = await invokeRaw(bundles.pathFor("claude-hook"), fixture.root, {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/counter.js" },
    });
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /原因：/);
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /影响：/);
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /解决方案：/);
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /继续方式：/);
    assert.equal("continue" in output, false);
    assert.equal("decision" in output, false);
  } finally {
    await fixture.dispose();
  }
});

test("Codex PreToolUse allow exits with no stdout", async () => {
  const fixture = await createTinyApp();
  try {
    const result = await invokeRaw(bundles.pathFor("codex-hook"), fixture.root, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "bash -c 'printf ok > docs/result.md'" },
    });
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await fixture.dispose();
  }
});

test("Codex PreToolUse block uses decision block without unsupported fields", async () => {
  const fixture = await startIntake();
  try {
    const result = await invokeRaw(bundles.pathFor("codex-hook"), fixture.root, {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/counter.js" },
    });
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /原因：/);
    assert.match(output.reason, /影响：/);
    assert.match(output.reason, /解决方案：/);
    assert.match(output.reason, /继续方式：/);
    assert.equal("continue" in output, false);
    assert.equal("stopReason" in output, false);
    assert.equal("permissionDecision" in output, false);
  } finally {
    await fixture.dispose();
  }
});

test("a recovered SessionStart asks Core to reconcile changed workspace automatically", async (t) => {
  for (const host of ["claude", "codex"]) {
    await t.test(host, async () => {
      const fixture = await startIntake();
      try {
        await state.recordHostHealth(fixture.root, {
          host,
          kind: "session-start",
          eventId: `stale-${host}`,
          at: "2020-01-01T00:00:00.000Z",
        });
        await writeFile(`${fixture.root}/src/counter.js`, "export const counter = 2;\n");
        const before = await state.readState(fixture.root, "protocol");
        await invokeRaw(bundles.pathFor(`${host}-hook`), fixture.root, {
          hook_event_name: "SessionStart",
          event_id: `recovered-${host}`,
        });
        const after = await state.readState(fixture.root, "protocol");
        assert.equal(after.revision, before.revision + 1);
        assert.deepEqual(after.workspace.unownedPaths, ["src/counter.js"]);
        assert.equal(Object.values(after.interactions ?? {}).filter((item) => item.status === "pending").length, 1);
      } finally {
        await fixture.dispose();
      }
    });
  }
});

test("Claude PermissionRequest 每次都放行原生确认：成功 PostToolUse 只留审计，相同命令再次执行仍 defer", async () => {
  const fixture = await startIntake();
  try {
    const hook = bundles.pathFor("claude-hook");
    const first = await invokeRaw(hook, fixture.root, {
      hook_event_name: "PermissionRequest",
      event_id: "claude-permission-1",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src/generated" },
    });
    assert.equal(first.stdout, "");
    await invokeRaw(hook, fixture.root, {
      hook_event_name: "PostToolUse",
      event_id: "claude-tool-1",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src/generated" },
      tool_response: { success: true },
    });
    // ADR-0004：授权不跨执行复用——相同命令再次执行仍回到宿主确认。
    const second = await invokeRaw(hook, fixture.root, {
      hook_event_name: "PermissionRequest",
      event_id: "claude-permission-2",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src/generated" },
    });
    assert.equal(second.stdout, "");
  } finally {
    await fixture.dispose();
  }
});

test("Claude AskUserQuestion 的真实用户选择可直接消解已呈现的 workspace ownership", async () => {
  const fixture = await createTinyApp();
  try {
    await state.initProject(fixture.root, strictProjectConfig);
    const started = await state.startFeature(fixture.root, {
      featureId: "native-question",
      objective: "验证原生问题回答只需一次",
      host: "claude",
    });
    await writeFile(`${fixture.root}/src/started-a.js`, "export const startedA = true;\n");
    await writeFile(`${fixture.root}/src/started-b.js`, "export const startedB = true;\n");
    const pending = await state.reconcileWorkspace(fixture.root, "native-question", started.revision, "claude");
    const interaction = Object.values(pending.interactions ?? {}).find((item) => item.kind === "workspace-ownership" && item.status === "pending");
    assert.ok(interaction);

    const answer = "全部纳入当前任务";
    const result = await invokeRaw(bundles.pathFor("claude-hook"), fixture.root, {
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      tool_use_id: "ask-ownership",
      tool_input: {
        questions: [{
          question: interaction.question,
          header: "工作区归属",
          multiSelect: false,
          options: interaction.options.map((option) => ({ label: option.label, description: option.label })),
        }],
      },
      tool_response: `Your questions have been answered: "${interaction.question}"="${answer}". You can now continue with these answers in mind.`,
    });
    assert.equal(result.stderr, "");
    const promptHealth = [...await state.readHostHealth(fixture.root)].reverse().find((signal) => signal.host === "claude" && signal.kind === "user-prompt-submit");
    assert.equal(promptHealth?.eventId, "ask-ownership:answer");

    const resolved = await state.answer({
      root: fixture.root,
      featureId: pending.featureId,
      expectedRevision: pending.revision,
      host: "claude",
      credential: { source: "text", userReply: answer },
    });
    assert.equal(resolved.action, "adopt-all");
    assert.equal(Object.values(resolved.state.interactions ?? {}).some((item) => item.status === "pending"), false);
  } finally {
    await fixture.dispose();
  }
});

test("Codex PermissionRequest 每次都不代决：成功 PostToolUse 只留审计，相同命令再次执行仍 defer", async () => {
  const fixture = await startIntake();
  try {
    const hook = bundles.pathFor("codex-hook");
    const first = await invokeRaw(hook, fixture.root, {
      hook_event_name: "PermissionRequest",
      event_id: "codex-permission-1",
      tool_name: "Bash",
      tool_input: { command: "git reset --hard HEAD" },
    });
    assert.equal(first.stdout, "");
    await invokeRaw(hook, fixture.root, {
      hook_event_name: "PostToolUse",
      event_id: "codex-tool-1",
      tool_name: "Bash",
      tool_input: { command: "git reset --hard HEAD" },
      tool_response: { success: true },
    });
    // ADR-0004：授权不跨执行复用——相同命令再次执行仍回到宿主确认。
    const second = await invokeRaw(hook, fixture.root, {
      hook_event_name: "PermissionRequest",
      event_id: "codex-permission-2",
      tool_name: "Bash",
      tool_input: { command: "git reset --hard HEAD" },
    });
    assert.equal(second.stdout, "");
  } finally {
    await fixture.dispose();
  }
});

test("Claude and Codex adapters persist successful browser executions as verifiable tool events", async (t) => {
  for (const host of ["claude", "codex"]) {
    await t.test(host, async () => {
      const fixture = await startIntake();
      try {
        await invokeRaw(bundles.pathFor(`${host}-hook`), fixture.root, {
          hook_event_name: "PostToolUse",
          event_id: `${host}-browser-result`,
          tool_use_id: `${host}-browser-execution`,
          tool_name: "browser_click",
          tool_input: { selector: "#save" },
          tool_response: { success: true, message: "button clicked" },
        });
        const events = await state.readFeatureEvents(fixture.root, "protocol");
        const recorded = events.find((event) => event.type === "host-event" && event.data.eventId === `${host}-browser-result`);
        assert.equal(recorded?.data.type, "tool");
        assert.equal(recorded?.data.toolName, "browser_click");
        assert.equal(recorded?.data.executionId, `${host}-browser-execution`);
        assert.match(recorded?.data.resultSummary, /button clicked/);
      } finally {
        await fixture.dispose();
      }
    });
  }
});
