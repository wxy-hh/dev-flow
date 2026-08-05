import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const approval = await loadSource("plugins/dev-flow/src/core/approval.ts");
const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");

test("execution approval accepts the documented Chinese variants", () => {
  for (const phrase of ["开始执行", "确认开始执行", "同意开始执行", "批准执行", "同意执行"]) {
    assert.equal(approval.isExplicitApproval(phrase), true, phrase);
  }
});

test("approval matching remains exact and rejects conditional sentences", () => {
  assert.equal(approval.isExplicitApproval("如果测试通过就开始执行"), false);
  assert.equal(approval.isExplicitApproval("开始执行吧"), false);
});

test("approval fallback hint lists the complete accepted phrase set", () => {
  const hint = interactions.decisionHint({
    kind: "approval",
    options: [{ id: "confirm", label: "确认开始执行" }, { id: "request-changes", label: "提出修改意见" }],
  });
  for (const phrase of approval.approvalPhrases) assert.match(hint, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
