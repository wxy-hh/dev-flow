import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const nativeQuestion = await loadSource("plugins/dev-flow/src/hosts/claude-native-question.ts");

const question = "发现 2 个无法归属的路径：\n- src/a.ts\n- src/b.ts";

test("Claude native question extracts the displayed question's string answer", () => {
  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }] },
    tool_response: `Your questions have been answered: "${question}"="全部纳入当前任务". You can now continue with these answers in mind.`,
  }), [{ question, answer: "全部纳入当前任务" }]);
});

test("Claude native question accepts structured answers but rejects answers for undisplayed questions", () => {
  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }] },
    tool_response: { answers: { [question]: "逐个确认" } },
  }), [{ question, answer: "逐个确认" }]);

  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }] },
    tool_response: 'Your questions have been answered: "另一个问题"="全部纳入当前任务".',
  }), []);
});

test("Claude native question parses a JSON-serialized answers payload in tool_response or tool_result", () => {
  const payload = JSON.stringify({ answers: { [question]: "全部纳入当前任务" } });
  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }] },
    tool_response: payload,
  }), [{ question, answer: "全部纳入当前任务" }]);
  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }] },
    tool_result: payload,
  }), [{ question, answer: "全部纳入当前任务" }]);
});

test("Claude native question unwraps a data-wrapped handler result", () => {
  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }] },
    tool_response: { data: { questions: [{ question }], answers: { [question]: "逐个确认" } } },
  }), [{ question, answer: "逐个确认" }]);
});

test("Claude native question reads text blocks from a content array", () => {
  const text = `Your questions have been answered: "${question}"="全部纳入当前任务".`;
  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }] },
    tool_response: { content: [{ type: "text", text }] },
  }), [{ question, answer: "全部纳入当前任务" }]);
});

test("Claude native question ignores pre-filled answers in tool_input when tool_response has none", () => {
  assert.deepEqual(nativeQuestion.claudeNativeQuestionAnswers({
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question }], answers: { [question]: "全部纳入当前任务" } },
    tool_response: { answers: {} },
  }), []);
});
