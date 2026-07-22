import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { routeDefinition } from "../policy/contract.js";
import { DevFlowError } from "./errors.js";
import { mutate, readState, type FeatureState } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";

const names: Record<string, string> = { status: "status.md", "risk-card": "risk-card.md", requirements: "requirements.md", "implementation-plan": "implementation-plan.md", "coverage-matrix": "coverage-matrix.md", "boundary-card": "boundary-card.md", "rollback-safety": "rollback-safety.md", verification: "verification.md", "rollback-units": "rollback-units.md", "plan-review": "plan-review.md", "code-review": "code-review.md" };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const featureDirectory = (root: string, id: string) => path.join(root, ".dev-flow", "features", id);
export async function scaffoldArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id); if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  if (!routeDefinition(state.route).requiredArtifacts.includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  const currentStep = currentOpenStep(state); const requiredNow = currentStep ? routeDefinition(state.route).artifactSteps?.[currentStep] ?? [] : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind]; if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind"); const target = path.join(featureDirectory(root, id), filename);
  const content = `---\ndev_flow:\n  schema_version: 1\n  feature_id: ${id}\n  route: ${state.route}\n  kind: ${kind}\n---\n\n# ${kind}\n\n`; await writeFile(target, content, { flag: "wx" }).catch(async (error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  const contents = await readFile(target, "utf8"); return mutate(root, id, expectedRevision, "artifact-scaffolded", (current) => { current.artifacts[kind] = { path: filename, sha256: hash(contents) }; });
}
/** Registers the edited file as the current evidence and revokes approvals whose basis changed. */
export async function recordArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id); if (!routeDefinition(state.route).requiredArtifacts.includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  if (kind === "status") throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", "status is generated from state and cannot be registered as manual evidence");
  const artifact = state.artifacts[kind]; if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8"); const checksum = hash(contents);
  return mutate(root, id, expectedRevision, "artifact-recorded", (current) => {
    current.artifacts[kind] = { ...artifact, sha256: checksum };
    if (kind === "requirements") { delete current.humanGates.requirement_confirmation; delete current.steps.requirement_confirmation; }
    if (["requirements", "implementation-plan", "coverage-matrix", "rollback-units", "status", "boundary-card", "rollback-safety"].includes(kind)) {
      delete current.humanGates.implementation_approval; delete current.steps.implementation_approval;
    }
    current.featureCheck = {}; delete current.steps.feature_check; current.logicComplete = false; delete current.steps.finalize;
  });
}
export async function assertArtifactIntegrity(root: string, id: string): Promise<void> { const state = await readState(root, id); for (const required of routeDefinition(state.route).requiredArtifacts) { const artifact = state.artifacts[required]; if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", required); const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8"); if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", required); } }
