import test from "node:test";
import { runRoute } from "../../helpers/route-flow.mjs";

test("light M", () => runRoute({ level: "M", topology: "local", execution: "light" }, "light-m"));

test("light M with kimi host records kimi provenance end to end", async () => {
  const state = await runRoute({ level: "M", topology: "local", execution: "light" }, "light-m", { host: "kimi" });
  if (state.lastUpdatedBy.host !== "kimi") {
    throw new Error(`expected lastUpdatedBy.host kimi, got ${state.lastUpdatedBy.host}`);
  }
});
