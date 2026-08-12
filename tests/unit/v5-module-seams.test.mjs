import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const domainModules = [
  "acceptance.ts",
  "repository-facts.ts",
  "change-invalidation.ts",
  "implementation-units.ts",
  "verification.ts",
  "review-jobs.ts",
  "ownership-workflow.ts",
  "route-workflow.ts",
  "decision-workflow.ts",
  "plan-revision.ts",
];

test("治理领域模块通过 store seam 访问文件系统", async () => {
  await access("plugins/dev-flow/src/core/acceptance-store.ts");
  for (const file of domainModules) {
    const source = await readFile(`plugins/dev-flow/src/core/${file}`, "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["']node:(?:fs|fs\/promises|path|child_process)["']/u,
      `${file} must delegate filesystem access to a store seam`,
    );
  }
  const stateStore = await readFile("plugins/dev-flow/src/core/state-store.ts", "utf8");
  for (const name of [
    "recordDecision",
    "reviseDecision",
    "revisePlanDuringImplementation",
    "lockClassification",
    "confirmRouteClassification",
    "reclassifyFeature",
    "presentWorkspaceOwnership",
    "resolveWorkspaceOwnershipText",
    "reconcileWorkspace",
    "registerRepositoryFact",
  ]) {
    assert.doesNotMatch(stateStore, new RegExp(`^export (?:async )?function ${name}\\b`, "mu"), `state-store must not own ${name}`);
  }
});
