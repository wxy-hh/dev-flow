import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DevFlowError } from "./errors.js";

const digest = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

function safePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || normalized === ".dev-flow" || normalized.startsWith(".dev-flow/")) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "验收记录路径必须是项目内的普通相对路径。", { path: value });
  }
  return normalized;
}

function imageValid(bytes: Buffer): boolean {
  const png = bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && bytes.readUInt32BE(16) > 0
    && bytes.readUInt32BE(20) > 0;
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  const webp = bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return png || jpeg || webp;
}

/**
 * 验收领域的文件适配器：只负责读取和内容寻址复制，不决定验收是否满足。
 * acceptance.ts 通过这个窄接口使用本地文件系统，领域规则因此不再依赖路径/IO 细节。
 */
export async function storeScreenshotArtifact(root: string, featureId: string, sourcePath: string): Promise<{ artifactPath: string; artifactSha256: string }> {
  const source = safePath(sourcePath);
  const sourceAbsolute = path.join(root, source);
  let metadata;
  try {
    metadata = await lstat(sourceAbsolute);
  } catch {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "截图文件不存在或不可读取。", { path: source });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "截图文件必须是项目内的普通文件。", { path: source });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(sourceAbsolute);
  } catch {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "截图文件不存在或不可读取。", { path: source });
  }
  if (!imageValid(bytes)) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "截图文件不是可解析的 PNG、JPEG 或 WebP。", { path: source });
  }
  const artifactSha256 = digest(bytes);
  const ext = path.extname(source).toLowerCase() || ".bin";
  const artifactPath = `acceptance/${artifactSha256}${ext}`;
  const featureRoot = path.join(root, ".dev-flow", "features", featureId);
  await mkdir(path.join(featureRoot, "acceptance"), { recursive: true });
  await copyFile(sourceAbsolute, path.join(featureRoot, artifactPath));
  return { artifactPath, artifactSha256 };
}
