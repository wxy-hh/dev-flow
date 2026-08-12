import type { RouteId } from "../policy/types.js";
import type {
  AcceptanceCriterionId,
  ImplementationUnitId,
  RequirementId,
  RollbackId,
  RollbackNode,
  TaskId,
  TestId,
  TraceArtifactKind,
  TraceDelta,
  TraceEdge,
  TraceId,
  TraceNode,
  TraceNodeInput,
  TraceSummary,
  TraceabilityLedger,
  VerificationCommandRef,
  VerificationDisposition,
} from "../policy/traceability.js";
import type { TraceSourceBlock } from "./traceability-anchors.js";
import { DevFlowError } from "./errors.js";
import { isSafeFileScopePattern } from "../policy/rollback.js";
import { normalizeProjectPath, normalizeUnicode } from "./path-normalization.js";

export const ALLOWED_TRACE_KINDS = {
  requirements: ["requirement", "acceptance-criterion"],
  // The implementation plan is the single editable source for the execution
  // graph. Recovery is explicit and never implied by an implementation unit.
  "implementation-plan": ["task", "test", "implementation-unit", "recovery"],
  "coverage-matrix": ["test"],
  "rollback-units": ["rollback"],
} as const;

export interface ApplyTraceDeltaInput {
  current: TraceabilityLedger;
  route: RouteId;
  artifactKind: TraceArtifactKind;
  artifactSha256: string;
  sourceBlocks: TraceSourceBlock[];
  delta: TraceDelta;
  projectConfigSha256: string;
  verificationCommandIds: string[];
  verificationCommandHashes?: Record<string, string>;
  nextStateRevision: number;
}

export interface TraceGraphValidationOptions {
  /**
   * Reserved for a same-source replacement of a legacy snapshot produced
   * before fileScope admission was enforced. Normal readers never set it.
   */
  allowUnsafeFileScopeSourceArtifact?: "implementation-plan" | "rollback-units";
}

const inputKeys: Record<TraceNodeInput["kind"], readonly string[]> = {
  requirement: ["kind", "id"],
  "acceptance-criterion": ["kind", "id", "parentRequirement", "verificationDisposition"],
  task: ["kind", "id", "covers", "implementationUnit", "tdd"],
  test: ["kind", "id", "verifies"],
  rollback: ["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"],
  "implementation-unit": ["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification"],
  recovery: ["kind", "id", "stepRef", "recoveryKind", "method", "riskRef"],
};
const idPrefix: Record<TraceNodeInput["kind"], string> = {
  requirement: "REQ",
  "acceptance-criterion": "AC",
  task: "TASK",
  test: "TEST",
  "implementation-unit": "UNIT",
  rollback: "RU",
  recovery: "REC",
};

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError("TRACE_GRAPH_INVALID", message, details);
}

function sliceError(code: "TRACE_SLICE_INCOMPLETE" | "TRACE_SLICE_STALE", message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError(code, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((item) => typeof item === "string" && item.length > 0);
}

function isSafeCommandCwd(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/")
    && !/^[A-Za-z]:[\\/]/.test(value) && !value.split(/[\\/]+/).includes("..");
}

function isVerificationCommandRef(value: unknown): value is VerificationCommandRef {
  if (typeof value === "string") return value.length > 0;
  if (!isRecord(value) || Object.keys(value).some((key) => !["command", "args", "cwd"].includes(key))
    || typeof value.command !== "string" || !value.command.trim()
    || (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string")))
    || (value.cwd !== undefined && !isSafeCommandCwd(value.cwd))) return false;
  return true;
}

function isVerificationCommandArray(value: unknown): value is VerificationCommandRef[] {
  return Array.isArray(value) && value.length > 0 && value.every(isVerificationCommandRef);
}

function verificationCommandKey(value: VerificationCommandRef): string {
  return typeof value === "string" ? `id:${value}` : `inline:${JSON.stringify(value)}`;
}

function assertId(kind: TraceNodeInput["kind"], id: unknown): asserts id is TraceId {
  if (typeof id !== "string" || !new RegExp(`^${idPrefix[kind]}-[0-9]{3,}$`).test(id)) {
    invalid("node ID does not match its kind", { kind, id });
  }
}

function assertNoDuplicate(values: string[], field: string, id: string): void {
  if (new Set(values).size !== values.length) invalid("node relationship contains duplicates", { field, id });
}

function assertSafeFileScope(fileScope: string[], id: string, persisted = false): void {
  for (const pattern of fileScope) {
    if (persisted && pattern !== normalizeUnicode(pattern)) {
      invalid("persisted rollback fileScope must use Unicode NFC", { id, field: "fileScope", pattern });
    }
    if (!isSafeFileScopePattern(pattern)) {
      invalid(persisted ? "persisted rollback fileScope is unsafe" : "rollback fileScope is unsafe", { id, field: "fileScope", pattern });
    }
  }
}

const dispositionKinds = new Set(["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"]);

function validateVerificationDisposition(value: unknown, id: string): asserts value is VerificationDisposition {
  if (!isRecord(value) || Object.keys(value).some((key) => !["kind", "reason", "target"].includes(key))
    || typeof value.kind !== "string" || !dispositionKinds.has(value.kind)) {
    invalid("acceptance-criterion verificationDisposition is invalid", { id });
  }
  if (value.kind !== "behavior-test") {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      invalid("non-behavior verification disposition requires a non-empty reason", { id });
    }
    if (value.target !== undefined && (typeof value.target !== "string" || !value.target.trim())) {
      invalid("verification disposition target must be a non-empty string", { id });
    }
  } else if (value.reason !== undefined && typeof value.reason !== "string") {
    invalid("verification disposition reason must be a string", { id });
  }
}

function validateNodeInput(value: unknown): asserts value is TraceNodeInput {
  if (!isRecord(value) || typeof value.kind !== "string" || !(value.kind in inputKeys)) invalid("node input has an unknown kind");
  const kind = value.kind as TraceNodeInput["kind"];
  const keys = Object.keys(value);
  if (keys.some((key) => !inputKeys[kind].includes(key))) invalid("node input contains Core-owned or unknown fields", { kind, keys });
  assertId(kind, value.id);
  if (kind === "acceptance-criterion") {
    assertId("requirement", value.parentRequirement);
    if (value.verificationDisposition !== undefined) validateVerificationDisposition(value.verificationDisposition, value.id as string);
  }
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid("task covers must be a non-empty string array", { id: value.id });
    assertNoDuplicate(value.covers, "covers", value.id as string);
    assertId("implementation-unit", value.implementationUnit);
    if (value.tdd !== undefined && value.tdd !== "test-first" && value.tdd !== "direct") {
      invalid("task tdd must be test-first or direct", { id: value.id });
    }
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid("test verifies must be a non-empty string array", { id: value.id });
    assertNoDuplicate(value.verifies, "verifies", value.id as string);
    for (const id of value.verifies) assertId("acceptance-criterion", id);
  }
  if (kind === "rollback") {
    const rollback = value as unknown as Extract<TraceNodeInput, { kind: "rollback" }>;
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false], ["forwardVerification", false], ["rollbackVerification", false]] as const) {
      const relationship = field === "forwardVerification" || field === "rollbackVerification"
        ? value[field]
        : value[field];
      if (field === "forwardVerification" || field === "rollbackVerification") {
        if (!isVerificationCommandArray(relationship)) invalid("rollback verification must be a non-empty command array", { field, id: value.id });
        const keys = (relationship as VerificationCommandRef[]).map(verificationCommandKey);
        assertNoDuplicate(keys, field, value.id as string);
      } else {
        if (!isStringArray(relationship, allowEmpty)) invalid("rollback relationship must be a string array", { field, id: value.id });
        assertNoDuplicate(relationship as string[], field, value.id as string);
      }
    }
    for (const id of rollback.tasks) assertId("task", id);
    for (const id of rollback.dependsOn) assertId("rollback", id);
    assertSafeFileScope(rollback.fileScope, value.id as string);
  }
  if (kind === "implementation-unit") {
    const unit = value as unknown as Extract<TraceNodeInput, { kind: "implementation-unit" }>;
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false]] as const) {
      const relationship = unit[field];
      if (!isStringArray(relationship, allowEmpty)) invalid("implementation unit relationship must be a string array", { field, id: value.id });
      assertNoDuplicate(relationship, field, value.id as string);
    }
    if (!isVerificationCommandArray(unit.forwardVerification)) invalid("implementation unit forwardVerification must be a non-empty command array", { id: value.id });
    assertNoDuplicate(unit.forwardVerification.map(verificationCommandKey), "forwardVerification", value.id as string);
    for (const id of unit.tasks) assertId("task", id);
    for (const id of unit.dependsOn) assertId("implementation-unit", id);
    assertSafeFileScope(unit.fileScope, value.id as string);
  }
  if (kind === "recovery") {
    const recovery = value as unknown as Extract<TraceNodeInput, { kind: "recovery" }>;
    if (recovery.recoveryKind !== "rollback" && recovery.recoveryKind !== "compensation") {
      invalid("recovery recoveryKind must be rollback or compensation", { id: value.id });
    }
    if (typeof recovery.method !== "string" || !recovery.method.trim()) {
      invalid("recovery method must be a non-empty string", { id: value.id });
    }
    if (typeof recovery.riskRef !== "string" || !recovery.riskRef.trim()) {
      invalid("recovery riskRef must be a non-empty string", { id: value.id });
    }
    if (typeof recovery.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(recovery.stepRef)) {
      invalid("recovery stepRef must reference an implementation unit or task", { id: value.id, stepRef: recovery.stepRef });
    }
  }
}

export function validateTraceDelta(value: unknown): asserts value is TraceDelta {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.nodes)) invalid("Trace delta must contain only nodes");
  const ids = new Set<string>();
  for (const node of value.nodes) {
    validateNodeInput(node);
    if (ids.has(node.id)) invalid("Trace delta declares an ID more than once", { id: node.id });
    ids.add(node.id);
  }
}

/** Normalize path-bearing trace fields without weakening the safety contract. */
function normalizeTraceDelta(value: TraceDelta): TraceDelta {
  return {
    nodes: value.nodes.map((node) => node.kind === "rollback"
      ? {
          ...node,
          fileScope: node.fileScope.map(normalizeUnicode),
          forwardVerification: node.forwardVerification.map(normalizeVerificationCommandRef),
          rollbackVerification: node.rollbackVerification.map(normalizeVerificationCommandRef),
        }
      : node),
  };
}

function normalizeVerificationCommandRef(value: VerificationCommandRef): VerificationCommandRef {
  if (typeof value === "string") return value;
  return {
    command: value.command,
    ...(value.args ? { args: [...value.args] } : {}),
    ...(value.cwd ? { cwd: normalizeProjectPath(value.cwd) } : {}),
  };
}

function currentNodes(nodes: Record<string, TraceNode>): TraceNode[] {
  return Object.values(nodes).filter((node) => node.status !== "tombstoned");
}

function nodeById(nodes: Record<string, TraceNode>, id: string): TraceNode | undefined {
  const node = nodes[id];
  return node?.status === "tombstoned" ? undefined : node;
}

function sourceFor(input: ApplyTraceDeltaInput, node: TraceNodeInput, source: TraceSourceBlock): TraceNode {
  const common = {
    sourceArtifact: input.artifactKind,
    sourceSha256: input.artifactSha256,
    sourceAnchor: source.sourceAnchor,
    sourceBlockSha256: source.sourceBlockSha256,
    status: "current" as const,
  };
  switch (node.kind) {
    case "requirement": return { ...common, kind: node.kind, id: node.id };
    case "acceptance-criterion": return {
      ...common,
      kind: node.kind,
      id: node.id,
      parentRequirement: node.parentRequirement,
      ...(node.verificationDisposition ? { verificationDisposition: { ...node.verificationDisposition } } : {}),
    };
    case "task": return {
      ...common,
      kind: node.kind,
      id: node.id,
      covers: [...node.covers],
      implementationUnit: node.implementationUnit,
      ...(node.tdd ? { tdd: node.tdd } : {}),
    };
    case "test": return { ...common, kind: node.kind, id: node.id, verifies: [...node.verifies] };
    case "rollback": return {
      ...common,
      kind: node.kind,
      id: node.id,
      tasks: [...node.tasks],
      dependsOn: [...node.dependsOn],
      fileScope: [...node.fileScope],
      covers: [...node.covers],
       forwardVerification: node.forwardVerification.map(normalizeVerificationCommandRef),
       rollbackVerification: node.rollbackVerification.map(normalizeVerificationCommandRef),
      sourceArtifact: "rollback-units",
      verificationConfigSha256: input.projectConfigSha256,
    };
    case "implementation-unit": return {
      ...common,
      kind: node.kind,
      id: node.id,
      tasks: [...node.tasks],
      dependsOn: [...node.dependsOn],
      fileScope: node.fileScope.map(normalizeUnicode),
      covers: [...node.covers],
      forwardVerification: node.forwardVerification.map(normalizeVerificationCommandRef),
      sourceArtifact: "implementation-plan",
      verificationConfigSha256: input.projectConfigSha256,
    };
    case "recovery": return {
      ...common,
      kind: node.kind,
      id: node.id,
      stepRef: node.stepRef,
      recoveryKind: node.recoveryKind,
      method: node.method,
      riskRef: node.riskRef,
    };
  }
}

function inputMeaning(node: TraceNodeInput): string {
  return JSON.stringify(node);
}

function nodeMeaning(node: TraceNode): string {
  switch (node.kind) {
    case "requirement": return JSON.stringify({ kind: node.kind, id: node.id });
    case "acceptance-criterion": return JSON.stringify({ kind: node.kind, id: node.id, parentRequirement: node.parentRequirement, ...(node.verificationDisposition ? { verificationDisposition: node.verificationDisposition } : {}) });
    case "task": return JSON.stringify({ kind: node.kind, id: node.id, covers: node.covers, implementationUnit: node.implementationUnit, ...(node.tdd ? { tdd: node.tdd } : {}) });
    case "test": return JSON.stringify({ kind: node.kind, id: node.id, verifies: node.verifies });
    case "rollback": return JSON.stringify({ kind: node.kind, id: node.id, tasks: node.tasks, dependsOn: node.dependsOn, fileScope: node.fileScope, covers: node.covers, forwardVerification: node.forwardVerification, rollbackVerification: node.rollbackVerification });
    case "implementation-unit": return JSON.stringify({ kind: node.kind, id: node.id, tasks: node.tasks, dependsOn: node.dependsOn, fileScope: node.fileScope, covers: node.covers, forwardVerification: node.forwardVerification });
    case "recovery": return JSON.stringify({ kind: node.kind, id: node.id, stepRef: node.stepRef, recoveryKind: node.recoveryKind, method: node.method, riskRef: node.riskRef });
  }
}

function assertSourceBlocks(input: ApplyTraceDeltaInput): Map<string, TraceSourceBlock> {
  const sourceBlocks = new Map<string, TraceSourceBlock>();
  for (const block of input.sourceBlocks) {
    if (!isRecord(block) || typeof block.id !== "string" || typeof block.kind !== "string" || typeof block.sourceAnchor !== "string" || typeof block.sourceBlockSha256 !== "string") {
      invalid("source block is invalid");
    }
    if (sourceBlocks.has(block.id)) invalid("source block ID is declared more than once", { id: block.id });
    sourceBlocks.set(block.id, block);
  }
  const ids = new Set(input.delta.nodes.map((node) => node.id));
  if (ids.size !== sourceBlocks.size || [...ids].some((id) => !sourceBlocks.has(id))) invalid("source blocks must exactly match delta nodes");
  for (const node of input.delta.nodes) {
    const source = sourceBlocks.get(node.id)!;
    if (source.kind !== node.kind) invalid("source anchor kind does not match delta node", { id: node.id });
  }
  return sourceBlocks;
}

function assertArtifactDeltaContract(input: ApplyTraceDeltaInput): void {
  const allowed = ALLOWED_TRACE_KINDS[input.artifactKind];
  if (input.delta.nodes.some((node) => !allowed.includes(node.kind as never))) invalid("delta kind is not allowed for its artifact", { artifactKind: input.artifactKind });
  const has = (kind: TraceNodeInput["kind"]) => input.delta.nodes.some((node) => node.kind === kind);
  if (input.artifactKind === "implementation-plan" && input.route !== "xs" && (!has("task") || !has("implementation-unit"))) {
    invalid("启用 Trace 的实施计划必须同时包含 task 和 implementation unit");
  }
  if (input.artifactKind === "rollback-units" && input.route !== "l") invalid("独立 rollback-units 工件只适用于 L 级路线");
  for (const node of input.delta.nodes) {
    if (node.kind !== "rollback" && node.kind !== "implementation-unit") continue;
    if (node.kind === "rollback" && !["rollback-units"].includes(input.artifactKind)) invalid("rollback node has an invalid source artifact");
    if (node.kind === "implementation-unit" && input.artifactKind !== "implementation-plan") invalid("implementation unit has an invalid source artifact");
    const verification = node.kind === "rollback"
      ? [...node.forwardVerification, ...node.rollbackVerification]
      : node.forwardVerification;
    if (verification.some((ref) =>
      typeof ref === "string" && !input.verificationCommandIds.includes(ref))) {
      invalid("implementation verification references an unknown command ID", { id: node.id });
    }
  }
}

export function deriveTraceEdges(nodes: Record<string, TraceNode>): TraceEdge[] {
  const edges: TraceEdge[] = [];
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") edges.push({ from: node.id, type: "parent", to: node.parentRequirement });
    if (node.kind === "task") {
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
      edges.push({ from: node.id, type: "implementation-unit", to: node.implementationUnit });
    }
    if (node.kind === "test") for (const target of node.verifies) edges.push({ from: node.id, type: "verifies", to: target });
    if (node.kind === "rollback") {
      for (const target of node.tasks) edges.push({ from: node.id, type: "contains-task", to: target });
      for (const target of node.dependsOn) edges.push({ from: node.id, type: "depends-on", to: target });
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
    }
    if (node.kind === "implementation-unit") {
      for (const target of node.tasks) edges.push({ from: node.id, type: "contains-task", to: target });
      for (const target of node.dependsOn) edges.push({ from: node.id, type: "depends-on", to: target });
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
    }
  }
  return edges.sort((a, b) => `${a.from}\u0000${a.type}\u0000${a.to}`.localeCompare(`${b.from}\u0000${b.type}\u0000${b.to}`));
}

export function traceSummary(nodes: Record<string, TraceNode>): TraceSummary {
  const values = Object.values(nodes);
  return {
    total: values.length,
    current: values.filter((node) => node.status === "current").length,
    stale: values.filter((node) => node.status === "stale").length,
    tombstoned: values.filter((node) => node.status === "tombstoned").length,
  };
}

function assertReference(nodes: Record<string, TraceNode>, id: string, kinds: TraceNode["kind"][], details: Record<string, unknown>): TraceNode {
  const node = nodeById(nodes, id);
  if (!node || !kinds.includes(node.kind)) invalid("graph reference is missing or has the wrong kind", { id, ...details });
  return node;
}

function assertRollbackDag(nodes: Record<string, TraceNode>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid("rollback dependency graph contains a cycle", { id });
    visiting.add(id);
    const node = nodeById(nodes, id);
    if (node?.kind === "rollback") for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const node of currentNodes(nodes)) if (node.kind === "rollback") visit(node.id);
}

function assertImplementationDag(nodes: Record<string, TraceNode>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid("implementation unit dependency graph contains a cycle", { id });
    visiting.add(id);
    const node = nodeById(nodes, id);
    if (node?.kind === "implementation-unit") for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const node of currentNodes(nodes)) if (node.kind === "implementation-unit") visit(node.id);
}

function sameEdges(left: TraceEdge[], right: TraceEdge[]): boolean {
  return left.length === right.length && left.every((edge, index) => {
    const candidate = right[index];
    return edge.from === candidate?.from && edge.type === candidate.type && edge.to === candidate.to;
  });
}

function sameSummary(left: TraceSummary, right: TraceSummary): boolean {
  return left.total === right.total
    && left.current === right.current
    && left.stale === right.stale
    && left.tombstoned === right.tombstoned;
}

const statusValues = new Set(["current", "stale", "tombstoned"]);
const sourceArtifacts = new Set(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);
const hex64 = /^[a-f0-9]{64}$/;

function assertPersistedNode(
  recordId: string,
  value: unknown,
  options: TraceGraphValidationOptions,
): asserts value is TraceNode {
  if (!isRecord(value)) invalid("persisted node is not an object", { id: recordId });
  const kind = value.kind;
  if (typeof kind !== "string" || !(kind in idPrefix)) invalid("persisted node has an unknown kind", { id: recordId, kind });
  assertId(kind as TraceNodeInput["kind"], value.id);
  if (value.id !== recordId) invalid("persisted node id does not match its record key", { id: recordId, nodeId: value.id });
  if (!statusValues.has(value.status as string)) invalid("persisted node has an invalid status", { id: recordId, status: value.status });
  if (typeof value.sourceArtifact !== "string" || !sourceArtifacts.has(value.sourceArtifact)) {
    invalid("persisted node has an invalid sourceArtifact", { id: recordId, sourceArtifact: value.sourceArtifact });
  }
  if (typeof value.sourceSha256 !== "string" || !hex64.test(value.sourceSha256)) {
    invalid("persisted node has an invalid sourceSha256", { id: recordId });
  }
  if (typeof value.sourceAnchor !== "string" || !value.sourceAnchor.includes(`id=${value.id}`)) {
    invalid("persisted node has an invalid sourceAnchor", { id: recordId });
  }
  if (typeof value.sourceBlockSha256 !== "string" || !hex64.test(value.sourceBlockSha256)) {
    invalid("persisted node has an invalid sourceBlockSha256", { id: recordId });
  }
  if (kind === "acceptance-criterion") {
    assertId("requirement", value.parentRequirement);
    if (value.verificationDisposition !== undefined) validateVerificationDisposition(value.verificationDisposition, recordId);
  }
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid("persisted task covers is invalid", { id: recordId });
    assertId("implementation-unit", value.implementationUnit);
    if (value.tdd !== undefined && value.tdd !== "test-first" && value.tdd !== "direct") {
      invalid("persisted task tdd is invalid", { id: recordId });
    }
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid("persisted test verifies is invalid", { id: recordId });
  }
  if (kind === "recovery") {
    if (typeof value.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(value.stepRef)) invalid("persisted recovery stepRef is invalid", { id: recordId });
    if (value.recoveryKind !== "rollback" && value.recoveryKind !== "compensation") invalid("persisted recovery recoveryKind is invalid", { id: recordId });
    if (typeof value.method !== "string" || !value.method.trim()) invalid("persisted recovery method is invalid", { id: recordId });
    if (typeof value.riskRef !== "string" || !value.riskRef.trim()) invalid("persisted recovery riskRef is invalid", { id: recordId });
  }
  if (kind === "rollback") {
    for (const [field, allowEmpty] of [["tasks", false], ["dependsOn", true], ["fileScope", false], ["covers", false], ["forwardVerification", false], ["rollbackVerification", false]] as const) {
      if (field === "forwardVerification" || field === "rollbackVerification") {
        if (!isVerificationCommandArray(value[field])) invalid("persisted rollback verification field is invalid", { id: recordId, field });
      } else if (!isStringArray(value[field], allowEmpty)) {
        invalid("persisted rollback field is invalid", { id: recordId, field });
      }
    }
    if (value.sourceArtifact !== "implementation-plan" && value.sourceArtifact !== "rollback-units") {
      invalid("persisted rollback has an invalid sourceArtifact", { id: recordId });
    }
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) {
      invalid("persisted rollback has an invalid verificationConfigSha256", { id: recordId });
    }
    const allowLegacyRepair = value.status !== "tombstoned"
      && value.sourceArtifact === options.allowUnsafeFileScopeSourceArtifact;
    if (value.status !== "tombstoned" && !allowLegacyRepair) {
      assertSafeFileScope(value.fileScope as string[], recordId, true);
    }
  }
  if (kind === "implementation-unit") {
    if (!isStringArray(value.tasks) || !isStringArray(value.dependsOn, true) || !isStringArray(value.fileScope) || !isStringArray(value.covers) || !isVerificationCommandArray(value.forwardVerification)) {
      invalid("persisted implementation unit fields are invalid", { id: recordId });
    }
    for (const taskId of value.tasks as string[]) assertId("task", taskId);
    for (const dependency of value.dependsOn as string[]) assertId("implementation-unit", dependency);
    assertSafeFileScope(value.fileScope as string[], recordId, true);
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) invalid("persisted implementation unit verification configuration is invalid", { id: recordId });
  }
}

/** 一条 AC 是否具有有效验证覆盖：被当前 TEST verifies，或携带非行为验证处置。 */
export function acceptanceCriterionCovered(
  nodes: Record<string, TraceNode>,
  node: Extract<TraceNode, { kind: "acceptance-criterion" }>,
): boolean {
  if (currentNodes(nodes).some((candidate) => candidate.kind === "test" && candidate.verifies.includes(node.id))) return true;
  const disposition = node.verificationDisposition;
  if (!disposition) return false;
  if (disposition.kind === "behavior-test") return false; // 行为测试必须有真实 TEST 节点
  return Boolean(disposition.reason?.trim());
}

function assertPersistedLedgerShape(ledger: TraceabilityLedger, options: TraceGraphValidationOptions): void {
  if (typeof ledger.featureId !== "string" || !ledger.featureId) invalid("ledger featureId is invalid");
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) invalid("ledger revision is invalid");
  if (!Number.isInteger(ledger.stateRevision) || ledger.stateRevision < 0) invalid("ledger stateRevision is invalid");
  if (typeof ledger.projectConfigSha256 !== "string" || !hex64.test(ledger.projectConfigSha256)) {
    invalid("ledger projectConfigSha256 is invalid");
  }
  if (ledger.verificationCommandHashes !== undefined && (!isRecord(ledger.verificationCommandHashes)
    || Object.values(ledger.verificationCommandHashes).some((value) => typeof value !== "string" || !hex64.test(value)))) {
    invalid("ledger verification command hashes are invalid");
  }
  for (const [id, node] of Object.entries(ledger.nodes)) assertPersistedNode(id, node, options);
}

export function validateTraceGraph(
  ledger: TraceabilityLedger,
  route: RouteId,
  mode: "partial" | "complete",
  options: TraceGraphValidationOptions = {},
): void {
  if (!isRecord(ledger) || ledger.schemaVersion !== 1 || !isRecord(ledger.nodes) || !Array.isArray(ledger.edges)) invalid("traceability ledger has an invalid shape");
  assertPersistedLedgerShape(ledger as TraceabilityLedger, options);
  const nodes = ledger.nodes as Record<string, TraceNode>;
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") assertReference(nodes, node.parentRequirement, ["requirement"], { from: node.id });
    if (node.kind === "task") {
      if (node.covers.length === 0) invalid("task cannot be orphaned", { id: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
      const unit = nodeById(nodes, node.implementationUnit);
      if (!unit && !(route === "l" && mode === "partial")) invalid("task references a missing implementation unit", { id: node.id, implementationUnit: node.implementationUnit });
      if (unit && unit.kind !== "implementation-unit") invalid("task implementation unit has the wrong kind", { id: node.id });
      if (unit?.kind === "implementation-unit" && !unit.tasks.includes(node.id)) {
        invalid("implementation unit must list the task", { id: node.id, implementationUnit: node.implementationUnit });
      }
    }
    if (node.kind === "test") for (const verified of node.verifies) assertReference(nodes, verified, ["acceptance-criterion"], { from: node.id });
    if (node.kind === "rollback") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task") invalid("rollback arrangement task reference is invalid", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["rollback"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
    if (node.kind === "implementation-unit") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task" || task.implementationUnit !== node.id) invalid("implementation unit tasks must be symmetric with task implementationUnit", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["implementation-unit"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
    if (node.kind === "recovery") {
      // 恢复安排必须引用存在的高风险步骤；恢复安排本身不提供工作范围或回撤执行。
      assertReference(nodes, node.stepRef, ["implementation-unit", "task"], { from: node.id });
    }
  }
  assertRollbackDag(nodes);
  assertImplementationDag(nodes);
  const edges = deriveTraceEdges(nodes);
  if (!sameEdges(ledger.edges, edges)) invalid("ledger edges do not match nodes");
  if (!sameSummary(ledger.summary, traceSummary(nodes))) invalid("ledger summary does not match nodes");
  if (mode === "complete") {
    const kinds = new Set(currentNodes(nodes).map((node) => node.kind));
    // TEST 不是完整图的必需节点（ADR-0011）：验证处置可以是行为测试之外的类型/
    // 规则检查、文件核对或人工验收，纯文档/配置/机械任务不需要形式 TEST。需要
    // 行为测试覆盖的 AC 由下方逐项验收条件检查强制（无处置或 behavior-test 处置
    // 必须被真实 TEST 节点 verifies），不依赖节点种类存在性。
    for (const kind of ["requirement", "acceptance-criterion", "task", "implementation-unit"] as const) if (!kinds.has(kind)) invalid("complete graph is missing a required node kind", { kind });
    if (currentNodes(nodes).some((node) => node.status !== "current")) invalid("complete graph cannot contain stale nodes");
    for (const node of currentNodes(nodes)) {
      if (node.kind === "acceptance-criterion" && !acceptanceCriterionCovered(nodes, node)) {
        invalid("every acceptance criterion requires a test or an explicit verification disposition", { id: node.id });
      }
    }
  }
}

function downstream(
  nodes: Record<string, TraceNode>,
  changed: Set<string>,
  protectedIds: Set<string> = new Set(),
): void {
  const reverse = new Map<string, string[]>();
  for (const edge of deriveTraceEdges(nodes)) {
    const items = reverse.get(edge.to) ?? [];
    items.push(edge.from); reverse.set(edge.to, items);
  }
  const queue = [...changed]; const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    for (const dependent of reverse.get(id) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent); queue.push(dependent);
      // Nodes rewritten in the same complete replacement stay current unless their own fields changed.
      if (protectedIds.has(dependent)) continue;
      const node = nodes[dependent];
      if (node && node.status !== "tombstoned") node.status = "stale";
    }
  }
}

export function emptyTraceabilityLedger(featureId: string, stateRevision: number, projectConfigSha256: string): TraceabilityLedger {
  return { schemaVersion: 1, featureId, revision: 0, stateRevision, projectConfigSha256, nodes: {}, edges: [], summary: { total: 0, current: 0, stale: 0, tombstoned: 0 } };
}

export function applyTraceDelta(input: ApplyTraceDeltaInput, options: { validateGraph?: boolean } = {}): TraceabilityLedger {
  const effectiveInput = { ...input, delta: normalizeTraceDelta(input.delta) };
  validateTraceDelta(effectiveInput.delta);
  assertArtifactDeltaContract(effectiveInput);
  const sourceBlocks = assertSourceBlocks(effectiveInput);
  const nodes = structuredClone(effectiveInput.current.nodes) as Record<string, TraceNode>;
  const changed = new Set<string>();
  for (const node of effectiveInput.delta.nodes) {
    const previous = nodes[node.id];
    if (previous?.status === "tombstoned") invalid("tombstoned IDs cannot be reused", { id: node.id });
    const next = sourceFor(effectiveInput, node, sourceBlocks.get(node.id)!);
    if (previous && previous.sourceArtifact !== effectiveInput.artifactKind) invalid("node ID already belongs to a different source artifact", { id: node.id });
    // Delta nodes are rebound as current; only dependents outside this replacement become stale.
    if (previous && (previous.sourceBlockSha256 !== next.sourceBlockSha256 || nodeMeaning(previous) !== inputMeaning(node))) changed.add(node.id);
    nodes[node.id] = next;
  }
  const inputIds = new Set(effectiveInput.delta.nodes.map((node) => node.id));
  for (const node of Object.values(nodes)) {
    if (node.sourceArtifact !== effectiveInput.artifactKind || inputIds.has(node.id) || node.status === "tombstoned") continue;
    node.status = "tombstoned"; changed.add(node.id);
  }
  // Protect the full replacement set so co-registered unchanged blocks stay current.
  downstream(nodes, changed, inputIds);
  const ledger: TraceabilityLedger = {
    schemaVersion: 1,
    featureId: effectiveInput.current.featureId,
    revision: effectiveInput.current.revision + 1,
    stateRevision: effectiveInput.nextStateRevision,
    projectConfigSha256: effectiveInput.projectConfigSha256,
    ...(effectiveInput.verificationCommandHashes ? { verificationCommandHashes: { ...effectiveInput.verificationCommandHashes } } : {}),
    nodes,
    edges: deriveTraceEdges(nodes),
    summary: traceSummary(nodes),
  };
  // 图校验默认在 delta 归约内部执行；计划编译需要聚合全部诊断（图错误不能
  // 阻止收集未覆盖 AC 与恢复安排问题），通过 options.validateGraph=false 推迟，
  // 由调用方在收集其他诊断后统一校验并去重。
  if (options.validateGraph !== false) validateTraceGraph(ledger, effectiveInput.route, "partial");
  return ledger;
}

function assertConfigCurrent(ledger: TraceabilityLedger, currentProjectConfigSha256: string, currentCommandHashes?: Record<string, string>): void {
  if (ledger.verificationCommandHashes && currentCommandHashes) {
    const referenced = new Set<string>();
    for (const node of currentNodes(ledger.nodes)) {
      if (node.kind === "implementation-unit") {
        for (const ref of node.forwardVerification) if (typeof ref === "string") referenced.add(ref);
      } else if (node.kind === "rollback") {
        for (const ref of [...node.forwardVerification, ...node.rollbackVerification]) if (typeof ref === "string") referenced.add(ref);
      }
    }
    for (const id of referenced) {
      if (ledger.verificationCommandHashes[id] !== currentCommandHashes[id]) sliceError("TRACE_SLICE_STALE", "referenced verification command changed", { commandId: id });
    }
  } else if (ledger.projectConfigSha256 !== currentProjectConfigSha256) {
    sliceError("TRACE_SLICE_STALE", "project configuration changed since Trace registration");
  }
  for (const node of currentNodes(ledger.nodes)) {
    if ((node.kind === "rollback" || node.kind === "implementation-unit") && !ledger.verificationCommandHashes && node.verificationConfigSha256 !== currentProjectConfigSha256) {
      sliceError("TRACE_SLICE_STALE", "rollback verification configuration is stale", { id: node.id });
    }
  }
}

function requireCurrentKinds(ledger: TraceabilityLedger, kinds: TraceNode["kind"][]): void {
  for (const kind of kinds) {
    const nodes = currentNodes(ledger.nodes).filter((node) => node.kind === kind);
    if (nodes.length === 0) sliceError("TRACE_SLICE_INCOMPLETE", "Trace slice is missing a required node", { kind });
    if (nodes.some((node) => node.status === "stale")) sliceError("TRACE_SLICE_STALE", "Trace slice contains stale nodes", { kind });
  }
}

export function assertTraceabilityComplete(ledger: TraceabilityLedger, route: RouteId, currentProjectConfigSha256: string, currentCommandHashes?: Record<string, string>): void {
  assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes);
  if (Object.values(ledger.nodes).some((node) => node.status === "stale")) {
    sliceError("TRACE_SLICE_STALE", "complete Trace graph contains stale nodes");
  }
  try { validateTraceGraph(ledger, route, "complete"); }
  catch (error) { if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details); throw error; }
}

/** 收集所有没有有效验证覆盖的当前 AC（TEST 或显式非行为处置），用于预检的完整诊断。 */
export function collectUncoveredAcceptanceCriteria(ledger: TraceabilityLedger): Array<{ id: string; parentRequirement: string }> {
  const nodes = ledger.nodes as Record<string, TraceNode>;
  return currentNodes(nodes)
    .filter((node) => node.kind === "acceptance-criterion")
    .filter((node) => !acceptanceCriterionCovered(nodes, node))
    .map((node) => ({ id: node.id, parentRequirement: node.parentRequirement }));
}

export function assertTraceSliceCurrent(ledger: TraceabilityLedger, route: RouteId, step: string, currentProjectConfigSha256: string, currentCommandHashes?: Record<string, string>): void {
  assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes);
  const completeSteps = new Set(["planning", "implementation", "finalize"]);
  if (completeSteps.has(step)) return assertTraceabilityComplete(ledger, route, currentProjectConfigSha256, currentCommandHashes);
  const requirements: TraceNode["kind"][] = ["requirement", "acceptance-criterion"];
  if (["requirements"].includes(step)) {
    requireCurrentKinds(ledger, [...requirements]);
    try { validateTraceGraph(ledger, route, "partial"); }
    catch (error) { if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details); throw error; }
    return;
  }
  const kinds: TraceNode["kind"][] = step === "implementation_plan"
    ? [...requirements, "task", "implementation-unit"]
    : step === "coverage_review"
      ? [...requirements, "task", "test"]
      : step === "rollback_unit"
        ? [...requirements, "task", "test", "rollback"]
        : [...requirements, "task", "test", "implementation-unit"] as TraceNode["kind"][];
  requireCurrentKinds(ledger, kinds);
  try {
    validateTraceGraph(ledger, route, step === "rollback_unit" ? "complete" : "partial");
    if (step === "coverage_review") {
      for (const node of currentNodes(ledger.nodes)) if (node.kind === "acceptance-criterion"
        && !acceptanceCriterionCovered(ledger.nodes as Record<string, TraceNode>, node)) {
        sliceError("TRACE_SLICE_INCOMPLETE", "coverage review requires a test or an explicit verification disposition for every acceptance criterion", { id: node.id });
      }
    }
  } catch (error) {
    if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
    throw error;
  }
}
