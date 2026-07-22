import readline from "node:readline";
import { recordArtifact, scaffoldArtifact } from "../core/artifacts.js";
import { DevFlowError } from "../core/errors.js";
import { featureCheck, finalize, recordStep } from "../core/feature-check.js";
import { confirmGate, presentGate } from "../core/human-gates.js";
import { initProject, readState, startFeature, abandonFeature, reclassifyFeature, switchActive } from "../core/state-store.js";
import { nextAction } from "../core/next.js";
import { runVerification } from "../core/verification.js";
import { selectRoute } from "../policy/route.js";
import { collectDoctorReport } from "./doctor.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = process.cwd();
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.basename(moduleDirectory) === "dist" ? path.resolve(moduleDirectory, "..") : path.resolve(moduleDirectory, "../..");
const tools = ["dev_flow_init_project", "dev_flow_classify", "dev_flow_start", "dev_flow_status", "dev_flow_next", "dev_flow_switch_active", "dev_flow_scaffold_artifact", "dev_flow_record_artifact", "dev_flow_record_step", "dev_flow_present_gate", "dev_flow_confirm_gate", "dev_flow_reclassify", "dev_flow_verify", "dev_flow_feature_check", "dev_flow_finalize", "dev_flow_abandon", "dev_flow_doctor"];
const object = (required: string[], properties: Record<string, unknown> = {}) => ({ type: "object", required, properties, additionalProperties: false });
const string = { type: "string", minLength: 1 };
const integer = { type: "integer", minimum: 0 };
const featureMutation = (extra: Record<string, unknown> = {}) => object(["featureId", "expectedRevision"], { featureId: string, expectedRevision: integer, ...extra });
const toolSchemas: Record<string, { description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }> = {
  dev_flow_init_project: { description: "Create strict project configuration.", inputSchema: object(["config"], { config: { type: "object" } }) },
  dev_flow_classify: { description: "Pure route classification.", inputSchema: object(["level", "topology"], { level: { enum: ["XS", "S", "M", "L"] }, topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] }, execution: { enum: ["light", "standard"] }, requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] }, riskLabels: { type: "array" } }), annotations: { readOnlyHint: true } },
  dev_flow_start: { description: "Create a classified feature.", inputSchema: object(["level", "topology"], { level: { enum: ["XS", "S", "M", "L"] }, topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] }, execution: { enum: ["light", "standard"] }, requirements: { type: "string" }, riskLabels: { type: "array" }, featureId: string, activation: { enum: ["active", "paused"] }, scope: { type: "object" }, host: { enum: ["claude", "codex"] } }) },
  dev_flow_status: { description: "Read one feature state.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_next: { description: "Return the unique allowed next action.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_switch_active: { description: "Atomically hand off the single active feature.", inputSchema: object(["fromFeatureId", "toFeatureId", "reason"], { fromFeatureId: string, toFeatureId: string, reason: string }) },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_step: { description: "Record the current non-gate route step.", inputSchema: featureMutation({ step: string, evidence: {} }) },
  dev_flow_present_gate: { description: "Present a strict human gate.", inputSchema: featureMutation({ gate: { enum: ["requirement_confirmation", "implementation_approval"] } }) },
  dev_flow_confirm_gate: { description: "Confirm a presented gate with later user evidence.", inputSchema: featureMutation({ gate: { enum: ["requirement_confirmation", "implementation_approval"] }, userReply: string, promptEventId: string, turnBoundaryEventId: string, host: { enum: ["claude", "codex"] } }) },
  dev_flow_reclassify: { description: "Monotonically increase route strictness.", inputSchema: featureMutation({ classification: { type: "object" }, reason: string }) },
  dev_flow_verify: { description: "Run only configured verification commands.", inputSchema: featureMutation({ commandIds: { type: "array", items: string }, host: { enum: ["claude", "codex"] } }) },
  dev_flow_feature_check: { description: "Check route completeness and fresh evidence.", inputSchema: featureMutation() },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
  dev_flow_abandon: { description: "Terminally abandon a non-finalized feature.", inputSchema: featureMutation({ reason: string, userEvidence: string }) },
  dev_flow_doctor: { description: "Diagnose plugin and project wiring.", inputSchema: object([]), annotations: { readOnlyHint: true } },
};
function result(id: unknown, value: unknown) { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } })}\n`); }
function failure(id: unknown, error: unknown) { const value = error instanceof DevFlowError ? { code: error.code, message: error.message, details: error.details } : { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) }; process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: value.message, data: value } })}\n`); }
async function call(name: string, a: any) { switch (name) {
  case "dev_flow_init_project": return initProject(root, a.config);
  case "dev_flow_classify": return selectRoute(a);
  case "dev_flow_start": return startFeature(root, { ...a, host: a.host ?? "codex" });
  case "dev_flow_status": return readState(root, a.featureId);
  case "dev_flow_next": return nextAction(root, a.featureId);
  case "dev_flow_switch_active": return switchActive(root, a.fromFeatureId, a.toFeatureId, a.reason);
  case "dev_flow_scaffold_artifact": return scaffoldArtifact(root, a.featureId, a.expectedRevision, a.kind);
  case "dev_flow_record_artifact": return recordArtifact(root, a.featureId, a.expectedRevision, a.kind);
  case "dev_flow_record_step": return recordStep(root, a.featureId, a.expectedRevision, a.step, a.evidence);
  case "dev_flow_present_gate": return presentGate(root, a.featureId, a.expectedRevision, a.gate);
  case "dev_flow_confirm_gate": return confirmGate(root, a.featureId, a.expectedRevision, a.gate, a.userReply, { promptEventId: a.promptEventId, turnBoundaryEventId: a.turnBoundaryEventId }, a.host ?? "codex");
  case "dev_flow_reclassify": return reclassifyFeature(root, a.featureId, a.expectedRevision, a.classification, a.reason);
  case "dev_flow_verify": return runVerification(root, a.featureId, a.expectedRevision, a.host ?? "codex", a.commandIds);
  case "dev_flow_feature_check": return featureCheck(root, a.featureId, a.expectedRevision);
  case "dev_flow_finalize": return finalize(root, a.featureId, a.expectedRevision);
  case "dev_flow_abandon": return abandonFeature(root, a.featureId, a.expectedRevision, a.reason, a.userEvidence);
  case "dev_flow_doctor": return collectDoctorReport(root, pluginRoot, __DEV_FLOW_VERSION__, tools);
  default: throw new DevFlowError("UNKNOWN_TOOL", name);
} }
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) { let message: { id?: unknown; method?: string; params?: any } = {}; try { message = JSON.parse(line); if (message.method === "initialize") result(message.id, { protocolVersion: "2024-11-05", serverInfo: { name: "dev-flow", version: __DEV_FLOW_VERSION__ }, capabilities: { tools: {} }, instructions: "Classify before starting. Call dev_flow_next and execute exactly one returned action. Stop after presenting a HUMAN GATE." }); else if (message.method === "tools/list") result(message.id, { tools: tools.map((name) => ({ name, ...toolSchemas[name] })) }); else if (message.method === "tools/call") result(message.id, await call(message.params.name, message.params.arguments ?? {})); } catch (error) { failure(message.id, error); } }
