import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const { classifyGitCommand, gitReadOnlyCommands } = await loadSource("plugins/dev-flow/src/core/git-policy.ts");

test("Git policy allows only the explicit strict read list", () => {
  assert.deepEqual(gitReadOnlyCommands, ["cat-file", "diff", "log", "ls-files", "ls-tree", "name-rev", "rev-parse", "show", "status"]);
  for (const command of ["git status", "git diff --cached", "git log", "git show HEAD", "git ls-files", "git branch --show-current", "git remote -v", "git stash list"]) assert.equal(classifyGitCommand(command), "read", command);
  for (const command of ["git add .", "git branch -d old", "git config user.name x", "git checkout main", "git status && git commit -m x", "FOO=1 git -C app commit -m x", "git mystery"]) assert.equal(classifyGitCommand(command), "write", command);
  assert.equal(classifyGitCommand("npm test"), "other");
});
