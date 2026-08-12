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

test("high-impact recommendation appends drawback and alternative condition; plain recommendations stay short", () => {
  const highImpact = grillInteraction.buildGrillPresentation({
    question: "是否引入新的迁移脚本？",
    options,
    recommendation: {
      optionId: "plugin-hook",
      reason: "改动面最小。",
      drawback: "复用现有 hook 会在迁移期间留下双份解析路径，需要额外清理。",
      alternative: { optionId: "config-api", condition: "后续还有多个解析入口需要切换" },
    },
  });
  assert.match(highImpact.text, /提醒：推荐方案的主要缺点是 复用现有 hook 会在迁移期间留下双份解析路径，需要额外清理。/);
  assert.match(highImpact.text, /如果 后续还有多个解析入口需要切换，选项 B（新增 css\.resolve 配置 API）可能更合适。/);
  // 提醒位于选项之后、回复引导之前
  const reminderIndex = highImpact.text.indexOf("提醒：");
  const guideIndex = highImpact.text.indexOf("请回复 A、B 或 C。");
  assert.ok(reminderIndex > 0 && reminderIndex < guideIndex);

  const plain = grillInteraction.buildGrillPresentation({
    question: "普通问题？",
    options,
    recommendation: { optionId: "plugin-hook", reason: "改动面最小。" },
  });
  assert.equal(plain.text.includes("提醒："), false);
});

test("high-impact recommendation must provide both drawback and alternative, referencing a non-recommended option", () => {
  const base = { question: "q", options, recommendation: { optionId: "plugin-hook", reason: "r" } };
  assert.throws(
    () => grillInteraction.buildGrillPresentation({ ...base, recommendation: { ...base.recommendation, drawback: "只有缺点" } }),
    (error) => error.code === "GRILL_PRESENTATION_INVALID",
  );
  assert.throws(
    () => grillInteraction.buildGrillPresentation({ ...base, recommendation: { ...base.recommendation, alternative: { optionId: "config-api", condition: "c" } } }),
    (error) => error.code === "GRILL_PRESENTATION_INVALID",
  );
  assert.throws(
    () => grillInteraction.buildGrillPresentation({ ...base, recommendation: { ...base.recommendation, drawback: "d", alternative: { optionId: "plugin-hook", condition: "c" } } }),
    (error) => error.code === "GRILL_PRESENTATION_INVALID",
  );
  assert.throws(
    () => grillInteraction.buildGrillPresentation({ ...base, recommendation: { ...base.recommendation, drawback: "d", alternative: { optionId: "missing", condition: "c" } } }),
    (error) => error.code === "GRILL_PRESENTATION_INVALID",
  );
});

test("high-impact recommendation survives the interaction seam and text reply matching stays unchanged", () => {
  const input = {
    kind: "grill",
    target: "grill:q1",
    basisHash: "e".repeat(64),
    question: "高影响问题？",
    options,
    recommendation: {
      optionId: "plugin-hook",
      reason: "改动面最小。",
      drawback: "缺点 X",
      alternative: { optionId: "config-api", condition: "条件 Y" },
    },
  };
  const state = { interactions: {}, pendingDecision: undefined };
  const created = interactions.createInteraction(state, input);
  assert.equal(created.recommendation.drawback, "缺点 X");
  assert.equal(created.recommendation.alternative.optionId, "config-api");
  // 回答匹配不因提醒字段改变：A/B/C 与标签匹配行为保持
  assert.deepEqual(grillInteraction.matchGrillReply({ options, userReply: "B" }), {
    kind: "option",
    answerCode: "B",
    selectedOptionId: "config-api",
    rawReply: "B",
  });
});
