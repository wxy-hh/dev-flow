import type { RouteId } from "../policy/types.js";
import type {
  AcceptanceCriterionId,
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
} from "../policy/traceability.js";
import type { TraceSourceBlock } from "./traceability-anchors.js";
import { DevFlowError } from "./errors.js";
import { isSafeFileScopePattern } from "../policy/rollback.js";
import { normalizeProjectPath, normalizeUnicode } from "./path-normalization.js";

export const ALLOWED_TRACE_KINDS = {
  requirements: ["requirement", "acceptance-criterion"],
  // The implementation plan is the single editable source for the execution
  // graph. Coverage and rollback projections are derived from these nodes;
  // they are not additional user-maintained route documents.
  "implementation-plan": ["task", "test", "rollback"],
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
  "acceptance-criterion": ["kind", "id", "parentRequirement"],
  task: ["kind", "id", "covers", "rollbackUnit"],
  test: ["kind", "id", "verifies"],
  rollback: ["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"],
};
const idPrefix: Record<TraceNodeInput["kind"], string> = {
  requirement: "REQ",
  "acceptance-criterion": "AC",
  task: "TASK",
  test: "TEST",
  rollback: "RU",
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

function validateNodeInput(value: unknown): asserts value is TraceNodeInput {
  if (!isRecord(value) || typeof value.kind !== "string" || !(value.kind in inputKeys)) invalid("node input has an unknown kind");
  const kind = value.kind as TraceNodeInput["kind"];
  const keys = Object.keys(value);
  if (keys.some((key) => !inputKeys[kind].includes(key))) invalid("node input contains Core-owned or unknown fields", { kind, keys });
  assertId(kind, value.id);
  if (kind === "acceptance-criterion") assertId("requirement", value.parentRequirement);
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid("task covers must be a non-empty string array", { id: value.id });
    assertNoDuplicate(value.covers, "covers", value.id as string);
    assertId("rollback", value.rollbackUnit);
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
    case "acceptance-criterion": return { ...common, kind: node.kind, id: node.id, parentRequirement: node.parentRequirement };
    case "task": return { ...common, kind: node.kind, id: node.id, covers: [...node.covers], rollbackUnit: node.rollbackUnit };
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
      sourceArtifact: input.artifactKind as "implementation-plan" | "rollback-units",
      verificationConfigSha256: input.projectConfigSha256,
    };
  }
}

function inputMeaning(node: TraceNodeInput): string {
  return JSON.stringify(node);
}

function nodeMeaning(node: TraceNode): string {
  switch (node.kind) {
    case "requirement": return JSON.stringify({ kind: node.kind, id: node.id });
    case "acceptance-criterion": return JSON.stringify({ kind: node.kind, id: node.id, parentRequirement: node.parentRequirement });
    case "task": return JSON.stringify({ kind: node.kind, id: node.id, covers: node.covers, rollbackUnit: node.rollbackUnit });
    case "test": return JSON.stringify({ kind: node.kind, id: node.id, verifies: node.verifies });
    case "rollback": return JSON.stringify({ kind: node.kind, id: node.id, tasks: node.tasks, dependsOn: node.dependsOn, fileScope: node.fileScope, covers: node.covers, forwardVerification: node.forwardVerification, rollbackVerification: node.rollbackVerification });
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
  if (input.artifactKind === "implementation-plan" && input.route === "standard-m" && (!has("task") || !has("rollback"))) {
    invalid("standard M implementation plans require both tasks and rollback units");
  }
  if (input.artifactKind === "rollback-units" && input.route !== "standard-l") invalid("rollback-units are only valid for standard L");
  for (const node of input.delta.nodes) {
    if (node.kind !== "rollback") continue;
    if (!["implementation-plan", "rollback-units"].includes(input.artifactKind)) invalid("rollback node has an invalid source artifact");
    if ([...node.forwardVerification, ...node.rollbackVerification].some((ref) =>
      typeof ref === "string" && !input.verificationCommandIds.includes(ref))) {
      invalid("rollback verification references an unknown command ID", { id: node.id });
    }
  }
}

export function deriveTraceEdges(nodes: Record<string, TraceNode>): TraceEdge[] {
  const edges: TraceEdge[] = [];
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") edges.push({ from: node.id, type: "parent", to: node.parentRequirement });
    if (node.kind === "task") {
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
      edges.push({ from: node.id, type: "rollback-unit", to: node.rollbackUnit });
    }
    if (node.kind === "test") for (const target of node.verifies) edges.push({ from: node.id, type: "verifies", to: target });
    if (node.kind === "rollback") {
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
  if (kind === "acceptance-criterion") assertId("requirement", value.parentRequirement);
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid("persisted task covers is invalid", { id: recordId });
    assertId("rollback", value.rollbackUnit);
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid("persisted test verifies is invalid", { id: recordId });
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
}

function assertPersistedLedgerShape(ledger: TraceabilityLedger, options: TraceGraphValidationOptions): void {
  if (typeof ledger.featureId !== "string" || !ledger.featureId) invalid("ledger featureId is invalid");
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) invalid("ledger revision is invalid");
  if (!Number.isInteger(ledger.stateRevision) || ledger.stateRevision < 0) invalid("ledger stateRevision is invalid");
  if (typeof ledger.projectConfigSha256 !== "string" || !hex64.test(ledger.projectConfigSha256)) {
    invalid("ledger projectConfigSha256 is invalid");
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
      const rollback = nodeById(nodes, node.rollbackUnit);
      if (!rollback && !(route === "standard-l" && mode === "partial")) invalid("task references a missing rollback unit", { id: node.id, rollbackUnit: node.rollbackUnit });
      if (rollback && rollback.kind !== "rollback") invalid("task rollback unit has the wrong kind", { id: node.id });
      if (rollback?.kind === "rollback" && !rollback.tasks.includes(node.id)) {
        invalid("task rollback unit must list the task", { id: node.id, rollbackUnit: node.rollbackUnit });
      }
    }
    if (node.kind === "test") for (const verified of node.verifies) assertReference(nodes, verified, ["acceptance-criterion"], { from: node.id });
    if (node.kind === "rollback") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task" || task.rollbackUnit !== node.id) invalid("rollback unit tasks must be symmetric with task rollbackUnit", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["rollback"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
  }
  assertRollbackDag(nodes);
  const edges = deriveTraceEdges(nodes);
  if (!sameEdges(ledger.edges, edges)) invalid("ledger edges do not match nodes");
  if (!sameSummary(ledger.summary, traceSummary(nodes))) invalid("ledger summary does not match nodes");
  if (mode === "complete") {
    const kinds = new Set(currentNodes(nodes).map((node) => node.kind));
    for (const kind of ["requirement", "acceptance-criterion", "task", "test", "rollback"] as const) if (!kinds.has(kind)) invalid("complete graph is missing a required node kind", { kind });
    if (currentNodes(nodes).some((node) => node.status !== "current")) invalid("complete graph cannot contain stale nodes");
    for (const node of currentNodes(nodes)) {
      if (node.kind === "acceptance-criterion" && !currentNodes(nodes).some((candidate) => candidate.kind === "test" && candidate.verifies.includes(node.id))) {
        invalid("every acceptance criterion requires a test", { id: node.id });
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

export function applyTraceDelta(input: ApplyTraceDeltaInput): TraceabilityLedger {
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
    nodes,
    edges: deriveTraceEdges(nodes),
    summary: traceSummary(nodes),
  };
  validateTraceGraph(ledger, effectiveInput.route, "partial");
  return ledger;
}

function assertConfigCurrent(ledger: TraceabilityLedger, currentProjectConfigSha256: string): void {
  if (ledger.projectConfigSha256 !== currentProjectConfigSha256) sliceError("TRACE_SLICE_STALE", "project configuration changed since Trace registration");
  for (const node of currentNodes(ledger.nodes)) {
    if (node.kind === "rollback" && node.verificationConfigSha256 !== currentProjectConfigSha256) {
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

export function assertTraceabilityComplete(ledger: TraceabilityLedger, route: RouteId, currentProjectConfigSha256: string): void {
  assertConfigCurrent(ledger, currentProjectConfigSha256);
  if (Object.values(ledger.nodes).some((node) => node.status === "stale")) {
    sliceError("TRACE_SLICE_STALE", "complete Trace graph contains stale nodes");
  }
  try { validateTraceGraph(ledger, route, "complete"); }
  catch (error) { if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details); throw error; }
}

export function assertTraceSliceCurrent(ledger: TraceabilityLedger, route: RouteId, step: string, currentProjectConfigSha256: string): void {
  assertConfigCurrent(ledger, currentProjectConfigSha256);
  const completeSteps = new Set(["planning", "implementation", "feature_check", "finalize"]);
  if (completeSteps.has(step)) return assertTraceabilityComplete(ledger, route, currentProjectConfigSha256);
  const requirements: TraceNode["kind"][] = ["requirement", "acceptance-criterion"];
  if (["requirements"].includes(step)) {
    requireCurrentKinds(ledger, [...requirements]);
    try { validateTraceGraph(ledger, route, "partial"); }
    catch (error) { if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details); throw error; }
    return;
  }
  const kinds: TraceNode["kind"][] = step === "implementation_plan"
    ? [...requirements, "task", ...(route === "standard-m" ? ["rollback"] as TraceNode["kind"][] : [])]
    : step === "coverage_review"
      ? [...requirements, "task", "test"]
      : step === "rollback_unit"
        ? [...requirements, "task", "test", "rollback"]
        : [...requirements, "task", "test", "rollback"] as TraceNode["kind"][];
  requireCurrentKinds(ledger, kinds);
  try {
    validateTraceGraph(ledger, route, step === "rollback_unit" ? "complete" : "partial");
    if (step === "coverage_review") {
      for (const node of currentNodes(ledger.nodes)) if (node.kind === "acceptance-criterion"
        && !currentNodes(ledger.nodes).some((candidate) => candidate.kind === "test" && candidate.verifies.includes(node.id))) {
        sliceError("TRACE_SLICE_INCOMPLETE", "coverage review requires a test for every acceptance criterion", { id: node.id });
      }
    }
  } catch (error) {
    if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
    throw error;
  }
}
