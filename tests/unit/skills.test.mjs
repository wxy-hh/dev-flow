import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillsRoot = path.resolve("plugins/dev-flow/skills");

/** Canonical short names (df-*) and legacy aliases kept in description for host matching. */
const SKILL_ALIASES = {
  "df-task": "dev-flow-task",
  "df-status": "dev-flow-status",
  "df-doctor": "dev-flow-doctor",
  "df-requirements": "dev-flow-requirements",
  "df-grillme": "dev-flow-grillme",
  "df-plan": "dev-flow-plan",
  "df-coverage-review": "dev-flow-coverage-review",
  "df-rollback-safety": "dev-flow-rollback-safety",
  "df-plan-review": "dev-flow-plan-review",
  "df-implement": "dev-flow-implement",
  "df-code-review": "dev-flow-code-review",
  "df-verify": "dev-flow-verify",
  "df-feature-check": "dev-flow-feature-check",
  "df-finish": "dev-flow-finish",
  "df-risk-review": "dev-flow-risk-review",
};

/** Route / MCP tokens that must remain so workflow next-action can still hit the skill. */
const ROUTE_HIT_TOKENS = {
  "df-plan-review": [/plan_review/, /reviewType: "plan"/],
  "df-code-review": [/code_review/, /reviewType: "code"/],
  "df-implement": [/implementation/],
  "df-verify": [/verification/, /dev_flow_verify/],
  "df-feature-check": [/feature-check/, /dev_flow_feature_check/],
  "df-finish": [/finalize/, /dev_flow_finalize/, /logic-complete/],
  "df-requirements": [/requirements/, /requirement_confirmation/, /dev_flow_record_artifact/],
  "df-grillme": [/grill me/, /requirements/, /每轮只问一个阻塞问题/, /禁止调用任何 MCP mutation/],
  "df-coverage-review": [/coverage/],
  "df-rollback-safety": [/rollback/],
  "df-task": [/does not integrate OpenSpec/, /dev_flow_next/],
  "df-status": [/dev_flow_status/, /dev_flow_next/],
  "df-doctor": [/dev_flow_doctor/],
  "df-plan": [/dev_flow_next/],
  "df-risk-review": [/dev_flow_record_step|risk-card/],
};

test("all shared skills use df-* ids with MCP-only contract and legacy alias hit surface", async () => {
  const names = (await readdir(skillsRoot)).filter((n) => !n.startsWith(".")).sort();
  assert.deepEqual(names, Object.keys(SKILL_ALIASES).sort());

  for (const name of names) {
    const content = await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
    const legacy = SKILL_ALIASES[name];

    assert.match(content, new RegExp(`^---\\nname: ${name}\\n`), `${name} frontmatter name must match directory`);
    assert.match(content, /Dev Flow MCP/, `${name} must keep Dev Flow MCP authority`);
    assert.match(content, /[\u4e00-\u9fff]/, `${name} should be Chinese-localized`);
    // Host skill matching: keep both new id and old id in description for migration / habit.
    assert.match(content, new RegExp(name), `${name} description/body must mention canonical id`);
    assert.match(content, new RegExp(legacy), `${name} must keep legacy alias ${legacy} for matching`);

    for (const token of ROUTE_HIT_TOKENS[name] ?? []) {
      assert.match(content, token, `${name} missing route-hit token ${token}`);
    }
  }

  const requirements = await readFile(path.join(skillsRoot, "df-requirements", "SKILL.md"), "utf8");
  const grillme = await readFile(path.join(skillsRoot, "df-grillme", "SKILL.md"), "utf8");
  assert.match(requirements, /missing-or-unclear/);
  assert.match(requirements, /documented-unconfirmed/);
  assert.match(requirements, /df-grillme/);
  assert.match(grillme, /df-requirements/);
});
