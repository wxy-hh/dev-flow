import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";
import { completeReviewJobs } from "../helpers/route-flow.mjs";
import { v6ImplementationPlanMarkdown, v6RequirementsMarkdown } from "../helpers/v6-fixtures.mjs";

const run = promisify(execFile);
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const jobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");

const scanned = ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"];

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

function classificationFacts() {
  return {
    level: "M",
    topology: "shared-contract",
    scopeFactRefs: [],
    topologyFactRefs: [],
    uncertaintyFactRefs: [],
    riskFactRefs: {},
    decisionRefs: [],
    signals: {
      changeSurface: "multi-component",
      behaviorChange: "bounded-rule",
      topology: "shared-contract",
      unitCount: 1,
      requirements: "provided-confirmed",
      operationalRecovery: false,
      executableRollback: false,
    },
  };
}

function requirementsMarkdown(dispositionReason) {
  return v6RequirementsMarkdown().replace(
    "- parent_requirement: REQ-001\n- verification_kind: behavior-test",
    `- parent_requirement: REQ-001\n- verification_kind: file-check\n- verification_reason: ${dispositionReason}\n- verification_target: docs/spec.md`,
  );
}

const planMarkdown = v6ImplementationPlanMarkdown({ tdd: "direct", includeTest: false });

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "main.js"), "export {}\n");
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed"], { cwd: root });
  await store.initProject(root, config);
  let state = await store.startFeature(root, { featureId: "nb", host: "codex" });
  state = await store.lockClassification(root, "nb", state.revision, classificationFacts(), { scanned, items: [] });
  // M 路线需要先确认路线。
  await store.recordHostEvent(root, { eventId: `route-confirm-${state.revision}`, type: "user-prompt", host: "claude", text: "确认这条路线" });
  state = (await store.answerFromHostEvents({ root, featureId: "nb", expectedRevision: state.revision, host: "claude" })).state;
  state = await registerTraceFixture({ root, featureId: "nb", state, kind: "requirements", edit: () => requirementsMarkdown("仅核对文档结构，无运行时行为") });
  state = await checks.recordStep(root, "nb", state.revision, "requirements_alignment", {});
  state = await registerTraceFixture({ root, featureId: "nb", state, kind: "implementation-plan", edit: () => planMarkdown });
  return { root, state };
}

function jobByRole(batch, role) {
  const job = batch.jobs.find((candidate) => candidate.role === role);
  assert.ok(job, `expected a ${role} review job`);
  return job;
}

test("requirements-coverage package explicitly lists non-behavior dispositions with the covering tasks' tdd claims", async () => {
  const { root } = await setup("dev-flow-nb-disposition-");
  try {
    const state = await store.readState(root, "nb");
    const created = await jobs.createReviewBatch(root, "nb", state.revision);
    assert.equal(created.batch.phase, "plan");
    const rcPackage = await reviewStore.readReviewPackage(root, "nb", jobByRole(created.batch, "requirements-coverage").packageSha256);
    // 自报的豁免与其 tdd 自报并排呈现：不当豁免成为可定位的显式 finding 对象。
    assert.deepEqual(rcPackage.nonBehaviorDispositions, [
      {
        criterionId: "AC-001",
        dispositionKind: "file-check",
        reason: "仅核对文档结构，无运行时行为",
        target: "docs/spec.md",
        coveredBy: [{ taskId: "TASK-001", tdd: "direct" }],
      },
    ]);
    // 其他角色不携带该清单。
    const archPackage = await reviewStore.readReviewPackage(root, "nb", jobByRole(created.batch, "architecture-testability").packageSha256);
    assert.equal(archPackage.nonBehaviorDispositions, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a disposition-list change invalidates exactly the requirements-coverage role basis", async () => {
  const { root } = await setup("dev-flow-nb-disposition-rev-");
  try {
    let state = await store.readState(root, "nb");
    const first = await jobs.createReviewBatch(root, "nb", state.revision);
    state = (await completeReviewJobs(root, "nb", first.state, first.batch)).state;

    // 工件字节不变，仅 AC 的非行为处置理由变化（trace 语义变化）。
    state = await registerTraceFixture({ root, featureId: "nb", state, kind: "requirements", edit: () => requirementsMarkdown("核对导出列表是否变化") });
    state = await registerTraceFixture({ root, featureId: "nb", state, kind: "implementation-plan", edit: () => planMarkdown });
    const second = await jobs.createReviewBatch(root, "nb", state.revision);
    const rc = jobByRole(second.batch, "requirements-coverage");
    assert.equal(rc.status, "pending");
    assert.notEqual(rc.roleBasisHash, jobByRole(first.batch, "requirements-coverage").roleBasisHash);
    // architecture-testability 切片不含 AC 处置与 requirements 工件，应复用。
    assert.equal(jobByRole(second.batch, "architecture-testability").status, "reused");
    const rcPackage = await reviewStore.readReviewPackage(root, "nb", rc.packageSha256);
    assert.equal(rcPackage.nonBehaviorDispositions[0].reason, "核对导出列表是否变化");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
