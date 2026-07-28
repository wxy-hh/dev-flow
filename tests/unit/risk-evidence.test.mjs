import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const policy = await loadSource("plugins/dev-flow/src/policy/evidence.ts");

const config = {
  schemaVersion: 1,
  verification: {
    commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }],
    behaviorCommands: [],
  },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function createRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await store.initProject(root, config);
  return root;
}

async function confirm(root, state, gate) {
  state = await gates.presentGate(root, "f", state.revision, gate);
  const reply = gate === "requirement_confirmation" ? "确认需求" : "批准实现";
  const eventId = `${gate}-${state.revision}`;
  await store.recordHostEvent(root, { eventId, type: "user-prompt", host: "codex", text: reply });
  return gates.confirmGate(root, "f", state.revision, gate, reply, { promptEventId: eventId }, "codex");
}

function evidenceFor(state, step) {
  const required = policy.requiredEvidenceForStep(state.route, state.classification.riskLabels, step);
  return { ...required.fields, ...(required.checks.length ? { checks: required.checks } : {}) };
}

async function lightLToRollback(root, riskLabels) {
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "L", topology: "multi-chain", execution: "light", riskLabels,
  });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "boundary-card");
  state = await checks.recordStep(root, "f", state.revision, "boundary", evidenceFor(state, "boundary"));
  return artifacts.scaffoldArtifact(root, "f", state.revision, "rollback-safety");
}

async function lightLToCodeReview(root, riskLabels) {
  let state = await lightLToRollback(root, riskLabels);
  state = await checks.recordStep(root, "f", state.revision, "rollback_safety", evidenceFor(state, "rollback_safety"));
  state = await confirm(root, state, "implementation_approval");
  return checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
}

async function standardToRollback(root, level) {
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level, topology: level === "L" ? "multi-chain" : "local",
    execution: "standard", requirements: "provided-confirmed", riskLabels: ["data"],
  });
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
  state = await checks.recordStep(root, "f", state.revision, "requirements", {});
  state = await confirm(root, state, "requirement_confirmation");
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");
  state = await checks.recordStep(root, "f", state.revision, "implementation_plan", {});
  state = await artifacts.scaffoldArtifact(root, "f", state.revision, "coverage-matrix");
  state = await checks.recordStep(root, "f", state.revision, "coverage_review", {});
  if (level === "L") state = await artifacts.scaffoldArtifact(root, "f", state.revision, "rollback-units");
  return state;
}

test("evidence policy maps risk obligations onto every route without putting full-code-review in checks", () => {
  assert.deepEqual(
    policy.requiredEvidenceForStep("light-l", ["security"], "code_review"),
    { fields: { reviewType: "code" }, checks: ["security"], verificationKinds: [] },
  );
  assert.deepEqual(
    policy.requiredEvidenceForStep("standard-m", ["data"], "rollback_unit").checks,
    ["rollback"],
  );
  assert.deepEqual(
    policy.requiredEvidenceForStep("standard-l", ["data"], "rollback_unit").checks,
    ["rollback"],
  );
  assert.deepEqual(
    policy.requiredEvidenceForStep("light-l", ["irreversible_consequence"], "rollback_safety").checks,
    ["full-rollback"],
  );
  const criticalReview = policy.requiredEvidenceForStep("light-l", ["critical_correctness"], "code_review");
  assert.equal(criticalReview.fields.reviewDepth, "full");
  assert.equal(criticalReview.checks.includes("full-code-review"), false);
  assert.deepEqual(policy.requiredEvidenceForStep("xs", [], "verification").verificationKinds, ["targeted"]);
});

test("light-l security rejects missing reviewType and security evidence", async () => {
  const root = await createRoot("dev-flow-risk-light-");
  try {
    let state = await lightLToCodeReview(root, ["security"]);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "code_review", {}),
      (error) => error.code === "REVIEW_TYPE_MISMATCH",
    );
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "code_review", { reviewType: "code" }),
      (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
        && error.details.missing.checks.includes("security"),
    );
    state = await checks.recordStep(root, "f", state.revision, "code_review", {
      reviewType: "code", checks: ["security"],
    });
    assert.equal(state.steps.code_review.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const level of ["M", "L"]) {
  test(`standard-${level.toLowerCase()} data rejects rollback_unit without rollback checks`, async () => {
    const root = await createRoot(`dev-flow-risk-standard-${level.toLowerCase()}-`);
    try {
      let state = await standardToRollback(root, level);
      await assert.rejects(
        () => checks.recordStep(root, "f", state.revision, "rollback_unit", {}),
        (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
          && error.details.missing.checks.includes("rollback"),
      );
      state = await checks.recordStep(root, "f", state.revision, "rollback_unit", { checks: ["rollback"] });
      assert.equal(state.steps.rollback_unit.status, "satisfied");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("light-l irreversible consequence requires full rollback and full code review", async () => {
  const root = await createRoot("dev-flow-risk-irreversible-");
  try {
    let state = await lightLToRollback(root, ["irreversible_consequence"]);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "rollback_safety", { checks: ["rollback"] }),
      (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
        && error.details.missing.checks.includes("full-rollback"),
    );
    state = await checks.recordStep(root, "f", state.revision, "rollback_safety", {
      checks: ["full-rollback"],
    });
    state = await confirm(root, state, "implementation_approval");
    state = await checks.recordStep(root, "f", state.revision, "implementation", { files: [] });
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "code_review", { reviewType: "code" }),
      (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
        && error.details.missing.fields.reviewDepth === "full",
    );
    state = await checks.recordStep(root, "f", state.revision, "code_review", {
      reviewType: "code", reviewDepth: "full",
    });
    assert.equal(state.steps.code_review.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("critical correctness requires full code review and full verification evidence", async () => {
  const root = await createRoot("dev-flow-risk-critical-");
  try {
    let state = await lightLToCodeReview(root, ["critical_correctness"]);
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "code_review", { reviewType: "code" }),
      (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
        && error.details.missing.fields.reviewDepth === "full",
    );
    state = await checks.recordStep(root, "f", state.revision, "code_review", {
      reviewType: "code", reviewDepth: "full",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "verification");
    state = await verification.runVerification(root, "f", state.revision, "codex");
    assert.deepEqual(state.steps.verification.evidence.kinds, ["full"]);

    const stateFile = path.join(root, ".dev-flow", "features", "f", "state.json");
    const raw = JSON.parse(await readFile(stateFile, "utf8"));
    raw.steps.verification.evidence.kinds = ["behavior"];
    await writeFile(stateFile, `${JSON.stringify(raw, null, 2)}\n`);
    await assert.rejects(
      () => checks.featureCheck(root, "f", state.revision),
      (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
        && error.details.step === "verification"
        && error.details.missing.verificationKinds.includes("full"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("risk-minimal requires all security and rollback checks", async () => {
  const root = await createRoot("dev-flow-risk-minimal-");
  try {
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "XS", topology: "local", riskLabels: ["security", "data"],
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "risk-card");
    state = await checks.recordStep(root, "f", state.revision, "risk_review", {});
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "status");
    await assert.rejects(
      () => checks.recordStep(root, "f", state.revision, "risk_controls", { checks: ["security"] }),
      (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
        && error.details.missing.checks.includes("rollback"),
    );
    state = await checks.recordStep(root, "f", state.revision, "risk_controls", {
      checks: ["security", "rollback"],
    });
    assert.equal(state.steps.risk_controls.status, "satisfied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("featureCheck rereads stored step evidence and rejects legacy incomplete state", async () => {
  const root = await createRoot("dev-flow-risk-reread-");
  try {
    let state = await lightLToCodeReview(root, ["security"]);
    state = await checks.recordStep(root, "f", state.revision, "code_review", {
      reviewType: "code", checks: ["security"],
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "verification");
    state = await verification.runVerification(root, "f", state.revision, "codex");

    const stateFile = path.join(root, ".dev-flow", "features", "f", "state.json");
    const raw = JSON.parse(await readFile(stateFile, "utf8"));
    raw.steps.code_review.evidence = { reviewType: "code" };
    await writeFile(stateFile, `${JSON.stringify(raw, null, 2)}\n`);

    await assert.rejects(
      () => checks.featureCheck(root, "f", state.revision),
      (error) => error.code === "RISK_EVIDENCE_INCOMPLETE"
        && error.details.step === "code_review"
        && error.details.missing.checks.includes("security"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
