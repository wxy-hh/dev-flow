import test from "node:test"; import { runRoute } from "../../helpers/route-flow.mjs"; test("light M", () => runRoute({ level: "M", topology: "local", execution: "light" }, "light-m"));
