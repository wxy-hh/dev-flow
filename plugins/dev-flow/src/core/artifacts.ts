import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { routeDefinitionForFeature } from "../policy/contract.js";
import { renderArtifactTemplate } from "./artifact-templates.js";
import { DevFlowError } from "./errors.js";
import { gatesInvalidatedByArtifact } from "./gate-basis.js";
import { mutate, readState, type FeatureState } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { clearInteractionsByKind, clearInteractionsForTarget } from "./user-interactions.js";

const names: Record<string, string> = {
  status: "状态文档.md",
  "risk-card": "风险文档.md",
  requirements: "需求文档.md",
  "implementation-plan": "计划文档.md",
  "coverage-matrix": "覆盖矩阵文档.md",
  "boundary-card": "边界文档.md",
  "rollback-safety": "回滚安全文档.md",
  verification: "验证文档.md",
  "rollback-units": "回滚单元文档.md",
  "plan-review": "计划审核文档.md",
  "code-review": "代码审核文档.md",
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const featureDirectory = (root: string, id: string) => path.join(root, ".dev-flow", "features", id);
const traceArtifactKinds = new Set(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);
function template(state: FeatureState, id: string, kind: string): string {
  if (traceArtifactKinds.has(kind)) {
    return renderArtifactTemplate({ featureId: id, route: state.route, requirementsState: state.classification.requirements }, kind);
  }
  return `---\ndev_flow:\n  schema_version: 1\n  feature_id: ${id}\n  route: ${state.route}\n  kind: ${kind}\n---\n\n# ${kind}\n\n`;
}

function effectiveRoute(state: FeatureState) {
  return routeDefinitionForFeature(state.route, state.workflowCapabilities);
}

function artifactKinds(definition: ReturnType<typeof effectiveRoute>): string[] {
  return [...new Set([...definition.requiredArtifacts, ...(definition.generatedArtifacts ?? [])])];
}

export async function assertArtifactCurrent(root: string, id: string, state: FeatureState, kind: string): Promise<string> {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}

export async function scaffoldArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id); if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  const route = effectiveRoute(state);
  if (!artifactKinds(route).includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  const currentStep = currentOpenStep(state); const requiredNow = currentStep
    ? [...(route.artifactSteps?.[currentStep] ?? []), ...(route.generatedArtifactSteps?.[currentStep] ?? [])]
    : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind]; if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind"); const target = path.join(featureDirectory(root, id), filename);
  const content = template(state, id, kind); await writeFile(target, content, { flag: "wx" }).catch(async (error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  const contents = await readFile(target, "utf8"); return mutate(root, id, expectedRevision, "artifact-scaffolded", (current) => { current.artifacts[kind] = { path: filename, sha256: hash(contents) }; });
}
/** Registers the edited file as the current evidence and revokes approvals whose basis changed. */
export async function recordArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id); const route = effectiveRoute(state);
  if ((route.generatedArtifacts ?? []).includes(kind)) throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", `${kind} is generated from state and cannot be registered as manual evidence`);
  if (!route.requiredArtifacts.includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  const artifact = state.artifacts[kind]; if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8"); const checksum = hash(contents);
  return mutate(root, id, expectedRevision, "artifact-recorded", (current) => {
    current.artifacts[kind] = { ...artifact, sha256: checksum };
    for (const gate of gatesInvalidatedByArtifact(kind)) {
      delete current.humanGates[gate];
      delete current.steps[gate];
      clearInteractionsForTarget(current, `gate:${gate}`);
    }
    if (kind === "requirements") clearInteractionsByKind(current, "grill");
    current.featureCheck = {}; delete current.steps.feature_check; current.logicComplete = false; delete current.steps.finalize;
  });
}
export async function assertArtifactIntegrity(root: string, id: string): Promise<void> {
  const state = await readState(root, id);
  for (const kind of artifactKinds(effectiveRoute(state))) await assertArtifactCurrent(root, id, state, kind);
}
