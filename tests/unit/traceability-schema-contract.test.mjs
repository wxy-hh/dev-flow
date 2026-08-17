import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Trace schema documents all closed caller node variants", async () => {
  const schema = JSON.parse(await readFile(
    path.join(process.cwd(), "plugins/dev-flow/policy/traceability.schema.json"),
    "utf8",
  ));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$defs.traceNodeInput.oneOf.length, 7);
  for (const variant of schema.$defs.traceNodeInput.oneOf) {
    assert.equal(variant.additionalProperties, false);
    assert.ok(variant.required.includes("kind"));
    assert.ok(variant.required.includes("id"));
    assert.equal(variant.properties.id.type, "string");
  }
  const task = schema.$defs.traceNodeInput.oneOf.find((variant) => variant.properties.kind.const === "task");
  const implementationUnit = schema.$defs.traceNodeInput.oneOf.find((variant) => variant.properties.kind.const === "implementation-unit");
  assert.equal(task.properties.covers.items.type, "string");
  assert.equal(task.properties.covers.uniqueItems, true);
  assert.equal(implementationUnit.properties.tasks.items.type, "string");
  assert.equal(implementationUnit.properties.tasks.uniqueItems, true);
  assert.equal(schema.$defs.traceDelta, undefined);
  assert.deepEqual(schema.$defs.verificationCommandRef, { type: "string", minLength: 1 });
});
