const test = require("node:test");
const assert = require("node:assert/strict");
const { increment } = require("../src/counter.js");

test("increments a counter", () => {
  assert.equal(increment(1), 2);
});
