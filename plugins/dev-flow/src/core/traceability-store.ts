import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { TraceArtifactKind, TraceabilityLedger, TraceabilityPointer } from "../policy/traceability.js";
import type { FeatureState } from "./state-store.js";
import { DevFlowError } from "./errors.js";
import { validateProjectConfig, type ProjectConfig } from "./project-config.js";
import { deriveTraceEdges, traceSummary, validateTraceGraph } from "./traceability.js";

export type TraceStoreFaultPoint =
  | "before-temp-write"
  | "after-temp-fsync"
  | "after-snapshot-rename";

export interface TraceStoreOptions {
  fault?: (point: TraceStoreFaultPoint) => void | Promise<void>;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}

export function canonicalTraceJson(ledger: TraceabilityLedger): string {
  return `${JSON.stringify(sortValue(ledger), null, 2)}\n`;
}

function snapshotDirectory(root: string, featureId: string): string {
  return path.join(root, ".dev-flow", "features", featureId, "traceability", "snapshots");
}

function digest(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function writeTraceSnapshot(
  root: string,
  ledger: TraceabilityLedger,
  options: TraceStoreOptions = {},
): Promise<TraceabilityPointer> {
  assertSupportedTraceSchema(ledger);
  const contents = canonicalTraceJson(ledger);
  const sha256 = digest(contents);
  const directory = snapshotDirectory(root, ledger.featureId);
  const target = path.join(directory, `${sha256}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile(target, "utf8");
    if (existing !== contents) throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", "existing snapshot does not match its content address");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await options.fault?.("before-temp-write");
    const temporary = path.join(directory, `.${sha256}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    await options.fault?.("after-temp-fsync");
    try { await rename(temporary, target); }
    catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EEXIST") throw renameError;
      const existing = await readFile(target, "utf8");
      if (existing !== contents) throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", "concurrent snapshot does not match its content address");
    }
    await fsyncDirectory(directory);
    await options.fault?.("after-snapshot-rename");
  }
  return {
    path: `traceability/snapshots/${sha256}.json`,
    sha256,
    revision: ledger.revision,
    summary: traceSummary(ledger.nodes),
  };
}

function integrity(message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSupportedTraceSchema(ledger: unknown): asserts ledger is TraceabilityLedger {
  if (!isRecord(ledger)) integrity("Trace snapshot has an invalid shape");
  if (ledger.schemaVersion === 1) {
    throw new DevFlowError("UNSUPPORTED_TRACE_SCHEMA", "检测到旧 Trace ledger schema。", {
      recoveryHint: "用产生该状态的旧插件收尾，备份 .dev-flow 后用 6.0 重新初始化",
    });
  }
  if (ledger.schemaVersion !== 2) integrity("Trace snapshot has an invalid schemaVersion");
}

function safeSnapshotPath(pointer: TraceabilityPointer): string {
  if (!/^traceability\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path)
    || pointer.path !== `traceability/snapshots/${pointer.sha256}.json`) {
    integrity("Trace pointer path is invalid");
  }
  return pointer.path;
}

function sameEdges(left: TraceabilityLedger["edges"], right: TraceabilityLedger["edges"]): boolean {
  return left.length === right.length && left.every((edge, index) => {
    const candidate = right[index];
    return edge.from === candidate?.from && edge.type === candidate.type && edge.to === candidate.to;
  });
}

interface TraceReadOptions {
  allowUnsafeFileScopeSourceArtifact?: "implementation-plan";
}

async function readTraceabilityWithOptions(
  root: string,
  state: FeatureState,
  options: TraceReadOptions = {},
): Promise<TraceabilityLedger> {
  if (!state.traceability) integrity("Trace pointer is missing", { featureId: state.featureId });
  const pointer = state.traceability;
  const relative = safeSnapshotPath(pointer);
  const file = path.join(root, ".dev-flow", "features", state.featureId, relative);
  let contents: string;
  try { contents = await readFile(file, "utf8"); }
  catch { integrity("Trace snapshot cannot be read", { featureId: state.featureId, path: relative }); }
  if (digest(contents!) !== pointer.sha256) integrity("Trace snapshot digest does not match pointer", { featureId: state.featureId });
  let ledger: TraceabilityLedger;
  try { ledger = JSON.parse(contents!) as TraceabilityLedger; }
  catch { integrity("Trace snapshot is not valid JSON", { featureId: state.featureId }); }
  assertSupportedTraceSchema(ledger!);
  try { validateTraceGraph(ledger!, state.route, "partial", options); }
  catch (error) { integrity("Trace snapshot graph is invalid", { cause: error instanceof Error ? error.message : String(error) }); }
  if (ledger!.featureId !== state.featureId || ledger!.revision !== pointer.revision || ledger!.stateRevision > state.revision) {
    integrity("Trace pointer and ledger revisions do not match", { featureId: state.featureId });
  }
  if (ledger!.summary.total !== pointer.summary.total
    || ledger!.summary.current !== pointer.summary.current
    || ledger!.summary.stale !== pointer.summary.stale
    || ledger!.summary.tombstoned !== pointer.summary.tombstoned
    || !sameEdges(deriveTraceEdges(ledger!.nodes), ledger!.edges)) {
    integrity("Trace pointer summary or ledger edges do not match", { featureId: state.featureId });
  }
  return ledger!;
}

export async function readTraceability(root: string, state: FeatureState): Promise<TraceabilityLedger> {
  return readTraceabilityWithOptions(root, state);
}

/**
 * Reads an otherwise valid legacy snapshot only while replacing its originating
 * Trace source. The replacement delta is still strictly validated and the
 * resulting ledger is re-read through the normal strict path.
 */
export async function readTraceabilityForArtifactReplacement(
  root: string,
  state: FeatureState,
  artifactKind: TraceArtifactKind,
): Promise<TraceabilityLedger> {
  const allowUnsafeFileScopeSourceArtifact = artifactKind === "implementation-plan"
    ? artifactKind
    : undefined;
  return readTraceabilityWithOptions(root, state, { allowUnsafeFileScopeSourceArtifact });
}

export async function listOrphanTraceSnapshots(root: string, state: FeatureState): Promise<string[]> {
  const directory = snapshotDirectory(root, state.featureId);
  let entries: string[];
  try { entries = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const active = state.traceability?.path.split("/").at(-1);
  return entries.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry) && entry !== active).sort();
}

export async function readProjectConfigSnapshot(root: string): Promise<{ config: ProjectConfig; sha256: string; contents: string }> {
  const file = path.join(root, ".dev-flow", "project.json");
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch { throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first", {
    userMessage: "项目尚未初始化，请先运行 dev_flow_init_project。",
    cause: "当前业务目录缺少 .dev-flow/project.json。",
    impact: "未初始化项目前无法读取追溯投影。",
    recoveryKind: "retry",
    recoveryInstruction: "运行 dev_flow_init_project 初始化项目后重试。",
    retryOriginal: true,
    requiresUserDecision: false,
  }); }
  let config: unknown;
  try { config = JSON.parse(raw); validateProjectConfig(config); }
  catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "project configuration is unreadable");
  }
  return { config: config as ProjectConfig, sha256: digest(raw), contents: raw };
}
