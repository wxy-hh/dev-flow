import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadSource } from "../helpers/load-source.mjs";

const fingerprint = await loadSource("plugins/dev-flow/src/core/fingerprint.ts");
const run = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-fingerprint-"));
  await mkdir(path.join(root, "src", "dist"), { recursive: true });
  await writeFile(path.join(root, "src", "keep.ts"), "keep");
  await writeFile(path.join(root, "src", "dist", "bundle.js"), "generated");
  return root;
}

test("non-Git governed-root enumeration applies explicit excludes", async () => {
  const root = await fixture();
  const files = await fingerprint.enumerateProtectedFiles(root, {
    governedRoots: ["src"],
    governedRootsExclude: ["src/dist/**"],
  });

  assert.deepEqual(files, ["src/keep.ts"]);
});

test("repository-root enumeration excludes untracked workflow control paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-fingerprint-root-"));
  try {
    await mkdir(path.join(root, ".dev-flow", "features", "x"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "business.ts"), "business");
    await writeFile(path.join(root, ".dev-flow", "features", "x", "state.json"), "state");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "module");
    assert.deepEqual(await fingerprint.enumerateProtectedFiles(root, { governedRoots: ["."] }), ["business.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("governed-root enumeration rejects symbolic links", async () => {
  const root = await fixture();
  await symlink(path.join(root, "src", "keep.ts"), path.join(root, "src", "link.ts"));

  await assert.rejects(
    () => fingerprint.enumerateProtectedFiles(root, { governedRoots: ["src"] }),
    /UNSAFE_PROTECTED_ROOT/,
  );
});

test("governed-root enumeration rejects a symbolic link at the configured root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-fingerprint-root-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "dev-flow-fingerprint-outside-"));
  try {
    await rm(path.join(root, "src"), { recursive: true, force: true });
    await symlink(outside, path.join(root, "src"));
    await assert.rejects(
      () => fingerprint.enumerateProtectedFiles(root, { governedRoots: ["src"] }),
      /UNSAFE_PROTECTED_ROOT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("Git enumeration keeps tracked ignored files and excludes untracked ignored files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-fingerprint-git-"));
  await mkdir(path.join(root, "src", "generated", "nested"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "src/generated/\n");
  await writeFile(path.join(root, "src", "keep.ts"), "keep");
  await writeFile(path.join(root, "src", "generated", "tracked.js"), "tracked");
  await writeFile(path.join(root, "src", "generated", "untracked.js"), "untracked");
  await writeFile(path.join(root, "src", "generated", "nested", ".gitignore"), "*.tmp\n");
  await writeFile(path.join(root, "src", "generated", "nested", "ignored.tmp"), "ignored");
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "src/keep.ts"], { cwd: root });
  await run("git", ["add", "-f", "src/generated/tracked.js"], { cwd: root });
  await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "baseline"], { cwd: root });

  const files = await fingerprint.enumerateProtectedFiles(root, { governedRoots: ["src"] });
  assert.deepEqual(files, ["src/generated/tracked.js", "src/keep.ts"]);
});

test("a tracked in-repository symlink hashes the link target blob without following it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-fingerprint-safe-link-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "shared.ts"), "one\n");
    await symlink("../shared.ts", path.join(root, "src", "shared.ts"));
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["add", "src/shared.ts", "shared.ts"], { cwd: root });
    const first = await fingerprint.fingerprintGovernedRoots(root, { governedRoots: ["src"] });
    await writeFile(path.join(root, "shared.ts"), "two\n");
    const second = await fingerprint.fingerprintGovernedRoots(root, { governedRoots: ["src"] });
    assert.equal(first, second);
    assert.deepEqual(await fingerprint.enumerateProtectedFiles(root, { governedRoots: ["src"] }), ["src/shared.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an excluded symlink is filtered before safety validation", async () => {
  const root = await fixture();
  try {
    await symlink("/tmp", path.join(root, "src", "excluded-link"));
    const files = await fingerprint.enumerateProtectedFiles(root, {
      governedRoots: ["src"],
      governedRootsExclude: ["src/excluded-link"],
    });
    assert.deepEqual(files, ["src/dist/bundle.js", "src/keep.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
