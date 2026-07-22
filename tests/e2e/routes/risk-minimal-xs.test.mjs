import test from "node:test"; import { runRoute } from "../../helpers/route-flow.mjs"; test("risk XS", () => runRoute({ level: "XS", topology: "local", riskLabels: ["security"] }, "risk-minimal"));
