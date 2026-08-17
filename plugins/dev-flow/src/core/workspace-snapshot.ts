import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { stableJson } from "../policy/stable-json.js";
import {
  parseWorkspaceSnapshotManifest,
  type EvidenceObjectRef,
  type EvidenceStoreCatalog,
  type EvidenceStorePointer,
  type WorkspaceSnapshotFile,
  type WorkspaceSnapshotManifest,
} from "../policy/evidence-store.js";
import { putEvidenceObject, type EvidenceStoreWriteOptions } from "./evidence-store.js";
import { enumerateProtectedFiles, type GovernedRootsConfig } from "./fingerprint.js";

export interface WorkspaceSnapshotResult {
  files: WorkspaceSnapshotFile[];
  manifest: WorkspaceSnapshotManifest;
  ref: EvidenceObjectRef;
  pointer: EvidenceStorePointer;
  catalog: EvidenceStoreCatalog;
}

/**
 * Capture one canonical governed-workspace snapshot. The enumeration result is
 * read exactly once for content/mode/kind so callers cannot splice together a
 * file list and a fingerprint that observed two different workspace states.
 */
export async function captureWorkspaceSnapshot(
  root: string,
  featureId: string,
  input: GovernedRootsConfig,
  options: EvidenceStoreWriteOptions & { now?: Date } = {},
): Promise<WorkspaceSnapshotResult> {
  const paths = await enumerateProtectedFiles(root, input);
  const files: WorkspaceSnapshotFile[] = [];
  for (const relative of paths) {
    const absolute = path.join(root, relative);
    const metadata = await lstat(absolute);
    const symbolic = metadata.isSymbolicLink();
    const bytes = symbolic ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
    files.push({
      path: relative,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mode: (metadata.mode & 0o777).toString(8).padStart(3, "0"),
      kind: symbolic ? "symlink" : "file",
      ...(symbolic ? { linkTarget: bytes.toString("utf8") } : {}),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest: WorkspaceSnapshotManifest = {
    schemaVersion: 1,
    featureId,
    capturedAt: (options.now ?? new Date()).toISOString(),
    files,
  };
  const stored = await putEvidenceObject(
    root,
    featureId,
    "file-snapshot",
    Buffer.from(`${stableJson(manifest)}\n`, "utf8"),
    options,
  );
  parseWorkspaceSnapshotManifest(manifest);
  return {
    files,
    manifest,
    ref: stored.ref,
    pointer: stored.pointer,
    catalog: stored.catalog,
  };
}

/** Canonical bytes used by all workspace snapshot callers. */
export function canonicalWorkspaceSnapshotJson(manifest: WorkspaceSnapshotManifest): string {
  return `${stableJson(manifest)}\n`;
}
