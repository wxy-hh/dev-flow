import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadSource } from "../helpers/load-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests", "fixtures", "v5-legacy");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const decisions = await loadSource("plugins/dev-flow/src/core/decision-interactions.ts");
const provenance = await loadSource("plugins/dev-flow/src/core/interaction-provenance.ts");
const traceStore = await loadSource("plugins/dev-flow/src/core/traceability-store.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));
}

test("real 5.0 state fixtures fail closed on the v6 state parser", async () => {
  const state = await fixture("state.json");
  assert.notEqual(state.schemaVersion, 6);
  assert.throws(
    () => store.validateFeatureState(state),
    (error) => error.code === "UNSUPPORTED_FEATURE_SCHEMA",
  );
});

test("real 5.0 Trace fixture fails closed on the v6 trace ledger parser", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v5-trace-"));
  try {
    const ledger = await fixture("trace.json");
    assert.notEqual(ledger.schemaVersion, 2);
    await assert.rejects(
      () => traceStore.writeTraceSnapshot(root, ledger),
      (error) => error.code === "UNSUPPORTED_TRACE_SCHEMA" || error.code === "TRACEABILITY_INTEGRITY_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real 5.0 review fixture fails closed on the v6 review ledger parser", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v5-review-"));
  try {
    const ledger = await fixture("review.json");
    assert.notEqual(ledger.schemaVersion, 3);
    await assert.rejects(
      () => reviewStore.writeReviewSnapshot(root, ledger),
      (error) => error.code === "UNSUPPORTED_REVIEW_SCHEMA" || error.code === "REVIEW_INTEGRITY_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
