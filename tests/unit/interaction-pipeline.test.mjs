import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const pipeline = await loadSource("plugins/dev-flow/src/mcp/interaction-pipeline.ts");

// 纯 mock：三端口注入，零文件系统。管道的可测价值在编排逻辑本身
// （pending 语义、envelope 形状、optionLabel 映射、extra 附加）。
const presentedState = { featureId: "f", revision: 3 };
const presentedInteraction = {
  kind: "approval",
  status: "pending",
  question: "确认？",
  options: [
    { id: "confirm", label: "确认开始执行" },
    { id: "request-changes", label: "提出修改意见", requiresComment: true },
  ],
};

function resolvedState(response) {
  return {
    featureId: "f",
    revision: 4,
    interactions: {
      "i-1": {
        id: "i-1",
        kind: "approval",
        status: "resolved",
        options: presentedInteraction.options,
        response,
      },
    },
  };
}

function presentation() {
  return { state: presentedState, interaction: presentedInteraction, interactionId: "i-1" };
}

test("无选择时返回 pending envelope 并附加 extra，不落账", async () => {
  const calls = { notify: [], answer: 0 };
  const ports = {
    elicit: async () => undefined,
    notify: (event) => calls.notify.push(event),
    answer: async () => { calls.answer += 1; throw new Error("不应调用"); },
  };
  const result = await pipeline.elicitAndAnswer(ports, presentation(), {
    root: "/r", featureId: "f", host: "claude",
    decision: "approval", approvalId: "approval:x",
    question: "请确认当前执行摘要，或提出需要修改的意见。",
    extra: { preview: { undoOrder: [] } },
  });
  assert.equal(result.interactionOutcome, "pending");
  assert.equal(result.state, presentedState);
  assert.deepEqual(result.preview, { undoOrder: [] });
  assert.equal(calls.answer, 0);
  assert.deepEqual(calls.notify, [{ kind: "decision-required", featureId: "f", decision: "approval", approvalId: "approval:x" }]);
});

test("pendingOutcome 覆盖默认 pending（risk-acceptance 的 presented 分支）", async () => {
  const ports = { elicit: async () => undefined, notify: () => {}, answer: async () => { throw new Error("不应调用"); } };
  const result = await pipeline.elicitAndAnswer(ports, presentation(), {
    root: "/r", featureId: "f", host: "codex", decision: "review-risk", question: "q", pendingOutcome: "presented",
  });
  assert.equal(result.interactionOutcome, "presented");
});

test("有选择时落账并返回解析后的 envelope：optionLabel 映射、response 透传、extra 附加", async () => {
  const answerCalls = [];
  const ports = {
    elicit: async (interaction, question) => {
      assert.equal(interaction, presentedInteraction);
      assert.equal(question, "确认？");
      return { action: "confirm", comment: "可以" };
    },
    notify: () => {},
    answer: async (input) => {
      answerCalls.push(input);
      return { state: resolvedState({ action: "confirm", kind: "approval", comment: "可以" }), action: "confirm", comment: "可以" };
    },
  };
  const result = await pipeline.elicitAndAnswer(ports, presentation(), {
    root: "/r", featureId: "f", host: "claude", decision: "approval", question: "确认？", extra: { decisionId: "d-1" },
  });
  assert.equal(answerCalls.length, 1);
  assert.deepEqual(answerCalls[0], {
    root: "/r", featureId: "f", expectedRevision: 3, host: "claude",
    credential: { source: "elicitation", action: "confirm", comment: "可以" },
  });
  // outcome 与 response.action 都经 optionLabel 映射（envelope 语义唯一来源）。
  assert.equal(result.interactionOutcome, "确认开始执行");
  assert.equal(result.response.action, "确认开始执行");
  assert.equal(result.response.kind, "approval");
  assert.equal(result.response.comment, "可以");
  assert.equal(result.interaction.status, "resolved");
  assert.equal(result.decisionId, "d-1");
});

test("answer 后交互丢失时管道不吞错（fail-closed）", async () => {
  const ports = {
    elicit: async () => ({ action: "confirm" }),
    notify: () => {},
    answer: async () => ({ state: { featureId: "f", revision: 4, interactions: {} }, action: "confirm" }),
  };
  await assert.rejects(
    () => pipeline.elicitAndAnswer(ports, presentation(), {
      root: "/r", featureId: "f", host: "claude", decision: "approval", question: "确认？",
    }),
    (error) => error.code === "INTERACTION_NOT_FOUND",
  );
});
