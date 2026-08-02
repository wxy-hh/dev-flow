import test from "node:test"; import { runRoute } from "../../helpers/route-flow.mjs"; test("light L", () => runRoute({ level: "L", topology: "multi-chain", execution: "light" }, "light-l"));
