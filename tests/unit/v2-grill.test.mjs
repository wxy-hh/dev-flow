import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "../helpers/load-source.mjs";

const templates = await loadSource("plugins/dev-flow/src/core/artifact-templates.ts");
const grill = await loadSource("plugins/dev-flow/src/core/requirements-grill.ts");
const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");

test("requirements templates contain no grill control state", () => {
  const contents = templates.renderArtifactTemplate({ featureId: "f", route: "standard-m", requirementsState: "documented-unconfirmed" }, "requirements");
  assert.doesNotMatch(contents, /grill_status|grill_question_id|grill_response_hint|in_progress/);
});

test("open question parsing filters template placeholders and collects real gaps", () => {
  const template = templates.renderArtifactTemplate({ featureId: "f", route: "standard-m", requirementsState: "documented-unconfirmed" }, "requirements");
  // 模板默认「- 无」不算未收敛条目。
  assert.deepEqual(grill.openQuestionItems(template), []);
  // 真实缺口逐项列出；空标记与续行被过滤。
  const withGaps = template.replace("## 开放问题\n\n- 无", [
    "## 开放问题",
    "",
    "- 无",
    "- 取消后 fetchStatus 默认语义待确认",
    "  （需要与后端核对）",
    "* 非目标中「另行确认」的破坏性变更",
    "1. N/A",
    "- 暂无",
    "",
  ].join("\n"));
  assert.deepEqual(grill.openQuestionItems(withGaps), [
    "取消后 fetchStatus 默认语义待确认",
    "非目标中「另行确认」的破坏性变更",
  ]);
  // 没有「开放问题」段。
  assert.deepEqual(grill.openQuestionItems("# 需求\n\n## 范围\n\n- x\n"), []);
  // 段为空。
  assert.deepEqual(grill.openQuestionItems("## 开放问题\n"), []);
});

test("grill decision rejects an unavailable code and accepts a complete option label", () => {
  const state = {
    interactions: {
      "i-1": {
        id: "i-1",
        kind: "grill",
        status: "pending",
        question: "如何处理需求边界？",
        options: [
          { id: "first", label: "保守处理", description: "保持当前边界。" },
          { id: "expand", label: "扩大范围", description: "纳入额外需求。" },
        ],
        recommendation: { optionId: "first", reason: "先保持改动边界稳定。" },
      },
    },
  };
  // 统一回答 seam（ADR-0019）：纯函数匹配经 resolveResponseForAnswer 打，
  // 不再直调私有化的 resolveTextInteraction。
  assert.throws(() => interactions.resolveResponseForAnswer(state, state.interactions["i-1"], { source: "text", userReply: "C", host: "codex" }), /DECISION_REPLY_NOT_RECOGNIZED/);
  const response = interactions.resolveResponseForAnswer(state, state.interactions["i-1"], { source: "text", userReply: "扩大范围", host: "codex" });
  assert.equal(response.action, "expand");
});

test("routed pending requirements can request grill directly and resolve interaction plus ledger together", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-routed-"));
  try {
    await mkdir(path.join(root, "src"));
    await stateStore.initProject(root, {
      schemaVersion: 2,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    });
    let state = await stateStore.startFeature(root, {
      featureId: "grill-routed",
      host: "codex",
      level: "M",
      topology: "shared-contract",
      execution: "standard",
      requirements: "documented-unconfirmed",
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: ["unknown"],
      riskFacts: {},
      decisionRefs: [],
    });
    state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
    const registered = await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "requirements", {
      nodes: [
        { kind: "requirement", id: "REQ-001" },
        { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
      ],
    });
    state = registered.state;
    const requested = await grill.requestGrillDecision(root, state.featureId, state.revision, {
      questionId: "G-001",
      question: "选择需求边界",
      options: [
        { id: "answer", label: "保守处理", description: "保持当前边界。" },
        { id: "expand", label: "扩大范围", description: "纳入额外需求。" },
      ],
      recommendation: { optionId: "answer", reason: "改动范围更可控。", drawback: "会继续保留当前限制。", alternative: { optionId: "expand", condition: "如果后续需要覆盖更多场景" } },
      host: "codex",
    });
    assert.equal(requested.state.interactions[requested.interactionId].status, "pending");
    const resolved = await stateStore.answer({ root, featureId: state.featureId, expectedRevision: requested.state.revision, host: "codex", credential: { source: "elicitation", action: "answer" } });
    assert.equal(resolved.state.governance.decisions.find((item) => item.recordId === "G-001").conclusion, "answer");
    assert.equal(resolved.state.interactions[requested.interactionId].status, "resolved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake grill request reopens a previously resolved decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-intake-reopen-"));
  try {
    await stateStore.initProject(root, {
      schemaVersion: 2,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    });
    let state = await stateStore.startFeature(root, { featureId: "grill-intake", host: "codex", objective: "intake" });
    const input = {
      questionId: "G-REOPEN",
      question: "再次确认",
      options: [
        { id: "yes", label: "确认", description: "按当前方案继续。" },
        { id: "no", label: "拒绝", description: "停止采用当前方案。" },
      ],
      recommendation: { optionId: "yes", reason: "当前方案已经完成前置澄清。", drawback: "会保留当前方案的维护成本。", alternative: { optionId: "no", condition: "如果确认应立即停止当前方案" } },
      host: "codex",
    };
    const first = await grill.requestGrillDecision(root, state.featureId, state.revision, input);
    const resolved = await stateStore.answer({ root, featureId: state.featureId, expectedRevision: first.state.revision, host: "codex", credential: { source: "elicitation", action: "yes" } });
    const second = await grill.requestGrillDecision(root, state.featureId, resolved.state.revision, input);
    state = second.state;
    assert.equal(state.interactions[second.interactionId].status, "pending");
    assert.equal(state.governance.decisions.find((item) => item.recordId === "G-REOPEN").conclusion, "yes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake grill token requires a matching host user-prompt event", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-intake-provenance-"));
  try {
    await stateStore.initProject(root, {
      schemaVersion: 2,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    });
    const state = await stateStore.startFeature(root, { featureId: "grill-intake-provenance", host: "codex", objective: "intake" });
    const input = {
      questionId: "G-PROVENANCE",
      question: "确认",
      options: [
        { id: "yes", label: "确认", description: "按当前方案继续。" },
        { id: "no", label: "拒绝", description: "停止采用当前方案。" },
      ],
      recommendation: { optionId: "yes", reason: "当前方案已经完成前置澄清。", drawback: "会保留当前方案的维护成本。", alternative: { optionId: "no", condition: "如果确认应立即停止当前方案" } },
      host: "codex",
    };
    const requested = await grill.requestGrillDecision(root, state.featureId, state.revision, input);
    const at = new Date(Date.now() + 1000).toISOString();
    await stateStore.recordHostEvent(root, { eventId: "prompt-wrong-host", type: "user-prompt", host: "claude", text: "确认", at });
    await assert.rejects(
      () => stateStore.answerFromHostEvents({ root, featureId: state.featureId, expectedRevision: requested.state.revision, host: "codex" }),
      (error) => error.code === "INTERACTION_EVENT_MISSING",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("next and status suggest grill when open questions are unconverged, without gating", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-grill-advisory-"));
  try {
    await mkdir(path.join(root, "src"));
    await stateStore.initProject(root, {
      schemaVersion: 2,
      verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
      enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
      governedRoots: ["src"],
    });
    let state = await stateStore.startFeature(root, {
      featureId: "grill-advisory",
      host: "codex",
      level: "M",
      topology: "shared-contract",
      execution: "standard",
      requirements: "documented-unconfirmed",
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: ["unknown"],
      riskFacts: {},
      decisionRefs: [],
    });
    state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
    state = (await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "requirements", {
      nodes: [
        { kind: "requirement", id: "REQ-001" },
        { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
      ],
    })).state;
    // 模板默认「- 无」：无 advisory。
    let action = await next.nextAction(root, state.featureId);
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "requirements_alignment");
    assert.equal(action.advisory, undefined);

    // 写入真实开放问题：advisory 出现（提示是只读建议，不重新登记也生效）。
    const requirementsPath = path.join(root, ".dev-flow", "features", state.featureId, state.artifacts.requirements.path);
    const contents = await readFile(requirementsPath, "utf8");
    await writeFile(requirementsPath, contents.replace("## 开放问题\n\n- 无", "## 开放问题\n\n- 取消后 fetchStatus 默认语义待确认\n- 非目标中「另行确认」的破坏性变更\n"));
    action = await next.nextAction(root, state.featureId);
    assert.equal(action.kind, "run-step");
    assert.equal(action.step, "requirements_alignment");
    assert.deepEqual(action.advisory, {
      code: "OPEN_QUESTIONS_UNCONVERGED",
      items: ["取消后 fetchStatus 默认语义待确认", "非目标中「另行确认」的破坏性变更"],
    });

    // status 投影同源提示（requirements_alignment 尚未满足时；status.md 由
    // 执行侧创建并登记，Core 每次提交时重写投影）。
    state = await stateStore.readState(root, state.featureId);
    await stateStore.mutate(root, state.featureId, state.revision, "advisory-status", (draft) => {
      draft.artifacts.status = { path: "status.md", sha256: "0".repeat(64) };
      draft.lastUpdatedBy = { host: "codex", pluginVersion: "test" };
    });
    state = await stateStore.readState(root, state.featureId);
    const status = await readFile(path.join(root, ".dev-flow", "features", state.featureId, "status.md"), "utf8");
    assert.match(status, /开放问题.*还有 2 项未收敛/);
    assert.match(status, /dev_flow_request_grill_decision/);

    // 已有 pending grill 时不再提示：GRILL_INCOMPLETE 门禁接管。
    // （grill 决策 basis 绑定需求文档 sha256：先重新登记修改后的文档。）
    state = await stateStore.readState(root, state.featureId);
    state = (await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "requirements", {
      nodes: [
        { kind: "requirement", id: "REQ-001" },
        { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
      ],
    })).state;
    const requested = await grill.requestGrillDecision(root, state.featureId, state.revision, {
      questionId: "G-001",
      question: "选择需求边界",
      options: [
        { id: "answer", label: "保守处理", description: "保持当前边界。" },
        { id: "expand", label: "扩大范围", description: "纳入额外需求。" },
      ],
      recommendation: { optionId: "answer", reason: "改动范围更可控。", drawback: "会继续保留当前限制。", alternative: { optionId: "expand", condition: "如果后续需要覆盖更多场景" } },
      host: "codex",
    });
    action = await next.nextAction(root, state.featureId);
    assert.equal(action.kind, "intake");
    assert.equal(action.activity, "resolve-decision");
    const resolved = await stateStore.answer({ root, featureId: state.featureId, expectedRevision: requested.state.revision, host: "codex", credential: { source: "elicitation", action: "answer" } });

    // 进入 planning 后不再提示（requirements_alignment 已满足）。
    await stateStore.mutate(root, state.featureId, resolved.state.revision, "requirements-aligned", (draft) => {
      draft.steps.requirements_alignment = { status: "satisfied", evidence: {} };
    });
    const afterAlignment = await next.nextAction(root, state.featureId);
    assert.equal(afterAlignment.advisory, undefined);
    assert.notEqual(afterAlignment.kind, "run-step");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
