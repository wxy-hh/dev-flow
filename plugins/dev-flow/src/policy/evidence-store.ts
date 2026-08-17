// Evidence Store persistent contracts.
//
// State and ledgers only hold EvidenceObjectRef logical references. The
// physical catalog, pack files and cold placement are feature-private and are
// resolved by core/evidence-store.ts.

export const EVIDENCE_OBJECT_KINDS = [
  "artifact-proposal",
  "trace",
  "review-ledger",
  "review-package",
  "review-execution",
  "review-result",
  "file-snapshot",
  "evidence-baseline",
  "checkpoint-pack",
  "verification-log",
  "repair-log",
  "workspace-lineage",
  "governance-ledger",
  "interaction-ledger",
  "event-segment",
] as const;

export type EvidenceObjectKind = (typeof EVIDENCE_OBJECT_KINDS)[number];

export interface EvidenceObjectRef {
  kind: EvidenceObjectKind;
  sha256: string;
  size: number;
}

export interface EvidencePackIndexEntry {
  sha256: string;
  kind: EvidenceObjectKind;
  /** Raw object size in bytes. */
  size: number;
  /** Offset of this object's gzip chunk within the immutable pack file. */
  offset: number;
  /** Compressed chunk length in bytes. */
  compressedLength: number;
}

export interface EvidencePackIndex {
  schemaVersion: 1;
  packSha256: string;
  objects: EvidencePackIndexEntry[];
}

export interface EvidencePackDescriptor {
  packSha256: string;
  indexSha256: string;
  location: "hot" | "cold";
  objectCount: number;
  totalRawSize: number;
}

export interface EvidenceStoreEntry {
  sha256: string;
  kind: EvidenceObjectKind;
  size: number;
  packSha256: string;
  offset: number;
  compressedLength: number;
}

export interface EvidenceStoreCatalog {
  schemaVersion: 1;
  featureId: string;
  revision: number;
  objects: EvidenceStoreEntry[];
  packs: EvidencePackDescriptor[];
}

/** Small pointer stored in FeatureState; never contains pack offsets. */
export interface EvidenceStorePointer {
  catalogSha256: string;
  objectCount: number;
  packCount: number;
}

export interface WorkspaceSnapshotFile {
  path: string;
  sha256: string;
  /** Permission bits as an octal string, e.g. "644". */
  mode: string;
  kind: "file" | "symlink";
  linkTarget?: string;
}

export interface WorkspaceSnapshotManifest {
  schemaVersion: 1;
  featureId: string;
  capturedAt: string;
  files: WorkspaceSnapshotFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function parseEvidenceObjectKind(value: unknown): EvidenceObjectKind {
  if (typeof value !== "string" || !EVIDENCE_OBJECT_KINDS.includes(value as EvidenceObjectKind)) {
    throw new TypeError(`invalid evidence object kind: ${String(value)}`);
  }
  return value as EvidenceObjectKind;
}

export function parseEvidenceObjectRef(value: unknown): EvidenceObjectRef {
  if (!isRecord(value)
    || Object.keys(value).sort().join(",") !== "kind,sha256,size"
    || !isSha256(value.sha256)
    || !Number.isInteger(value.size) || (value.size as number) < 0) {
    throw new TypeError("invalid evidence object ref");
  }
  return {
    kind: parseEvidenceObjectKind(value.kind),
    sha256: value.sha256,
    size: value.size as number,
  };
}

export function parseEvidenceStoreEntry(value: unknown): EvidenceStoreEntry {
  if (!isRecord(value)
    || !isSha256(value.sha256)
    || !Number.isInteger(value.size) || (value.size as number) < 0
    || !isSha256(value.packSha256)
    || !Number.isInteger(value.offset) || (value.offset as number) < 0
    || !Number.isInteger(value.compressedLength) || (value.compressedLength as number) <= 0) {
    throw new TypeError("invalid evidence store entry");
  }
  return {
    sha256: value.sha256,
    kind: parseEvidenceObjectKind(value.kind),
    size: value.size as number,
    packSha256: value.packSha256,
    offset: value.offset as number,
    compressedLength: value.compressedLength as number,
  };
}

export function parseEvidencePackDescriptor(value: unknown): EvidencePackDescriptor {
  if (!isRecord(value)
    || !isSha256(value.packSha256)
    || !isSha256(value.indexSha256)
    || (value.location !== "hot" && value.location !== "cold")
    || !Number.isInteger(value.objectCount) || (value.objectCount as number) < 0
    || !Number.isInteger(value.totalRawSize) || (value.totalRawSize as number) < 0) {
    throw new TypeError("invalid evidence pack descriptor");
  }
  return {
    packSha256: value.packSha256,
    indexSha256: value.indexSha256,
    location: value.location,
    objectCount: value.objectCount as number,
    totalRawSize: value.totalRawSize as number,
  };
}

export function parseEvidenceStoreCatalog(value: unknown): EvidenceStoreCatalog {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.featureId !== "string" || !value.featureId
    || !Number.isInteger(value.revision) || (value.revision as number) < 0
    || !Array.isArray(value.objects)
    || !Array.isArray(value.packs)) {
    throw new TypeError("invalid evidence store catalog");
  }
  const objects = value.objects.map(parseEvidenceStoreEntry);
  const packs = value.packs.map(parseEvidencePackDescriptor);
  const packShas = new Set(packs.map((pack) => pack.packSha256));
  const seen = new Set<string>();
  for (const object of objects) {
    if (!packShas.has(object.packSha256)) throw new TypeError("catalog object references a missing pack");
    const key = `${object.kind}\u0000${object.sha256}`;
    if (seen.has(key)) throw new TypeError("catalog contains duplicate object ref");
    seen.add(key);
  }
  return {
    schemaVersion: 1,
    featureId: value.featureId,
    revision: value.revision as number,
    objects,
    packs,
  };
}

export function parseEvidenceStorePointer(value: unknown): EvidenceStorePointer {
  if (!isRecord(value)
    || !isSha256(value.catalogSha256)
    || !Number.isInteger(value.objectCount) || (value.objectCount as number) < 0
    || !Number.isInteger(value.packCount) || (value.packCount as number) < 0) {
    throw new TypeError("invalid evidence store pointer");
  }
  return {
    catalogSha256: value.catalogSha256,
    objectCount: value.objectCount as number,
    packCount: value.packCount as number,
  };
}

export function parseWorkspaceSnapshotManifest(value: unknown): WorkspaceSnapshotManifest {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.featureId !== "string" || !value.featureId
    || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt))
    || !Array.isArray(value.files)) {
    throw new TypeError("invalid workspace snapshot manifest");
  }
  const files = value.files.map((file) => {
    if (!isRecord(file)
      || typeof file.path !== "string" || !file.path
      || !isSha256(file.sha256)
      || typeof file.mode !== "string" || !/^[0-7]{3,4}$/.test(file.mode)
      || (file.kind !== "file" && file.kind !== "symlink")) {
      throw new TypeError("invalid workspace snapshot file record");
    }
    const record: WorkspaceSnapshotFile = {
      path: file.path,
      sha256: file.sha256,
      mode: file.mode,
      kind: file.kind,
    };
    if (file.kind === "symlink") {
      if (typeof file.linkTarget !== "string") throw new TypeError("symlink snapshot requires linkTarget");
      record.linkTarget = file.linkTarget;
    } else if (file.linkTarget !== undefined) {
      throw new TypeError("file snapshot cannot contain linkTarget");
    }
    return record;
  });
  return {
    schemaVersion: 1,
    featureId: value.featureId,
    capturedAt: value.capturedAt,
    files,
  };
}
