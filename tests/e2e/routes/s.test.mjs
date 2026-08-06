import test from "node:test";
import { runRoute } from "../../helpers/route-flow.mjs";

test("S route", () => runRoute({ level: "S", topology: "local" }, "s"));

test("S route with kimi host records kimi provenance end to end", async () => {
  const state = await runRoute({ level: "S", topology: "local" }, "s", { host: "kimi" });
  if (state.lastUpdatedBy.host !== "kimi") {
    throw new Error(`expected lastUpdatedBy.host kimi, got ${state.lastUpdatedBy.host}`);
  }
});
