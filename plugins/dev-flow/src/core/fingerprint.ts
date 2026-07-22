import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { DevFlowError } from "./errors.js";

const ignored = new Set([".git", ".dev-flow", "node_modules"]);

async function collect(root: string, relative: string, files: string[]): Promise<void> {
  const absolute = path.join(root, relative);
  let entries;
  try { entries = await readdir(absolute, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    const target = path.join(root, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root, child, files);
    else if (metadata.isFile()) files.push(child);
  }
}

/** Hashes only explicitly configured business roots, never workflow state or Git metadata. */
export async function fingerprintProtectedRoots(root: string, protectedRoots: string[]): Promise<string> {
  const files: string[] = [];
  for (const item of [...protectedRoots].sort()) await collect(root, item, files);
  const digest = createHash("sha256");
  for (const relative of files.sort()) {
    digest.update(relative); digest.update("\0"); digest.update(await readFile(path.join(root, relative))); digest.update("\0");
  }
  return digest.digest("hex");
}
