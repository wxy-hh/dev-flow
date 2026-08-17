import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { stableJson } from "../policy/stable-json.js";
import {
  parseEvidenceObjectRef,
  parseEvidenceStoreCatalog,
  type EvidenceObjectRef,
  type EvidencePackDescriptor,
  type EvidenceStoreCatalog,
  type EvidenceStoreEntry,
  type EvidenceStorePointer,
} from "../policy/evidence-store.js";
import { DevFlowError } from "./errors.js";
import {
  readEvidencePackEntry,
  readPackIndexJson,
  writeEvidencePack,
  type EvidencePackFaultPoint,
  type EvidencePackInput,
} from "./evidence-pack.js";

/** Default bounded GC budgets. Production callers never pass these; tests override. */
export const DEFAULT_GC_PACK_BUDGET = 8;
export const DEFAULT_GC_BYTE_BUDGET = 32 * 1024 * 1024;

export interface EvidenceStoreWriteOptions {
  fault?: (point: EvidencePackFaultPoint | "before-catalog-write" | "after-catalog-write") => void | Promise<void>;
}

function evidenceDirectory(root: string, featureId: string): string {
  return path.join(root, ".dev-flow", "features", featureId, "evidence");
}

function hotDirectory(root: string, featureId: string): string {
  return path.join(evidenceDirectory(root, featureId), "packs", "hot");
}

function coldDirectory(root: string, featureId: string): string {
  return path.join(evidenceDirectory(root, featureId), "packs", "cold");
}

function catalogPath(root: string, featureId: string): string {
  return path.join(evidenceDirectory(root, featureId), "catalog.json");
}

function packDirectory(root: string, featureId: string, descriptor: Pick<EvidencePackDescriptor, "location">): string {
  return descriptor.location === "cold" ? coldDirectory(root, featureId) : hotDirectory(root, featureId);
}

function emptyCatalog(featureId: string): EvidenceStoreCatalog {
  return { schemaVersion: 1, featureId, revision: 0, objects: [], packs: [] };
}

function digest(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function canonicalCatalogJson(catalog: EvidenceStoreCatalog): string {
  return `${stableJson(catalog)}\n`;
}

function integrity(message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError("EVIDENCE_STORE_INTEGRITY_FAILED", message, {
    recoveryKind: "repair",
    recoveryInstruction: "运行 doctor 检查 evidence store；不要手动修改 .dev-flow 控制文件。",
    ...details,
  });
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeFileAtomic(target: string, contents: string | Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await fsyncDirectory(path.dirname(target));
}

export async function readEvidenceStoreCatalog(root: string, featureId: string): Promise<EvidenceStoreCatalog> {
  let contents: string;
  try {
    contents = await readFile(catalogPath(root, featureId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCatalog(featureId);
    throw error;
  }
  let catalog: EvidenceStoreCatalog;
  try {
    catalog = parseEvidenceStoreCatalog(JSON.parse(contents));
  } catch (error) {
    integrity("evidence catalog is invalid", { featureId, cause: error instanceof Error ? error.message : String(error) });
  }
  if (catalog.featureId !== featureId) integrity("evidence catalog featureId mismatch", { featureId, catalogFeatureId: catalog.featureId });
  return catalog;
}

async function writeEvidenceStoreCatalog(
  root: string,
  featureId: string,
  catalog: EvidenceStoreCatalog,
  options: EvidenceStoreWriteOptions = {},
): Promise<{ catalog: EvidenceStoreCatalog; sha256: string }> {
  const contents = canonicalCatalogJson(catalog);
  const sha256 = digest(contents);
  await mkdir(evidenceDirectory(root, featureId), { recursive: true });
  await options.fault?.("before-catalog-write");
  await writeFileAtomic(catalogPath(root, featureId), contents);
  await options.fault?.("after-catalog-write");
  return { catalog, sha256 };
}

export function evidenceStorePointer(catalog: EvidenceStoreCatalog, catalogSha256: string): EvidenceStorePointer {
  return {
    catalogSha256,
    objectCount: catalog.objects.length,
    packCount: catalog.packs.length,
  };
}

function objectKey(ref: Pick<EvidenceObjectRef, "kind" | "sha256">): string {
  return `${ref.kind}\u0000${ref.sha256}`;
}

/**
 * Write several canonical objects as one immutable pack and atomically append
 * it to the feature catalog. Same bytes are never stored twice; same bytes
 * with a different kind receive a distinct logical ref.
 */
export async function putEvidenceObjects(
  root: string,
  featureId: string,
  inputs: EvidencePackInput[],
  options: EvidenceStoreWriteOptions = {},
): Promise<{ refs: EvidenceObjectRef[]; pointer: EvidenceStorePointer; catalog: EvidenceStoreCatalog }> {
  if (inputs.length === 0) throw new TypeError("at least one evidence object is required");
  const normalized: EvidencePackInput[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    if (!Buffer.isBuffer(input.bytes)) throw new TypeError("evidence object bytes must be a Buffer");
    const sha256 = digest(input.bytes);
    const key = objectKey({ kind: input.kind, sha256 });
    if (seen.has(key)) throw new TypeError("duplicate evidence object in one pack");
    seen.add(key);
    normalized.push({ kind: input.kind, bytes: Buffer.from(input.bytes) });
  }

  const current = await readEvidenceStoreCatalog(root, featureId);
  const existingByKey = new Map(current.objects.map((entry) => [objectKey(entry), entry]));
  const missing = normalized.filter((input) => !existingByKey.has(objectKey({ kind: input.kind, sha256: digest(input.bytes) })));
  const refs = normalized.map((input) => {
    const sha256 = digest(input.bytes);
    return { kind: input.kind, sha256, size: input.bytes.length };
  });

  if (missing.length === 0) {
    const sha256 = digest(canonicalCatalogJson(current));
    return { refs, pointer: evidenceStorePointer(current, sha256), catalog: current };
  }

  const pack = await writeEvidencePack(hotDirectory(root, featureId), missing, options);
  const descriptor: EvidencePackDescriptor = {
    packSha256: pack.packSha256,
    indexSha256: pack.indexSha256,
    location: "hot",
    objectCount: pack.entries.length,
    totalRawSize: pack.entries.reduce((total, entry) => total + entry.size, 0),
  };
  const entries: EvidenceStoreEntry[] = pack.entries.map((entry) => ({
    ...entry,
    packSha256: pack.packSha256,
  }));
  const next: EvidenceStoreCatalog = {
    ...current,
    revision: current.revision + 1,
    packs: [
      ...current.packs.filter((candidate) => candidate.packSha256 !== descriptor.packSha256),
      descriptor,
    ],
    objects: [
      ...current.objects.filter((entry) => entry.packSha256 !== descriptor.packSha256),
      ...entries,
    ],
  };
  next.objects.sort((left, right) => left.kind.localeCompare(right.kind) || left.sha256.localeCompare(right.sha256));
  next.packs.sort((left, right) => left.packSha256.localeCompare(right.packSha256));
  const written = await writeEvidenceStoreCatalog(root, featureId, next, options);
  return { refs, pointer: evidenceStorePointer(written.catalog, written.sha256), catalog: written.catalog };
}

/** Single-object convenience wrapper. */
export async function putEvidenceObject(
  root: string,
  featureId: string,
  kind: EvidenceObjectRef["kind"],
  canonicalBytes: Buffer | string,
  options: EvidenceStoreWriteOptions = {},
): Promise<{ ref: EvidenceObjectRef; pointer: EvidenceStorePointer; catalog: EvidenceStoreCatalog }> {
  const bytes = Buffer.isBuffer(canonicalBytes) ? canonicalBytes : Buffer.from(canonicalBytes, "utf8");
  const result = await putEvidenceObjects(root, featureId, [{ kind, bytes }], options);
  return { ref: result.refs[0]!, ...result };
}

/**
 * Read a logical ref through the feature catalog. Hot/cold placement is
 * transparent; every read verifies pack name, pack index and decompressed
 * object hash.
 */
export async function readEvidenceObject(root: string, featureId: string, ref: EvidenceObjectRef): Promise<Buffer> {
  parseEvidenceObjectRef(ref);
  const catalog = await readEvidenceStoreCatalog(root, featureId);
  const entry = catalog.objects.find((candidate) => objectKey(candidate) === objectKey(ref));
  if (!entry) integrity("evidence object is missing from catalog", { featureId, ...ref });
  if (entry.size !== ref.size) integrity("evidence object size does not match its ref", { featureId, expected: ref.size, actual: entry.size });
  const descriptor = catalog.packs.find((candidate) => candidate.packSha256 === entry.packSha256);
  if (!descriptor) integrity("evidence object pack descriptor is missing", { featureId, packSha256: entry.packSha256 });
  const directory = packDirectory(root, featureId, descriptor);
  let indexJson: string;
  try {
    indexJson = await readFile(path.join(directory, `${descriptor.packSha256}.index.json`), "utf8");
  } catch {
    integrity("evidence pack index cannot be read", { featureId, packSha256: descriptor.packSha256, location: descriptor.location });
  }
  const index = readPackIndexJson(indexJson, descriptor.packSha256);
  if (digest(indexJson) !== descriptor.indexSha256) integrity("evidence pack index digest does not match catalog", { featureId, packSha256: descriptor.packSha256 });
  const indexed = index.objects.find((candidate) => candidate.kind === entry.kind && candidate.sha256 === entry.sha256);
  if (!indexed || indexed.size !== entry.size || indexed.offset !== entry.offset || indexed.compressedLength !== entry.compressedLength) {
    integrity("evidence catalog entry does not match pack index", { featureId, ...ref });
  }
  try {
    return await readEvidencePackEntry(directory, descriptor.packSha256, entry);
  } catch (error) {
    integrity("evidence object cannot be read or verified", { featureId, cause: error instanceof Error ? error.message : String(error), ...ref });
  }
}

/**
 * Move all hot packs to cold without changing any logical ref. Copy-before-
 * switch keeps the old catalog readable until the new catalog is durable.
 */
export async function sealEvidenceHistory(root: string, featureId: string, options: EvidenceStoreWriteOptions = {}): Promise<{ catalog: EvidenceStoreCatalog; moved: number }> {
  const current = await readEvidenceStoreCatalog(root, featureId);
  const hot = current.packs.filter((pack) => pack.location === "hot");
  if (hot.length === 0) return { catalog: current, moved: 0 };
  const cold = coldDirectory(root, featureId);
  await mkdir(cold, { recursive: true });
  for (const pack of hot) {
    const sourceDirectory = hotDirectory(root, featureId);
    for (const suffix of [`${pack.packSha256}.pack`, `${pack.packSha256}.index.json`]) {
      const source = path.join(sourceDirectory, suffix);
      const target = path.join(cold, suffix);
      try {
        await copyFile(source, target, (await import("node:fs")).constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const [existing, expected] = await Promise.all([readFile(target), readFile(source)]);
        if (!existing.equals(expected)) integrity("cold evidence path is occupied by different bytes", { featureId, suffix });
      }
    }
  }
  const next: EvidenceStoreCatalog = {
    ...current,
    revision: current.revision + 1,
    packs: current.packs.map((pack) => pack.location === "cold" ? pack : { ...pack, location: "cold" as const }),
  };
  const written = await writeEvidenceStoreCatalog(root, featureId, next, options);
  for (const pack of hot) {
    for (const suffix of [`${pack.packSha256}.pack`, `${pack.packSha256}.index.json`]) {
      await unlink(path.join(hotDirectory(root, featureId), suffix)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  return { catalog: written.catalog, moved: hot.length };
}

function packFileSha(packFile: string): string | undefined {
  const match = /^([a-f0-9]{64})\.(?:pack|index\.json)$/.exec(packFile);
  return match?.[1];
}

async function deleteFileIfExists(file: string): Promise<boolean> {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export interface EvidenceGcResult {
  deletedPacks: number;
  deletedFiles: number;
  deletedBytes: number;
  catalog: EvidenceStoreCatalog;
}

/**
 * Bounded orphan GC. The caller must provide the complete current root set;
 * unknown roots fail closed. Each call removes at most the configured budget,
 * so clearing a backlog is incremental and never makes a business mutation
 * block on arbitrary amounts of filesystem work.
 */
export async function collectEvidenceOrphans(
  root: string,
  featureId: string,
  rootSet: EvidenceObjectRef[],
  options: EvidenceStoreWriteOptions & { packBudget?: number; byteBudget?: number } = {},
): Promise<EvidenceGcResult> {
  const current = await readEvidenceStoreCatalog(root, featureId);
  const known = new Map(current.objects.map((entry) => [objectKey(entry), entry]));
  for (const ref of rootSet) {
    const parsed = parseEvidenceObjectRef(ref);
    if (!known.has(objectKey(parsed))) integrity("GC root set references an object missing from catalog", { featureId, ...parsed });
  }
  const rootPackShas = new Set(rootSet.map((ref) => known.get(objectKey(ref))!.packSha256));
  const orphanPacks = current.packs.filter((pack) => !rootPackShas.has(pack.packSha256)).sort((left, right) => left.packSha256.localeCompare(right.packSha256));
  const packBudget = options.packBudget ?? DEFAULT_GC_PACK_BUDGET;
  const byteBudget = options.byteBudget ?? DEFAULT_GC_BYTE_BUDGET;
  const selected: EvidencePackDescriptor[] = [];
  let selectedBytes = 0;
  for (const pack of orphanPacks) {
    if (selected.length >= packBudget || selectedBytes >= byteBudget) break;
    selected.push(pack);
    selectedBytes += pack.totalRawSize;
  }
  const selectedShas = new Set(selected.map((pack) => pack.packSha256));
  let next = current;
  if (selected.length > 0) {
    next = {
      ...current,
      revision: current.revision + 1,
      objects: current.objects.filter((entry) => !selectedShas.has(entry.packSha256)),
      packs: current.packs.filter((pack) => !selectedShas.has(pack.packSha256)),
    };
    // Catalog switch first: a failure while deleting files leaves harmless
    // physical leftovers for the next bounded round, never a catalog that
    // points at already-deleted reachable packs.
    await writeEvidenceStoreCatalog(root, featureId, next, options);
  }
  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const pack of selected) {
    const directory = packDirectory(root, featureId, pack);
    for (const suffix of [`${pack.packSha256}.pack`, `${pack.packSha256}.index.json`]) {
      const file = path.join(directory, suffix);
      const before = await stat(file).then((value) => value.size, () => 0);
      if (await deleteFileIfExists(file)) {
        deletedFiles += 1;
        deletedBytes += before;
      }
    }
  }
  // Clean pack files left behind by a crash between catalog switch and
  // deletion. These files have no descriptor in the current catalog.
  const descriptors = new Set(next.packs.map((pack) => pack.packSha256));
  for (const directory of [hotDirectory(root, featureId), coldDirectory(root, featureId)]) {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const file of files) {
      const sha = packFileSha(file);
      if (!sha || descriptors.has(sha)) continue;
      const absolute = path.join(directory, file);
      const before = await stat(absolute).then((value) => value.size, () => 0);
      if (await deleteFileIfExists(absolute)) {
        deletedFiles += 1;
        deletedBytes += before;
      }
    }
  }
  return { deletedPacks: selected.length, deletedFiles, deletedBytes, catalog: next };
}

export interface EvidenceStoreIntegrityIssue {
  code: "EVIDENCE_STORE_OBJECT_PACK_MISSING" | "EVIDENCE_STORE_REACHABLE_PACK_DAMAGED";
  message: string;
  ref?: EvidenceObjectRef;
  packSha256?: string;
}

export interface EvidenceStoreHealth {
  catalogPresent: boolean;
  featureId: string;
  catalogRevision: number;
  objectCount: number;
  packCount: number;
  hotPackCount: number;
  coldPackCount: number;
  hotObjectCount: number;
  coldObjectCount: number;
  hotRawBytes: number;
  coldRawBytes: number;
  orphanPackCount: number;
  orphanRawBytes: number;
  physicalOrphanFileCount: number;
  /** Bounded-GC rounds estimated from the current backlog; 0 when clean. */
  backlogRounds: number;
  integrityIssues: EvidenceStoreIntegrityIssue[];
}

/**
 * Read-only hot summary for doctor/status. This function never reads pack
 * payloads, so it can inspect arbitrarily large cold history without loading
 * unreachable audit bytes. It does stat catalog-listed pack files to detect
 * missing/damaged storage and counts physical leftovers for bounded GC.
 */
export async function inspectEvidenceStoreHealth(root: string, featureId: string, options: { rootSet?: EvidenceObjectRef[] } = {}): Promise<EvidenceStoreHealth> {
  const catalog = await readEvidenceStoreCatalog(root, featureId);
  const packBySha = new Map(catalog.packs.map((pack) => [pack.packSha256, pack]));
  const knownObjects = new Map(catalog.objects.map((entry) => [objectKey(entry), entry]));
  const integrityIssues: EvidenceStoreIntegrityIssue[] = [];
  const rootPackShas = new Set<string>();
  for (const ref of options.rootSet ?? []) {
    const parsed = parseEvidenceObjectRef(ref);
    const entry = knownObjects.get(objectKey(parsed));
    if (!entry) {
      integrityIssues.push({
        code: "EVIDENCE_STORE_OBJECT_PACK_MISSING",
        message: "root set references an object absent from catalog",
        ref: parsed,
      });
      continue;
    }
    rootPackShas.add(entry.packSha256);
  }
  const objectsByPack = new Map<string, number>();
  const rawBytesByPack = new Map<string, number>();
  for (const entry of catalog.objects) {
    const pack = packBySha.get(entry.packSha256);
    if (!pack) {
      integrityIssues.push({
        code: "EVIDENCE_STORE_OBJECT_PACK_MISSING",
        message: "catalog object references a pack absent from catalog.packs",
        ref: { kind: entry.kind, sha256: entry.sha256, size: entry.size },
        packSha256: entry.packSha256,
      });
      continue;
    }
    objectsByPack.set(entry.packSha256, (objectsByPack.get(entry.packSha256) ?? 0) + 1);
    rawBytesByPack.set(entry.packSha256, (rawBytesByPack.get(entry.packSha256) ?? 0) + entry.size);
  }
  let hotPackCount = 0;
  let coldPackCount = 0;
  let hotObjectCount = 0;
  let coldObjectCount = 0;
  let hotRawBytes = 0;
  let coldRawBytes = 0;
  let orphanPackCount = 0;
  let orphanRawBytes = 0;
  for (const pack of catalog.packs) {
    const objectCount = objectsByPack.get(pack.packSha256) ?? 0;
    const rawBytes = rawBytesByPack.get(pack.packSha256) ?? 0;
    if (pack.location === "hot") {
      hotPackCount += 1;
      hotObjectCount += objectCount;
      hotRawBytes += rawBytes;
    } else {
      coldPackCount += 1;
      coldObjectCount += objectCount;
      coldRawBytes += rawBytes;
    }
    const unrooted = options.rootSet ? !rootPackShas.has(pack.packSha256) : objectCount === 0;
    if (unrooted) {
      orphanPackCount += 1;
      orphanRawBytes += pack.totalRawSize;
    }
    const directory = packDirectory(root, featureId, pack);
    const missing: string[] = [];
    for (const suffix of [`${pack.packSha256}.pack`, `${pack.packSha256}.index.json`]) {
      const exists = await stat(path.join(directory, suffix)).then(() => true, (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? false : Promise.reject(error));
      if (!exists) missing.push(suffix);
    }
    if (missing.length > 0) {
      integrityIssues.push({
        code: "EVIDENCE_STORE_REACHABLE_PACK_DAMAGED",
        message: `pack storage is incomplete: ${missing.join(", ")}`,
        packSha256: pack.packSha256,
      });
    }
  }
  const descriptors = new Set(catalog.packs.map((pack) => pack.packSha256));
  let physicalOrphanFileCount = 0;
  for (const directory of [hotDirectory(root, featureId), coldDirectory(root, featureId)]) {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const file of files) {
      const sha = packFileSha(file);
      if (sha && !descriptors.has(sha)) physicalOrphanFileCount += 1;
    }
  }
  const orphanRoundBudget = Math.max(orphanPackCount / DEFAULT_GC_PACK_BUDGET, orphanRawBytes / DEFAULT_GC_BYTE_BUDGET, physicalOrphanFileCount / DEFAULT_GC_PACK_BUDGET);
  return {
    catalogPresent: catalog.packs.length > 0 || catalog.objects.length > 0,
    featureId: catalog.featureId,
    catalogRevision: catalog.revision,
    objectCount: catalog.objects.length,
    packCount: catalog.packs.length,
    hotPackCount,
    coldPackCount,
    hotObjectCount,
    coldObjectCount,
    hotRawBytes,
    coldRawBytes,
    orphanPackCount,
    orphanRawBytes,
    physicalOrphanFileCount,
    backlogRounds: Math.ceil(orphanRoundBudget),
    integrityIssues,
  };
}
