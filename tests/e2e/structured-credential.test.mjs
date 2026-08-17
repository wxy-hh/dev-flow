// 切片 2（03-askuserquestion-structured-credential）：表单选中即信任。
// 事件携带问题文本；归属以事件内容解析选项，agent 转述完全不参与。
import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { invokeHook } from "../helpers/host-runner.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const bundles = await buildTestBundles();
const hook = bundles.pathFor("claude-hook");

const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };

async function lockRouteConfirmation(fixture, featureId) {
  await store.initProject(fixture.root, strictProjectConfig);
  const started = await store.startFeature(fixture.root, { featureId, objective: "测试结构化凭证", host: "claude" });
  // v5 分类引用已登记的仓库事实记录（ADR-0018）：绑定既有受管文件，不新增文件。
  const withFact = await store.registerRepositoryFact(fixture.root, featureId, started.revision, {
    assertion: "只改一个模块",
    location: { kind: "positive", path: "src/counter.js" },
  }, "claude");
  const factRef = withFact.recordId;
  const pending = await store.lockClassification(fixture.root, featureId, withFact.state.revision, {
    scopeFactRefs: [factRef], topologyFactRefs: [factRef], uncertaintyFactRefs: [],
    riskFactRefs: {}, decisionRefs: [],
    signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
    level: "M", topology: "local", requirements: "provided-confirmed",
  }, boundaryAudit);
  assert.equal(decisions.pendingDecisionForState(pending).kind, "route-confirmation");
  return pending;
}

test("hook 记录 AskUserQuestion 回答事件时携带问题文本（不再只落文本）", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "struct-hook", objective: "测试 hook 结构化记录", host: "claude" });
    const question = "请确认 Dev Flow 路线：planning → implementation";
    await invokeHook(hook, fixture.root, {
      hook_event_name: "PostToolUse",
      event_id: "ask-q-1",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question, options: [{ label: "确认这条路线" }, { label: "修正分类事实" }] }] },
      tool_response: { answers: { [question]: "确认这条路线（推荐）" } },
    });
    const events = await store.readFeatureEvents(fixture.root, "struct-hook");
    const answerEvent = events.find((record) => record.data?.eventId === "ask-q-1:answer:0");
    assert.ok(answerEvent, "AskUserQuestion 回答应记录为 user-prompt 事件");
    assert.equal(answerEvent.data.text, "确认这条路线（推荐）");
    assert.equal(answerEvent.data.question, question, "事件应携带问题文本");
  } finally { await fixture.dispose(); }
});

test("选中即信任：结构化事件按事件内容落账，不依赖调用方文本", async () => {
  const fixture = await createTinyApp();
  try {
    const pending = await lockRouteConfirmation(fixture, "struct-mcp");
    await store.recordHostEvent(fixture.root, {
      eventId: "answer-struct", type: "user-prompt", host: "claude",
      text: "确认这条路线（推荐）", question: "请确认 Dev Flow 路线",
    });
    const routed = (await store.answerFromHostEvents({ root: fixture.root, featureId: pending.featureId, expectedRevision: pending.revision, host: "claude" })).state;
    assert.equal(routed.mode, "routed");
    assert.equal(decisions.pendingDecisionForState(routed), undefined);
  } finally { await fixture.dispose(); }
});

test("无问题字段的文本事件仍按事件内容确认（问题文本不是信任前提）", async () => {
  const fixture = await createTinyApp();
  try {
    const pending = await lockRouteConfirmation(fixture, "struct-text");
    await store.recordHostEvent(fixture.root, {
      eventId: "answer-text", type: "user-prompt", host: "claude", text: "确认这条路线",
    });
    const routed = (await store.answerFromHostEvents({ root: fixture.root, featureId: pending.featureId, expectedRevision: pending.revision, host: "claude" })).state;
    assert.equal(routed.mode, "routed");
    assert.equal(decisions.pendingDecisionForState(routed), undefined);
  } finally { await fixture.dispose(); }
});
