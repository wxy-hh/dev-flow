import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableJson } from "../policy/stable-json.js";
import {
  parseFeatureEventSegment,
  parseFeatureEventSegmentIndex,
  type FeatureEventSegment,
  type FeatureEventSegmentIndex,
  type FeatureEventSegmentRecord,
} from "../policy/event-segment.js";
import type { EvidenceObjectRef } from "../policy/evidence-store.js";
import { putEvidenceObject, readEvidenceObject } from "./evidence-store.js";

const featureDirectory = (root: string, id: string) => path.join(root, ".dev-flow", "features", id);
const hotPath = (root: string, id: string) => path.join(featureDirectory(root, id), "events.jsonl");
const segmentIndexPath = (root: string, id: string) => path.join(featureDirectory(root, id), "events", "segment-index.json");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readIndex(root: string, featureId: string): Promise<FeatureEventSegmentIndex> {
  try {
    const raw = await readFile(segmentIndexPath(root, featureId), "utf8");
    return parseFeatureEventSegmentIndex(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, featureId, entries: [] };
    throw error;
  }
}

async function writeIndex(root: string, featureId: string, index: FeatureEventSegmentIndex): Promise<void> {
  const directory = path.dirname(segmentIndexPath(root, featureId));
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.segment-index.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${stableJson(index)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, segmentIndexPath(root, featureId));
}

async function readHotRecords(root: string, featureId: string, options: { startSequence?: number } = {}): Promise<FeatureEventSegmentRecord[]> {
  let raw: string;
  try {
    raw = await readFile(hotPath(root, featureId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const startSequence = options.startSequence ?? 0;
  return raw.split("\n").filter(Boolean).map((line, index) => {
    const record = JSON.parse(line) as { revision?: unknown; type?: unknown; at?: unknown; data?: unknown; eventSequence?: unknown };
    if (typeof record.type !== "string" || typeof record.at !== "string") throw new TypeError("invalid hot event record");
    return {
      eventSequence: Number.isInteger(record.eventSequence) ? Number(record.eventSequence) : startSequence + index + 1,
      revision: Number.isInteger(record.revision) ? Number(record.revision) : 0,
      type: record.type,
      at: record.at,
      data: record.data,
    };
  });
}

/** Next feature-local event sequence after all sealed segments and the hot tail. */
export async function nextFeatureEventSequence(root: string, featureId: string): Promise<number> {
  const index = await readIndex(root, featureId);
  const previous = index.entries.at(-1)?.lastSequence ?? 0;
  const hot = await readHotRecords(root, featureId, { startSequence: previous });
  return (hot.at(-1)?.eventSequence ?? previous) + 1;
}

/**
 * Seal the current hot JSONL into one immutable event-segment object, chaining
 * the previous segment hash and leaving an empty hot tail.
 */
/** Seal hot events only when the tail is non-empty; used at lifecycle/phase boundaries. */
export async function maybeSealFeatureEvents(root: string, featureId: string): Promise<{ ref: EvidenceObjectRef; segment: FeatureEventSegment; sealed: number } | undefined> {
  const hot = await readHotRecords(root, featureId, { startSequence: (await readIndex(root, featureId)).entries.at(-1)?.lastSequence ?? 0 });
  if (hot.length === 0) return undefined;
  return sealFeatureEvents(root, featureId);
}

export interface EventSealWarning {
  code: "EVENT_SEAL_FAILED";
  currentRevision: number;
  lifecycle: string;
  failedPostAction: "seal-feature-events";
}

/** Count records still sitting in the hot tail after a committed mutation. */
export async function unsealedHotEventCount(root: string, featureId: string): Promise<number> {
  const hot = await readHotRecords(root, featureId, { startSequence: (await readIndex(root, featureId)).entries.at(-1)?.lastSequence ?? 0 });
  return hot.length;
}

/**
 * Post-commit seal. A failed seal must not look like the mutation failed:
 * the caller already committed Core state and only the archive step broke.
 */
export async function sealAfterCommit<T extends { revision: number; lifecycle: string }>(
  root: string,
  featureId: string,
  committed: T,
): Promise<T & { warning?: EventSealWarning }> {
  try {
    await maybeSealFeatureEvents(root, featureId);
    return committed;
  } catch {
    return {
      ...committed,
      warning: {
        code: "EVENT_SEAL_FAILED",
        currentRevision: committed.revision,
        lifecycle: committed.lifecycle,
        failedPostAction: "seal-feature-events",
      },
    };
  }
}

export async function sealFeatureEvents(root: string, featureId: string): Promise<{ ref: EvidenceObjectRef; segment: FeatureEventSegment; sealed: number }> {
  const index = await readIndex(root, featureId);
  const previous = index.entries.at(-1);
  const firstSequence = previous ? previous.lastSequence + 1 : 1;
  const hot = await readHotRecords(root, featureId, { startSequence: previous ? previous.lastSequence : 0 });
  if (hot.length === 0) throw new TypeError("no hot events to seal");
  if (hot.some((record, offset) => record.eventSequence !== firstSequence + offset)) {
    throw new TypeError("hot event sequence is not contiguous with the previous segment");
  }
  const previousSegmentSha256 = previous?.ref.sha256;
  const records = hot.map((record, offset) => ({
    ...record,
    eventSequence: firstSequence + offset,
  }));
  const segment: FeatureEventSegment = {
    schemaVersion: 1,
    featureId,
    firstSequence,
    lastSequence: firstSequence + records.length - 1,
    ...(previousSegmentSha256 ? { previousSegmentSha256 } : {}),
    recordCount: records.length,
    codec: "jsonl",
    records,
  };
  parseFeatureEventSegment(segment);
  const stored = await putEvidenceObject(root, featureId, "event-segment", Buffer.from(`${stableJson(segment)}\n`, "utf8"));
  const nextIndex: FeatureEventSegmentIndex = {
    schemaVersion: 1,
    featureId,
    entries: [
      ...index.entries,
      {
        ref: stored.ref,
        firstSequence,
        lastSequence: segment.lastSequence,
        ...(previousSegmentSha256 ? { previousSegmentSha256 } : {}),
      },
    ],
  };
  await writeIndex(root, featureId, nextIndex);
  await writeFile(hotPath(root, featureId), "");
  return { ref: stored.ref, segment, sealed: records.length };
}

export interface SegmentedFeatureEventsResult {
  records: FeatureEventSegmentRecord[];
  sealedSegments: number;
}

/** Read sealed segments plus the hot tail in sequence order. */
export async function readSegmentedFeatureEvents(root: string, featureId: string, options: { afterSequence?: number } = {}): Promise<SegmentedFeatureEventsResult> {
  const index = await readIndex(root, featureId);
  const records: FeatureEventSegmentRecord[] = [];
  for (const entry of index.entries) {
    if (entry.lastSequence <= (options.afterSequence ?? 0)) continue;
    const bytes = await readEvidenceObject(root, featureId, entry.ref);
    const segment = parseFeatureEventSegment(JSON.parse(bytes.toString("utf8")));
    records.push(...segment.records);
  }
  const base = records.at(-1)?.eventSequence ?? (options.afterSequence ?? 0);
  const hot = await readHotRecords(root, featureId, { startSequence: base });
  records.push(...hot);
  const filtered = records.filter((record) => record.eventSequence > (options.afterSequence ?? 0));
  filtered.sort((left, right) => left.eventSequence - right.eventSequence);
  return { records: filtered, sealedSegments: index.entries.length };
}

/** Evidence Store roots referenced by the sealed event-segment index. */
export async function eventSegmentRootRefs(root: string, featureId: string): Promise<EvidenceObjectRef[]> {
  const index = await readIndex(root, featureId);
  return index.entries.map((entry) => entry.ref);
}


export function featureEventSegmentHash(segment: FeatureEventSegment): string {
  return sha256(stableJson(segment));
}
