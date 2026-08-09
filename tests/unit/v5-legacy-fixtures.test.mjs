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

test("real 5.0 state and interaction fixtures project one pending decision and accept a same-revision later event", async () => {
  const [state, interaction] = await Promise.all([fixture("state.json"), fixture("interaction.json")]);
  assert.doesNotThrow(() => store.validateFeatureState(state));
  assert.deepEqual(state.interactions[interaction.id], interaction);

  const first = decisions.pendingDecisionForState(state);
  const second = decisions.pendingDecisionForState(state);
  assert.deepEqual(second, first, "legacy projection must be deterministic across repeated reads");
  assert.equal(decisions.pendingInteractionForDecision(state, first).id, interaction.id);

  const prompt = provenance.resolvePromptEvent([
    { revision: 0, type: "feature-started", at: "2026-08-01T00:00:00.000Z", data: {} },
    { revision: 0, type: "host-event", at: "2026-08-01T00:00:01.000Z", data: {
      eventId: "legacy-answer", type: "user-prompt", host: "codex", text: "纳入当前任务", at: "2026-08-01T00:00:01.000Z",
    } },
  ], {
    host: "codex",
    userReply: "纳入当前任务",
    presentedAt: interaction.presentedAt,
    presentedRevision: interaction.presentedRevision,
  });
  assert.equal(prompt.eventId, "legacy-answer");
  assert.equal(prompt.revision, 0);
});

test("real 5.0 Trace fixture without command hashes remains content-addressed and idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v5-trace-"));
  try {
    const ledger = await fixture("trace.json");
    assert.equal(ledger.verificationCommandHashes, undefined);
    const pointer = await traceStore.writeTraceSnapshot(root, ledger);
    const state = { featureId: ledger.featureId, route: "m", revision: 0, traceability: pointer };
    assert.deepEqual(await traceStore.readTraceability(root, state), ledger);
    assert.deepEqual(await traceStore.readTraceability(root, state), ledger);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real 5.0 review fixture with the full legacy basis hash remains readable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v5-review-"));
  try {
    const ledger = await fixture("review.json");
    const legacyHash = ledger.batches[0].basisHash;
    assert.notEqual(reviewStore.semanticReviewBasisHash(ledger.batches[0].basis), legacyHash);
    const pointer = await reviewStore.writeReviewSnapshot(root, ledger);
    const state = { featureId: ledger.featureId, revision: ledger.stateRevision, review: pointer };
    assert.deepEqual(await reviewStore.readReviewLedger(root, state), ledger);
    assert.deepEqual(await reviewStore.readReviewLedger(root, state), ledger);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
