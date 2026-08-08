import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadSource } from "./load-source.mjs";

const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const anchors = await loadSource("plugins/dev-flow/src/core/traceability-anchors.ts");

export function traceDeltaFor(kind, route) {
  if (kind === "requirements") {
    return {
      nodes: [
        { kind: "requirement", id: "REQ-001" },
        { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
      ],
    };
  }
  if (kind === "implementation-plan" && route === "m") {
    return {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
        { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
        {
          kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"],
          forwardVerification: ["unit"], rollbackVerification: ["unit"],
        },
      ],
    };
  }
  if (kind === "implementation-plan" && route === "l") {
    return {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
        { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
        {
          kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"],
          forwardVerification: ["unit"], rollbackVerification: ["unit"],
        },
      ],
    };
  }
  if (kind === "coverage-matrix") return { nodes: [{ kind: "test", id: "TEST-001", verifies: ["AC-001"] }] };
  if (kind === "rollback-units" && route === "l") {
    return {
      nodes: [{
        kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"],
        forwardVerification: ["unit"], rollbackVerification: ["unit"],
      }],
    };
  }
  throw new Error(`no trace fixture for ${route}:${kind}`);
}

export function twoClosureTraceDeltaFor(kind, route) {
  if (route !== "m") throw new Error(`two-closure fixture is only defined for ${route}`);
  if (kind === "requirements") {
    return {
      nodes: [
        { kind: "requirement", id: "REQ-001" },
        { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
        { kind: "requirement", id: "REQ-002" },
        { kind: "acceptance-criterion", id: "AC-002", parentRequirement: "REQ-002" },
      ],
    };
  }
  if (kind === "implementation-plan") {
    return {
      nodes: [
        { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
        { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
        {
          kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src/one.ts"], covers: ["REQ-001", "AC-001"],
          forwardVerification: ["unit"], rollbackVerification: ["unit"],
        },
        { kind: "task", id: "TASK-002", covers: ["REQ-002", "AC-002"], rollbackUnit: "RU-002" },
        { kind: "test", id: "TEST-002", verifies: ["AC-002"] },
        {
          kind: "rollback", id: "RU-002", tasks: ["TASK-002"], dependsOn: [], fileScope: ["src/two.ts"], covers: ["REQ-002", "AC-002"],
          forwardVerification: ["unit"], rollbackVerification: ["unit"],
        },
      ],
    };
  }
  if (kind === "coverage-matrix") {
    return {
      nodes: [
        { kind: "test", id: "TEST-001", verifies: ["AC-001"] },
        { kind: "test", id: "TEST-002", verifies: ["AC-002"] },
      ],
    };
  }
  throw new Error(`no two-closure fixture for ${route}:${kind}`);
}

/** Adds a second independent closure to a runtime scaffold; it never creates an artifact from scratch. */
export function appendSecondTraceClosure(markdown, kind, route) {
  if (route !== "m") throw new Error(`second closure is only defined for ${route}`);
  if (kind === "requirements") {
    return `${markdown}\n<!-- dev-flow:id=REQ-002 kind=requirement -->\n### REQ-002：第二组需求\n\n- 描述：\n\n<!-- dev-flow:id=AC-002 kind=acceptance-criterion -->\n#### AC-002：第二组验收条件（parent: REQ-002）\n\n- 验收条件：\n`;
  }
  if (kind === "implementation-plan") {
    return `${markdown}\n<!-- dev-flow:id=TASK-002 kind=task -->\n### TASK-002：第二组实现任务\n\n- covers: REQ-002, AC-002\n- rollback_unit: RU-002\n\n<!-- dev-flow:id=TEST-002 kind=test -->\n### TEST-002：第二组验证场景（verifies: AC-002）\n\n- 验证方法：\n\n<!-- dev-flow:id=RU-002 kind=rollback -->\n### RU-002：第二组回撤单元\n\n- tasks: TASK-002\n- depends_on: []\n- file_scope: src/two.ts\n- covers: REQ-002, AC-002\n- forward_verification: unit\n- rollback_verification: unit\n`;
  }
  if (kind === "coverage-matrix") {
    return `${markdown}\n<!-- dev-flow:id=TEST-002 kind=test -->\n### TEST-002：第二组验证场景（verifies: AC-002）\n\n- 验证方法：\n`;
  }
  throw new Error(`no second closure for ${route}:${kind}`);
}

export async function registerTraceFixture({ root, featureId, state, kind, delta, edit = (markdown) => markdown }) {
  let current = state;
  if (!current.artifacts[kind]) {
    current = await artifacts.scaffoldArtifact(root, featureId, current.revision, kind);
  }
  const target = path.join(root, ".dev-flow", "features", featureId, current.artifacts[kind].path);
  const before = await readFile(target, "utf8");
  const after = edit(before);
  if (after !== before) await writeFile(target, after);
  const traceDelta = delta ?? traceDeltaFor(kind, current.route);
  assert.deepEqual(
    anchors.parseTraceSourceBlocks(after).map(({ id }) => id).sort(),
    traceDelta.nodes.map(({ id }) => id).sort(),
  );
  const result = await artifacts.recordArtifactWithTrace(root, featureId, current.revision, kind, traceDelta);
  return result.state;
}
