// 回归：hook 在子目录 cwd 下运行时，宿主事件必须写入项目根 .dev-flow 账本。
// 真实故障：agent 在 Bash 中 cd packages/svelte 后，AskUserQuestion 回答事件
// 被静默丢弃（recordHostEvent 在子目录下找不到 active.json），dev_flow_answer
// 永远 INTERACTION_PROVENANCE_UNAVAILABLE；健康信号同时分裂到子目录账本。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { invokeHook, mcpCall } from "../helpers/host-runner.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const resolver = await loadSource("plugins/dev-flow/src/hosts/project-root.ts");
const bundles = await buildTestBundles();
const claudeHook = bundles.pathFor("claude-hook");
const codexHook = bundles.pathFor("codex-hook");
const server = bundles.pathFor("mcp-server");

test("claude hook 子目录 cwd 下 AskUserQuestion 回答落入根账本并可消解追认", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "subdir-claude", objective: "子目录 hook 事件", host: "claude" });

    // agent 在 Bash 中 cd 进子目录（真实会话发生在 packages/svelte）
    const subdir = path.join(fixture.root, "packages", "svelte");
    await mkdir(subdir, { recursive: true });

    await mcpCall(server, fixture.root, "dev_flow_record_decision", {
      featureId: "subdir-claude", expectedRevision: started.revision,
      question: "本任务的交付物范围是什么？",
      evidence: "用户选择仅产出计划",
      conclusion: "仅产出计划",
      host: "claude",
    });
    const recState = await store.readState(fixture.root, "subdir-claude");
    const ratifyInteraction = Object.values(recState.interactions).find((i) => i.status === "pending");

    // 用户通过 AskUserQuestion 回答「确认登记」；hook 事件从子目录 cwd 触发
    await invokeHook(claudeHook, subdir, {
      cwd: subdir,
      hook_event_name: "PostToolUse", event_id: "ask-subdir-1", tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: ratifyInteraction.question, options: [{ label: "确认登记" }, { label: "不要登记" }] }] },
      tool_response: `Your questions have been answered: "${ratifyInteraction.question}"="确认登记". You can now continue with these answers in mind.`,
    });

    // 回答事件必须出现在根账本（而不是被丢弃到子目录）
    const events = await store.readFeatureEvents(fixture.root, "subdir-claude");
    const answerEvent = events.find((e) => String(e.data?.eventId ?? "").includes("ask-subdir-1:answer"));
    assert.ok(answerEvent, "子目录 cwd 下 hook 应把回答事件写入根 .dev-flow 账本");
    assert.equal(answerEvent.data.text, "确认登记");

    // 健康信号也必须写入根账本，子目录不得产生分裂账本
    const health = await readFile(path.join(fixture.root, ".dev-flow", "host-health.jsonl"), "utf8");
    assert.match(health, /ask-subdir-1:answer/, "回答健康信号应写入根 host-health.jsonl");
    await assert.rejects(readFile(path.join(subdir, ".dev-flow", "host-health.jsonl")), "子目录不应产生独立的 host-health 账本");

    // 端到端：dev_flow_answer 应能消解追认（真实会话中此步失败）
    const before = await store.readState(fixture.root, "subdir-claude");
    await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId: "subdir-claude", expectedRevision: before.revision, host: "claude",
    });
    const after = await store.readState(fixture.root, "subdir-claude");
    assert.equal(after.governance.decisions.length, 1, "决策应已登记");
    assert.equal(after.governance.decisions[0].conclusion, "仅产出计划");
  } finally { await fixture.dispose(); }
});

test("codex hook 子目录 cwd 下用户消息落入根账本", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "subdir-codex", objective: "子目录 hook 事件", host: "codex" });
    const subdir = path.join(fixture.root, "packages", "svelte");
    await mkdir(subdir, { recursive: true });

    await invokeHook(codexHook, subdir, {
      cwd: subdir,
      hook_event_name: "UserPromptSubmit", event_id: "prompt-subdir-1", prompt: "确认登记",
    });

    const events = await store.readFeatureEvents(fixture.root, "subdir-codex");
    const promptEvent = events.find((e) => String(e.data?.eventId ?? "") === "prompt-subdir-1");
    assert.ok(promptEvent, "codex 子目录 cwd 下 hook 应把用户消息写入根账本");
    assert.equal(promptEvent.data.type, "user-prompt");
    assert.equal(promptEvent.data.text, "确认登记");
  } finally { await fixture.dispose(); }
});

test("resolveDevFlowRoot 向上查找最近带标记的根，无标记时回退 cwd", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "dev-flow-root-"));
  const subdir = path.join(base, "a", "b", "c");
  await mkdir(path.join(base, ".dev-flow"), { recursive: true });
  await mkdir(subdir, { recursive: true });
  await writeFile(path.join(base, ".dev-flow", "project.json"), "{}");

  assert.equal(await resolver.resolveDevFlowRoot(subdir), base, "应向上找到最近的 dev-flow 根");
  assert.equal(await resolver.resolveDevFlowRoot(base), base, "根目录自身应命中");

  // 无标记目录（如健康记录器遗留的裸 .dev-flow）不应被当作根
  await mkdir(path.join(subdir, ".dev-flow"), { recursive: true });
  assert.equal(await resolver.resolveDevFlowRoot(subdir), base, "裸 .dev-flow 目录不应命中，继续向上");

  // 没有任何标记时回退到原 cwd
  const foreign = await mkdtemp(path.join(tmpdir(), "dev-flow-foreign-"));
  assert.equal(await resolver.resolveDevFlowRoot(foreign), foreign, "无标记时回退 cwd");
});
