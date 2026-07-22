import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillsRoot = path.resolve("plugins/dev-flow/skills");

test("all shared skills use the MCP-only, one-action contract", async () => {
  const names = (await readdir(skillsRoot)).sort();
  assert.equal(names.length, 14);
  for (const name of names) {
    const content = await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
    assert.match(content, /^---\nname: dev-flow-/);
    assert.match(content, /Dev Flow MCP/);
  }
  const plan = await readFile(path.join(skillsRoot, "dev-flow-plan-review", "SKILL.md"), "utf8");
  const code = await readFile(path.join(skillsRoot, "dev-flow-code-review", "SKILL.md"), "utf8");
  assert.match(plan, /reviewType: "plan"/); assert.match(code, /reviewType: "code"/);
  assert.match(await readFile(path.join(skillsRoot, "dev-flow-task", "SKILL.md"), "utf8"), /does not integrate OpenSpec/);
  assert.match(await readFile(path.join(skillsRoot, "dev-flow-finish", "SKILL.md"), "utf8"), /logic-complete/);
});
