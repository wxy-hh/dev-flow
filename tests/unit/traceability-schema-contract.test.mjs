import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Trace schema documents five closed caller node variants", async () => {
  const schema = JSON.parse(await readFile(
    path.join(process.cwd(), "plugins/dev-flow/policy/traceability.schema.json"),
    "utf8",
  ));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$defs.traceNodeInput.oneOf.length, 5);
  for (const variant of schema.$defs.traceNodeInput.oneOf) {
    assert.equal(variant.additionalProperties, false);
    assert.ok(variant.required.includes("kind"));
    assert.ok(variant.required.includes("id"));
  }
  assert.equal(schema.$defs.traceDelta.additionalProperties, false);
});
