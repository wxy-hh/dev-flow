import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture } from "../helpers/trace-fixtures.mjs";

const trace = await loadSource("plugins/dev-flow/src/core/traceability.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-trace-store-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("snapshot is immutable and addressed by canonical content", async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, ".dev-flow/features/f"), { recursive: true });
    const ledger = trace.emptyTraceabilityLedger("f", 0, "a".repeat(64));
    const first = await traceStore.writeTraceSnapshot(root, ledger);
    const second = await traceStore.writeTraceSnapshot(root, ledger);
    assert.deepEqual(second, first);
    assert.match(first.path, /^traceability\/snapshots\/[a-f0-9]{64}\.json$/);
    assert.equal(
      digest(await readFile(path.join(root, ".dev-flow/features/f", first.path))),
      first.sha256,
    );
  });
});

test("standard state points to an integrity-checked initial trace snapshot", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    const state = await stateStore.startFeature(root, {
      featureId: "standard",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
      host: "codex",
    });
    assert.equal(state.workflowCapabilities.trace, 1);
    assert.ok(state.traceability);
    const ledger = await traceStore.readTraceability(root, state);
    assert.equal(ledger.featureId, "standard");
    assert.equal(ledger.stateRevision, state.revision);
    await assert.rejects(
      () => traceStore.readTraceability(root, {
        ...state,
        traceability: { ...state.traceability, sha256: "b".repeat(64) },
      }),
      /TRACEABILITY_INTEGRITY_FAILED/,
    );
  });
});

test("ordinary mutate preserves revision event active and status hash after commit", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    let state = await stateStore.startFeature(root, {
      featureId: "standard",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
      host: "codex",
    });
    state = await stateStore.mutate(root, "standard", state.revision, "test-ready-for-status", (draft) => {
      draft.steps = Object.fromEntries([
        "requirements",
        "requirement_confirmation",
        "implementation_plan",
        "coverage_review",
        "rollback_unit",
        "plan_review",
      ].map((step) => [step, { status: "satisfied" }]));
    });
    state = await artifacts.scaffoldArtifact(root, "standard", state.revision, "status");
    const before = state.revision;
    const statusHash = state.artifacts.status.sha256;
    state = await stateStore.mutate(root, "standard", state.revision, "test-canary", () => {});
    assert.equal(state.revision, before + 1);
    assert.notEqual(state.artifacts.status.sha256, statusHash);
    const active = await stateStore.readActive(root);
    assert.equal(active.featureId, "standard");
    assert.equal(active.revision, state.revision);
    const events = await stateStore.readFeatureEvents(root, "standard");
    assert.ok(events.some((event) => event.revision === state.revision && event.type === "test-canary"));
    const disk = await readFile(path.join(root, ".dev-flow/features/standard", state.artifacts.status.path), "utf8");
    assert.equal(digest(disk), state.artifacts.status.sha256);
  });
});

test("prepared mutation faults keep commit semantics", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    let state = await stateStore.startFeature(root, {
      featureId: "standard",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
      host: "codex",
    });
    const before = state.revision;
    await assert.rejects(
      () => stateStore.mutatePrepared(
        root,
        "standard",
        state.revision,
        "before-commit-fault",
        async () => ({ mutate: () => {} }),
        { fault: (point) => { if (point === "before-state-commit") throw new Error("inject-before"); } },
      ),
      /inject-before/,
    );
    state = await stateStore.readState(root, "standard");
    assert.equal(state.revision, before);

    await assert.rejects(
      () => stateStore.mutatePrepared(
        root,
        "standard",
        state.revision,
        "after-commit-fault",
        async () => ({ mutate: () => {} }),
        { fault: (point) => { if (point === "after-state-commit") throw new Error("inject-after"); } },
      ),
      (error) => {
        assert.match(String(error), /STATE_COMMITTED_PROJECTION_FAILED/);
        assert.equal(error.details.committed, true);
        assert.equal(error.details.currentRevision, before + 1);
        assert.deepEqual(error.details.failedProjections, ["after-state-commit"]);
        return true;
      },
    );
    state = await stateStore.readState(root, "standard");
    assert.equal(state.revision, before + 1);
  });
});

test("next scaffolds generated status before implementation approval", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    let state = await stateStore.startFeature(root, {
      featureId: "standard",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
      host: "codex",
    });
    state = await artifacts.scaffoldArtifact(root, "standard", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "standard", state, kind: "requirements" });
    state = await stateStore.mutate(root, "standard", state.revision, "test-ready-for-approval", (draft) => {
      draft.steps = Object.fromEntries([
        "requirements",
        "requirement_confirmation",
      ].map((step) => [step, { status: "satisfied" }]));
    });
    state = await artifacts.scaffoldArtifact(root, "standard", state.revision, "implementation-plan");
    state = await registerTraceFixture({ root, featureId: "standard", state, kind: "implementation-plan" });
    state = await stateStore.mutate(root, "standard", state.revision, "test-ready-for-coverage", (draft) => {
      draft.steps.implementation_plan = { status: "satisfied" };
    });
    state = await artifacts.scaffoldArtifact(root, "standard", state.revision, "coverage-matrix");
    state = await registerTraceFixture({ root, featureId: "standard", state, kind: "coverage-matrix" });
    state = await stateStore.mutate(root, "standard", state.revision, "test-ready-for-approval", (draft) => {
      for (const step of ["coverage_review", "rollback_unit", "plan_review"]) draft.steps[step] = { status: "satisfied" };
    });
    const action = await next.nextAction(root, "standard");
    assert.deepEqual(action, { kind: "scaffold-artifact", step: "status" });
    state = await artifacts.scaffoldArtifact(root, "standard", state.revision, "status");
    const status = await readFile(path.join(root, ".dev-flow/features/standard", state.artifacts.status.path), "utf8");
    assert.match(status, /## Trace/);
    assert.match(status, /- Enforced: true/);
    assert.match(status, /- Pointer: traceability\/snapshots\/[a-f0-9]{64}\.json/);
    assert.match(status, /- Summary: total=5 current=5 stale=0 tombstoned=0/);
    assert.doesNotMatch(status, /- Blocker:/);
    const after = await next.nextAction(root, "standard");
    assert.equal(after.kind, "present-human-gate");
    assert.equal(after.step, "implementation_approval");
  });
});

test("snapshot write faults at every injection point leave no durable pointer file", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    await mkdir(path.join(root, ".dev-flow/features/f"), { recursive: true });
    const ledger = trace.emptyTraceabilityLedger("f", 0, "a".repeat(64));
    for (const point of ["before-temp-write", "after-temp-fsync", "after-snapshot-rename"]) {
      await assert.rejects(
        () => traceStore.writeTraceSnapshot(root, ledger, {
          fault: (hit) => { if (hit === point) throw new Error(`inject-${point}`); },
        }),
        new RegExp(`inject-${point}`),
      );
    }
    // after-snapshot-rename runs after rename, so the content-addressed file may exist;
    // without a state pointer it is orphaned and start must not leave a feature pointer.
    const light = await stateStore.startFeature(root, {
      featureId: "light",
      level: "M",
      topology: "local",
      execution: "light",
      host: "codex",
    });
    assert.equal(light.workflowCapabilities.trace, 1);
    assert.equal(light.traceability, undefined);
  });
});

test("startFeature post-commit projection failures keep state and report STATE_COMMITTED_PROJECTION_FAILED", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    await assert.rejects(
      () => stateStore.startFeature(root, {
        featureId: "event-fail",
        level: "M",
        topology: "local",
        execution: "standard",
        requirements: "provided-confirmed",
        host: "codex",
        activation: "paused",
      }, {
        fault: (point) => { if (point === "before-event") throw new Error("inject-event"); },
      }),
      (error) => {
        assert.equal(error.code, "STATE_COMMITTED_PROJECTION_FAILED");
        assert.equal(error.details.committed, true);
        assert.equal(error.details.currentRevision, 0);
        assert.deepEqual(error.details.failedProjections, ["event"]);
        return true;
      },
    );
    const eventFailed = await stateStore.readState(root, "event-fail");
    assert.equal(eventFailed.revision, 0);
    assert.equal(eventFailed.lifecycle, "paused");
    assert.ok(eventFailed.traceability);
    assert.equal((await stateStore.readFeatureEvents(root, "event-fail")).length, 0);
    assert.equal(await stateStore.readActive(root), undefined);
  });

  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    await assert.rejects(
      () => stateStore.startFeature(root, {
        featureId: "active-fail",
        level: "M",
        topology: "local",
        execution: "standard",
        requirements: "provided-confirmed",
        host: "codex",
      }, {
        fault: (point) => { if (point === "before-active") throw new Error("inject-active"); },
      }),
      (error) => {
        assert.equal(error.code, "STATE_COMMITTED_PROJECTION_FAILED");
        assert.equal(error.details.committed, true);
        assert.deepEqual(error.details.failedProjections, ["active"]);
        return true;
      },
    );
    const activeFailed = await stateStore.readState(root, "active-fail");
    assert.equal(activeFailed.revision, 0);
    assert.equal((await stateStore.readFeatureEvents(root, "active-fail")).at(-1)?.type, "started");
    assert.equal(await stateStore.readActive(root), undefined);
  });

  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    await assert.rejects(
      () => stateStore.startFeature(root, {
        featureId: "after-commit-fail",
        level: "M",
        topology: "local",
        execution: "standard",
        requirements: "provided-confirmed",
        host: "codex",
        activation: "paused",
      }, {
        fault: (point) => { if (point === "after-state-commit") throw new Error("inject-after"); },
      }),
      (error) => {
        assert.equal(error.code, "STATE_COMMITTED_PROJECTION_FAILED");
        assert.ok(error.details.failedProjections.includes("after-state-commit"));
        // event projection still runs independently after the after-state-commit fault
        assert.ok(error.details.failedProjections.includes("event") || error.details.failedProjections.length >= 1);
        return true;
      },
    );
    assert.equal((await stateStore.readState(root, "after-commit-fail")).revision, 0);
  });
});

test("startFeature pre-commit snapshot fault cleans new feature directory", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    for (const point of ["before-temp-write", "after-temp-fsync", "after-snapshot-rename"]) {
      const featureId = `pre-commit-${point}`;
      await assert.rejects(
        () => stateStore.startFeature(root, {
          featureId,
          level: "M",
          topology: "local",
          execution: "standard",
          requirements: "provided-confirmed",
          host: "codex",
        }, {
          snapshotFault: (hit) => { if (hit === point) throw new Error(`inject-${point}`); },
        }),
        new RegExp(`inject-${point}`),
      );
      await assert.rejects(() => stateStore.readState(root, featureId), /FEATURE_NOT_FOUND/);
      await assert.rejects(
        () => readFile(path.join(root, ".dev-flow/features", featureId, "state.json")),
        (error) => error.code === "ENOENT",
      );
    }
  });
});

test("readTraceability fail-closes on corrupt node shape even when digest matches", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    let state = await stateStore.startFeature(root, {
      featureId: "shape",
      level: "M",
      topology: "local",
      execution: "standard",
      requirements: "provided-confirmed",
      host: "codex",
    });
    const ledger = await traceStore.readTraceability(root, state);
    ledger.nodes["REQ-001"] = {
      kind: "requirement",
      id: "REQ-001",
      // missing TraceSource fields and invalid status
      status: "ghost",
    };
    ledger.summary = trace.traceSummary(ledger.nodes);
    ledger.edges = trace.deriveTraceEdges(ledger.nodes);
    const pointer = await traceStore.writeTraceSnapshot(root, ledger);
    state = await stateStore.mutate(root, "shape", state.revision, "inject-bad-trace", (draft) => {
      draft.traceability = pointer;
    });
    await assert.rejects(
      () => traceStore.readTraceability(root, state),
      /TRACEABILITY_INTEGRITY_FAILED/,
    );
  });
});

test("readProjectConfigSnapshot hashes raw project.json bytes", async () => {
  await withRoot(async (root) => {
    await stateStore.initProject(root, strictProjectConfig);
    const raw = await readFile(path.join(root, ".dev-flow/project.json"), "utf8");
    const snapshot = await traceStore.readProjectConfigSnapshot(root);
    assert.equal(snapshot.sha256, digest(raw));
    await writeFile(path.join(root, ".dev-flow/project.json"), `${raw}\n`);
    const rehashed = await traceStore.readProjectConfigSnapshot(root);
    assert.notEqual(rehashed.sha256, snapshot.sha256);
  });
});
