import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const run = promisify(execFile);

test("pause removes the active pointer without requiring commit or finalize, resume reconciles it", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "pause", host: "codex" });
    const paused = await store.pauseFeature(fixture.root, "pause", started.revision, "等待用户补充信息", "codex");
    assert.equal(paused.lifecycle, "paused");
    await assert.rejects(() => access(path.join(fixture.root, ".dev-flow", "active.json")));
    const resumed = await store.resumeFeature(fixture.root, "pause", "claude");
    assert.equal(resumed.lifecycle, "active");
    assert.equal((await store.readActive(fixture.root)).featureId, "pause");
    assert.equal((await store.readActive(fixture.root)).revision, resumed.revision);
  } finally {
    await fixture.dispose();
  }
});

test("resume after a manual pause commit adopts the commit and marks evidence stale", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const started = await store.startFeature(fixture.root, { featureId: "resume", host: "codex", scope: { inScope: ["src"], outOfScope: [] } });
    await store.pauseFeature(fixture.root, "resume", started.revision, "暂停", "codex");
    await mkdir(path.dirname(path.join(fixture.root, "src", "counter.js")), { recursive: true });
    await writeFile(path.join(fixture.root, "src", "counter.js"), "export const n = 2;\n");
    await run("git", ["add", "src/counter.js"], { cwd: fixture.root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "manual wip"], { cwd: fixture.root });
    const resumed = await store.resumeFeature(fixture.root, "resume", "claude");
    assert.equal(resumed.lifecycle, "active");
    assert.equal(resumed.workspace.ownership["src/counter.js"], "feature");
    assert.equal(resumed.workspace.ownershipSource["src/counter.js"], "manual-commit");
    assert.equal(resumed.evidenceFreshness.verification, "stale");
    assert.equal(resumed.evidenceFreshness.review, "stale");
    assert.match(resumed.resumeSummary, /证据已标记为待更新/);
  } finally {
    await fixture.dispose();
  }
});

test("starting another task never silently switches the active feature", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "old", host: "codex" });
    await assert.rejects(
      () => store.startFeature(fixture.root, { featureId: "new", objective: "新任务", host: "codex" }),
      (error) => error.code === "TASK_SWITCH_REQUIRED",
    );
    const old = await store.readState(fixture.root, "old");
    assert.equal(old.lifecycle, "active");
    assert.equal(old.pendingDecision.kind, "task-switch");
    await assert.rejects(() => store.readState(fixture.root, "new"), (error) => error.code === "FEATURE_NOT_FOUND");
  } finally {
    await fixture.dispose();
  }
});
