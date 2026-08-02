import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const config = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src"] };

const fileFor = (root) => path.join(root, ".dev-flow", "features", "f", "需求文档.md");
async function setStatus(root, status) {
  const file = fileFor(root);
  await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: [^\r\n]+$/m, `  grill_status: ${status}`));
}
async function start(root, requirements) {
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "f", host: "claude", level: "M", topology: "local", execution: "standard", requirements });
  return artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
}
async function writeLegacyState(root, mutate) {
  const file = path.join(root, ".dev-flow", "features", "f", "state.json");
  const state = JSON.parse(await readFile(file, "utf8"));
  mutate(state);
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

test("requirements scaffolds the fixed grill status for every requirements state", async () => {
  for (const [requirements, status] of [["missing-or-unclear", "pending"], ["documented-unconfirmed", "pending"], ["provided-confirmed", "not_required"]]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-template-"));
    try {
      await start(root, requirements);
      const contents = await readFile(fileFor(root), "utf8");
      assert.match(contents, new RegExp(`^  grill_status: ${status}$`, "m"));
      for (const heading of ["范围", "目标", "非目标", "验收条件", "决策记录", "开放问题"]) assert.match(contents, new RegExp(`^## ${heading}$`, "m"));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("requirements step and gate require a registered, complete grill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-gate-"));
  try {
    let state = await start(root, "missing-or-unclear");
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_INCOMPLETE");

    await setStatus(root, "complete");
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "ARTIFACT_INTEGRITY_FAILED");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});

    await setStatus(root, "in_progress");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_INCOMPLETE");

    await setStatus(root, "complete");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    assert.equal(state.humanGates.requirement_confirmation.status, "pending");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("documented requirements enforce the same pending and in-progress gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-documented-"));
  try {
    let state = await start(root, "documented-unconfirmed");
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_INCOMPLETE");
    await setStatus(root, "complete");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    await setStatus(root, "in_progress");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_INCOMPLETE");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("provided-confirmed requirements accept an explicit completed grill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-provided-"));
  try {
    let state = await start(root, "provided-confirmed");
    await setStatus(root, "complete");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    assert.equal(state.humanGates.requirement_confirmation.status, "pending");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid grill status is rejected and registered edits revoke a confirmed requirement gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-invalidation-"));
  try {
    let state = await start(root, "provided-confirmed");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    state = await gates.presentGate(root, "f", state.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "later", type: "user-prompt", host: "claude", text: "approved" });
    state = await gates.confirmGate(root, "f", state.revision, "requirement_confirmation", "approved", { promptEventId: "later" }, "claude");

    await setStatus(root, "in_progress");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    assert.equal(state.humanGates.requirement_confirmation, undefined);
    assert.equal(state.steps.requirement_confirmation, undefined);
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_INCOMPLETE");

    await setStatus(root, "unsupported");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    await assert.rejects(() => gates.presentGate(root, "f", state.revision, "requirement_confirmation"), (error) => error.code === "GRILL_STATUS_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("grill status must occur exactly once inside dev_flow front matter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-front-matter-"));
  try {
    let state = await start(root, "provided-confirmed");
    const file = fileFor(root);
    await writeFile(file, `${(await readFile(file, "utf8")).replace(/^  grill_status: not_required\r?\n/m, "")}\n  grill_status: complete\n`);
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_STATUS_INVALID");

    const duplicateRoot = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-duplicate-"));
    try {
      state = await start(duplicateRoot, "missing-or-unclear");
      const duplicate = fileFor(duplicateRoot);
      await writeFile(duplicate, (await readFile(duplicate, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete\n  grill_status: complete"));
    state = await registerTraceFixture({ root: duplicateRoot, featureId: "f", state, kind: "requirements" });
      await assert.rejects(() => checks.recordStep(duplicateRoot, "f", state.revision, "requirements", {}), (error) => error.code === "GRILL_STATUS_INVALID");
    } finally { await rm(duplicateRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy standard features without grill_status fail closed after requirements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-legacy-"));
  try {
    let state = await start(root, "missing-or-unclear");
    const requirements = fileFor(root);
    const contents = (await readFile(requirements, "utf8")).replace(/^  grill_status: pending\r?\n/m, "");
    await writeFile(requirements, contents);
    state = await writeLegacyState(root, (legacy) => {
      legacy.artifacts.requirements.sha256 = createHash("sha256").update(contents).digest("hex");
      legacy.steps = { requirements: { status: "satisfied" }, requirement_confirmation: { status: "satisfied" } };
    });
    await assert.rejects(() => checks.recordStep(root, "f", state.revision, "implementation_plan", {}), (error) => error.code === "GRILL_STATUS_INVALID");

    state = await writeLegacyState(root, (legacy) => {
      legacy.steps = Object.fromEntries(["requirements", "requirement_confirmation", "implementation_plan", "coverage_review", "rollback_unit", "plan_review", "implementation_approval", "implementation", "code_review"].map((step) => [step, { status: "satisfied" }]));
    });
    await assert.rejects(() => verification.runVerification(root, "f", state.revision, "claude"), (error) => error.code === "GRILL_STATUS_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("grill front matter tolerates legacy limit fields and bare pending checklist rounds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-lenient-"));
  try {
    let state = await start(root, "missing-or-unclear");
    const file = fileFor(root);
    // 存量 front matter 残留 grill_question_limit（含越界值）被宽容忽略，不再校验
    await writeFile(file, (await readFile(file, "utf8")).replace(
      /^  grill_status: pending$/m,
      "  grill_status: in_progress\n  grill_question_id: Q-001\n  grill_response_hint: \"请选择一个方案\"\n  grill_question_limit: 999",
    ));
    let parsed = grill.parseGrillFrontMatter(await readFile(file, "utf8"));
    assert.equal(parsed.status, "in_progress");
    assert.equal(parsed.questionId, "Q-001");
    assert.equal("questionLimit" in parsed, false);

    // 清单预批轮：pending 允许不带当前题字段
    await writeFile(file, (await readFile(file, "utf8"))
      .replace(/^  grill_status: in_progress$/m, "  grill_status: pending")
      .replace(/^  grill_question_id: Q-001\r?\n/m, "")
      .replace(/^  grill_response_hint: "请选择一个方案"\r?\n/m, "")
      .replace(/^  grill_question_limit: 999\r?\n/m, ""));
    parsed = grill.parseGrillFrontMatter(await readFile(file, "utf8"));
    assert.equal(parsed.status, "pending");
    assert.equal(parsed.questionId, undefined);
    assert.equal(parsed.responseHint, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("grill decisions auto-inject the merge-remaining option and resolve it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-merge-"));
  try {
    let state = await start(root, "missing-or-unclear");
    const file = fileFor(root);
    await writeFile(file, (await readFile(file, "utf8")).replace(
      /^  grill_status: pending$/m,
      "  grill_status: in_progress\n  grill_question_id: Q-001\n  grill_response_hint: \"请选择一个方案\"",
    ));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    const input = {
      questionId: "Q-001",
      question: "选择同步方案",
      options: [{ id: "hosted", label: "托管同步" }],
      host: "claude",
    };
    const decision = await grill.requestGrillDecision(root, "f", state.revision, input);
    const injected = decision.interaction.options.filter((option) => option.id === "merge-remaining");
    assert.equal(injected.length, 1, "options must include exactly one merge-remaining");
    assert.equal(injected[0].label, "合并剩余（剩余问题按推荐答案一次确认）");
    assert.ok(
      decision.interaction.fallback.replies.some((candidate) => candidate.action === "merge-remaining"),
      "fallback replies must include merge-remaining token",
    );
    // 重复请求不重复注入
    const again = await grill.requestGrillDecision(root, "f", decision.state.revision, input);
    assert.equal(again.interaction.options.filter((option) => option.id === "merge-remaining").length, 1);
    // resolve merge-remaining 返回对应 action（text-token 路径）
    const reply = again.interaction.fallback.replies.find((candidate) => candidate.action === "merge-remaining").reply;
    await store.recordHostEvent(root, { eventId: "merge-token", type: "user-prompt", host: "claude", text: reply });
    const resolved = await grill.resolveGrillToken(root, "f", again.state.revision, again.interaction.id, reply, undefined, "claude");
    assert.equal(resolved.response.action, "merge-remaining");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("grill decisions use native structured choices or one-time replies and preserve other feedback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-interaction-"));
  try {
    let state = await start(root, "missing-or-unclear");
    const file = fileFor(root);
    await writeFile(file, (await readFile(file, "utf8")).replace(
      /^  grill_status: pending$/m,
      "  grill_status: in_progress\n  grill_question_id: Q-001\n  grill_response_hint: \"请选择一个方案\"",
    ));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    const input = {
      questionId: "Q-001",
      question: "选择同步方案",
      options: [
        { id: "hosted", label: "托管同步" },
        { id: "other", label: "其他 / 补充", requiresComment: true },
      ],
      host: "claude",
    };
    let decision = await grill.requestGrillDecision(root, "f", state.revision, input);
    await assert.rejects(
      () => grill.resolveGrillElicitation(root, "f", decision.state.revision, decision.interaction.id, "other", undefined, "claude"),
      (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
    );
    let resolved = await grill.resolveGrillElicitation(root, "f", decision.state.revision, decision.interaction.id, "hosted", undefined, "claude");
    assert.equal(resolved.response.action, "hosted");
    assert.equal(resolved.response.source, "elicitation");

    state = await registerTraceFixture({ root, featureId: "f", state: resolved.state, kind: "requirements" });
    decision = await grill.requestGrillDecision(root, "f", state.revision, input);
    const reply = decision.interaction.fallback.replies.find((candidate) => candidate.action === "other").reply.replace(" <修改意见>", " 支持离线同步");
    await store.recordHostEvent(root, { eventId: "grill-token", type: "user-prompt", host: "claude", text: reply });
    resolved = await grill.resolveGrillToken(root, "f", decision.state.revision, decision.interaction.id, reply, undefined, "claude");
    assert.deepEqual(resolved.response, {
      action: "other",
      comment: "支持离线同步",
      source: "text-token",
      promptEventId: "grill-token",
      userReply: reply,
      host: "claude",
      respondedAt: resolved.response.respondedAt,
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("grill token replies tolerate whitespace and reject gate approval phrases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-ws-"));
  try {
    let state = await start(root, "missing-or-unclear");
    const file = fileFor(root);
    await writeFile(file, (await readFile(file, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: in_progress\n  grill_question_id: Q-001\n  grill_response_hint: \"请选择一个方案\""));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    const input = {
      questionId: "Q-001",
      question: "选择同步方案",
      options: [{ id: "hosted", label: "托管同步" }, { id: "other", label: "其他 / 补充", requiresComment: true }],
      host: "claude",
    };
    let decision = await grill.requestGrillDecision(root, "f", state.revision, input);
    const reply = decision.interaction.fallback.replies.find((candidate) => candidate.action === "hosted").reply;

    // 带首尾空格的一次性回复可匹配（归一化）
    await store.recordHostEvent(root, { eventId: "ws-token", type: "user-prompt", host: "claude", text: `  ${reply}  ` });
    let resolved = await grill.resolveGrillToken(root, "f", decision.state.revision, decision.interaction.id, `  ${reply}  `, undefined, "claude");
    assert.equal(resolved.response.action, "hosted");

    // 批准词仅映射 HUMAN GATE，grill 交互仍走 token 匹配并拒绝
    state = await registerTraceFixture({ root, featureId: "f", state: resolved.state, kind: "requirements" });
    decision = await grill.requestGrillDecision(root, "f", state.revision, input);
    await store.recordHostEvent(root, { eventId: "phrase", type: "user-prompt", host: "claude", text: "确认需求" });
    await assert.rejects(
      () => grill.resolveGrillToken(root, "f", decision.state.revision, decision.interaction.id, "确认需求", undefined, "claude"),
      (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});
