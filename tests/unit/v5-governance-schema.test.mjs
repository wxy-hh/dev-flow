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
const migration = await loadSource("plugins/dev-flow/src/core/schema-migration.ts");

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));
}

function v4WithRecords(overrides = {}) {
  return {
    ...structuredClone(overrides),
    schemaVersion: 4,
    featureId: "fixture-v4",
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
    lastUpdatedBy: { host: "claude", pluginVersion: "5.0.4" },
    workspace: {
      baseHead: "abc", baseBranch: "main", observedHead: "abc",
      startedDirty: {}, ownership: {}, ownershipSource: {}, observedCommits: [],
      observedPathFingerprints: {}, lastWorkspaceFingerprint: "fp-1", reconciliationStatus: "current",
    },
    evidenceFreshness: { review: "missing", verification: "missing", checkpoint: "missing", implementation: "current" },
    qualityExceptions: [],
    ...overrides,
  };
}

test("v4 fixture migrates deterministically and idempotently to schema v5 without dual writes", async () => {
  const v4 = await fixture("state.json");
  const first = migration.migrateFeatureState(v4);
  const second = migration.migrateFeatureState(v4);
  assert.equal(first.schemaVersion, 5);
  assert.deepEqual(second, first, "same v4 input must produce identical v5 output");
  // 幂等：v5 输入原样返回（migrate 对 v5 是 no-op，不产生 v4 副本字段）
  assert.equal(migration.migrateFeatureState(first), first);
  assert.equal("governance" in first, true);
  // fixture 只有 pending interaction：没有已解决决策/授权/凭证
  assert.deepEqual(first.governance.decisions, []);
  assert.deepEqual(first.governance.authorizations, []);
  assert.deepEqual(first.governance.credentials, []);
  assert.deepEqual(first.governance.claims, []);
  assert.deepEqual(first.governance.repositoryFacts, []);
  assert.equal(first.governance.decisions.length, 0);
});

test("v4 resolved decisions migrate to decision records without basis (unconfirmed by derivation)", () => {
  const v4 = v4WithRecords({
    decisionLedger: [
      { id: "DEC-1111111111111111", question: "是否纳入？", status: "resolved", evidence: "用户已确认", conclusion: "纳入" },
      { id: "DEC-2222222222222222", question: "仍未决定？", status: "open" },
      { id: "DEC-3333333333333333", question: "并入它处？", status: "merged", mergedInto: "DEC-4444444444444444" },
      { id: "DEC-5555555555555555", question: "驳回？", status: "dismissed", dismissedReason: "无关" },
    ],
  });
  const migrated = migration.migrateFeatureState(v4);
  assert.equal(migrated.governance.decisions.length, 1);
  const decision = migrated.governance.decisions[0];
  assert.equal(decision.recordId, "DEC-1111111111111111");
  assert.equal(decision.kind, "decision");
  assert.equal(decision.conclusion, "纳入");
  assert.equal(decision.basis, undefined, "v4 决策没有事件/内容依据，不猜测有效");
  assert.equal(basis.deriveCurrency(decision, {}), "unconfirmed");
});

test("v4 quality exceptions migrate to authorizations bound to the fingerprint, ignoring v4 status", () => {
  const v4 = v4WithRecords({
    qualityExceptions: [
      { kind: "verification", basisHash: "b1", fingerprint: "fp-current", riskSummary: "接受验证缺口", userEvidence: "用户接受", at: "2026-08-01T00:00:00.000Z", status: "current" },
      { kind: "review", basisHash: "b2", fingerprint: "fp-old", riskSummary: "接受审查缺口", userEvidence: "用户接受", at: "2026-08-01T00:00:01.000Z", status: "stale" },
    ],
  });
  const migrated = migration.migrateFeatureState(v4);
  assert.equal(migrated.governance.authorizations.length, 2);
  const [current, old] = migrated.governance.authorizations;
  assert.equal(current.authorizationType, "risk-acceptance");
  assert.equal(current.basis.kind, "content");
  assert.equal(current.basis.sha256, "fp-current");
  assert.equal(current.recordedAt, "2026-08-01T00:00:00.000Z");
  // v4 自带的 status 结论不被信任：只由当前指纹派生
  assert.equal(basis.deriveCurrency(current, { contentFingerprint: "fp-current" }), "current");
  assert.equal(basis.deriveCurrency(current, { contentFingerprint: "fp-other" }), "stale");
  assert.equal(basis.deriveCurrency(current, {}), "unconfirmed");
  assert.equal(basis.deriveCurrency(old, { contentFingerprint: "fp-current" }), "stale");
});

test("v4 resolved interactions migrate to credentials bound to their prompt event", () => {
  const v4 = v4WithRecords({
    interactions: {
      "interaction-a": {
        id: "interaction-a",
        kind: "grill",
        target: "grill:x",
        basisHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        presentedAt: "2026-08-01T00:00:00.000Z",
        presentationEventId: "present-event-a",
        status: "resolved",
        options: [],
        response: {
          action: "answered", kind: "option", selectedOptionId: "opt-1", rawReply: "选 A",
          source: "text", promptEventId: "answer-event-a", host: "claude", respondedAt: "2026-08-01T00:00:01.000Z",
        },
      },
      "interaction-b": { id: "interaction-b", kind: "grill", target: "grill:y", basisHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", presentedAt: "2026-08-01T00:00:00.000Z", status: "pending", options: [] },
      "interaction-c": {
        id: "interaction-c",
        kind: "approval",
        target: "approval",
        basisHash: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        presentedAt: "2026-08-01T00:00:00.000Z",
        presentationEventId: "present-event-c",
        status: "resolved",
        options: [],
        response: { action: "answered", kind: "option", selectedOptionId: "yes", source: "elicitation", host: "codex", respondedAt: "2026-08-01T00:00:02.000Z" },
      },
    },
  });
  const migrated = migration.migrateFeatureState(v4);
  assert.equal(migrated.governance.credentials.length, 2);
  const text = migrated.governance.credentials.find((c) => c.interactionId === "interaction-a");
  const form = migrated.governance.credentials.find((c) => c.interactionId === "interaction-c");
  assert.deepEqual(text, {
    recordId: "CRED-interaction-a",
    kind: "credential",
    source: "text",
    host: "claude",
    interactionId: "interaction-a",
    optionId: "opt-1",
    rawText: "选 A",
    basis: { kind: "event", eventId: "answer-event-a" },
    recordedAt: "2026-08-01T00:00:01.000Z",
  });
  assert.equal(form.source, "native-form");
  assert.equal(form.host, "codex");
  assert.equal(form.basis.eventId, "present-event-c");
  // 凭证绑定事件：事件仍存在则 current，否则 stale
  assert.equal(basis.deriveCurrency(text, { eventIds: new Set(["answer-event-a"]) }), "current");
  assert.equal(basis.deriveCurrency(text, { eventIds: new Set([]) }), "stale");
});

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

test("migrateFeatureState rejects schema v1/v2/v3 with the same stable code", () => {
  for (const version of [1, 2, 3]) {
    assert.throws(
      () => migration.migrateFeatureState({ schemaVersion: version }),
      (error) => error.code === "UNSUPPORTED_FEATURE_SCHEMA",
    );
  }
});

test("governance records are type-isolated: a credential cannot be stored as a decision", () => {
  const v5 = v4WithRecords({ schemaVersion: 5, governance: {
    decisions: [{ recordId: "CRED-x", kind: "credential", source: "text", host: "claude", interactionId: "i" }],
    claims: [], authorizations: [], credentials: [], repositoryFacts: [],
  } });
  assert.throws(
    () => store.validateFeatureState(v5),
    (error) => error.code === "INVALID_STATE_SCHEMA",
  );
});

test("governance ledger shape is validated on v5 states", () => {
  const invalid = v4WithRecords({ schemaVersion: 5, governance: { decisions: "nope" } });
  assert.throws(() => store.validateFeatureState(invalid), (error) => error.code === "INVALID_STATE_SCHEMA");
  const missingKind = v4WithRecords({ schemaVersion: 5, governance: {
    decisions: [{ recordId: "D-1", kind: "unknown", question: "q", conclusion: "c" }],
    claims: [], authorizations: [], credentials: [], repositoryFacts: [],
  } });
  assert.throws(() => store.validateFeatureState(missingKind), (error) => error.code === "INVALID_STATE_SCHEMA");
});

test("a fresh feature is written as schema v5 with an empty governance ledger", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    const state = await store.startFeature(fixture.root, { objective: "issue-01 smoke", host: "codex" });
    assert.equal(state.schemaVersion, 5);
    assert.deepEqual(state.governance, { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] });
    // 落盘与读取都保持 v5 单格式，不降级、不双写
    const persisted = JSON.parse(await readFile(path.join(fixture.root, ".dev-flow", "features", state.featureId, "state.json"), "utf8"));
    assert.equal(persisted.schemaVersion, 5);
    assert.deepEqual(persisted.governance, state.governance);
    const reloaded = await store.readState(fixture.root, state.featureId);
    assert.equal(reloaded.schemaVersion, 5);
    assert.deepEqual(reloaded, state);
  } finally {
    await fixture.dispose();
  }
});

test("readState migrates an existing v4 state file at the load boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v5-boundary-"));
  try {
    const v4 = await fixture("state.json");
    const directory = path.join(root, ".dev-flow", "features", v4.featureId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "state.json"), JSON.stringify(v4));
    const loaded = await store.readState(root, v4.featureId);
    assert.equal(loaded.schemaVersion, 5);
    assert.ok(loaded.governance);
    // 再次读取结果一致（跨宿主/重复读取确定性）
    const again = await store.readState(root, v4.featureId);
    assert.deepEqual(again, loaded);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
