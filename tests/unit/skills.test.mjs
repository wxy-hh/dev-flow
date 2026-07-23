import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillsRoot = path.resolve("plugins/dev-flow/skills");

/**
 * Canonical short skill ids (slash: /dev-flow:<id>).
 * description must keep df-* and dev-flow-* aliases for host matching after renames.
 */
const SKILL_ALIASES = {
  task: ["df-task", "dev-flow-task"],
  status: ["df-status", "dev-flow-status"],
  doctor: ["df-doctor", "dev-flow-doctor"],
  requirements: ["df-requirements", "dev-flow-requirements"],
  grillme: ["df-grillme", "dev-flow-grillme"],
  plan: ["df-plan", "dev-flow-plan"],
  "coverage-review": ["df-coverage-review", "dev-flow-coverage-review"],
  "rollback-safety": ["df-rollback-safety", "dev-flow-rollback-safety"],
  "plan-review": ["df-plan-review", "dev-flow-plan-review"],
  implement: ["df-implement", "dev-flow-implement"],
  "code-review": ["df-code-review", "dev-flow-code-review"],
  verify: ["df-verify", "dev-flow-verify"],
  "feature-check": ["df-feature-check", "dev-flow-feature-check"],
  finish: ["df-finish", "dev-flow-finish"],
  "risk-review": ["df-risk-review", "dev-flow-risk-review"],
};

const ROUTE_HIT_TOKENS = {
  "plan-review": [/plan_review/, /reviewType: "plan"/, /implementation_approval/],
  "code-review": [/code_review/, /reviewType: "code"/],
  implement: [/implementation/, /implementation_approval/],
  verify: [/verification/, /dev_flow_verify/],
  "feature-check": [/feature-check/, /dev_flow_feature_check/],
  finish: [/finalize/, /dev_flow_finalize/, /logic-complete/],
  requirements: [/requirements/, /requirement_confirmation/, /dev_flow_record_artifact/, /scaffold_artifact/],
  grillme: [/grill me/, /requirements/, /每轮只问一个阻塞问题/, /禁止调用任何 MCP mutation/, /grill_question_id/, /dev_flow_record_artifact/, /Source: codebase/],
  "coverage-review": [/coverage/],
  "rollback-safety": [/rollback/],
  task: [/does not integrate OpenSpec/, /dev_flow_next/, /execution: light/, /documented-unconfirmed/, /scaffold_artifact/],
  status: [/dev_flow_status/, /dev_flow_next/, /progress\.wait/, /继续/],
  doctor: [/dev_flow_doctor/],
  plan: [/dev_flow_next/, /scaffold_artifact/],
  "risk-review": [/dev_flow_record_step|risk-card/],
};

test("skills use short ids under plugin namespace with legacy alias hit surface", async () => {
  const names = (await readdir(skillsRoot)).filter((n) => !n.startsWith(".")).sort();
  assert.deepEqual(names, Object.keys(SKILL_ALIASES).sort());

  for (const name of names) {
    const content = await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
    const aliases = SKILL_ALIASES[name];

    assert.match(content, new RegExp(`^---\\nname: ${name}\\n`), `${name} frontmatter name must match directory`);
    assert.match(content, /Dev Flow MCP/, `${name} must keep Dev Flow MCP authority`);
    assert.match(content, /[\u4e00-\u9fff]/, `${name} should be Chinese-localized`);
    assert.match(content, new RegExp(`\\b${name}\\b|${name}、|${name}。|${name}$`), `${name} must appear for matching`);

    for (const alias of aliases) {
      assert.match(content, new RegExp(alias), `${name} must keep alias ${alias}`);
    }

    for (const token of ROUTE_HIT_TOKENS[name] ?? []) {
      assert.match(content, token, `${name} missing route-hit token ${token}`);
    }
  }

  const requirements = await readFile(path.join(skillsRoot, "requirements", "SKILL.md"), "utf8");
  const grillme = await readFile(path.join(skillsRoot, "grillme", "SKILL.md"), "utf8");
  assert.match(requirements, /missing-or-unclear/);
  assert.match(requirements, /documented-unconfirmed/);
  assert.match(requirements, /`grillme`/);
  assert.match(grillme, /`requirements`/);
});
