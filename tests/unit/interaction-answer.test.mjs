import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

// ADR-0019：交互只经 `answer` 落账。测试只打「凭证进、账本出」：
// 一份宿主凭证进去之后，交互是否 resolved、kind 的领域账本结果、
// 是否出现下一题 pending、失败是否 revision 不变且事件未消费。

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const answerModule = await loadSource("plugins/dev-flow/src/core/interaction-answer.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const quality = await loadSource("plugins/dev-flow/src/core/quality-exceptions.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  const started = await store.startFeature(root, { featureId: "f", host: "codex" });
  return { root, state: started };
}

test("结构化凭证（表单选中）即信任：追认经 answer 落账，凭证按 native-form 记录", async () => {
  const { root, state } = await setup("dev-flow-answer-native-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    const result = await store.answer({
      root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
      credential: { source: "elicitation", action: "confirm" },
    });
    assert.equal(result.action, "confirm");
    assert.equal(result.state.governance.decisions.length, 1);
    assert.equal(result.state.governance.decisions[0].conclusion, "保留兼容行为");
    assert.equal(result.state.governance.credentials[0].source, "native-form");
    assert.equal(result.state.governance.credentials[0].optionId, "confirm");
    assert.equal(decisions.pendingDecisionForState(result.state), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("文本凭证绑定失败时不写任何东西：revision 不变、事件未消费、问题仍 pending", async () => {
  const { root, state } = await setup("dev-flow-answer-nobind-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    // 呈现之后没有匹配的宿主事件。
    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
      }),
      (error) => error.code === "INTERACTION_EVENT_MISSING",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, presented.state.revision, "失败不得推进 revision");
    assert.equal(unchanged.governance.decisions.length, 0, "失败不得写入账本");
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "decision-ratification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("文本凭证经 answer 绑定事件原文落账；凭证 basis 指向事件", async () => {
  const { root, state } = await setup("dev-flow-answer-text-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    await store.recordHostEvent(root, { eventId: "ratify-ok", type: "user-prompt", host: "codex", text: "确认登记" });
    const result = await store.answerFromHostEvents({
      root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
    });
    assert.equal(result.state.governance.decisions.length, 1);
    assert.equal(result.state.governance.decisions[0].conclusion, "保留兼容行为");
    assert.equal(result.state.governance.decisions[0].basis.eventId, "ratify-ok");
    assert.equal(result.state.governance.decisions[0].credentialId, result.state.governance.credentials[0].recordId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("没有正式交互时 answer 失败关闭，不锁定或改写任何状态", async () => {
  const { root, state } = await setup("dev-flow-answer-nopending-");
  try {
    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: state.revision, host: "codex",
      }),
      (error) => error.code === "INTERACTION_NOT_PENDING",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, state.revision);
    assert.equal(unchanged.mode, "intake");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CAS 冲突时整笔不写：revision 不变、事件未消费、问题仍 pending", async () => {
  const { root, state } = await setup("dev-flow-answer-cas-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    // 在呈现后推进一个 revision（例如登记一条宿主事件之外的变更）。
    const bumped = await store.mutate(root, "f", presented.state.revision, "test-bump", (draft) => { draft.objective = "bumped"; });
    await store.recordHostEvent(root, { eventId: "ratify-cas", type: "user-prompt", host: "codex", text: "确认登记" });
    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
      }),
      (error) => error.code === "STATE_REVISION_CONFLICT",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, bumped.revision);
    assert.equal(unchanged.governance.decisions.length, 0);
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "decision-ratification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grill 带理由的 other 经 answer 写入决定；缺理由时不写且不消费", async () => {
  const { root, state } = await setup("dev-flow-answer-grill-");
  try {
    const requested = await grill.requestGrillDecision(root, "f", state.revision, {
      questionId: "G-001",
      question: "如何处理需求边界？",
      options: [
        { id: "keep", label: "保留现有行为", description: "保持当前边界。" },
        { id: "remove", label: "移除现有行为", description: "扩大范围。" },
      ],
      recommendation: { optionId: "keep", reason: "改动范围更可控。", drawback: "会保留当前限制。", alternative: { optionId: "remove", condition: "如果后续需要覆盖更多场景" } },
      host: "codex",
    });
    const reply = "其他：先做一个最小实验，再依据结果决定是否保留。";
    await store.recordHostEvent(root, { eventId: "grill-other", type: "user-prompt", host: "codex", text: reply });
    const result = await store.answerFromHostEvents({
      root, featureId: "f", expectedRevision: requested.state.revision, host: "codex",
    });
    assert.equal(result.action, "other");
    assert.equal(result.state.governance.decisions.find((item) => item.recordId === "G-001").conclusion, "other");

    // 其他选项无实质方案：拒绝且 revision 不变。
    const root2 = await mkdtemp(path.join(os.tmpdir(), "dev-flow-answer-grill-noother-"));
    try {
      await mkdir(path.join(root2, "src"));
      await store.initProject(root2, config);
      const started = await store.startFeature(root2, { featureId: "g", host: "codex" });
      const second = await grill.requestGrillDecision(root2, "g", started.revision, {
        questionId: "G-002",
        question: "选择方案",
        options: [
          { id: "keep", label: "保留", description: "保持现状。" },
          { id: "remove", label: "移除", description: "删除。" },
        ],
        recommendation: { optionId: "keep", reason: "更稳。", drawback: "会有维护成本。", alternative: { optionId: "remove", condition: "如果确认应立即移除" } },
        host: "codex",
      });
      await store.recordHostEvent(root2, { eventId: "grill-empty-other", type: "user-prompt", host: "codex", text: "其他：" });
      await assert.rejects(
        () => store.answerFromHostEvents({
          root: root2, featureId: "g", expectedRevision: second.state.revision, host: "codex",
        }),
        (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
      );
      const unchanged = await store.readState(root2, "g");
      assert.equal(unchanged.revision, second.state.revision);
      assert.equal(unchanged.governance.decisions.length, 0);
    } finally {
      await rm(root2, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("「确认」不能命中归属的 adopt/exclude（多意图问题语义边界）", async () => {
  const { root, state } = await setup("dev-flow-answer-own-confirm-");
  try {
    await writeFile(path.join(root, "src/extra.js"), "export const e = 1;\n", "utf8");
    const pending = await store.reconcileWorkspace(root, "f", state.revision, "codex");
    await store.recordHostEvent(root, { eventId: "own-confirm", type: "user-prompt", host: "codex", text: "确认" });
    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: pending.revision, host: "codex",
      }),
      (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, pending.revision);
    assert.equal(unchanged.workspace.ownership["src/extra.js"], undefined, "「确认」不得把路径纳入当前任务");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("归属逐个确认后 answer 返回下一题 pending；下一次 answer 只处理剩余路径", async () => {
  const { root, state } = await setup("dev-flow-answer-own-pending-");
  try {
    await writeFile(path.join(root, "src/a.js"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(root, "src/b.js"), "export const b = 2;\n", "utf8");
    const pending = await store.reconcileWorkspace(root, "f", state.revision, "codex");
    await store.recordHostEvent(root, { eventId: "own-1by1", type: "user-prompt", host: "codex", text: "逐个确认" });
    const first = await store.answerFromHostEvents({
      root, featureId: "f", expectedRevision: pending.revision, host: "codex",
    });
    assert.equal(first.action, "one-by-one");
    assert.ok(first.pending, "apply 呈现下一题时返回 pending");
    assert.equal(first.pending.kind, "workspace-ownership");
    const firstPath = first.pending.options && first.state.interactions
      ? Object.values(first.state.interactions).find((item) => item.status === "pending")?.workspacePaths?.[0]
      : undefined;
    await store.recordHostEvent(root, { eventId: "own-adopt", type: "user-prompt", host: "codex", text: "纳入当前任务" });
    const second = await store.answerFromHostEvents({
      root, featureId: "f", expectedRevision: first.state.revision, host: "codex",
    });
    const afterFirst = second.state;
    const remainingPath = Object.values(afterFirst.interactions).find((item) => item.status === "pending")?.workspacePaths?.[0];
    assert.ok(firstPath && remainingPath && firstPath !== remainingPath, "逐个确认后只问剩余路径");
    await store.recordHostEvent(root, { eventId: "own-exclude", type: "user-prompt", host: "codex", text: "排除并先处理" });
    const third = await store.answerFromHostEvents({
      root, featureId: "f", expectedRevision: second.state.revision, host: "codex",
    });
    assert.equal(third.state.workspace.ownership[firstPath], "feature");
    assert.equal(third.state.workspace.ownership[remainingPath], "excluded");
    assert.equal(decisions.pendingDecisionForState(third.state), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("路线确认经 answer 一次锁定；追溯与审查 pointer 落在同一 revision", async () => {
  const { root, state } = await setup("dev-flow-answer-route-");
  try {
    const facts = {
      level: "M", topology: "local", requirements: "provided-confirmed",
      scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
    };
    const boundaryAudit = { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] };
    const locked = await store.lockClassification(root, "f", state.revision, facts, boundaryAudit);
    assert.equal(decisions.pendingDecisionForState(locked).kind, "route-confirmation");
    await store.recordHostEvent(root, { eventId: "route-ok", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const result = await store.answerFromHostEvents({
      root, featureId: "f", expectedRevision: locked.revision, host: "codex",
    });
    assert.equal(result.action, "confirm");
    assert.equal(result.state.mode, "routed");
    assert.equal(result.state.route, "m");
    assert.equal(decisions.pendingDecisionForState(result.state), undefined);
    // 路线锁定与追溯/审查快照在同一笔事务原子落账：revision 只推进一步，
    // 快照指针已随锁定写入（pointer 的 revision 是快照内部版本，非状态 revision）。
    assert.equal(result.state.revision, locked.revision + 1);
    if (result.state.traceability) assert.equal(typeof result.state.traceability.sha256, "string");
    if (result.state.review) assert.equal(typeof result.state.review.sha256, "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("已接通的 kind 回答无法识别时失败关闭（DECISION_REPLY_NOT_RECOGNIZED），不改任何状态", async () => {
  // task-switch 接通前，本用例断言 DECISION_KIND_UNSUPPORTED；13/13 全接通后
  // 该分支无合法 kind 可达，失败关闭语义改由无法识别的回答继承。
  const { root, state } = await setup("dev-flow-answer-unsupported-");
  try {
    const staged = await store.mutate(root, "f", state.revision, "stage-unsupported", (draft) => {
      draft.interactions = {
        "legacy-pending": {
          id: "legacy-pending",
          kind: "task-switch",
          target: "task-switch:legacy",
          basisHash: "0".repeat(64),
          options: [{ id: "finish-old", label: "先完成当前任务" }, { id: "pause-old", label: "暂停当前任务" }],
          presentedAt: new Date().toISOString(),
          status: "pending",
        },
      };
      draft.pendingDecision = {
        kind: "task-switch",
        question: "当前已有一个进行中的任务。开始新任务前，你希望如何处理旧任务？",
        options: [{ id: "finish-old", label: "先完成当前任务" }, { id: "pause-old", label: "暂停当前任务" }],
        basisHash: "0".repeat(64),
        presentedAt: new Date().toISOString(),
        presentedRevision: state.revision,
        target: "task-switch:legacy",
        source: "core",
      };
    });
    await store.recordHostEvent(root, { eventId: "unsupported-answer", type: "user-prompt", host: "codex", text: "确认" });
    // 接通后的 task-switch 走正常匹配：无法识别的回答失败关闭，状态不变。
    await assert.rejects(
      () => store.answerFromHostEvents({
        root, featureId: "f", expectedRevision: staged.revision, host: "codex",
      }),
      (error) => error.code === "DECISION_REPLY_NOT_RECOGNIZED",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, staged.revision);
    assert.equal(decisions.pendingDecisionForState(unchanged).kind, "task-switch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public host-event answer path takes the captured same-host event without caller reply text", async () => {
  const { root, state } = await setup("dev-flow-answer-host-event-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    await store.recordHostEvent(root, { eventId: "ratify-host-event", type: "user-prompt", host: "codex", text: "确认登记" });
    const result = await answerModule.answerFromHostEvents({
      root, featureId: "f", expectedRevision: presented.state.revision, host: "codex",
    });
    assert.equal(result.action, "confirm");
    assert.equal(result.state.governance.decisions[0].basis.eventId, "ratify-host-event");
    assert.equal(result.state.interactions[presented.interactionId].response.promptEventId, "ratify-host-event");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public host-event answer path reports INTERACTION_EVENT_MISSING before any mutation", async () => {
  const { root, state } = await setup("dev-flow-answer-host-missing-");
  try {
    const presented = await store.recordDecision(root, "f", state.revision, "是否保留兼容行为？", "历史兼容测试仍存在", "保留兼容行为", [], "codex");
    await assert.rejects(
      () => answerModule.answerFromHostEvents({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex" }),
      (error) => error.code === "INTERACTION_EVENT_MISSING",
    );
    assert.equal((await store.readState(root, "f")).revision, presented.state.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("route-confirmation public answer consumes the real same-host prompt event", async () => {
  const { root, state } = await setup("dev-flow-answer-route-host-");
  try {
    const facts = {
      level: "M", topology: "shared-contract", requirements: "provided-confirmed",
      scopeFactRefs: [], topologyFactRefs: [], uncertaintyFactRefs: [], riskFactRefs: {}, decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "shared-contract", unitCount: 2, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
    };
    const presented = await store.lockClassification(root, "f", state.revision, facts, {
      scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [],
    });
    assert.equal(decisions.pendingDecisionForState(presented).kind, "route-confirmation");
    await store.recordHostEvent(root, { eventId: "route-confirm-host", type: "user-prompt", host: "codex", text: "确认路线" });
    const result = await answerModule.answerFromHostEvents({ root, featureId: "f", expectedRevision: presented.revision, host: "codex" });
    assert.equal(result.action, "confirm");
    assert.equal(result.state.mode, "routed");
    const interaction = Object.values(result.state.interactions).find((item) => item.kind === "route-confirmation");
    assert.equal(interaction.response.promptEventId, "route-confirm-host");
    assert.ok(result.state.traceability, "route lock must write the Trace pointer");
    assert.ok(result.state.review, "route lock must write the Review pointer");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("quality-exception public answer consumes the captured reason without caller text", async () => {
  const { root, state } = await setup("dev-flow-answer-quality-host-");
  try {
    const presented = await quality.presentQualityException(root, "f", state.revision, {
      kind: "verification",
      basisHash: "a".repeat(64),
      fingerprint: "b".repeat(64),
      riskSummary: "验证证据需要用户明确接受。",
    });
    await store.recordHostEvent(root, { eventId: "quality-host", type: "user-prompt", host: "codex", text: "接受风险：我已了解验证风险" });
    const result = await answerModule.answerFromHostEvents({ root, featureId: "f", expectedRevision: presented.state.revision, host: "codex" });
    assert.equal(result.action, "accept");
    assert.equal(result.state.governance.authorizations[0].authorizationType, "risk-acceptance");
    const interaction = Object.values(result.state.interactions).find((item) => item.kind === "quality-exception");
    assert.equal(interaction.response.promptEventId, "quality-host");
    assert.match(interaction.response.userReply, /我已了解验证风险/);
    assert.equal(interaction.response.comment, "我已了解验证风险");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval public answer consumes the real later user prompt without caller text", async () => {
  const { prepareReviewReadyFeature, driveUntil } = await import("../helpers/route-flow.mjs");
  const approvals = await loadSource("plugins/dev-flow/src/core/approval-interactions.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-answer-approval-host-"));
  try {
    const state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "approval", host: "claude" });
    const driven = await driveUntil(root, state.featureId, state, {
      stopAt: (action) => action.kind === "present-human-gate",
    });
    assert.equal(driven.action.kind, "present-human-gate");
    const presented = await approvals.presentApproval(root, state.featureId, driven.state.revision);
    const approvalId = presented.approvalId;
    await store.recordHostEvent(root, { eventId: "approval-host-event", type: "user-prompt", host: "claude", text: "批准实现" });
    const result = await answerModule.answerFromHostEvents({ root, featureId: state.featureId, expectedRevision: presented.state.revision, host: "claude" });
    assert.equal(result.action, "confirm");
    assert.equal(result.state.humanGates[approvalId].status, "confirmed");
    assert.equal(result.state.interactions[presented.interactionId].response.promptEventId, "approval-host-event");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
