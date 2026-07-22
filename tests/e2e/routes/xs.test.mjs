import test from "node:test"; import { runRoute } from "../../helpers/route-flow.mjs"; test("XS route", () => runRoute({ level: "XS", topology: "local" }, "xs"));
