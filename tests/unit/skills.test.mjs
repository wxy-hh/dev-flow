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
  "plan-review": [/plan_review/, /create-review-batch/, /dev_flow_submit_review_job/, /implementation_approval/],
  "code-review": [/code_review/, /reviewType: "code"/, /requiredEvidence/, /full-code-review/],
  implement: [/implementation/, /implementation_approval/, /dev_flow_begin_implementation_unit/, /dev_flow_checkpoint_implementation_unit/, /fileScope/, /连续编辑多个文件/, /当前 diff/, /只调用一次/],
  verify: [/verification/, /dev_flow_verify/, /requiredEvidence\.verificationKinds/, /manualAcceptance/, /user-signoff/, /acceptanceAssist/, /明确要求协助/, /交付后检查/],
  "feature-check": [/feature-check/, /dev_flow_feature_check/, /不得编造/, /人工\/UI 验收/, /Core/],
  finish: [/finalize/, /dev_flow_finalize/, /logic-complete/, /可选审计信息/, /不得假装浏览器验收/],
  requirements: [/requirements/, /requirement_confirmation/, /dev_flow_record_artifact/, /scaffold_artifact/, /dev_flow_present_gate/, /禁止同回合/],
  grillme: [/grill me/, /requirements/, /每轮只问一个阻塞问题/, /禁止调用任何 MCP mutation/, /grill_question_id/, /dev_flow_record_artifact/, /Source: codebase/],
  "coverage-review": [/coverage/],
  "rollback-safety": [/rollback/, /requiredEvidence\.checks/, /full-rollback/, /dev_flow_preview_rollback/, /dev_flow_execute_rollback/, /禁止.*自行恢复/],
  task: [/does not integrate OpenSpec/, /dev_flow_next/, /execution: light/, /documented-unconfirmed/, /scaffold_artifact/, /topology/, /具体失败后果/, /riskRequirements/, /light-L/],
  status: [/dev_flow_status/, /dev_flow_next/, /progress\.wait/, /继续/, /verificationFreshness/, /replyHint/, /requiredEvidence/, /可选建议，不影响流程/, /reviewStatus/, /validTargets/, /activeUnitId/, /remainingUnitIds/],
  doctor: [/dev_flow_doctor/],
  plan: [/dev_flow_next/, /scaffold_artifact/, /dev_flow_present_gate/, /禁止同回合/],
  "risk-review": [/dev_flow_record_step|risk-card/, /requiredEvidence/, /禁止.*复制/],
};

const ARTIFACT_OWNERS = new Set([
  "task",
  "requirements",
  "grillme",
  "plan",
  "coverage-review",
  "risk-review",
  "rollback-safety",
  "code-review",
  "verify",
  "implement",
]);
const TRACE_ARTIFACT_SKILLS = new Set(["requirements", "plan", "coverage-review", "rollback-safety"]);

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
    if (TRACE_ARTIFACT_SKILLS.has(name)) {
      assert.match(
        content,
        /dev_flow_scaffold_artifact[\s\S]*Read[\s\S]*(编辑|Edit|Write)[\s\S]*dev_flow_record_artifact_with_trace/,
        `${name} must require Read-before-Write with Trace registration`,
      );
    } else if (ARTIFACT_OWNERS.has(name)) {
      assert.match(content, /dev_flow_scaffold_artifact[\s\S]*Read[\s\S]*(编辑|Edit|Write)[\s\S]*dev_flow_record_artifact/,
        `${name} must require Read-before-Write for registered artifacts`);
    }
  }

  const requirements = await readFile(path.join(skillsRoot, "requirements", "SKILL.md"), "utf8");
  const grillme = await readFile(path.join(skillsRoot, "grillme", "SKILL.md"), "utf8");
  const task = await readFile(path.join(skillsRoot, "task", "SKILL.md"), "utf8");
  const plan = await readFile(path.join(skillsRoot, "plan", "SKILL.md"), "utf8");
  assert.match(requirements, /missing-or-unclear/);
  assert.match(requirements, /documented-unconfirmed/);
  assert.match(requirements, /`grillme`/);
  assert.match(grillme, /`requirements`/);
  assert.match(task, /status.*(只能 scaffold|禁止手工编辑).*record_artifact/);
  assert.match(plan, /status.*(只允许 scaffold|禁止编辑).*record_artifact/);

  const coverage = await readFile(path.join(skillsRoot, "coverage-review", "SKILL.md"), "utf8");
  const rollback = await readFile(path.join(skillsRoot, "rollback-safety", "SKILL.md"), "utf8");
  const status = await readFile(path.join(skillsRoot, "status", "SKILL.md"), "utf8");
  assert.match(requirements, /dev_flow_record_artifact_with_trace/);
  assert.match(requirements, /REQ-\.\.\.[\s\S]*AC-\.\.\./);
  assert.doesNotMatch(requirements, /dev_flow_record_artifact\(requirements\)/);
  assert.match(plan, /standard M[\s\S]*TASK-\.\.\.[\s\S]*RU-\.\.\./);
  assert.match(plan, /standard L[\s\S]*只提交 `TASK-/);
  assert.match(coverage, /dev_flow_record_artifact_with_trace[\s\S]*TEST-\.\.\.[\s\S]*AC-\.\.\./);
  assert.match(rollback, /standard L[\s\S]*rollback-units[\s\S]*RU-\.\.\./);
  assert.match(rollback, /standard M[\s\S]*不新建 artifact 或 RU/);
  assert.match(status, /dev_flow_get_traceability/);
});
