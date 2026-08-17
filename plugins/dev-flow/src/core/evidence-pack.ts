import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type {
  EvidenceObjectRef,
  EvidencePackIndex,
  EvidencePackIndexEntry,
} from "../policy/evidence-store.js";

/**
 * Immutable pack encoding:
 *
 *   [4-byte BE compressedLength][gzip canonical object bytes]...
 *
 * The pack index stores the byte offset of each gzip chunk and verifies both
 * the raw and compressed bytes on every read. Objects are never written as
 * loose files; a single-object pack is the minimum unit.
 */

export type EvidencePackFaultPoint =
  | "before-pack-write"
  | "after-pack-fsync"
  | "before-pack-rename"
  | "before-index-write"
  | "after-index-fsync"
  | "before-index-rename";

export interface EvidencePackInput {
  kind: EvidenceObjectRef["kind"];
  bytes: Buffer;
}

export interface EvidencePackOptions {
  fault?: (point: EvidencePackFaultPoint) => void | Promise<void>;
}

export interface EvidencePackWriteResult {
  packSha256: string;
  indexSha256: string;
  packBytes: number;
  entries: EvidencePackIndexEntry[];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeFileAtomic(target: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await fsyncDirectory(path.dirname(target));
}

export function encodeEvidencePack(inputs: EvidencePackInput[]): { pack: Buffer; entries: EvidencePackIndexEntry[] } {
  if (inputs.length === 0) throw new TypeError("evidence pack requires at least one object");
  const chunks: Buffer[] = [];
  const entries: EvidencePackIndexEntry[] = [];
  let offset = 0;
  for (const input of inputs) {
    if (input.bytes.length === 0) throw new TypeError("evidence pack rejects empty objects");
    // Frame each object with its kind so identical raw bytes under different
    // kinds never collide on the same physical pack address.
    const framed = Buffer.concat([Buffer.from(`${input.kind}\u0000`, "utf8"), input.bytes]);
    const compressed = gzipSync(framed);
    chunks.push(Buffer.alloc(4));
    chunks[chunks.length - 1].writeUInt32BE(compressed.length, 0);
    chunks.push(compressed);
    entries.push({
      sha256: sha256(input.bytes),
      kind: input.kind,
      size: input.bytes.length,
      offset: offset + 4,
      compressedLength: compressed.length,
    });
    offset += 4 + compressed.length;
  }
  return { pack: Buffer.concat(chunks), entries };
}

export function decodeEvidencePackEntry(pack: Buffer, entry: EvidencePackIndexEntry): Buffer {
  if (entry.offset < 0 || entry.compressedLength <= 0 || entry.offset + entry.compressedLength > pack.length) {
    throw new TypeError("evidence pack index entry is outside pack bounds");
  }
  if (entry.offset < 4) throw new TypeError("evidence pack index entry overlaps the length prefix");
  const compressed = pack.subarray(entry.offset, entry.offset + entry.compressedLength);
  let framed: Buffer;
  try {
    framed = gunzipSync(compressed);
  } catch {
    throw new TypeError("evidence pack entry cannot be decompressed");
  }
  const separator = framed.indexOf(0);
  if (separator <= 0 || framed.subarray(0, separator).toString("utf8") !== entry.kind) {
    throw new TypeError("evidence pack entry kind does not match its index");
  }
  const bytes = framed.subarray(separator + 1);
  if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
    throw new TypeError("evidence pack entry does not match its content address");
  }
  return bytes;
}

export function canonicalPackIndexJson(index: EvidencePackIndex): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    packSha256: index.packSha256,
    objects: index.objects
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.offset - right.offset || left.kind.localeCompare(right.kind) || left.sha256.localeCompare(right.sha256)),
  }, null, 2)}\n`;
}

export function readPackIndexJson(contents: string, expectedPackSha256: string): EvidencePackIndex {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new TypeError("evidence pack index is not valid JSON");
  }
  const index = value as Partial<EvidencePackIndex> | null;
  if (!index || typeof index !== "object"
    || index.schemaVersion !== 1
    || index.packSha256 !== expectedPackSha256
    || !Array.isArray(index.objects)
    || index.objects.length === 0) {
    throw new TypeError("evidence pack index has an invalid shape");
  }
  const entries = index.objects.map((entry) => {
    if (!entry || typeof entry !== "object") throw new TypeError("evidence pack index entry is invalid");
    return entry as EvidencePackIndexEntry;
  });
  const sorted = [...entries].sort((left, right) => left.offset - right.offset);
  for (const [position, entry] of sorted.entries()) {
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || typeof entry.kind !== "string"
      || !Number.isInteger(entry.size) || entry.size <= 0
      || !Number.isInteger(entry.offset) || entry.offset < 4
      || !Number.isInteger(entry.compressedLength) || entry.compressedLength <= 0) {
      throw new TypeError("evidence pack index entry is invalid");
    }
    const previous = sorted[position - 1];
    if (previous && entry.offset < previous.offset + previous.compressedLength + 4) {
      throw new TypeError("evidence pack index entries overlap");
    }
  }
  return {
    schemaVersion: 1,
    packSha256: index.packSha256,
    objects: entries,
  };
}

/**
 * Write an immutable pack and its index. Both files are content-addressed and
 * idempotent: concurrent writers that produced the same canonical bytes are
 * treated as one successful write.
 */
export async function writeEvidencePack(
  directory: string,
  inputs: EvidencePackInput[],
  options: EvidencePackOptions = {},
): Promise<EvidencePackWriteResult> {
  const { pack, entries } = encodeEvidencePack(inputs);
  const packSha256 = sha256(pack);
  const index: EvidencePackIndex = { schemaVersion: 1, packSha256, objects: entries };
  const indexJson = canonicalPackIndexJson(index);
  const indexSha256 = sha256(Buffer.from(indexJson));
  const packPath = path.join(directory, `${packSha256}.pack`);
  const indexPath = path.join(directory, `${packSha256}.index.json`);

  await mkdir(directory, { recursive: true });

  try {
    const existingPack = await readFile(packPath);
    if (!existingPack.equals(pack)) throw new TypeError("evidence pack path is occupied by different bytes");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await options.fault?.("before-pack-write");
    const packTemporary = path.join(directory, `.${packSha256}.${randomUUID()}.tmp`);
    const handle = await open(packTemporary, "wx");
    try {
      await handle.writeFile(pack);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await options.fault?.("after-pack-fsync");
    try {
      await rename(packTemporary, packPath);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EEXIST") throw renameError;
      const existingPack = await readFile(packPath);
      if (!existingPack.equals(pack)) throw new TypeError("evidence pack path is occupied by different bytes");
    }
    await options.fault?.("before-pack-rename");
    await fsyncDirectory(directory);
  }

  try {
    const existingIndex = await readFile(indexPath, "utf8");
    if (existingIndex !== indexJson) throw new TypeError("evidence pack index path is occupied by different bytes");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await options.fault?.("before-index-write");
    await writeFileAtomic(indexPath, Buffer.from(indexJson));
    await options.fault?.("after-index-fsync");
    await options.fault?.("before-index-rename");
  }

  return { packSha256, indexSha256, packBytes: pack.length, entries };
}

export async function readEvidencePackIndex(directory: string, packSha256: string): Promise<EvidencePackIndex> {
  const indexPath = path.join(directory, `${packSha256}.index.json`);
  const contents = await readFile(indexPath, "utf8");
  return readPackIndexJson(contents, packSha256);
}

export async function readEvidencePackEntry(
  directory: string,
  packSha256: string,
  entry: EvidencePackIndexEntry,
): Promise<Buffer> {
  const pack = await readFile(path.join(directory, `${packSha256}.pack`));
  if (sha256(pack) !== packSha256) throw new TypeError("evidence pack digest does not match its name");
  return decodeEvidencePackEntry(pack, entry);
}
