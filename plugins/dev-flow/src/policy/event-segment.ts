import { parseEvidenceObjectRef, type EvidenceObjectRef } from "./evidence-store.js";

/**
 * Phase 8 feature event segment contract. Sealed segments are immutable
 * Evidence Store objects; the hot tail continues as a JSONL append log.
 */

export interface FeatureEventSegmentRecord {
  eventSequence: number;
  revision: number;
  type: string;
  at: string;
  data: unknown;
}

export interface FeatureEventSegment {
  schemaVersion: 1;
  featureId: string;
  firstSequence: number;
  lastSequence: number;
  previousSegmentSha256?: string;
  recordCount: number;
  codec: "jsonl";
  records: FeatureEventSegmentRecord[];
}

export interface FeatureEventSegmentIndexEntry {
  ref: EvidenceObjectRef;
  firstSequence: number;
  lastSequence: number;
  previousSegmentSha256?: string;
}

export interface FeatureEventSegmentIndex {
  schemaVersion: 1;
  featureId: string;
  entries: FeatureEventSegmentIndexEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFeatureEventSegment(value: unknown): FeatureEventSegment {
  if (!isRecord(value) || value.schemaVersion !== 1
    || typeof value.featureId !== "string" || !value.featureId
    || !Number.isInteger(value.firstSequence) || (value.firstSequence as number) < 0
    || !Number.isInteger(value.lastSequence) || (value.lastSequence as number) < (value.firstSequence as number)
    || (value.previousSegmentSha256 !== undefined && typeof value.previousSegmentSha256 !== "string")
    || !Number.isInteger(value.recordCount) || (value.recordCount as number) < 0
    || value.codec !== "jsonl"
    || !Array.isArray(value.records)) {
    throw new TypeError("invalid feature event segment");
  }
  const records = value.records.map((record) => {
    if (!isRecord(record) || !Number.isInteger(record.eventSequence)
      || !Number.isInteger(record.revision)
      || typeof record.type !== "string" || !record.type
      || typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) {
      throw new TypeError("invalid feature event segment record");
    }
    return {
      eventSequence: Number(record.eventSequence),
      revision: Number(record.revision),
      type: String(record.type),
      at: String(record.at),
      data: record.data,
    };
  });
  return {
    schemaVersion: 1,
    featureId: String(value.featureId),
    firstSequence: Number(value.firstSequence),
    lastSequence: Number(value.lastSequence),
    ...(value.previousSegmentSha256 !== undefined
      ? { previousSegmentSha256: String(value.previousSegmentSha256) }
      : {}),
    recordCount: Number(value.recordCount),
    codec: "jsonl",
    records,
  };
}

export function parseFeatureEventSegmentIndex(value: unknown): FeatureEventSegmentIndex {
  if (!isRecord(value) || value.schemaVersion !== 1
    || typeof value.featureId !== "string" || !value.featureId
    || !Array.isArray(value.entries)) {
    throw new TypeError("invalid feature event segment index");
  }
  return {
    schemaVersion: 1,
    featureId: String(value.featureId),
    entries: value.entries.map((entry) => {
      if (!isRecord(entry) || !Number.isInteger(entry.firstSequence) || !Number.isInteger(entry.lastSequence)
        || (entry.previousSegmentSha256 !== undefined && typeof entry.previousSegmentSha256 !== "string")) {
        throw new TypeError("invalid feature event segment index entry");
      }
      return {
        ref: parseEvidenceObjectRef(entry.ref),
        firstSequence: Number(entry.firstSequence),
        lastSequence: Number(entry.lastSequence),
        ...(entry.previousSegmentSha256 !== undefined
          ? { previousSegmentSha256: String(entry.previousSegmentSha256) }
          : {}),
      };
    }),
  };
}
