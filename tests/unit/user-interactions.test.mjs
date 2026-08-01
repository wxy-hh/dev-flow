import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");

test("one-time interaction tokens bind action, require feedback, and cannot be replayed", () => {
  const state = { interactions: {} };
  const interaction = interactions.createInteraction(state, {
    kind: "gate",
    target: "gate:requirement_confirmation",
    basisHash: "basis",
    options: [
      { id: "confirm", label: "确认需求" },
      { id: "request-changes", label: "提出修改意见", requiresComment: true },
    ],
  });
  assert.match(interactions.fallbackHint(interaction), /✅ 如需确认需求/);
  assert.doesNotMatch(interactions.fallbackHint(interaction), /DF-/);
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, "DF-NOT-THE-TOKEN confirm", "codex", "event-1"),
    (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
  );
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, `${interaction.fallbackToken} request-changes`, "codex", "event-2"),
    (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
  );
  const response = interactions.resolveTokenInteraction(
    state, interaction.id, `${interaction.fallbackToken} request-changes 补充离线场景`, "codex", "event-3",
  );
  assert.equal(response.comment, "补充离线场景");
  const published = interactions.interactionResponse(state, interaction.id);
  assert.deepEqual(published, response);
  assert.equal(Object.isFrozen(published), true);
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, `${interaction.fallbackToken} confirm`, "codex", "event-4"),
    (error) => error.code === "INTERACTION_ALREADY_RESOLVED",
  );
});

test("token replies tolerate whitespace and case differences while storing the original reply", () => {
  const create = () => {
    const state = { interactions: {} };
    const interaction = interactions.createInteraction(state, {
      kind: "gate",
      target: "gate:implementation_approval",
      basisHash: "basis",
      options: [
        { id: "confirm", label: "确认执行" },
        { id: "request-changes", label: "提出修改意见", requiresComment: true },
      ],
    });
    return { state, interaction };
  };

  // 首尾空格与全小写 token 均可匹配
  {
    const { state, interaction } = create();
    const response = interactions.resolveTokenInteraction(
      state, interaction.id, `  ${interaction.fallbackToken.toLowerCase()}  confirm  `, "codex", "event-a",
    );
    assert.equal(response.action, "confirm");
    assert.equal(response.userReply, `  ${interaction.fallbackToken.toLowerCase()}  confirm  `);
  }
  // 内部双空格折叠后仍可匹配；comment 保留原始内部空白（仅去首尾）
  {
    const { state, interaction } = create();
    const response = interactions.resolveTokenInteraction(
      state, interaction.id, ` ${interaction.fallbackToken}  request-changes  补充  离线  `, "codex", "event-b",
    );
    assert.equal(response.comment, "补充  离线");
  }
  // 错误 token 仍拒绝
  {
    const { state, interaction } = create();
    assert.throws(
      () => interactions.resolveTokenInteraction(state, interaction.id, "DF-NOT-THE-TOKEN confirm", "codex", "event-c"),
      (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
    );
  }
});

test("natural-language replies match by letter, number, recommendation, or label", () => {
  const create = () => {
    const state = { interactions: {} };
    const interaction = interactions.createInteraction(state, {
      kind: "grill",
      target: "grill:Q-001",
      basisHash: "basis",
      question: "选择同步方案",
      options: [
        { id: "hosted", label: "托管同步" },
        { id: "self", label: "自建同步" },
        { id: "other", label: "其他 / 补充", requiresComment: true },
      ],
    });
    return { state, interaction };
  };
  // 字母序号（大小写均可）
  {
    const { state, interaction } = create();
    const response = interactions.resolveTokenInteraction(state, interaction.id, "A", "claude", "e1");
    assert.equal(response.action, "hosted");
    assert.equal(response.userReply, "A");
  }
  {
    const { state, interaction } = create();
    const response = interactions.resolveTokenInteraction(state, interaction.id, "b", "claude", "e2");
    assert.equal(response.action, "self");
  }
  // 数字序号（requiresComment 选项需提供内容 → 抛错）
  {
    const { state, interaction } = create();
    assert.throws(
      () => interactions.resolveTokenInteraction(state, interaction.id, "3", "claude", "e3"),
      (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
    );
  }
  {
    const { state, interaction } = create();
    const response = interactions.resolveTokenInteraction(state, interaction.id, "2", "claude", "e3b");
    assert.equal(response.action, "self");
  }
  // 推荐词 → 第一位选项
  {
    const { state, interaction } = create();
    const response = interactions.resolveTokenInteraction(state, interaction.id, "推荐", "claude", "e4");
    assert.equal(response.action, "hosted");
  }
  // label 精确匹配（归一化，容忍空白）
  {
    const { state, interaction } = create();
    const response = interactions.resolveTokenInteraction(state, interaction.id, "  自建同步  ", "claude", "e5");
    assert.equal(response.action, "self");
  }
  // 无法匹配的文本仍拒绝
  {
    const { state, interaction } = create();
    assert.throws(
      () => interactions.resolveTokenInteraction(state, interaction.id, "随便", "claude", "e6"),
      (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
    );
  }
});

test("requiresComment natural selection demands a comment", () => {
  const state = { interactions: {} };
  const interaction = interactions.createInteraction(state, {
    kind: "grill",
    target: "grill:Q-001",
    basisHash: "basis",
    options: [
      { id: "hosted", label: "托管同步" },
      { id: "other", label: "其他", requiresComment: true },
    ],
  });
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, "B", "claude", "e1"),
    (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
  );
  // 自然语言 + 补充说明：label 后跟 comment（仅 grill 生效）
  const response = interactions.resolveTokenInteraction(state, interaction.id, "其他 补充离线场景", "claude", "e2");
  assert.equal(response.action, "other");
  assert.equal(response.comment, "补充离线场景");
});

test("gate interactions reject free-text extensions of the confirm label", () => {
  const state = { interactions: {} };
  const interaction = interactions.createInteraction(state, {
    kind: "gate",
    target: "gate:requirement_confirmation",
    basisHash: "basis",
    options: [
      { id: "confirm", label: "确认需求" },
      { id: "request-changes", label: "提出修改意见", requiresComment: true },
    ],
  });
  // “确认需求，可以”这类整句扩展不得被当作 confirm（防否定/保留意见被误判为确认）
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, "确认需求，可以", "claude", "e1"),
    (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
  );
  // label 精确命中 request-changes，但该选项要求补充意见内容
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, "提出修改意见", "claude", "e2"),
    (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
  );
  const response = interactions.resolveTokenInteraction(state, interaction.id, "提出修改意见 补充边界条件", "claude", "e3");
  assert.equal(response.action, "request-changes");
  assert.equal(response.comment, "补充边界条件");
});

test("phraseAction maps directly to a gate option without a token match", () => {
  const state = { interactions: {} };
  const interaction = interactions.createInteraction(state, {
    kind: "gate",
    target: "gate:requirement_confirmation",
    basisHash: "basis",
    options: [
      { id: "confirm", label: "确认需求" },
      { id: "request-changes", label: "提出修改意见", requiresComment: true },
    ],
  });
  const response = interactions.resolveTokenInteraction(
    state, interaction.id, "确认需求", "claude", "event-d", "confirm",
  );
  assert.equal(response.action, "confirm");
  assert.equal(response.source, "text-token");
  assert.equal(response.userReply, "确认需求");
  assert.equal(response.promptEventId, "event-d");
});
