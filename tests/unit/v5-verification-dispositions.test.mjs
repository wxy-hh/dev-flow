import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";

const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");

const projectConfig = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const ac2Anchor = "\n<!-- dev-flow:id=AC-002 kind=acceptance-criterion -->\n#### AC-002：第二项验收（parent: REQ-001）\n\n- 验收条件：\n";

function requirementsDelta(ac2Disposition) {
  return {
    nodes: [
      { kind: "requirement", id: "REQ-001" },
      { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
      ...(ac2Disposition
        ? [{ kind: "acceptance-criterion", id: "AC-002", parentRequirement: "REQ-001", verificationDisposition: ac2Disposition }]
        : [{ kind: "acceptance-criterion", id: "AC-002", parentRequirement: "REQ-001" }]),
    ],
  };
}

async function setupFormalFeature() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-disposition-"));
  await mkdir(path.join(root, "src"));
  await stateStore.initProject(root, projectConfig);
  let state = await stateStore.startFeature(root, {
    featureId: "disp",
    host: "codex",
    level: "M",
    topology: "local",
    classificationBasis: {
      scopeFacts: ["scope"],
      topologyFacts: ["topology"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
      signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
      controlEnhancements: { trace: true },
    },
  });
  state = await artifacts.scaffoldArtifact(root, state.featureId, state.revision, "requirements");
  return { root, state };
}

async function registerRequirements(root, state, delta) {
  const markdown = await readFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts.requirements.path), "utf8");
  await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts.requirements.path), markdown + ac2Anchor);
  let current = (await artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "requirements", delta)).state;
  current = await steps.recordStep(root, state.featureId, current.revision, "requirements_alignment", {});
  current = await artifacts.scaffoldArtifact(root, state.featureId, current.revision, "implementation-plan");
  return current;
}

async function registerPlan(root, state, markdown, delta) {
  await writeFile(path.join(root, ".dev-flow", "features", state.featureId, state.artifacts["implementation-plan"].path), markdown);
  return artifacts.recordArtifactWithTrace(root, state.featureId, state.revision, "implementation-plan", delta);
}

const taskRuMarkdown = [
  "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001, AC-001\n- implementation_unit: UNIT-001\n- tdd: test-first\n",
  "<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\n\n- 验证方法：\n",
  "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: TASK-001\n- depends_on: []\n- file_scope: src\n- covers: REQ-001, AC-001\n- forward_verification: unit\n",
].join("\n");

const taskRuDelta = {
  nodes: [
    { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001", tdd: "test-first" },
    { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
    { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
  ],
};

test("an AC with a non-behavior disposition and reason passes plan preflight without its own TEST", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const req = await registerRequirements(root, state, requirementsDelta({ kind: "file-check", reason: "核对 docs/api.md 与实现一致", target: "docs/api.md" }));
    assert.equal(req.mode, "routed");
    const result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", taskRuDelta);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    // 预检通过后登记；AC-002 由文件核对处置覆盖（无 TEST 也合法）。
    await assert.doesNotReject(() => artifacts.recordArtifactWithTrace(root, state.featureId, req.revision, "implementation-plan", taskRuDelta));
    const store = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
    const ledger = await store.readTraceability(root, (await stateStore.readState(root, state.featureId)));
    const ac2 = ledger.nodes["AC-002"];
    assert.equal(ac2.verificationDisposition.kind, "file-check");
    assert.equal(ac2.verificationDisposition.target, "docs/api.md");
    // TDD 顺序与最终处置分别记录在 task 与 AC 上
    assert.equal(ledger.nodes["TASK-001"].tdd, "test-first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uncovered AC without disposition, empty reason, and behavior-test without TEST are all rejected", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    // 1) AC-002 无处置且 plan 无 TEST 覆盖 → 预检失败（定位 AC-002）
    const prepared = await registerRequirements(root, state, requirementsDelta(undefined));
    const missingMarkdown = taskRuMarkdown.replace("AC-001", "AC-001, AC-002");
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, prepared.artifacts["implementation-plan"].path), missingMarkdown);
    let result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", taskRuDelta);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.position === "AC-002"), JSON.stringify(result.diagnostics));

    // 2) 非行为处置空理由 → requirements 登记时被拒绝（delta 形状校验）
    const emptyReason = requirementsDelta({ kind: "rule-check", reason: "   " });
    const fresh = await stateStore.readState(root, state.featureId);
    await assert.rejects(
      () => artifacts.recordArtifactWithTrace(root, state.featureId, fresh.revision, "requirements", emptyReason),
      (error) => error.code === "TRACE_GRAPH_INVALID" || error.code === "PLAN_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one TEST can cover multiple ACs and inspect reports dispositions separately", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const req = await registerRequirements(root, state, requirementsDelta({ kind: "file-check", reason: "核对 README 文档" }));
    const multiDelta = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001", "AC-002"], implementationUnit: "UNIT-001" },
        { kind: "test", id: "TEST-001", verifies: ["AC-001", "AC-002"] },
        { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001", "AC-002"], forwardVerification: ["unit"] },
      ],
    };
    const markdown = [
      "<!-- dev-flow:id=TASK-001 kind=task -->\n### TASK-001\n\n- covers: REQ-001, AC-001, AC-002\n- implementation_unit: UNIT-001\n",
      "<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\n\n- 验证方法：\n",
      "<!-- dev-flow:id=UNIT-001 kind=implementation-unit -->\n### UNIT-001\n\n- tasks: TASK-001\n- depends_on: []\n- file_scope: src\n- covers: REQ-001, AC-001, AC-002\n- forward_verification: unit\n",
    ].join("\n");
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, req.artifacts["implementation-plan"].path), markdown);
    const registered = await artifacts.recordArtifactWithTrace(root, state.featureId, req.revision, "implementation-plan", multiDelta);
    const view = await inspection.inspectFeature(root, state.featureId, "trace");
    assert.ok(view.content.verificationDispositions);
    assert.equal(view.content.verificationDispositions.coveredByTest, 1);
    assert.deepEqual(view.content.verificationDispositions.byKind, [{ kind: "file-check", count: 1 }]);
    void registered;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("test-first tasks require a behavior test for the ACs they cover", async () => {
  const { root, state } = await setupFormalFeature();
  try {
    const req = await registerRequirements(root, state, requirementsDelta(undefined));
    // TEST-001 不覆盖 TASK-001 声明的 AC-001 → test-first 任务缺行为测试
    const noTestMarkdown = taskRuMarkdown.replace("<!-- dev-flow:id=TEST-001 kind=test -->\n### TEST-001\n\n- 验证方法：\n", "");
    await writeFile(path.join(root, ".dev-flow", "features", state.featureId, req.artifacts["implementation-plan"].path), noTestMarkdown);
    const noTest = { nodes: taskRuDelta.nodes.filter((node) => node.id !== "TEST-001") };
    let result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", noTest);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === "TEST_FIRST_REQUIRES_BEHAVIOR_TEST" && d.position === "AC-001"), JSON.stringify(result.diagnostics));
    // 任务改为 direct（非行为变更）后不再要求行为测试
    const direct = {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], implementationUnit: "UNIT-001", tdd: "direct" },
        { kind: "implementation-unit", id: "UNIT-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"], forwardVerification: ["unit"] },
      ],
    };
    result = await artifacts.validatePlan(root, state.featureId, "implementation-plan", direct);
    assert.equal(result.ok, false, "AC-001 仍无任何验证处置，direct 只解除 test-first 约束");
    assert.ok(!result.diagnostics.some((d) => d.code === "TEST_FIRST_REQUIRES_BEHAVIOR_TEST"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
