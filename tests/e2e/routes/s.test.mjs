import test from "node:test"; import { runRoute } from "../../helpers/route-flow.mjs"; test("S route", () => runRoute({ level: "S", topology: "local" }, "s"));
