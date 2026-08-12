import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProtectedFileSnapshot } from "./fingerprint.js";

function featureDirectory(root: string, id: string): string {
  return path.join(root, ".dev-flow", "features", id);
}

/** 读取通过时刻保存的逐文件快照；格式错误交给调用方按保守路径处理。 */
export async function readEvidenceSnapshot(root: string, id: string, snapshotPath: string): Promise<ProtectedFileSnapshot[]> {
  const raw = await readFile(path.join(featureDirectory(root, id), snapshotPath), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new TypeError("evidence snapshot must be an array");
  return parsed as ProtectedFileSnapshot[];
}

/** 以 feature 私有相对路径写入通过时刻快照，并返回可存入状态的路径。 */
export async function writeEvidenceSnapshot(
  root: string,
  id: string,
  snapshot: ProtectedFileSnapshot[],
  fingerprint: string,
  directory: "review" | "verification",
): Promise<string> {
  const snapshotPath = `${directory}/snapshot-${fingerprint}.json`;
  const featureRoot = featureDirectory(root, id);
  const file = path.join(featureRoot, snapshotPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(snapshot));
  return snapshotPath;
}
