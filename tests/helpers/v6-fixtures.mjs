/**
 * v6 fixture helpers.
 *
 * Contract under construction: normal v6 tests build structured Markdown first
 * and let Core compile it. They must never construct a public traceDelta.
 * These builders intentionally only create Markdown/JSON inputs; the v6
 * Core entry points are imported by the tests that enable their Phase todo.
 */

export function v6RequirementsMarkdown({ id = "REQ-001", acId = "AC-001" } = {}) {
  return [
    `<!-- dev-flow:id=${id} kind=requirement -->`,
    `### ${id}：v6 fixture requirement`,
    "",
    "需求正文不参与机器语义。",
    "",
    `<!-- dev-flow:id=${acId} kind=acceptance-criterion -->`,
    `### ${acId}：v6 fixture acceptance criterion`,
    "",
    `- parent_requirement: ${id}`,
    "- verification_kind: behavior-test",
    "",
  ].join("\n");
}

/**
 * Minimal valid implementation-plan Markdown for the v6 field grammar.
 * forward_verification must reference project command IDs; fixture repos use
 * the conventional "unit" command configured with targeted provides.
 */
export function v6ImplementationPlanMarkdown({
  taskId = "TASK-001",
  testId = "TEST-001",
  unitId = "UNIT-001",
  commandId = "unit",
  fileScope = ["src"],
  covers = ["REQ-001", "AC-001"],
  verifies = ["AC-001"],
  tdd = "test-first",
  includeTest = true,
  extra = "",
} = {}) {
  const coverList = `[${covers.join(", ")}]`;
  const lines = [
    `<!-- dev-flow:id=${taskId} kind=task -->`,
    `### ${taskId}：v6 fixture task`,
    "",
    `- covers: ${coverList}`,
    `- implementation_unit: ${unitId}`,
    `- tdd: ${tdd}`,
    "",
  ];
  if (includeTest) {
    lines.push(
      `<!-- dev-flow:id=${testId} kind=test -->`,
      `### ${testId}：v6 fixture test`,
      "",
      `- verifies: [${verifies.join(", ")}]`,
      "",
    );
  }
  lines.push(
    `<!-- dev-flow:id=${unitId} kind=implementation-unit -->`,
    `### ${unitId}：v6 fixture implementation unit`,
    "",
    `- tasks: [${taskId}]`,
    "- depends_on: []",
    `- file_scope: [${fileScope.join(", ")}]`,
    `- covers: ${coverList}`,
    `- forward_verification: [${commandId}]`,
    "",
  );
  if (extra.trim()) lines.push(extra.trim(), "");
  return lines.join("\n");
}

/**
 * L/high-risk plans additionally require a recovery arrangement in the same
 * implementation-plan artifact. REC nodes stay in implementation-plan; v6 has
 * no standalone rollback-units artifact.
 */
export function v6RecoveryBlock({ recId = "REC-001", stepRef = "UNIT-001" } = {}) {
  return [
    `<!-- dev-flow:id=${recId} kind=recovery -->`,
    `### ${recId}：v6 fixture recovery`,
    "",
    `- step_ref: ${stepRef}`,
    "- recovery_kind: compensation",
    "- method: 重建受影响的交付文件并重新执行该 UNIT 的 forward_verification",
    "- risk_ref: data",
    "",
  ].join("\n");
}

/** Markdown that is expected to be rejected by the v6 compiler. */
export function v6InvalidUnknownFieldMarkdown() {
  return [
    "<!-- dev-flow:id=TASK-001 kind=task -->",
    "### TASK-001",
    "",
    "- covers: [REQ-001, AC-001]",
    "- implementation_unit: UNIT-001",
    "- not_a_v6_field: true",
    "",
  ].join("\n");
}

/**
 * Write an artifact file into a feature directory. This helper intentionally
 * does not call record/validate: Phase 2 enables the compiler integration.
 */
export async function writeV6Artifact(root, featureId, kind, contents) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const target = path.join(root, ".dev-flow", "features", featureId, kind === "requirements" ? "需求文档.md" : "实施计划.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}
