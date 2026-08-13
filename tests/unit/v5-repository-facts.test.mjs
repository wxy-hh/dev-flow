import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const inspection = await loadSource("plugins/dev-flow/src/core/inspection.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "pass", command: "node", args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

const scanned = ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"];

function boundaryAudit(items) {
  return { scanned, items };
}

function auditItem(id, disposition, ref, kind = "assumption") {
  return { id, kind, disposition, ...(disposition === "repository-fact" ? { factRef: ref } : { decisionRef: ref }), summary: `item ${id}` };
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
    signals: {
      changeSurface: "single-site",
      behaviorChange: "mechanical",
      topology: "local",
      unitCount: 1,
      requirements: "provided-confirmed",
      operationalRecovery: false,
      executableRollback: false,
    },
    ...overrides,
  };
}

async function setup(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "shared.js"), "export const shared = true;\n");
  await store.initProject(root, config);
  const state = await store.startFeature(root, { featureId: "f", host: "codex" });
  return { root, state };
}

test("positive facts require a real readable governed file; missing/out-of-scope/control paths are rejected", async () => {
  const { root, state } = await setup("dev-flow-fact-positive-");
  try {
    const registered = await store.registerRepositoryFact(root, "f", state.revision, {
      assertion: "共享接口定义在 src/shared.js",
      location: { kind: "positive", path: "src/shared.js", anchor: "export const shared" },
    }, "codex");
    const ok = registered.state;
    assert.equal(ok.governance.repositoryFacts.length, 1);
    const fact = ok.governance.repositoryFacts[0];
    assert.equal(registered.recordId, fact.recordId);
    assert.match(fact.recordId, /^FACT-[a-f0-9]{16}$/);
    assert.equal(fact.location.kind, "positive");
    assert.equal(fact.location.path, "src/shared.js");

    for (const bad of [
      { kind: "positive", path: "src/missing.js" },
      { kind: "positive", path: "../outside.js" },
      { kind: "positive", path: "/etc/passwd" },
      { kind: "positive", path: ".dev-flow/project.json" },
      { kind: "positive", path: "README.md" },
    ]) {
      await assert.rejects(
        () => store.registerRepositoryFact(root, "f", ok.revision, { assertion: "x", location: bad }, "codex"),
        (error) => error.code === "INVALID_REPOSITORY_FACT",
        JSON.stringify(bad),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("negative facts require a checked scope and repeatable conditions", async () => {
  const { root, state } = await setup("dev-flow-fact-negative-");
  try {
    const registered = await store.registerRepositoryFact(root, "f", state.revision, {
      assertion: "src 目录没有共享接口受影响",
      location: { kind: "negative", checkedScope: ["src"], conditions: "在 src 全量搜索 export interface/export type 定义" },
    }, "codex");
    const ok = registered.state;
    assert.equal(ok.governance.repositoryFacts[0].location.kind, "negative");
    assert.deepEqual(ok.governance.repositoryFacts[0].location.checkedScope, ["src"]);

    for (const bad of [
      { kind: "negative", checkedScope: [], conditions: "搜索了所有定义" },
      { kind: "negative", checkedScope: ["src"], conditions: "" },
      { kind: "negative", checkedScope: ["missing-dir"], conditions: "搜索了定义" },
    ]) {
      await assert.rejects(
        () => store.registerRepositoryFact(root, "f", ok.revision, { assertion: "x", location: bad }, "codex"),
        (error) => error.code === "INVALID_REPOSITORY_FACT",
        JSON.stringify(bad),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BoundaryAudit accepts only current fact refs; free-text evidenceRef and stale facts fail", async () => {
  const { root, state } = await setup("dev-flow-fact-audit-");
  try {
    const registered = await store.registerRepositoryFact(root, "f", state.revision, {
      assertion: "共享接口定义在 src/shared.js",
      location: { kind: "positive", path: "src/shared.js" },
    }, "codex");
    let current = registered.state;
    const factId = registered.recordId;

    // evidenceRef 自由文本不再满足完成条件（ADR-0018）
    await assert.rejects(
      () => store.lockClassification(root, "f", current.revision, classificationFacts(), boundaryAudit([
        { id: "b1", kind: "assumption", disposition: "repository-fact", evidenceRef: "查过代码了", summary: "x" },
      ])),
      (error) => error.code === "BOUNDARY_AUDIT_UNRESOLVED"
        && Array.isArray(error.details.registeredIds)
        && error.details.registeredIds.includes(factId),
    );
    // 引用未登记的事实 id 同样未解决
    await assert.rejects(
      () => store.lockClassification(root, "f", current.revision, classificationFacts(), boundaryAudit([
        auditItem("b1", "repository-fact", "FACT-deadbeefdeadbeef"),
      ])),
      (error) => error.code === "BOUNDARY_AUDIT_UNRESOLVED"
        && error.details.unresolvedRefs.includes("FACT-deadbeefdeadbeef")
        && error.details.registeredIds.includes(factId),
    );
    // 引用当前事实 → 锁定成功
    current = await store.lockClassification(root, "f", current.revision, classificationFacts({ scopeFactRefs: [factId] }), boundaryAudit([
      auditItem("b1", "repository-fact", factId),
    ]));
    assert.equal(current.mode, "routed");

    // 内容变化 → 事实 stale，重查失败，不能据此通过分类
    await writeFile(path.join(root, "src", "shared.js"), "export const shared = false;\n");
    const next = await store.readState(root, "f");
    await assert.rejects(
      () => store.lockClassification(root, "f", next.revision, classificationFacts({ scopeFactRefs: [factId] }), boundaryAudit([
        auditItem("b1", "repository-fact", factId),
      ])),
      (error) => error.code === "BOUNDARY_FACT_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unrelated content changes keep a fact current; re-registering refreshes it", async () => {
  const { root, state } = await setup("dev-flow-fact-unrelated-");
  try {
    const registered = await store.registerRepositoryFact(root, "f", state.revision, {
      assertion: "共享接口定义在 src/shared.js",
      location: { kind: "positive", path: "src/shared.js" },
    }, "codex");
    let current = registered.state;
    const factId = registered.recordId;
    // 无关文件变化不使事实失效
    await writeFile(path.join(root, "src", "unrelated.js"), "export const unrelated = true;\n");
    current = await store.readState(root, "f");
    current = await store.lockClassification(root, "f", current.revision, classificationFacts({ scopeFactRefs: [factId] }), boundaryAudit([
      auditItem("b1", "repository-fact", factId),
    ]));
    assert.equal(current.mode, "routed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspect classification topic shows safe locations without internal fingerprints", async () => {
  const { root, state } = await setup("dev-flow-fact-inspect-");
  try {
    const current = await store.registerRepositoryFact(root, "f", state.revision, {
      assertion: "共享接口定义在 src/shared.js",
      location: { kind: "positive", path: "src/shared.js" },
    }, "codex");
    assert.equal(current.recordId, current.state.governance.repositoryFacts[0].recordId);
    const view = await inspection.inspectFeature(root, "f", "classification");
    const facts = view.content.repositoryFacts;
    assert.equal(facts.length, 1);
    assert.deepEqual(facts[0].location, { kind: "positive", path: "src/shared.js" });
    assert.equal("observedFingerprint" in facts[0], false, "inspect must not expose internal fingerprints");
    assert.equal("basis" in facts[0], false);
    void current;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("batch registration writes once, dedups by recordId, and fails closed on any bad observation", async () => {
  const { root, state } = await setup("dev-flow-fact-batch-");
  try {
    const first = await store.registerRepositoryFacts(root, "f", state.revision, [
      { assertion: "shared exists", location: { kind: "positive", path: "src/shared.js" } },
      { assertion: "shared still exists", location: { kind: "positive", path: "src/shared.js", anchor: "export const shared" } },
    ], "codex");
    assert.equal(first.recordIds.length, 2);
    assert.equal(first.created.length, 2);
    assert.deepEqual(first.existing, []);
    assert.equal(first.state.governance.repositoryFacts.length, 2);
    assert.equal(first.state.revision, state.revision + 1);

    const again = await store.registerRepositoryFacts(root, "f", first.state.revision, [
      { assertion: "shared exists", location: { kind: "positive", path: "src/shared.js" } },
    ], "codex");
    assert.deepEqual(again.recordIds, [first.recordIds[0]]);
    assert.deepEqual(again.created, []);
    assert.deepEqual(again.existing, [first.recordIds[0]]);
    assert.equal(again.state.governance.repositoryFacts.length, 2);

    await assert.rejects(
      () => store.registerRepositoryFacts(root, "f", again.state.revision, [
        { assertion: "ok", location: { kind: "positive", path: "src/shared.js" } },
        { assertion: "missing", location: { kind: "positive", path: "src/missing.js" } },
      ], "codex"),
      (error) => error.code === "INVALID_REPOSITORY_FACT",
    );
    const unchanged = await store.readState(root, "f");
    assert.equal(unchanged.revision, again.state.revision);
    assert.equal(unchanged.governance.repositoryFacts.length, 2);

    await assert.rejects(
      () => store.registerRepositoryFacts(root, "f", again.state.revision, [], "codex"),
      (error) => error.code === "INVALID_REPOSITORY_FACT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("text-present observation recordId matches the normalized stored fact", async () => {
  const { root, state } = await setup("dev-flow-fact-text-present-");
  try {
    const registered = await store.registerRepositoryFact(root, "f", state.revision, {
      observation: { kind: "text-present", path: "src/shared.js", text: "export const shared" },
    }, "codex");
    assert.equal(registered.recordId, registered.state.governance.repositoryFacts[0].recordId);
    assert.equal(registered.state.governance.repositoryFacts[0].location.anchor, "export const shared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
