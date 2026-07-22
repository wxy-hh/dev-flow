import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const { contract } = await loadSource("plugins/dev-flow/src/policy/contract.ts");
test("published route documentation covers every machine contract route", async () => {
  const routes = await readFile("docs/routes.md", "utf8");
  for (const route of Object.keys(contract.routes)) assert.match(routes, new RegExp(route.replace("-", "[- ]"), "i"));
  assert.match(routes, /OpenSpec/i); assert.match(routes, /plan_review/); assert.match(routes, /code_review/);
});
