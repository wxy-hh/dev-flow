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
  assert.match(routes, /rollback-operability/);
});
