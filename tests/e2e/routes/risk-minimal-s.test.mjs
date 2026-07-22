import test from "node:test"; import { runRoute } from "../../helpers/route-flow.mjs"; test("risk S", () => runRoute({ level: "S", topology: "local", riskLabels: ["data"] }, "risk-minimal"));
