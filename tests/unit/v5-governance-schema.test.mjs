import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests", "fixtures", "v5-legacy");

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const basis = await loadSource("plugins/dev-flow/src/core/basis-state.ts");

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));
}

/** A shape-complete v6 state; overrides apply after defaults. */
function v6State(overrides = {}) {
  return {
    ...structuredClone(overrides),
    schemaVersion: 6,
    featureId: "fixture-v6",
    revision: 0,
    lifecycle: "active",
    mode: "intake",
    scope: { inScope: ["src/a.ts"], outOfScope: [] },
    steps: {},
    humanGates: {},
    artifacts: {},
    verification: { attempts: [] },
    interactions: {},
    blockingFindings: [],
    logicComplete: false,
    lastUpdatedBy: { host: "claude", pluginVersion: "6.0.0" },
    workspace: {
      baseHead: "abc", baseBranch: "main", observedHead: "abc",
      startedDirty: {}, ownership: {}, ownershipSource: {}, observedCommits: [],
      observedPathFingerprints: {}, lastWorkspaceFingerprint: "fp-1", reconciliationStatus: "current",
    },
    evidenceFreshness: { review: "missing", verification: "missing", checkpoint: "missing", implementation: "current" },
    governance: { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] },
    ...overrides,
  };
}

test("schema v1/v2/v3 states return a stable unsupported error with recovery instructions", () => {
  for (const version of [1, 2, 3]) {
    const legacy = { schemaVersion: version, featureId: "old", revision: 0 };
    assert.throws(
      () => store.validateFeatureState(legacy),
      (error) => {
        assert.equal(error.code, "UNSUPPORTED_FEATURE_SCHEMA");
        assert.equal(typeof error.recovery.instruction, "string", "unsupported error must carry a recovery instruction");
        return true;
      },
      `schemaVersion ${version} must be rejected with UNSUPPORTED_FEATURE_SCHEMA`,
    );
  }
});

test("v4/v5 states are rejected fail-closed by the 6.0 hard switch (no migration path)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-hardcut-"));
  try {
    const v4 = await fixture("state.json");
    const directory = path.join(root, ".dev-flow", "features", v4.featureId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "state.json"), JSON.stringify(v4));
    await assert.rejects(() => store.readState(root, v4.featureId), (error) => error.code === "UNSUPPORTED_FEATURE_SCHEMA");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("governance records are type-isolated: a credential cannot be stored as a decision", () => {
  const state = v6State({ governance: {
    decisions: [{ recordId: "CRED-x", kind: "credential", source: "text", host: "claude", interactionId: "i" }],
    claims: [], authorizations: [], credentials: [], repositoryFacts: [],
  } });
  assert.throws(
    () => store.validateFeatureState(state),
    (error) => error.code === "INVALID_STATE_SCHEMA",
  );
});

test("governance ledger shape is validated on v6 states", () => {
  const invalid = v6State({ governance: { decisions: "nope" } });
  assert.throws(() => store.validateFeatureState(invalid), (error) => error.code === "INVALID_STATE_SCHEMA");
  const missingKind = v6State({ governance: {
    decisions: [{ recordId: "D-1", kind: "unknown", question: "q", conclusion: "c" }],
    claims: [], authorizations: [], credentials: [], repositoryFacts: [],
  } });
  assert.throws(() => store.validateFeatureState(missingKind), (error) => error.code === "INVALID_STATE_SCHEMA");
});

function validInteractionRecord(overrides = {}) {
  return {
    id: "int-1",
    kind: "approval",
    target: "approval:requirements",
    basisHash: "a".repeat(64),
    options: [{ id: "confirm", label: "确认" }, { id: "request-changes", label: "修改" }],
    status: "pending",
    presentedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("interaction records are shape-validated at the load boundary", () => {
  const valid = v6State({ interactions: { "int-1": validInteractionRecord() } });
  assert.doesNotThrow(() => store.validateFeatureState(valid));

  const missingKind = v6State({ interactions: { "int-1": validInteractionRecord({ kind: undefined }) } });
  assert.throws(() => store.validateFeatureState(missingKind), (error) => error.code === "INVALID_STATE_SCHEMA");

  const unknownKind = v6State({ interactions: { "int-1": validInteractionRecord({ kind: "unknown-kind" }) } });
  assert.throws(() => store.validateFeatureState(unknownKind), (error) => error.code === "INVALID_STATE_SCHEMA");

  const invalidStatus = v6State({ interactions: { "int-1": validInteractionRecord({ status: "answered" }) } });
  assert.throws(() => store.validateFeatureState(invalidStatus), (error) => error.code === "INVALID_STATE_SCHEMA");
});

test("two pending interaction records are rejected at the load boundary", () => {
  const state = v6State({ interactions: {
    "int-1": validInteractionRecord(),
    "int-2": validInteractionRecord({ id: "int-2", target: "approval:implementation" }),
  } });
  assert.throws(() => store.validateFeatureState(state), (error) => error.code === "MULTIPLE_PENDING_DECISIONS");
});

test("a fresh feature is written as schema v6 with an empty governance ledger", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { objective: "issue-01 smoke", host: "codex" });
    assert.equal(state.schemaVersion, 6);
    assert.deepEqual(state.governance, { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] });
    const persisted = JSON.parse(await readFile(path.join(fixture.root, ".dev-flow", "features", state.featureId, "state.json"), "utf8"));
    assert.equal(persisted.schemaVersion, 6);
    const reloaded = await store.readState(fixture.root, state.featureId);
    assert.equal(reloaded.schemaVersion, 6);
    assert.deepEqual(reloaded, state);
  } finally {
    await fixture.dispose();
  }
});

test("v6 governance records keep event-bound credentials current only while the event exists", () => {
  const state = v6State({
    mode: "routed",
    route: "m",
    classification: { level: "M", topology: "local", riskLabels: [], orderedRoute: ["planning", "implementation", "code_review", "verification", "finalize"], acceptanceAssistSuggested: false },
    classificationBasis: {},
    obligations: [],
    governance: {
      decisions: [],
      claims: [],
      authorizations: [],
      credentials: [{
        recordId: "CRED-interaction-a",
        kind: "credential",
        source: "text",
        host: "claude",
        interactionId: "interaction-a",
        optionId: "opt-1",
        rawText: "选 A",
        basis: { kind: "event", eventId: "answer-event-a" },
        recordedAt: "2026-08-01T00:00:01.000Z",
      }],
      repositoryFacts: [],
    },
  });
  assert.equal(basis.deriveCurrency(state.governance.credentials[0], { eventIds: new Set(["answer-event-a"]) }), "current");
  assert.equal(basis.deriveCurrency(state.governance.credentials[0], { eventIds: new Set([]) }), "stale");
});
