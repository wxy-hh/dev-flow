import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function atAction(prefix, input, satisfiedSteps) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await store.initProject(root, config);
  let current = await store.startFeature(root, { featureId: "f", host: "codex", ...input });
  if (input.execution === "standard") {
    current = await artifacts.scaffoldArtifact(root, "f", current.revision, "requirements");
    current = await registerTraceFixture({ root, featureId: "f", state: current, kind: "requirements" });
    current = await checks.recordStep(root, "f", current.revision, "requirements", {});
    current = await gates.presentGate(root, "f", current.revision, "requirement_confirmation");
    await store.recordHostEvent(root, { eventId: "requirements-approved", type: "user-prompt", host: "codex", text: "确认需求" });
    current = await gates.confirmGate(root, "f", current.revision, "requirement_confirmation", "确认需求", { promptEventId: "requirements-approved" }, "codex");
    current = await artifacts.scaffoldArtifact(root, "f", current.revision, "implementation-plan");
    current = await registerTraceFixture({ root, featureId: "f", state: current, kind: "implementation-plan" });
    current = await checks.recordStep(root, "f", current.revision, "implementation_plan", {});
    current = await artifacts.scaffoldArtifact(root, "f", current.revision, "coverage-matrix");
    current = await registerTraceFixture({ root, featureId: "f", state: current, kind: "coverage-matrix" });
    await checks.recordStep(root, "f", current.revision, "coverage_review", {});
    return { root, dispose: () => rm(root, { recursive: true, force: true }) };
  }
  const file = path.join(root, ".dev-flow", "features", "f", "state.json");
  const state = JSON.parse(await readFile(file, "utf8"));
  state.steps = Object.fromEntries(satisfiedSteps.map((step) => [step, { status: "satisfied" }]));
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}

test("nextAction and StatusView expose identical required evidence before every risk-sensitive action", async () => {
  const cases = [
    {
      prefix: "dev-flow-next-critical-",
      input: { level: "L", topology: "multi-chain", execution: "light", riskLabels: ["critical_correctness"] },
      steps: ["boundary", "rollback_safety", "implementation_approval", "implementation"],
      expected: {
        kind: "run-step",
        step: "code_review",
        requiredEvidence: { fields: { reviewType: "code", reviewDepth: "full" }, checks: [], verificationKinds: [] },
      },
    },
    {
      prefix: "dev-flow-next-data-",
      input: { level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed", riskLabels: ["data"] },
      steps: ["requirements", "requirement_confirmation", "implementation_plan", "coverage_review"],
      expected: {
        kind: "run-step",
        step: "rollback_unit",
        requiredEvidence: { fields: {}, checks: ["rollback"], verificationKinds: [] },
      },
    },
    {
      prefix: "dev-flow-next-security-",
      input: { level: "L", topology: "multi-chain", execution: "light", riskLabels: ["security"] },
      steps: ["boundary", "rollback_safety", "implementation_approval", "implementation"],
      expected: {
        kind: "run-step",
        step: "code_review",
        requiredEvidence: { fields: { reviewType: "code" }, checks: ["security"], verificationKinds: [] },
      },
    },
    {
      prefix: "dev-flow-next-targeted-",
      input: { level: "XS", topology: "local" },
      steps: ["locate", "implementation"],
      expected: {
        kind: "run-step",
        step: "verification",
        requiredEvidence: { fields: {}, checks: [], verificationKinds: ["targeted"] },
      },
    },
    {
      prefix: "dev-flow-next-external-",
      input: { level: "XS", topology: "local", riskLabels: ["external"] },
      steps: ["risk_review", "risk_controls", "implementation_approval", "implementation", "code_review"],
      expected: {
        kind: "run-step",
        step: "verification",
        requiredEvidence: { fields: {}, checks: [], verificationKinds: ["integration"] },
      },
    },
  ];

  for (const scenario of cases) {
    const fixture = await atAction(scenario.prefix, scenario.input, scenario.steps);
    try {
      assert.deepEqual(await next.nextAction(fixture.root, "f"), scenario.expected);
      assert.deepEqual((await status.readStatusView(fixture.root, "f")).progress.nextAction, scenario.expected);
    } finally {
      await fixture.dispose();
    }
  }
});

test("a review:1 feature derives batch creation, pending jobs, then Core-only plan-review evidence", async () => {
  const fixture = await atAction(
    "dev-flow-next-review-",
    { level: "M", topology: "shared-contract", execution: "standard", requirements: "provided-confirmed" },
    [],
  );
  try {
    let state = await store.readState(fixture.root, "f");
    state = await checks.recordStep(fixture.root, "f", state.revision, "rollback_unit", {});
    assert.equal(state.workflowCapabilities.review, 1);
    assert.deepEqual(await next.nextAction(fixture.root, "f"), { kind: "create-review-batch", step: "plan_review" });

    const created = await reviewJobs.createReviewBatch(fixture.root, "f", state.revision);
    state = created.state;
    const pending = await next.nextAction(fixture.root, "f");
    assert.equal(pending.kind, "review-jobs-pending");
    assert.equal(pending.batchId, created.batch.batchId);
    for (const job of created.batch.jobs) {
      const capability = `claim-${job.jobId}-next-evidence-1234567890`;
      const claimed = await reviewJobs.claimReviewJob(fixture.root, "f", state.revision, created.batch.batchId, job.jobId, capability);
      state = (await reviewJobs.submitReviewJob(
        fixture.root, "f", claimed.state.revision, created.batch.batchId, job.jobId, capability,
        { coverageSummary: `${job.role} complete`, findings: [] },
      )).state;
    }
    const expected = {
      kind: "run-step",
      step: "plan_review",
      requiredEvidence: { fields: { reviewBatch: true }, checks: [], verificationKinds: [] },
    };
    assert.deepEqual(await next.nextAction(fixture.root, "f"), expected);
    assert.deepEqual((await status.readStatusView(fixture.root, "f")).progress.nextAction, expected);
  } finally {
    await fixture.dispose();
  }
});
