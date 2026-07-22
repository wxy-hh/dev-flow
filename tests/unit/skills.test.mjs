import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillsRoot = path.resolve("plugins/dev-flow/skills");

test("all shared skills use the MCP-only, one-action contract", async () => {
  const names = (await readdir(skillsRoot)).sort();
  assert.equal(names.length, 15);
  assert.ok(names.includes("dev-flow-grillme"));
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
  const requirements = await readFile(path.join(skillsRoot, "dev-flow-requirements", "SKILL.md"), "utf8");
  const grillme = await readFile(path.join(skillsRoot, "dev-flow-grillme", "SKILL.md"), "utf8");
  assert.match(requirements, /missing-or-unclear/); assert.match(requirements, /documented-unconfirmed/); assert.match(requirements, /dev_flow_record_artifact/);
  assert.match(grillme, /grill me/); assert.match(grillme, /exactly one blocking question per turn/); assert.match(grillme, /never allowed to call an MCP mutation/);
});
