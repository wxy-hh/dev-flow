import { createHash } from "node:crypto";
import { routeDefinition } from "../policy/contract.js";
import { DevFlowError } from "./errors.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { artifactsRequiredBeforeGate, assertCurrentStep } from "./step-order.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const gates = new Set(["requirement_confirmation", "implementation_approval"]);
function gateBasis(state: FeatureState, gate: string) {
  if (gate === "requirement_confirmation") return { route: state.route, scope: state.scope, requirements: state.artifacts.requirements, classification: state.classification };
  return { route: state.route, scope: state.scope, classification: state.classification, plan: state.artifacts["implementation-plan"], coverage: state.artifacts["coverage-matrix"], rollback: state.artifacts["rollback-units"] ?? state.artifacts["rollback-safety"], risk: state.artifacts["risk-card"], boundary: state.artifacts["boundary-card"] };
}
export async function presentGate(root: string, id: string, expectedRevision: number, gate: string): Promise<FeatureState> { if (!gates.has(gate)) throw new DevFlowError("INVALID_GATE", gate); return mutate(root, id, expectedRevision, "gate-presented", async (state) => { if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "gate requires active feature"); if (!routeDefinition(state.route).orderedSteps.includes(gate)) throw new DevFlowError("INVALID_GATE", gate); if (state.humanGates[gate]) throw new DevFlowError("HUMAN_GATE_ALREADY_PRESENTED", gate); assertCurrentStep(state, gate); const missing = artifactsRequiredBeforeGate(state, gate).find((kind) => !state.artifacts[kind]); if (missing) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", missing); await assertRequirementsGrillSatisfied(root, id, state); state.humanGates[gate] = { status: "pending", presentedRevision: state.revision, presentedAt: new Date().toISOString(), basisHash: digest(gateBasis(state, gate)) }; }); }
export async function confirmGate(root: string, id: string, expectedRevision: number, gate: string, userReply: string, provenance: { promptEventId?: string; turnBoundaryEventId?: string }, host: "claude" | "codex"): Promise<FeatureState> {
  if (!gates.has(gate)) throw new DevFlowError("INVALID_GATE", gate); if (!userReply.trim()) throw new DevFlowError("HUMAN_GATE_REPLY_REQUIRED", "userReply is required"); if (!provenance.promptEventId && !provenance.turnBoundaryEventId) throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "a post-presentation prompt or turn boundary is required");
  const marker = provenance.promptEventId ?? provenance.turnBoundaryEventId; if (!marker) throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "a post-presentation prompt or turn boundary is required");
  const events = await readFeatureEvents(root, id);
  return mutate(root, id, expectedRevision, "gate-confirmed", async (state) => {
    await assertRequirementsGrillSatisfied(root, id, state);
    const current = state.humanGates[gate] as { status?: string; basisHash?: string; presentedRevision?: number; presentedAt?: string } | undefined;
    if (current?.status !== "pending") throw new DevFlowError("HUMAN_GATE_NOT_PENDING", gate); if ((current.presentedRevision ?? state.revision) >= state.revision) throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation must occur after presentation");
    const eventRecord = events.find((item) => item.type === "host-event" && (item.data as { eventId?: string }).eventId === marker); const event = eventRecord?.data as { type?: string; text?: string; at?: string } | undefined;
    if (!event || !current.presentedAt || (eventRecord?.revision ?? -1) <= (current.presentedRevision ?? -1) || Date.parse(event.at ?? "") < Date.parse(current.presentedAt)) throw new DevFlowError("HUMAN_GATE_SAME_TURN", "confirmation evidence must be later than gate presentation");
    if (provenance.promptEventId && (event.type !== "user-prompt" || event.text !== userReply)) throw new DevFlowError("HUMAN_GATE_REPLY_MISMATCH", "userReply must match the captured prompt");
    if (provenance.turnBoundaryEventId && event.type !== "turn-boundary") throw new DevFlowError("HUMAN_GATE_PROVENANCE_UNAVAILABLE", "turn boundary was not captured");
    for (const [otherGate, value] of Object.entries(state.humanGates)) if (otherGate !== gate && (value as { confirmation?: { promptEventId?: string; turnBoundaryEventId?: string } }).confirmation && Object.values((value as { confirmation: { promptEventId?: string; turnBoundaryEventId?: string } }).confirmation).includes(marker)) throw new DevFlowError("HUMAN_GATE_EVENT_CONSUMED", String(marker));
    const basisHash = digest(gateBasis(state, gate)); if (basisHash !== current.basisHash) throw new DevFlowError("HUMAN_GATE_BASIS_CHANGED", gate);
    state.humanGates[gate] = { ...current, status: "confirmed", confirmation: { userReply, ...provenance, host, confirmedAt: new Date().toISOString() } }; state.steps[gate] = { status: "satisfied" }; state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  });
}
