import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
async function text(relative) {
  return readFile(new URL(relative, root), "utf8");
}

test("distributed skills describe the internal review and feature-check contracts", async () => {
  const featureCheck = await text("plugins/dev-flow/skills/feature-check/SKILL.md");
  const planReview = await text("plugins/dev-flow/skills/plan-review/SKILL.md");
  const codeReview = await text("plugins/dev-flow/skills/code-review/SKILL.md");
  const routes = await text("docs/routes.md");
  assert.match(featureCheck, /并入 finalize/);
  assert.match(planReview, /planning/);
  assert.match(codeReview, /code_review/);
  assert.match(codeReview, /reviewType: "code"/);
  assert.match(codeReview, /requiredEvidence/);
  assert.match(codeReview, /full-code-review/);
  assert.match(codeReview, /实质审查|blocking/);
  assert.match(codeReview, /diff|变更/);
  assert.match(codeReview, /record_step/);
  assert.match(routes, /rollback-operability/);
  assert.match(routes, /实质审查/);
});

test("intake and status skills surface the classification level/route to the user", async () => {
  const task = await text("plugins/dev-flow/skills/task/SKILL.md");
  const status = await text("plugins/dev-flow/skills/status/SKILL.md");
  // 锁定分类后必须用可见文本声明级别与路线，不能只留在 MCP 返回里
  assert.match(task, /锁定成功后必须用可见文本向用户声明本次分级/);
  assert.match(task, /route/);
  assert.match(status, /compact 中文用户视图/);
  assert.match(status, /dev_flow_inspect/);
});
