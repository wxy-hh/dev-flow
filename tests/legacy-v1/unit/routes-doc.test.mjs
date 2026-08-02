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

test("current Trace documentation labels match the published package version", async () => {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const documents = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("plugins/dev-flow/README.md", "utf8"),
    readFile("docs/routes.md", "utf8"),
    readFile("docs/architecture.md", "utf8"),
  ]);
  assert.match(documents[0], new RegExp(`## Traceability（${version.replaceAll(".", "\\.")}\\+）`));
  assert.match(documents[1], new RegExp(`\\*\\*${version.replaceAll(".", "\\.")}\\+\\*\\*.*dev_flow_record_artifact_with_trace`));
  assert.match(documents[2], new RegExp(`Trace source（${version.replaceAll(".", "\\.")}\\+）`));
  assert.match(documents[3], new RegExp(`Traceability 事实层（${version.replaceAll(".", "\\.")}\\+）`));
});
