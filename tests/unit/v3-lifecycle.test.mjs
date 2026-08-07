import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const featureCheck = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const approvals = await loadSource("plugins/dev-flow/src/core/approval-interactions.ts");
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

test("start on an uninitialized project reports an explicit not-initialized message", async () => {
  const fixture = await createTinyApp();
  try {
    await assert.rejects(
      () => store.startFeature(fixture.root, { featureId: "f", host: "codex" }),
      (error) => {
        assert.equal(error.code, "PROJECT_NOT_INITIALIZED");
        assert.match(error.userMessage, /尚未初始化/);
        assert.doesNotMatch(error.cause, /条件尚未满足/);
        assert.match(error.recovery.instruction, /dev_flow_init_project/);
        return true;
      },
    );
  } finally {
    await fixture.dispose();
  }
});

test("a corrupt project.json reports INVALID_PROJECT_CONFIG, not not-initialized", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await writeFile(path.join(fixture.root, ".dev-flow", "project.json"), "{ not valid json");
    await assert.rejects(
      () => store.startFeature(fixture.root, { featureId: "f", host: "codex" }),
      (error) => {
        assert.equal(error.code, "INVALID_PROJECT_CONFIG");
        assert.doesNotMatch(error.cause, /缺少/);
        return true;
      },
    );
  } finally {
    await fixture.dispose();
  }
});

test("intake tool calls reject with ROUTE_NOT_DETERMINED instead of crashing", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const intake = await store.startFeature(fixture.root, { featureId: "intake", host: "codex" });
    const revision = intake.revision;
    await assert.rejects(
      () => featureCheck.recordStep(fixture.root, "intake", revision, "planning", {}),
      (error) => { assert.equal(error.code, "ROUTE_NOT_DETERMINED"); return true; },
    );
    await assert.rejects(
      () => featureCheck.finalize(fixture.root, "intake", revision),
      (error) => { assert.equal(error.code, "ROUTE_NOT_DETERMINED"); return true; },
    );
    await assert.rejects(
      () => artifacts.scaffoldArtifact(fixture.root, "intake", revision, "implementation-plan"),
      (error) => { assert.equal(error.code, "ROUTE_NOT_DETERMINED"); return true; },
    );
    await assert.rejects(
      () => featureCheck.featureCheck(fixture.root, "intake", revision),
      (error) => { assert.equal(typeof error.code, "string"); return true; },
    );
    await assert.rejects(
      () => approvals.presentApproval(fixture.root, "intake", revision, "approval:aaaaaaaaaaaaaaaaaaaa"),
      (error) => { assert.equal(typeof error.code, "string"); return true; },
    );
  } finally {
    await fixture.dispose();
  }
});
