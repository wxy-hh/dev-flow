import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "pass", command: "node", args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const scanned = ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"];

function signals() {
  return {
    changeSurface: "single-site",
    behaviorChange: "mechanical",
    topology: "local",
    unitCount: 1,
    requirements: "provided-confirmed",
    operationalRecovery: false,
    executableRollback: false,
  };
}

function classificationFacts(overrides = {}) {
  return {
    level: "XS",
    topology: "local",
    scopeFactRefs: [],
    topologyFactRefs: [],
    uncertaintyFactRefs: [],
    riskFactRefs: {},
    decisionRefs: [],
    signals: signals(),
    ...overrides,
  };
}

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  const state = await store.startFeature(root, { featureId: "f", host: "codex" });
  return { root, state };
}

test("lockClassification rejects the legacy v4 fact-prose shape with CLASSIFICATION_BASIS_INVALID, not a raw TypeError", async () => {
  const { root, state } = await setup("dev-flow-basis-guard-legacy-");
  try {
    const legacy = {
      level: "XS",
      topology: "local",
      scopeFacts: ["legacy scope prose"],
      topologyFacts: ["legacy topology prose"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
      signals: signals(),
    };
    await assert.rejects(
      () => store.lockClassification(root, "f", state.revision, legacy, { scanned, items: [] }),
      (error) => {
        assert.equal(error.name, "PolicyError");
        assert.equal(error.code, "CLASSIFICATION_BASIS_INVALID");
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lockClassification rejects malformed fact-ref fields with CLASSIFICATION_BASIS_INVALID", async () => {
  const { root, state } = await setup("dev-flow-basis-guard-malformed-");
  try {
    for (const malformed of [
      classificationFacts({ scopeFactRefs: "not-an-array" }),
      classificationFacts({ scopeFactRefs: ["   "] }),
      classificationFacts({ riskFactRefs: ["not-an-object"] }),
      classificationFacts({ riskFactRefs: { security: [] } }),
    ]) {
      await assert.rejects(
        () => store.lockClassification(root, "f", state.revision, malformed, { scanned, items: [] }),
        (error) => {
          assert.equal(error.name, "PolicyError");
          assert.equal(error.code, "CLASSIFICATION_BASIS_INVALID");
          return true;
        },
        JSON.stringify(malformed),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selectRoute validates a caller-supplied basis before use (the reclassifyFeature entry path)", async () => {
  // reclassifyFeature 经 selectRoute 消费 facts：旧形状 basis 必须得到合同错误，
  // 而不是深入执行后才炸。
  assert.throws(
    () => route.selectRoute({
      level: "S",
      topology: "local",
      classificationBasis: {
        scopeFacts: ["legacy scope prose"],
        topologyFacts: [],
        uncertaintyFacts: [],
        riskFacts: {},
        decisionRefs: [],
        signals: signals(),
      },
    }),
    (error) => {
      assert.equal(error.name, "PolicyError");
      assert.equal(error.code, "CLASSIFICATION_BASIS_INVALID");
      return true;
    },
  );
});

test("a well-formed new-shape basis still locks (guard does not over-reject)", async () => {
  const { root, state } = await setup("dev-flow-basis-guard-valid-");
  try {
    const locked = await store.lockClassification(root, "f", state.revision, classificationFacts(), { scanned, items: [] });
    assert.equal(locked.mode, "routed");
    assert.equal(locked.route, "xs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
