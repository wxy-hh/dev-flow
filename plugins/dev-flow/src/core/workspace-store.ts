import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/** 读取受信写入前后摘要；所有工作区文件 I/O 集中在此接缝。 */
export async function trustedWriteSummary(root: string, file: string): Promise<string> {
  const target = path.join(root, file);
  try {
    const metadata = await lstat(target);
    const bytes = metadata.isSymbolicLink() ? Buffer.from(await readlink(target)) : await readFile(target);
    return `${metadata.isSymbolicLink() ? "symlink" : "file"}:${createHash("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}
