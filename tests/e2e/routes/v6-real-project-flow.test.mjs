// v6 real-project flow tests. These drive Core next actions and public review
// execution/answer contracts end to end.
import assert from "node:assert/strict";
import test from "node:test";
import { routeFlowConfig, runRoute } from "../../helpers/route-flow.mjs";
test("new feature completes scaffold -> requirements -> plan -> reviews -> implementation units -> verification -> finalize on v6 contracts", async () => {
  const result = await runRoute({
    level: "M",
    topology: "shared-contract",
    requirements: "provided-confirmed",
    scopeFacts: ["共享协议字段需要兼容"],
    topologyFacts: ["存在共享契约"],
    uncertaintyFacts: [],
    riskFacts: {},
    decisionRefs: [],
  }, "m", {
    config: routeFlowConfig,
    featureId: "v6-real-project",
    implementationFiles: { "src/protocol.js": "export const value = 1;\n" },
    reviewExecution: true,
    hostEventAnswer: true,
    expectSnapshot: true,
    returnObservations: true,
  });
  assert.equal(result.state.lifecycle, "finalized");
  assert.equal(result.state.logicComplete, true);
  assert.equal(result.review.createSeen, true);
  assert.equal(result.review.pendingSeen, true);
  assert.equal(result.review.assuranceLevel, "multi-perspective");
});
test("Svelte-style plan revision preserves UNIT-001/002 checkpoints and redoes only UNIT-003", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { loadSource } = await import("../../helpers/load-source.mjs");
  const run = promisify(execFile);
  const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
  const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
  const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
  const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
  const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
  const revision = await loadSource("plugins/dev-flow/src/core/plan-revision.ts");
  const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
  const { routeFlowConfig, driveUntil } = await import("../../helpers/route-flow.mjs");
  const { v6RequirementsMarkdown, v6ImplementationPlanMarkdown } = await import("../../helpers/v6-fixtures.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-svelte-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
    await store.initProject(root, routeFlowConfig);
    let state = await store.startFeature(root, {
      featureId: "svelte",
      host: "claude",
      level: "M",
      topology: "local",
      classificationBasis: {
        scopeFacts: ["三文件协议层"],
        topologyFacts: ["三个实现单元"],
        uncertaintyFacts: [],
        riskFacts: {},
        decisionRefs: [],
        signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 3, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
        controlEnhancements: { trace: true },
      },
    });
    const id = state.featureId;
    // 实现文件由受信写通道归属为 feature-owned，交付指纹才能覆盖它们。
    state = await store.mutate(root, id, state.revision, "test-ownership", (draft) => {
      for (const file of ["src/a.js", "src/b.js", "src/c.js"]) {
        draft.workspace.ownership[file] = "feature";
        draft.workspace.ownershipSource[file] = "test-hook";
      }
      draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((p) => !["src/a.js", "src/b.js", "src/c.js"].includes(p));
    });
    const scaffolded = await artifacts.scaffoldArtifact(root, id, state.revision, "requirements");
    state = scaffolded;
    const reqPath = path.join(root, ".dev-flow", "features", id, state.artifacts.requirements.path);
    await writeFile(reqPath, v6RequirementsMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "requirements")).state;
    current = await steps.recordStep(root, id, current.revision, "requirements_alignment", {});
    const scaffoldedPlan = await artifacts.scaffoldArtifact(root, id, current.revision, "implementation-plan");
    current = scaffoldedPlan;
    const planPath = path.join(root, ".dev-flow", "features", id, current.artifacts["implementation-plan"].path);
    const plan = [
      v6ImplementationPlanMarkdown({ taskId: "TASK-001", testId: "TEST-001", unitId: "UNIT-001", fileScope: ["src/a.js"] }),
      v6ImplementationPlanMarkdown({ taskId: "TASK-002", testId: "TEST-002", unitId: "UNIT-002", fileScope: ["src/b.js"] }).replace("- depends_on: []", "- depends_on: [UNIT-001]"),
      v6ImplementationPlanMarkdown({ taskId: "TASK-003", testId: "TEST-003", unitId: "UNIT-003", fileScope: ["src/c.js"] }).replace("- depends_on: []", "- depends_on: [UNIT-002]"),
    ].join("\n");
    await writeFile(planPath, plan);
    current = (await artifacts.recordArtifactFromMarkdown(root, id, current.revision, "implementation-plan")).state;
    // planReview 路线：plan 登记后由 Core nextAction 派生 create-review-batch →
    // 完成 jobs → run-step(plan_review) → execution-approval gate → begin。
    // driveUntil 是唯一调度权威，手工 recordStep(planning) 会因批次缺失被拒。
    const driven = await driveUntil(root, id, current, {
      input: { level: "M", topology: "local" },
      stopAt: (action) => action.kind === "begin-implementation-unit",
    });
    current = driven.state;
    // UNIT-001
    current = await units.beginImplementationUnit(root, id, current.revision, "UNIT-001");
    await writeFile(path.join(root, "src", "a.js"), "export const a = 1;\n");
    const cp1 = await checkpoints.checkpointImplementationUnit(root, id, current.revision, "UNIT-001");
    current = cp1.state;
    // UNIT-002
    current = await units.beginImplementationUnit(root, id, current.revision, "UNIT-002");
    await writeFile(path.join(root, "src", "b.js"), "export const b = 1;\n");
    const cp2 = await checkpoints.checkpointImplementationUnit(root, id, current.revision, "UNIT-002");
    current = cp2.state;
    assert.equal(current.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed");
    assert.equal(current.implementationUnits.find((u) => u.unitId === "UNIT-002").status, "checkpointed");
    // Revise the plan: only UNIT-003's file scope changes.
    const revisedPlan = plan.replace("- file_scope: [src/c.js]", "- file_scope: [src/c.js, src/c2.js]");
    await writeFile(planPath, revisedPlan);
    const presented = await revision.revisePlanFromMarkdown(root, id, current.revision, "codex");
    assert.deepEqual(presented.interaction.planRevision.affectedUnits, ["UNIT-003"]);
    assert.deepEqual(presented.interaction.planRevision.sideEffectUnits, []);
    await store.recordHostEvent(root, { eventId: "svelte-confirm", type: "user-prompt", host: "codex", text: "确认修订" });
    const answers = await loadSource("plugins/dev-flow/src/core/interaction-answer.ts");
    const applied = (await answers.answerFromHostEvents({
      root, featureId: id, expectedRevision: presented.state.revision, host: "codex",
    })).state;
    const { nextAction } = await loadSource("plugins/dev-flow/src/core/next.ts");
    const after = await nextAction(root, id);
    assert.notEqual(after.kind, "repair-trace", "confirmed revision must not leave a stale Trace for next()");
    // UNIT-001/002 checkpoints preserved; only UNIT-003 reopened.
    assert.equal(applied.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed", "UNIT-001 checkpoint preserved");
    assert.equal(applied.implementationUnits.find((u) => u.unitId === "UNIT-002").status, "checkpointed", "UNIT-002 checkpoint preserved");
    const unit003 = applied.implementationUnits.find((u) => u.unitId === "UNIT-003");
    assert.equal(unit003.status, "pending", "UNIT-003 reopened to pending");
    const ledger = await traceStore.readTraceability(root, applied);
    assert.equal(ledger.nodes["UNIT-001"].status, "current");
    assert.equal(ledger.nodes["UNIT-002"].status, "current");
    assert.equal(ledger.nodes["UNIT-003"].status, "current");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interaction/fault/budgets: host-event-only gates, crash-before-CAS retry, bounded GC, doctor corrupt current", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { loadSource } = await import("../../helpers/load-source.mjs");
  const run = promisify(execFile);
  const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
  const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
  const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
  const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
  const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
  const evidenceStore = await loadSource("plugins/dev-flow/src/core/evidence-store.ts");
  const maintenance = await loadSource("plugins/dev-flow/src/core/evidence-maintenance.ts");
  const { collectDoctorReport } = await loadSource("plugins/dev-flow/src/mcp/doctor.ts");
  const { routeFlowConfig, driveUntil } = await import("../../helpers/route-flow.mjs");
  const { v6RequirementsMarkdown, v6ImplementationPlanMarkdown } = await import("../../helpers/v6-fixtures.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-cd-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
    await store.initProject(root, routeFlowConfig);
    let state = await store.startFeature(root, {
      featureId: "interaction", host: "claude", level: "M", topology: "local",
      classificationBasis: {
        scopeFacts: ["交互与故障"], topologyFacts: ["三个实现单元"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [],
        signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 3, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
        controlEnhancements: { trace: true },
      },
    });
    const id = state.featureId;
    state = await store.mutate(root, id, state.revision, "test-ownership", (draft) => {
      for (const file of ["src/a.js", "src/b.js", "src/c.js"]) {
        draft.workspace.ownership[file] = "feature";
        draft.workspace.ownershipSource[file] = "test-hook";
      }
      draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((p) => !["src/a.js", "src/b.js", "src/c.js"].includes(p));
    });
    state = await artifacts.scaffoldArtifact(root, id, state.revision, "requirements");
    const reqPath = path.join(root, ".dev-flow", "features", id, state.artifacts.requirements.path);
    await writeFile(reqPath, v6RequirementsMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "requirements")).state;
    current = await steps.recordStep(root, id, current.revision, "requirements_alignment", {});
    current = await artifacts.scaffoldArtifact(root, id, current.revision, "implementation-plan");
    const planPath = path.join(root, ".dev-flow", "features", id, current.artifacts["implementation-plan"].path);
    const plan = [
      v6ImplementationPlanMarkdown({ taskId: "TASK-001", testId: "TEST-001", unitId: "UNIT-001", fileScope: ["src/a.js"] }),
      v6ImplementationPlanMarkdown({ taskId: "TASK-002", testId: "TEST-002", unitId: "UNIT-002", fileScope: ["src/b.js"] }).replace("- depends_on: []", "- depends_on: [UNIT-001]"),
      v6ImplementationPlanMarkdown({ taskId: "TASK-003", testId: "TEST-003", unitId: "UNIT-003", fileScope: ["src/c.js"] }).replace("- depends_on: []", "- depends_on: [UNIT-002]"),
    ].join("\n");
    await writeFile(planPath, plan);
    current = (await artifacts.recordArtifactFromMarkdown(root, id, current.revision, "implementation-plan")).state;
    // 交互：plan-review 批次与 execution-approval gate 全部经宿主事件解析
    // （answerFromHostEvents，无 userReply）。
    const driven = await driveUntil(root, id, current, {
      input: { level: "M", topology: "local" },
      hostEventAnswer: true,
      reviewExecution: true,
      stopAt: (action) => action.kind === "begin-implementation-unit",
    });
    assert.equal(driven.review.createSeen, true, "plan review batch created");
    assert.equal(driven.review.pendingSeen, true, "plan review jobs completed");
    current = driven.state;
    current = await units.beginImplementationUnit(root, id, current.revision, "UNIT-001");
    await writeFile(path.join(root, "src", "a.js"), "export const a = 1;\n");
    current = (await checkpoints.checkpointImplementationUnit(root, id, current.revision, "UNIT-001")).state;
    assert.equal(current.implementationUnits.find((u) => u.unitId === "UNIT-001").status, "checkpointed");

    // 故障：pack 写入后、catalog 切换前崩溃 → 未发布对象，重试幂等且内容寻址一致。
    const beforeCrash = await evidenceStore.readEvidenceStoreCatalog(root, id);
    await assert.rejects(
      evidenceStore.putEvidenceObject(root, id, "trace", "crash-proposal", {
        fault: (point) => { if (point === "before-catalog-write") throw new Error("injected crash-before-CAS"); },
      }),
      /injected crash-before-CAS/,
    );
    const afterCrash = await evidenceStore.readEvidenceStoreCatalog(root, id);
    assert.equal(afterCrash.objects.length, beforeCrash.objects.length, "crash before catalog switch must not publish the object");
    assert.equal(afterCrash.revision, beforeCrash.revision, "catalog revision must not advance on crash");
    const retried = await evidenceStore.putEvidenceObject(root, id, "trace", "crash-proposal");
    assert.equal(retried.catalog.objects.length, beforeCrash.objects.length + 1, "retry publishes exactly one new object");
    assert.deepEqual(await evidenceStore.readEvidenceObject(root, id, retried.ref), Buffer.from("crash-proposal"));

    // 预算：有界 GC 只回收不可达 pack；checkpoint manifest 仍是 root，保留可读。
    const orphan = await evidenceStore.putEvidenceObject(root, id, "event-segment", "orphan");
    const result = await maintenance.runBoundedEvidenceMaintenance(root, id, current, { packBudget: 5 });
    assert.ok(result.deletedPacks >= 1, "unreachable pack reclaimed");
    await assert.rejects(evidenceStore.readEvidenceObject(root, id, orphan.ref), /EVIDENCE_STORE_INTEGRITY_FAILED/);

    // doctor：current state.json 损坏 → ACTIVE_FEATURE_CORRUPT 定位。
    const stateFile = path.join(root, ".dev-flow", "features", id, "state.json");
    await writeFile(stateFile, "{ not valid json");
    const report = await collectDoctorReport(root, path.resolve("plugins/dev-flow"), "6.0.0", ["dev_flow_doctor"]);
    assert.equal(report.activeFeature.corrupt, true);
    assert.ok(report.diagnostics.some((item) => item.code === "ACTIVE_FEATURE_CORRUPT" && item.status === "error"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scene E: legacy kinds are rejected, TASK.tdd reaches Trace, mixed targeted commands fail once", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { loadSource } = await import("../../helpers/load-source.mjs");
  const run = promisify(execFile);
  const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
  const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
  const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
  const dispatch = await loadSource("plugins/dev-flow/src/mcp/dispatch.ts");
  const { routeFlowConfig } = await import("../../helpers/route-flow.mjs");
  const { v6RequirementsMarkdown, v6ImplementationPlanMarkdown } = await import("../../helpers/v6-fixtures.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-scene-e-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
    await store.initProject(root, {
      ...routeFlowConfig,
      verification: {
        commands: [
          { id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] },
          { id: "full", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["integration", "full"] },
        ],
      },
    });
    let state = await store.startFeature(root, {
      featureId: "scene-e", host: "claude", level: "M", topology: "local",
      classificationBasis: {
        scopeFacts: ["公开合同"], topologyFacts: ["单单元"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [],
        signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
        controlEnhancements: { trace: true },
      },
    });
    const id = state.featureId;
    await assert.rejects(
      () => artifacts.scaffoldArtifact(root, id, state.revision, "coverage-matrix"),
      (error) => error.code === "ARTIFACT_NOT_REQUIRED" || error.code === "INVALID_ARTIFACT" || error.code === "UNSUPPORTED_TRACE_ARTIFACT_KIND",
    );
    assert.equal("dev_flow_record_artifact_with_trace" in dispatch.toolSchemas, false);
    state = await artifacts.scaffoldArtifact(root, id, state.revision, "requirements");
    await writeFile(path.join(root, ".dev-flow", "features", id, state.artifacts.requirements.path), v6RequirementsMarkdown());
    state = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "requirements")).state;
    state = await steps.recordStep(root, id, state.revision, "requirements_alignment", {});
    state = await artifacts.scaffoldArtifact(root, id, state.revision, "implementation-plan");
    const planPath = path.join(root, ".dev-flow", "features", id, state.artifacts["implementation-plan"].path);
    const mixed = v6ImplementationPlanMarkdown({ commandId: "unit, full" }).replace(
      "- forward_verification: [unit, full]",
      "- forward_verification: [unit, full]",
    );
    await writeFile(planPath, v6ImplementationPlanMarkdown().replace("- forward_verification: [unit]", "- forward_verification: [unit, full]"));
    const revisionBefore = state.revision;
    const preflight = await artifacts.validatePlanFromMarkdown(root, id, "implementation-plan");
    assert.equal(preflight.ok, false);
    assert.ok(preflight.diagnostics.some((item) => item.code === "TRACE_VERIFICATION_COMMAND_NOT_TARGETED"));
    assert.equal((await store.readState(root, id)).revision, revisionBefore);
    await writeFile(planPath, v6ImplementationPlanMarkdown({ tdd: "test-first" }));
    state = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "implementation-plan")).state;
    const ledger = await (await loadSource("plugins/dev-flow/src/core/traceability-store.ts")).readTraceability(root, state);
    assert.equal(ledger.nodes["TASK-001"].tdd, "test-first");
    void mixed;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scene B: code change stales only the code batch and reopens only UNIT-003", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { loadSource } = await import("../../helpers/load-source.mjs");
  const run = promisify(execFile);
  const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
  const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
  const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
  const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
  const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
  const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
  const { routeFlowConfig, driveUntil } = await import("../../helpers/route-flow.mjs");
  const { v6RequirementsMarkdown, v6ImplementationPlanMarkdown } = await import("../../helpers/v6-fixtures.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-scene-b-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
    await store.initProject(root, routeFlowConfig);
    let state = await store.startFeature(root, {
      featureId: "scene-b", host: "claude", level: "M", topology: "local",
      classificationBasis: {
        scopeFacts: ["三单元"], topologyFacts: ["本地"], uncertaintyFacts: [], riskFacts: {}, decisionRefs: [],
        signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 3, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
        controlEnhancements: { trace: true, planReview: true, codeReview: "independent" },
      },
    });
    const id = state.featureId;
    state = await store.mutate(root, id, state.revision, "test-ownership", (draft) => {
      for (const file of ["src/a.js", "src/b.js", "src/c.js"]) {
        draft.workspace.ownership[file] = "feature";
        draft.workspace.ownershipSource[file] = "test-hook";
      }
    });
    state = await artifacts.scaffoldArtifact(root, id, state.revision, "requirements");
    await writeFile(path.join(root, ".dev-flow", "features", id, state.artifacts.requirements.path), v6RequirementsMarkdown());
    let current = (await artifacts.recordArtifactFromMarkdown(root, id, state.revision, "requirements")).state;
    current = await steps.recordStep(root, id, current.revision, "requirements_alignment", {});
    current = await artifacts.scaffoldArtifact(root, id, current.revision, "implementation-plan");
    const planPath = path.join(root, ".dev-flow", "features", id, current.artifacts["implementation-plan"].path);
    await writeFile(planPath, [
      v6ImplementationPlanMarkdown({ taskId: "TASK-001", testId: "TEST-001", unitId: "UNIT-001", fileScope: ["src/a.js"] }),
      v6ImplementationPlanMarkdown({ taskId: "TASK-002", testId: "TEST-002", unitId: "UNIT-002", fileScope: ["src/b.js"] }).replace("- depends_on: []", "- depends_on: [UNIT-001]"),
      v6ImplementationPlanMarkdown({ taskId: "TASK-003", testId: "TEST-003", unitId: "UNIT-003", fileScope: ["src/c.js"] }).replace("- depends_on: []", "- depends_on: [UNIT-002]"),
    ].join("\n"));
    current = (await artifacts.recordArtifactFromMarkdown(root, id, current.revision, "implementation-plan")).state;
    const driven = await driveUntil(root, id, current, {
      input: { level: "M", topology: "local" },
      reviewExecution: true,
      hostEventAnswer: true,
      stopAt: (action) => action.kind === "begin-implementation-unit",
    });
    current = driven.state;
    const planBatchId = driven.review.batchId;
    for (const [unitId, file, body] of [
      ["UNIT-001", "src/a.js", "export const a = 1;\n"],
      ["UNIT-002", "src/b.js", "export const b = 1;\n"],
      ["UNIT-003", "src/c.js", "export const c = 1;\n"],
    ]) {
      current = await units.beginImplementationUnit(root, id, current.revision, unitId);
      await writeFile(path.join(root, file), body);
      current = (await checkpoints.checkpointImplementationUnit(root, id, current.revision, unitId)).state;
    }
    current = await steps.recordStep(root, id, current.revision, "implementation", {});
    const createdCode = await (await loadSource("plugins/dev-flow/src/core/review-jobs.ts")).createReviewBatch(root, id, current.revision);
    assert.equal(createdCode.batch.phase, "code");
    current = (await (await import("../../helpers/route-flow.mjs")).completeReviewJobs(root, id, createdCode.state, createdCode.batch, {
      reviewExecution: true,
      skipPendingAssert: true,
    })).state;
    current = await steps.recordStep(root, id, current.revision, "code_review", { reviewType: "code", coverage: ["quality", "fidelity"], findings: [] });
    const invalidation = await loadSource("plugins/dev-flow/src/core/change-invalidation.ts");
    await writeFile(path.join(root, "src", "c.js"), "export const c = 2;\n");
    const invalidated = await invalidation.invalidateAffectedClaims(root, id, current.revision);
    assert.ok(invalidated, "UNIT-003 content change must invalidate");
    current = await store.readState(root, id);
    assert.equal(current.implementationUnits.find((unit) => unit.unitId === "UNIT-001").status, "checkpointed");
    assert.equal(current.implementationUnits.find((unit) => unit.unitId === "UNIT-002").status, "checkpointed");
    assert.equal(current.implementationUnits.find((unit) => unit.unitId === "UNIT-003").status, "pending");
    const ledger = await reviewStore.readReviewLedger(root, current);
    const planBatch = ledger.batches.find((batch) => batch.batchId === planBatchId);
    assert.equal(planBatch?.phase, "plan");
    assert.equal(planBatch?.validity, "current");
    assert.equal(ledger.unknownDiff, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scene F: real mutation of 10k owned paths keeps state.json under 512 KiB", async () => {
  const { mkdir, mkdtemp, rm, readFile, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { loadSource } = await import("../../helpers/load-source.mjs");
  const run = promisify(execFile);
  const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
  const next = await loadSource("plugins/dev-flow/src/core/next.ts");
  const status = await loadSource("plugins/dev-flow/src/core/status.ts");
  const { routeFlowConfig } = await import("../../helpers/route-flow.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-scene-f-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
    await store.initProject(root, routeFlowConfig);
    let state = await store.startFeature(root, {
      featureId: "scene-f", host: "claude", level: "XS", topology: "local",
    });
    const id = state.featureId;
    state = await store.mutate(root, id, state.revision, "test-ownership-budget", (draft) => {
      for (let i = 0; i < 10_000; i += 1) {
        const file = `src/module-${i}/index.ts`;
        draft.workspace.ownership[file] = "feature";
        draft.workspace.ownershipSource[file] = "trusted-hook";
        draft.workspace.observedPathFingerprints[file] = "a".repeat(64);
      }
    });
    const stateFile = path.join(root, ".dev-flow", "features", id, "state.json");
    const bytes = await readFile(stateFile);
    assert.ok(bytes.length < 512 * 1024, `state.json ${bytes.length}B exceeds the 512KiB budget`);
    const persisted = JSON.parse(bytes.toString("utf8"));
    assert.equal(persisted.workspace, undefined, "10k paths must live in the archive, not state.json");
    assert.ok(persisted.archivedCollections.workspaceLineage);
    const action = await next.nextAction(root, id);
    assert.equal(typeof action.kind, "string");
    const view = await status.readStatusView(root, id);
    assert.equal(view.featureId, id);
    assert.equal(Object.keys((await store.readState(root, id)).workspace.ownership).length >= 10_000, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
