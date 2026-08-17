import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/evidence-store.ts");
const snapshot = await loadSource("plugins/dev-flow/src/core/workspace-snapshot.ts");

async function featureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-store-"));
  await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
  return root;
}

async function hotFiles(root) {
  const dir = path.join(root, ".dev-flow", "features", "f", "evidence", "packs", "hot");
  try { return await readdir(dir); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

test("putEvidenceObject is content-addressed and idempotent", async () => {
  const root = await featureRoot();
  try {
    const first = await store.putEvidenceObject(root, "f", "trace", "canonical-ledger");
    const second = await store.putEvidenceObject(root, "f", "trace", "canonical-ledger");
    assert.deepEqual(second.ref, first.ref);
    assert.equal(second.catalog.objects.length, 1);
    assert.equal(second.catalog.packs.length, 1);
    assert.equal(second.catalog.revision, first.catalog.revision);
    assert.equal((await hotFiles(root)).filter((file) => file.endsWith(".pack")).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same bytes with different kinds receive distinct logical refs", async () => {
  const root = await featureRoot();
  try {
    const trace = await store.putEvidenceObject(root, "f", "trace", "same-bytes");
    const review = await store.putEvidenceObject(root, "f", "review-result", "same-bytes");
    assert.equal(trace.ref.sha256, review.ref.sha256);
    assert.notEqual(trace.ref.kind, review.ref.kind);
    assert.equal(review.catalog.objects.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("putEvidenceObjects writes one immutable pack and every object verifies on read", async () => {
  const root = await featureRoot();
  try {
    const result = await store.putEvidenceObjects(root, "f", [
      { kind: "trace", bytes: Buffer.from("trace-v2") },
      { kind: "review-ledger", bytes: Buffer.from("review-v3") },
    ]);
    assert.equal(result.catalog.packs.length, 1);
    assert.deepEqual(result.refs.map((ref) => ref.kind).sort(), ["review-ledger", "trace"]);
    for (const ref of result.refs) {
      const bytes = await store.readEvidenceObject(root, "f", ref);
      assert.equal(bytes.toString("utf8"), ref.kind === "trace" ? "trace-v2" : "review-v3");
    }
    const indexFile = (await hotFiles(root)).find((file) => file.endsWith(".index.json"));
    assert.ok(indexFile, "pack index must be present");
    const index = JSON.parse(await readFile(path.join(root, ".dev-flow", "features", "f", "evidence", "packs", "hot", indexFile), "utf8"));
    assert.equal(index.objects.length, 2);
    assert.ok(index.objects.every((entry) => entry.offset >= 4 && entry.compressedLength > 0 && entry.size > 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pack fault before catalog switch leaves old catalog readable and new files as orphans", async () => {
  const root = await featureRoot();
  try {
    await assert.rejects(
      store.putEvidenceObject(root, "f", "trace", "old-orphan", {
        fault: (point) => { if (point === "before-pack-write") throw new Error("injected before-pack-write"); },
      }),
      /injected before-pack-write/,
    );
    assert.equal((await store.readEvidenceStoreCatalog(root, "f")).objects.length, 0);

    await assert.rejects(
      store.putEvidenceObject(root, "f", "trace", "old-orphan", {
        fault: (point) => { if (point === "before-catalog-write") throw new Error("injected before-catalog-write"); },
      }),
      /injected before-catalog-write/,
    );
    const catalog = await store.readEvidenceStoreCatalog(root, "f");
    assert.equal(catalog.objects.length, 0, "catalog must not reference objects written before the injected failure");

    const repaired = await store.putEvidenceObject(root, "f", "trace", "old-orphan");
    assert.equal(repaired.catalog.objects.length, 1);
    assert.deepEqual(await store.readEvidenceObject(root, "f", repaired.ref), Buffer.from("old-orphan"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sealEvidenceHistory changes physical location only and keeps logical refs readable", async () => {
  const root = await featureRoot();
  try {
    const written = await store.putEvidenceObject(root, "f", "verification-log", "sealed-log");
    const sealed = await store.sealEvidenceHistory(root, "f");
    assert.equal(sealed.moved, 1);
    assert.equal(sealed.catalog.packs[0].location, "cold");
    assert.deepEqual(await store.readEvidenceObject(root, "f", written.ref), Buffer.from("sealed-log"));
    assert.equal((await hotFiles(root)).filter((file) => file.endsWith(".pack")).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupted pack or mismatching ref size fails closed", async () => {
  const root = await featureRoot();
  try {
    const written = await store.putEvidenceObject(root, "f", "trace", "corrupt-me");
    const pack = path.join(root, ".dev-flow", "features", "f", "evidence", "packs", "hot", `${written.catalog.packs[0].packSha256}.pack`);
    await writeFile(pack, "broken");
    await assert.rejects(
      store.readEvidenceObject(root, "f", written.ref),
      /EVIDENCE_STORE_INTEGRITY_FAILED/,
    );
    await assert.rejects(
      store.readEvidenceObject(root, "f", { ...written.ref, size: written.ref.size + 1 }),
      /EVIDENCE_STORE_INTEGRITY_FAILED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded GC deletes only unreachable packs across multiple budget rounds", async () => {
  const root = await featureRoot();
  try {
    const keep = await store.putEvidenceObject(root, "f", "trace", "keep");
    const orphanA = await store.putEvidenceObject(root, "f", "repair-log", "orphan-a");
    const orphanB = await store.putEvidenceObject(root, "f", "event-segment", "orphan-b");
    assert.equal((await store.readEvidenceStoreCatalog(root, "f")).packs.length, 3);

    await assert.rejects(
      store.collectEvidenceOrphans(root, "f", [{ ...keep.ref, sha256: "0".repeat(64) }]),
      /EVIDENCE_STORE_INTEGRITY_FAILED/,
    );

    const first = await store.collectEvidenceOrphans(root, "f", [keep.ref], { packBudget: 1 });
    assert.equal(first.deletedPacks, 1);
    assert.equal(first.catalog.packs.length, 2);
    const second = await store.collectEvidenceOrphans(root, "f", [keep.ref], { packBudget: 1 });
    assert.equal(second.deletedPacks, 1);
    assert.equal(second.catalog.packs.length, 1);
    const third = await store.collectEvidenceOrphans(root, "f", [keep.ref], { packBudget: 1 });
    assert.equal(third.deletedPacks, 0);

    assert.deepEqual(await store.readEvidenceObject(root, "f", keep.ref), Buffer.from("keep"));
    await assert.rejects(store.readEvidenceObject(root, "f", orphanA.ref), /EVIDENCE_STORE_INTEGRITY_FAILED/);
    await assert.rejects(store.readEvidenceObject(root, "f", orphanB.ref), /EVIDENCE_STORE_INTEGRITY_FAILED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspectEvidenceStoreHealth reports hot/cold/orphan summary without reading payloads", async () => {
  const root = await featureRoot();
  try {
    const empty = await store.inspectEvidenceStoreHealth(root, "f");
    assert.equal(empty.catalogPresent, false);
    assert.equal(empty.objectCount, 0);
    assert.equal(empty.packCount, 0);
    assert.equal(empty.backlogRounds, 0);

    const keep = await store.putEvidenceObject(root, "f", "trace", "keep");
    const orphan = await store.putEvidenceObject(root, "f", "repair-log", "orphan");
    await store.sealEvidenceHistory(root, "f");

    const health = await store.inspectEvidenceStoreHealth(root, "f", { rootSet: [keep.ref] });
    assert.equal(health.objectCount, 2);
    assert.equal(health.packCount, 2);
    assert.equal(health.hotPackCount, 0);
    assert.equal(health.coldPackCount, 2);
    assert.equal(health.coldObjectCount, 2);
    assert.equal(health.orphanPackCount, 1);
    assert.equal(health.orphanRawBytes, orphan.ref.size);
    assert.equal(health.backlogRounds, 1);
    assert.deepEqual(health.integrityIssues, []);

    const keepPack = keep.catalog.packs.find((pack) => keep.catalog.objects.some((entry) => entry.sha256 === keep.ref.sha256 && entry.packSha256 === pack.packSha256));
    const packFile = path.join(root, ".dev-flow", "features", "f", "evidence", "packs", "cold", `${keepPack.packSha256}.pack`);
    await rm(packFile);
    const damaged = await store.inspectEvidenceStoreHealth(root, "f");
    assert.equal(damaged.integrityIssues.length, 1);
    assert.equal(damaged.integrityIssues[0].code, "EVIDENCE_STORE_REACHABLE_PACK_DAMAGED");
    assert.equal(damaged.integrityIssues[0].packSha256, keepPack.packSha256);

    const hotDir = path.join(root, ".dev-flow", "features", "f", "evidence", "packs", "hot");
    await mkdir(hotDir, { recursive: true });
    await writeFile(path.join(hotDir, `${"a".repeat(64)}.pack`), "leftover");
    const withLeftover = await store.inspectEvidenceStoreHealth(root, "f");
    assert.equal(withLeftover.physicalOrphanFileCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("captureWorkspaceSnapshot derives one manifest/object from one content traversal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-snap-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(path.join(root, "src", "b.ts"), "export const b = 2;\n");
  await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
  try {
    const captured = await snapshot.captureWorkspaceSnapshot(root, "f", { governedRoots: ["src"] });
    assert.equal(captured.files.length, 2);
    assert.deepEqual(captured.files.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
    const bytes = await store.readEvidenceObject(root, "f", captured.ref);
    const manifest = JSON.parse(bytes.toString("utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.featureId, "f");
    assert.equal(manifest.files.length, 2);
    assert.ok(manifest.files.every((file) => /^[0-7]{3}$/.test(file.mode) && file.kind === "file"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
