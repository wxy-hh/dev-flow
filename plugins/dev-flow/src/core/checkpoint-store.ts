import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseCheckpointManifest, RollbackProtocolError, type CheckpointManifest } from "../policy/rollback.js";
import type { EvidenceObjectRef } from "../policy/evidence-store.js";
import { DevFlowError } from "./errors.js";

/** Read and validate one immutable checkpoint manifest at its owning I/O seam. */
export async function readCheckpointManifest(
  root: string,
  featureId: string,
  checkpointId: string,
): Promise<CheckpointManifest> {
  const file = path.join(root, ".dev-flow", "features", featureId, "checkpoints", "manifests", `${checkpointId}.json`);
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch { throw new DevFlowError("CHECKPOINT_NOT_FOUND", "checkpoint manifest does not exist", { checkpointId }); }
  try {
    const manifest = parseCheckpointManifest(JSON.parse(raw));
    if (manifest.checkpointId !== checkpointId) {
      throw new DevFlowError("CHECKPOINT_INTEGRITY_FAILED", "checkpoint manifest id does not match its path", { checkpointId });
    }
    return manifest;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error instanceof RollbackProtocolError && error.code === "UNSUPPORTED_CHECKPOINT_SCHEMA") {
      throw new DevFlowError("UNSUPPORTED_CHECKPOINT_SCHEMA", "检测到 Dev Flow 4.x checkpoint manifest schema v1。", {
        checkpointId,
        recoveryHint: "回到 4.x 完成或放弃该 feature，备份 .dev-flow 后用 5.0 重新初始化",
      });
    }
    throw new DevFlowError("CHECKPOINT_INTEGRITY_FAILED", "checkpoint manifest is unreadable", { checkpointId });
  }
}

/** Evidence Store roots referenced by all v3 checkpoint manifests of one feature. */
export async function checkpointManifestRootRefs(root: string, featureId: string): Promise<EvidenceObjectRef[]> {
  const directory = path.join(root, ".dev-flow", "features", featureId, "checkpoints", "manifests");
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const refs: EvidenceObjectRef[] = [];
  for (const file of files) {
    const checkpointId = file.slice(0, -".json".length);
    const manifest = await readCheckpointManifest(root, featureId, checkpointId);
    for (const ref of Object.values(manifest.blobRefs ?? {})) {
      if (refs.some((candidate) => candidate.kind === ref.kind && candidate.sha256 === ref.sha256)) continue;
      refs.push(ref);
    }
  }
  return refs;
}
