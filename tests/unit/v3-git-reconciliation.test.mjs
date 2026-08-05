import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
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

test("manual commit is reconciled as user-adopted and content changes stale evidence", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { featureId: "manual", host: "codex", scope: { inScope: ["src"], outOfScope: [] } });
    await writeFile(`${fixture.root}/src/counter.js`, "export const count = 42;\n");
    await run("git", ["add", "src/counter.js"], { cwd: fixture.root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "manual feature change"], { cwd: fixture.root });
    const reconciled = await store.reconcileWorkspace(fixture.root, "manual", state.revision, "claude");
    assert.equal(reconciled.workspace.ownership["src/counter.js"], "feature");
    assert.equal(reconciled.workspace.ownershipSource["src/counter.js"], "manual-commit");
    assert.equal(reconciled.evidenceFreshness.verification, "stale");
  } finally {
    await fixture.dispose();
  }
});

test("an in-scope pre-existing dirty path creates one ownership decision instead of guessing", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await writeFile(`${fixture.root}/src/counter.js`, "export const count = 99;\n");
    const state = await store.startFeature(fixture.root, { featureId: "dirty", host: "codex", scope: { inScope: ["src"], outOfScope: [] } });
    assert.equal(state.pendingDecision.kind, "workspace-ownership");
    assert.equal(Object.values(state.workspace.ownership).filter((owner) => owner === "feature").length, 0);
  } finally {
    await fixture.dispose();
  }
});
