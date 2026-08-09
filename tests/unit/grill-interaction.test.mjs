import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const grillInteraction = await loadSource("plugins/dev-flow/src/core/grill-interaction.ts");
const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");

const options = [
  { id: "plugin-hook", label: "仅使用插件 hook", description: "复用现有 resolveId，不新增配置 API。" },
  { id: "config-api", label: "新增 css.resolve 配置 API", description: "提供独立配置入口。" },
  { id: "automatic", label: "自动推断解析方式", description: "减少显式配置。" },
];

test("grill presentation assigns A/B/C and renders exactly one explicit recommendation with its reason", () => {
  const presentation = grillInteraction.buildGrillPresentation({
    question: "CSS @import 解析接入点采用哪种 API 形态？",
    options,
    recommendation: {
      optionId: "plugin-hook",
      reason: "改动面最小，并与现有插件模型保持一致。",
    },
  });

  assert.deepEqual(presentation.options.map(({ answerCode, recommended }) => ({ answerCode, recommended })), [
    { answerCode: "A", recommended: true },
    { answerCode: "B", recommended: false },
    { answerCode: "C", recommended: false },
  ]);
  assert.equal(presentation.recommendation.optionId, "plugin-hook");
  assert.equal(presentation.recommendation.reason, "改动面最小，并与现有插件模型保持一致。");
  assert.equal(presentation.text, [
    "CSS @import 解析接入点采用哪种 API 形态？",
    "",
    "A. 仅使用插件 hook（推荐）",
    "   改动面最小，并与现有插件模型保持一致。",
    "",
    "B. 新增 css.resolve 配置 API",
    "   提供独立配置入口。",
    "",
    "C. 自动推断解析方式",
    "   减少显式配置。",
    "",
    "请回复 A、B 或 C。",
    "如果都不合适，请回复“其他：<你的方案和理由>”。",
  ].join("\n"));
});

test("grill replies normalize code variants and natural selections to one option result", () => {
  for (const reply of ["A", "a", "Ａ", "我选 A", "我选择A", "按方案 A 来", "就用 A 吧"]) {
    assert.deepEqual(grillInteraction.matchGrillReply({ options, userReply: reply }), {
      kind: "option",
      answerCode: "A",
      selectedOptionId: "plugin-hook",
      rawReply: reply,
    }, reply);
  }
});

test("grill replies stay pending for ambiguity or negation and can select a different explicit code", () => {
  assert.equal(grillInteraction.matchGrillReply({ options, userReply: "A 或 B" }), undefined);
  assert.equal(grillInteraction.matchGrillReply({ options, userReply: "A/B 都行" }), undefined);
  assert.equal(grillInteraction.matchGrillReply({ options, userReply: "不要 A" }), undefined);
  assert.equal(grillInteraction.matchGrillReply({ options, userReply: "我选择 A，但又决定不要 A" }), undefined);
  assert.deepEqual(grillInteraction.matchGrillReply({ options, userReply: "不要 A，选择 B" }), {
    kind: "option",
    answerCode: "B",
    selectedOptionId: "config-api",
    rawReply: "不要 A，选择 B",
  });
});

test("grill replies normalize a substantive custom proposal to other and reject an empty other", () => {
  assert.deepEqual(grillInteraction.matchGrillReply({
    options,
    userReply: "其他：保留 hook，同时增加一个仅供高级用户使用的覆盖点。",
  }), {
    kind: "other",
    rawReply: "其他：保留 hook，同时增加一个仅供高级用户使用的覆盖点。",
    comment: "保留 hook，同时增加一个仅供高级用户使用的覆盖点。",
  });
  assert.deepEqual(grillInteraction.matchGrillReply({
    options,
    userReply: "这些都不合适，我建议先验证插件顺序再决定 API。",
  }), {
    kind: "other",
    rawReply: "这些都不合适，我建议先验证插件顺序再决定 API。",
    comment: "我建议先验证插件顺序再决定 API。",
  });
  assert.equal(grillInteraction.matchGrillReply({ options, userReply: "其他" }), undefined);
});

test("grill replies accept one uniquely identified full option label", () => {
  assert.deepEqual(grillInteraction.matchGrillReply({ options, userReply: "我选择仅使用插件 hook" }), {
    kind: "option",
    answerCode: "A",
    selectedOptionId: "plugin-hook",
    rawReply: "我选择仅使用插件 hook",
  });
  assert.deepEqual(grillInteraction.matchGrillReply({ options, userReply: "新增 css.resolve 配置 API" }), {
    kind: "option",
    answerCode: "B",
    selectedOptionId: "config-api",
    rawReply: "新增 css.resolve 配置 API",
  });
});

test("grill interaction persists its explicit recommendation and normalized option response", () => {
  const state = { revision: 4, interactions: {} };
  const created = interactions.createInteraction(state, {
    kind: "grill",
    target: "grill:css-import-api",
    basisHash: "a".repeat(64),
    question: "CSS @import 解析接入点采用哪种 API 形态？",
    options,
    recommendation: {
      optionId: "plugin-hook",
      reason: "改动面最小，并与现有插件模型保持一致。",
    },
  });

  assert.deepEqual(created.recommendation, {
    optionId: "plugin-hook",
    reason: "改动面最小，并与现有插件模型保持一致。",
  });
  assert.equal(interactions.decisionHint(created), grillInteraction.buildGrillPresentation({
    question: created.question,
    options: created.options,
    recommendation: created.recommendation,
  }).text);
  const pending = decisions.publicPendingDecision(state);
  assert.equal(pending.presentation, interactions.decisionHint(created));
  assert.deepEqual(pending.recommendation, created.recommendation);
  assert.deepEqual(pending.options.map((option) => option.answerCode), ["A", "B", "C"]);

  const response = interactions.resolveTextInteraction(
    state,
    created.id,
    "我选择 A",
    "codex",
    { promptEventId: "prompt-1" },
  );
  assert.equal(response.kind, "option");
  assert.equal(response.answerCode, "A");
  assert.equal(response.selectedOptionId, "plugin-hook");
  assert.equal(response.rawReply, "我选择 A");
  assert.equal(response.action, "plugin-hook");
  assert.equal(created.response, response);
});

test("grill interaction hard-rejects the old implicit-recommendation contract", () => {
  const input = {
    kind: "grill",
    target: "grill:legacy",
    basisHash: "b".repeat(64),
    question: "选择一个方案",
    options,
  };
  assert.throws(
    () => interactions.createInteraction({ revision: 0, interactions: {} }, input),
    /GRILL_RECOMMENDATION_REQUIRED/,
  );
  assert.throws(
    () => interactions.createInteraction({ revision: 0, interactions: {} }, {
      ...input,
      recommendation: { optionId: "plugin-hook", reason: "" },
    }),
    /GRILL_PRESENTATION_INVALID/,
  );
  assert.throws(
    () => decisions.pendingDecisionForState({
      revision: 3,
      interactions: {
        legacy: {
          id: "legacy",
          kind: "grill",
          target: "grill:legacy",
          basisHash: "c".repeat(64),
          question: "旧问题",
          options: [
            { id: "yes", label: "确认" },
            { id: "no", label: "拒绝" },
          ],
          status: "pending",
          presentedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    }),
    /GRILL_INTERACTION_RESTART_REQUIRED/,
  );
});
