import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
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
  await store.startFeature(root, { featureId: "f", host: "codex", ...input });
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
