// v6 event segment tests. Phase 8 enables seal/read/hash-chain assertions.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";

const segments = await loadSource("plugins/dev-flow/src/core/event-segments.ts");
const stateStore = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const { createInteraction } = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-segments-"));
  await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
  return root;
}

function event(revision, type, text) {
  return `${JSON.stringify({ revision, type, at: new Date().toISOString(), data: { text } })}\n`;
}

test("sealFeatureEvents chains immutable segments and readSegmentedFeatureEvents merges the hot tail", async () => {
  const root = await setup();
  try {
    const hot = path.join(root, ".dev-flow", "features", "f", "events.jsonl");
    await writeFile(hot, event(1, "started", "one") + event(2, "step-recorded", "two"));
    const first = await segments.sealFeatureEvents(root, "f");
    assert.equal(first.sealed, 2);
    assert.equal((await readFile(hot, "utf8")), "");
    const firstRead = await segments.readSegmentedFeatureEvents(root, "f");
    assert.deepEqual(firstRead.records.map((record) => record.eventSequence), [1, 2]);

    await writeFile(hot, event(3, "step-recorded", "three") + event(4, "host-event", "four"));
    const second = await segments.sealFeatureEvents(root, "f");
    assert.equal(second.segment.previousSegmentSha256, first.ref.sha256);
    assert.deepEqual((await segments.readSegmentedFeatureEvents(root, "f")).records.map((record) => record.eventSequence), [1, 2, 3, 4]);
    assert.deepEqual((await segments.readSegmentedFeatureEvents(root, "f", { afterSequence: 2 })).records.map((record) => record.eventSequence), [3, 4]);

    await writeFile(hot, event(5, "host-event", "five"));
    const merged = await segments.readSegmentedFeatureEvents(root, "f");
    assert.deepEqual(merged.records.map((record) => record.eventSequence), [1, 2, 3, 4, 5]);
    assert.equal(merged.sealedSegments, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mutatePrepared stamps a new pending interaction with the next eventSequence cursor", async () => {
  const fixture = await createTinyApp();
  try {
    await stateStore.initProject(fixture.root, strictProjectConfig);
    const started = await stateStore.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    const events = await stateStore.readFeatureEvents(fixture.root, "feature");
    const lastSequence = events.at(-1).eventSequence;

    const presented = await stateStore.mutate(fixture.root, "feature", started.revision, "interaction-presented", (draft) => {
      createInteraction(draft, {
        kind: "workspace-ownership",
        target: "route",
        basisHash: "0".repeat(64),
        options: [
          { id: "adopt", label: "纳入当前任务" },
          { id: "other", label: "其他" },
        ],
      });
    });
    const interaction = Object.values(presented.interactions).find((item) => item.status === "pending");
    assert.equal(interaction.presentationEventSequence, lastSequence + 1);
    const after = await stateStore.readFeatureEvents(fixture.root, "feature");
    assert.deepEqual(after.map((event) => event.eventSequence), [...events.map((event) => event.eventSequence), lastSequence + 1]);
  } finally { await fixture.dispose(); }
});

test("readFeatureEvents transparently reads sealed segments plus the hot tail", async () => {
  const root = await setup();
  try {
    await stateStore.appendFeatureEvent(root, "f", 1, "started", { text: "one" });
    await stateStore.appendFeatureEvent(root, "f", 2, "step-recorded", { text: "two" });
    await segments.sealFeatureEvents(root, "f");
    await stateStore.appendFeatureEvent(root, "f", 3, "host-event", { text: "three" });
    const events = await stateStore.readFeatureEvents(root, "f");
    assert.deepEqual(events.map((event) => event.type), ["started", "step-recorded", "host-event"]);
    assert.deepEqual(events.map((event) => event.revision), [1, 2, 3]);
    assert.deepEqual(events.map((event) => event.eventSequence), [1, 2, 3]);
    assert.equal(await segments.nextFeatureEventSequence(root, "f"), 4);
    await stateStore.appendFeatureEvent(root, "f", 4, "host-event", { text: "four" });
    const raw = await readFile(path.join(root, ".dev-flow", "features", "f", "events.jsonl"), "utf8");
    assert.equal(JSON.parse(raw.trim().split("\n").at(-1)).eventSequence, 4);

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pauseFeature seals the hot event tail at a lifecycle boundary", async () => {
  const fixture = await createTinyApp();
  try {
    await stateStore.initProject(fixture.root, strictProjectConfig);
    const started = await stateStore.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    const hotFile = path.join(fixture.root, ".dev-flow", "features", "feature", "events.jsonl");
    assert.ok((await readFile(hotFile, "utf8")).trim().length > 0);

    await stateStore.pauseFeature(fixture.root, "feature", started.revision, "seal test", "claude");
    assert.equal((await readFile(hotFile, "utf8")).trim(), "");
    const sealed = await segments.readSegmentedFeatureEvents(fixture.root, "feature");
    assert.ok(sealed.sealedSegments >= 1);
    assert.ok(sealed.records.length > 0);
    const resumed = await stateStore.resumeFeature(fixture.root, "feature", "claude");
    assert.equal(resumed.lifecycle, "active");
    assert.ok((await readFile(hotFile, "utf8")).trim().length > 0);
  } finally { await fixture.dispose(); }
});

test("sealAfterCommit returns a committed-with-warning payload when sealing fails", async () => {
  const root = await setup();
  try {
    const hot = path.join(root, ".dev-flow", "features", "f", "events.jsonl");
    await writeFile(hot, "{not-json\n");
    const result = await segments.sealAfterCommit(root, "f", { revision: 4, lifecycle: "paused" });
    assert.equal(result.revision, 4);
    assert.equal(result.lifecycle, "paused");
    assert.equal(result.warning.code, "EVENT_SEAL_FAILED");
    assert.equal(result.warning.currentRevision, 4);
    assert.equal(result.warning.failedPostAction, "seal-feature-events");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
