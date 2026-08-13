import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const reconciliation = await loadSource("plugins/dev-flow/src/core/git-reconciliation.ts");
const run = promisify(execFile);

test("feature start captures branch, base head, and dirty-path ownership candidates", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "lineage", host: "claude", scope: { inScope: ["src"], outOfScope: ["test"] } });
    assert.ok(state.workspace.baseBranch.length > 0);
    assert.match(state.workspace.baseHead, /^[a-f0-9]{40}$/);
    assert.equal(state.workspace.ownershipSource["src/counter.js"], undefined);
    assert.equal(await reconciliation.isAncestor(fixture.root, state.workspace.baseHead, state.workspace.baseHead), true);
  } finally {
    await fixture.dispose();
  }
});

test("manual commit creates an ownership decision and is never silently adopted", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "manual", host: "codex", scope: { inScope: ["src"], outOfScope: [] } });
    await writeFile(`${fixture.root}/src/counter.js`, "export const count = 42;\n");
    await run("git", ["add", "src/counter.js"], { cwd: fixture.root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "manual feature change"], { cwd: fixture.root });
    const reconciled = await store.reconcileWorkspace(fixture.root, "manual", state.revision, "claude");
    assert.equal(reconciled.workspace.ownership["src/counter.js"], undefined);
    assert.equal(reconciled.workspace.ownershipSource["src/counter.js"], undefined);
    assert.equal(decisions.pendingDecisionForState(reconciled).kind, "workspace-ownership");
    assert.match(decisions.pendingDecisionForState(reconciled).question, /src\/counter\.js/);
    assert.equal(reconciled.evidenceFreshness.verification, "missing");
  } finally {
    await fixture.dispose();
  }
});

test("commits that return governed bytes to the last observed basis update lineage without stale evidence", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "same-bytes", host: "codex", scope: { inScope: ["src"], outOfScope: [] } });
    const original = await readFile(`${fixture.root}/src/counter.js`, "utf8");
    await writeFile(`${fixture.root}/src/counter.js`, "export const changed = true;\n");
    await run("git", ["add", "src/counter.js"], { cwd: fixture.root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "temporary bytes"], { cwd: fixture.root });
    await writeFile(`${fixture.root}/src/counter.js`, original);
    await run("git", ["add", "src/counter.js"], { cwd: fixture.root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "restore bytes"], { cwd: fixture.root });
    const reconciled = await store.reconcileWorkspace(fixture.root, state.featureId, state.revision, "codex");
    assert.equal(reconciled.workspace.observedCommits.length, 2);
    assert.equal(reconciled.pendingDecision, undefined);
    assert.equal(reconciled.workspace.lastWorkspaceFingerprint, state.workspace.lastWorkspaceFingerprint);
    assert.equal(reconciled.evidenceFreshness.verification, "missing");
  } finally { await fixture.dispose(); }
});

test("an in-scope pre-existing dirty path is excluded at start instead of asking ownership", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await writeFile(`${fixture.root}/src/counter.js`, "export const count = 99;\n");
    const state = await store.startFeature(fixture.root, { featureId: "dirty", host: "codex", scope: { inScope: ["src"], outOfScope: [] } });
    assert.equal(decisions.pendingDecisionForState(state), undefined);
    assert.equal(state.workspace.ownership["src/counter.js"], "excluded");
    assert.equal(state.workspace.ownershipSource["src/counter.js"], "startup-excluded");
    assert.equal(Object.values(state.workspace.ownership).filter((owner) => owner === "feature").length, 0);
  } finally {
    await fixture.dispose();
  }
});

test("critical progression rejects newly observed paths until ownership is resolved", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "gate", host: "codex", scope: { inScope: ["src"], outOfScope: [] } });
    await writeFile(`${fixture.root}/src/new.js`, "export const newlyObserved = true;\n");
    await assert.rejects(
      () => store.assertWorkspaceOwnershipComplete(fixture.root, state, strictProjectConfig, "checkpoint"),
      (error) => error.code === "WORKSPACE_OWNERSHIP_REQUIRED" && error.details.unownedPaths.includes("src/new.js"),
    );
  } finally {
    await fixture.dispose();
  }
});

test("workspace lineage ignores untracked control files when governed root is the repository root", async () => {
  const fixture = await createTinyApp();
  try {
    await writeFile(`${fixture.root}/.dev-flow-control-marker`, "business marker\n");
    await mkdir(`${fixture.root}/.dev-flow/features/control`, { recursive: true });
    await writeFile(`${fixture.root}/.dev-flow/features/control/state.json`, "control state\n");
    const config = { governedRoots: ["."], governedRootsExclude: [] };
    const lineage = await reconciliation.captureWorkspaceLineage(fixture.root, config);
    assert.equal(Object.keys(lineage.startedDirty).includes(".dev-flow/features/control/state.json"), false);
    assert.equal(Object.keys(lineage.startedDirty).includes(".dev-flow-control-marker"), true);
    const state = { workspace: lineage, scope: { inScope: ["."], outOfScope: [] } };
    await writeFile(`${fixture.root}/.dev-flow/features/control/next.json`, "another control file\n");
    const reconciled = await reconciliation.reconcileWorkspaceForFeature(fixture.root, state, config);
    assert.equal(reconciled.changedPaths.includes(".dev-flow/features/control/next.json"), false);
  } finally {
    await fixture.dispose();
  }
});
