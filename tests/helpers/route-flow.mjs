import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "./load-source.mjs";
import { registerTraceFixture } from "./trace-fixtures.mjs";
import { promisify } from "node:util";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const definitions = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const evidencePolicy = await loadSource("plugins/dev-flow/src/policy/evidence.ts");
const run = promisify(execFile);
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

export async function runRoute(input, expectedRoute, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-route-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    await store.initProject(root, config);
    let state = await store.startFeature(root, { ...input, featureId: "feature", host: "claude" });
    assert.equal(state.route, expectedRoute);
    const definition = definitions.routeDefinitionForFeature(expectedRoute, state.workflowCapabilities);
    for (const step of definition.orderedSteps) {
      if (["feature_check", "finalize"].includes(step)) continue;
      const stepArtifacts = [
        ...(definition.artifactSteps?.[step] ?? []),
        ...(definition.generatedArtifactSteps?.[step] ?? []),
      ];
      for (const kind of stepArtifacts) {
        state = await artifacts.scaffoldArtifact(root, "feature", state.revision, kind);
      }
      for (const kind of definition.artifactSteps?.[step] ?? []) {
        if (["requirements", "implementation-plan", "coverage-matrix", "rollback-units"].includes(kind)) {
          state = await registerTraceFixture({
            root,
            featureId: "feature",
            state,
            kind,
            edit: kind === "requirements" && ["missing-or-unclear", "documented-unconfirmed"].includes(input.requirements)
              ? (markdown) => markdown.replace(/^  grill_status: pending$/m, "  grill_status: complete")
              : undefined,
          });
        }
      }
      if (step === "requirements" && ["missing-or-unclear", "documented-unconfirmed"].includes(input.requirements)) {
        // The Trace fixture above registers the same runtime scaffold after this edit.
      }
      if (["requirement_confirmation", "implementation_approval"].includes(step)) {
        state = await gates.presentGate(root, "feature", state.revision, step);
        const reply = step === "requirement_confirmation" ? "确认需求" : "批准实现";
        const eventId = `${step}-prompt`;
        await store.recordHostEvent(root, {
          eventId,
          type: "user-prompt",
          host: "claude",
          text: reply,
        });
        state = await gates.confirmGate(
          root,
          "feature",
          state.revision,
          step,
          reply,
          { promptEventId: eventId },
          "claude",
        );
      } else if (step === "verification") {
        state = await verification.runVerification(root, "feature", state.revision, "claude");
      } else {
        const required = evidencePolicy.requiredEvidenceForStep(
          state.route,
          state.classification.riskLabels,
          step,
        );
        if (step === "implementation" && options.implementationFiles) {
          for (const [file, contents] of Object.entries(options.implementationFiles)) {
            await mkdir(path.dirname(path.join(root, file)), { recursive: true });
            await writeFile(path.join(root, file), contents);
          }
        }
        const stepEvidence = {
          ...required.fields,
          ...(required.checks.length ? { checks: required.checks } : {}),
          ...(step === "implementation" ? { files: Object.keys(options.implementationFiles ?? {}) } : {}),
        };
        state = await checks.recordStep(root, "feature", state.revision, step, stepEvidence);
      }
    }
    if (definition.featureCheckRequired) {
      state = await checks.featureCheck(root, "feature", state.revision);
    }
    state = await checks.finalize(root, "feature", state.revision);
    assert.equal(state.logicComplete, true);
    assert.equal(state.lifecycle, "finalized");
    if (options.expectSnapshot) assert.ok(state.deliverySnapshot);
    return state;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
