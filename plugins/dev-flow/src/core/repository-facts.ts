import { createHash } from "node:crypto";
import type { GovernanceRepositoryFact, RepositoryFactLocation, RepositoryObservation } from "../policy/governance-records.js";
import { DevFlowError } from "./errors.js";
import { isAbsoluteProjectPath, normalizeProjectPath, normalizeUnicode } from "./path-normalization.js";
import { assertPositiveAnchor, computeLocationFingerprint, executeRepositoryObservation } from "./repository-fact-store.js";
import { EMPTY_GOVERNANCE_LEDGER } from "../policy/governance-records.js";
import { readProjectConfig, mutate, readState, type FeatureState } from "./state-store.js";

/**
 * 仓库事实深模块（ADR-0018 / spec"仓库事实"）。
 *
 * - 肯定事实指向真实可读的文件、符号或配置位置；
 * - 否定事实保存明确的检查范围与可重复的检查条件；
 * - 每条事实绑定观察时的内容指纹：相关内容变化 → 事实 stale（自动待重查），
 *   无关内容变化不失效；
 * - 自由文本说明不构成确认依据；BoundaryAudit 只接受指向当前事实或当前
 *   决定的引用。
 */

export interface RepositoryFactInput {
  assertion?: string;
  location?: RepositoryFactLocation;
  observation?: RepositoryObservation;
}

function canonicalLocation(location: RepositoryFactLocation): string {
  if (location.kind === "positive") return JSON.stringify({ kind: "positive", path: location.path, anchor: location.anchor ?? null });
  return JSON.stringify({ kind: "negative", checkedScope: [...location.checkedScope].sort(), conditions: location.conditions });
}

export function repositoryFactId(input: Pick<RepositoryFactInput, "assertion" | "location" | "observation">): string {
  return `FACT-${createHash("sha256").update(`${input.assertion?.trim() ?? ""}\n${input.location ? canonicalLocation(input.location) : JSON.stringify(input.observation)}`).digest("hex").slice(0, 16)}`;
}

function invalidFact(message: string): DevFlowError {
  return new DevFlowError("INVALID_REPOSITORY_FACT", message, {
    recoveryHint: "肯定事实提供项目相对路径（可含符号锚点）；否定事实提供检查范围与可重复的检查条件",
    retryOriginal: true,
  });
}

/** 规范化并校验事实位置：必须是非空的 governed 相对路径，禁止越界与控制路径。 */
export function normalizeFactLocation(
  location: RepositoryFactLocation,
  governedRoots: string[],
): RepositoryFactLocation {
  const inside = (file: string): boolean => {
    const normalized = normalizeUnicode(file).replaceAll("\\", "/");
    const clean = normalizeProjectPath(normalized);
    if (!clean || isAbsoluteProjectPath(clean) || clean.startsWith("../") || clean === ".."
      || clean.startsWith(".dev-flow/") || clean === ".dev-flow" || clean.startsWith(".git/") || clean === ".git") {
      return false;
    }
    return governedRoots.some((root) => root === "." || clean === root || clean.startsWith(`${root}/`));
  };
  if (location.kind === "positive") {
    if (!location.path.trim() || !inside(location.path)) throw invalidFact("positive fact must point to a readable project-relative governed path");
    return { kind: "positive", path: normalizeProjectPath(normalizeUnicode(location.path).replaceAll("\\", "/")), ...(location.anchor?.trim() ? { anchor: location.anchor.trim() } : {}) };
  }
  const scope = [...new Set(location.checkedScope.map((entry) => normalizeProjectPath(normalizeUnicode(entry).replaceAll("\\", "/"))).filter((entry) => entry && inside(entry)))].sort();
  const conditions = location.conditions.trim();
  if (scope.length === 0) throw invalidFact("negative fact must record a non-empty checked scope inside governed roots");
  if (!conditions) throw invalidFact("negative fact must record repeatable check conditions");
  return { kind: "negative", checkedScope: scope, conditions };
}

export function normalizeRepositoryObservation(observation: RepositoryObservation, governedRoots: string[]): RepositoryObservation {
  const inside = (file: string): boolean => {
    const normalized = normalizeUnicode(file).replaceAll("\\", "/");
    const clean = normalizeProjectPath(normalized);
    if (!clean || isAbsoluteProjectPath(clean) || clean.startsWith("../") || clean === ".."
      || clean.startsWith(".dev-flow/") || clean === ".dev-flow" || clean.startsWith(".git/") || clean === ".git"
      || clean === "node_modules" || clean.startsWith("node_modules/")) return false;
    return governedRoots.some((root) => root === "." || clean === root || clean.startsWith(`${root}/`));
  };
  const pathValue = "path" in observation ? normalizeProjectPath(normalizeUnicode(observation.path).replaceAll("\\", "/")) : undefined;
  if (pathValue !== undefined && !inside(pathValue)) throw invalidFact("repository observation path must be inside a governed root");
  if (observation.kind === "file-exists") return { kind: observation.kind, path: pathValue! };
  if (observation.kind === "text-present") {
    if (!observation.text.trim()) throw invalidFact("text-present observation requires non-empty text");
    if (observation.occurrence !== undefined && (!Number.isInteger(observation.occurrence) || observation.occurrence < 1)) throw invalidFact("text-present occurrence must be a positive integer");
    return { kind: observation.kind, path: pathValue!, text: observation.text, ...(observation.occurrence === undefined ? {} : { occurrence: observation.occurrence }) };
  }
  if (observation.kind === "symbol-present") {
    if (!observation.symbol.trim()) throw invalidFact("symbol-present observation requires a non-empty symbol");
    return { kind: observation.kind, path: pathValue!, symbol: observation.symbol };
  }
  if (observation.kind === "json-value") {
    if (!observation.pointer.startsWith("/")) throw invalidFact("json-value observation pointer must start with /");
    return { kind: observation.kind, path: pathValue!, pointer: observation.pointer, expected: observation.expected };
  }
  if (!observation.pattern.trim() || (observation.patternKind !== "literal" && observation.patternKind !== "regex")) throw invalidFact("search-absent observation requires a pattern and patternKind");
  const scope = [...new Set(observation.checkedScope.map((entry) => normalizeProjectPath(normalizeUnicode(entry).replaceAll("\\", "/"))).filter((entry) => entry && inside(entry)))].sort();
  if (!scope.length) throw invalidFact("search-absent observation requires a non-empty governed scope");
  return { kind: observation.kind, checkedScope: scope, pattern: observation.pattern, patternKind: observation.patternKind };
}

/** 观察指纹：positive = 文件内容；negative = 检查范围内全部文件内容的级联哈希。 */
export async function computeFactFingerprint(
  root: string,
  fact: { location: RepositoryFactLocation } | RepositoryFactLocation,
): Promise<string> {
  const location = "location" in fact ? fact.location : fact;
  return computeLocationFingerprint(root, location);
}

/** 事实当前性：重新核对位置并比较观察指纹；内容变化 → 抛 BOUNDARY_FACT_STALE。 */
export async function assertRepositoryFactCurrent(root: string, fact: GovernanceRepositoryFact): Promise<void> {
  if (fact.observation) {
    const observation = await executeRepositoryObservation(root, fact.observation);
    if (!observation.confirmed) throw new DevFlowError("BOUNDARY_FACT_UNCONFIRMED", `repository fact ${fact.recordId} no longer satisfies its observation`, { recordId: fact.recordId, recoveryHint: "重新登记当前观察或修正分类依据。" });
    if (observation.observedFingerprint !== fact.observedFingerprint) throw new DevFlowError("BOUNDARY_FACT_STALE", `repository fact ${fact.recordId} refers to changed content`, { recordId: fact.recordId, recoveryHint: "重新登记该仓库事实以反映当前内容。" });
    return;
  }
  const current = await computeFactFingerprint(root, fact);
  if (fact.location.kind === "positive") await assertPositiveAnchor(root, fact.location);
  if (current !== fact.observedFingerprint) {
    throw new DevFlowError("BOUNDARY_FACT_STALE", `repository fact ${fact.recordId} refers to changed content`, {
      recordId: fact.recordId,
      assertion: fact.assertion,
      recoveryHint: "重新登记该仓库事实以反映当前内容；不相关内容变化不会使事实失效",
      retryOriginal: true,
    });
  }
}

/** 构造已登记事实记录（observedFingerprint 由调用方提供，保持确定性）。 */
export function repositoryFactRecord(input: Required<Pick<RepositoryFactInput, "assertion" | "location">> & { observation?: RepositoryObservation }, observedFingerprint: string, recordedAt: string): GovernanceRepositoryFact {
  return {
    recordId: repositoryFactId(input),
    kind: "repository-fact",
    assertion: input.assertion.trim(),
    location: input.location,
    ...(input.observation ? { observation: input.observation } : {}),
    observedFingerprint,
    recordedAt,
  };
}

const MAX_REPOSITORY_FACT_BATCH = 50;

/** 规范化 + 观察指纹。recordId 只从规范化后的 assertion/location 计算。 */
export async function normalizeRepositoryFact(
  root: string,
  input: RepositoryFactInput,
  config: { governedRoots: string[] },
): Promise<GovernanceRepositoryFact> {
  const observation = input.observation ? normalizeRepositoryObservation(input.observation, config.governedRoots) : undefined;
  const location = input.location
    ? normalizeFactLocation(input.location, config.governedRoots)
    : observation?.kind === "search-absent"
      ? { kind: "negative" as const, checkedScope: observation.checkedScope, conditions: `${observation.patternKind}:${observation.pattern}` }
      : observation && "path" in observation
        ? { kind: "positive" as const, path: observation.path, ...(observation.kind === "text-present" ? { anchor: observation.text } : observation.kind === "symbol-present" ? { anchor: observation.symbol } : {}) }
        : undefined;
  if (!location) throw new DevFlowError("INVALID_REPOSITORY_FACT", "repository fact requires a structured location or observation");
  const assertion = input.assertion?.trim() || (observation ? `observation:${observation.kind}` : "");
  const normalized = { assertion, location, ...(observation ? { observation } : {}) } as Required<Pick<RepositoryFactInput, "assertion" | "location">> & { observation?: RepositoryObservation };
  if (!normalized.assertion) throw new DevFlowError("INVALID_REPOSITORY_FACT", "repository fact assertion must not be empty");
  const observationResult = observation ? await executeRepositoryObservation(root, observation) : undefined;
  const observedFingerprint = observationResult ? observationResult.observedFingerprint : await computeFactFingerprint(root, { ...normalized, location });
  if (observationResult && !observationResult.confirmed) throw new DevFlowError("BOUNDARY_FACT_UNCONFIRMED", "repository observation is not satisfied", { summary: observationResult.summary, recoveryHint: "修正观察定义或先修正仓库后重试。" });
  return repositoryFactRecord(normalized, observedFingerprint, new Date().toISOString());
}

export interface RepositoryFactRegistration {
  state: FeatureState;
  recordId: string;
}

export interface RepositoryFactsRegistration {
  state: FeatureState;
  recordIds: string[];
  created: string[];
  existing: string[];
}

function applyRepositoryFacts(draft: FeatureState, records: GovernanceRepositoryFact[], host: "claude" | "codex"): { created: string[]; existing: string[] } {
  const ledger = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
  const facts = [...ledger.repositoryFacts];
  const created: string[] = [];
  const existing: string[] = [];
  for (const record of records) {
    if (facts.some((item) => item.recordId === record.recordId)) existing.push(record.recordId);
    else {
      facts.push(record);
      created.push(record.recordId);
    }
  }
  draft.governance = { ...ledger, repositoryFacts: facts };
  draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  return { created, existing };
}

/** 登记一条绑定当前观察指纹的仓库事实，并通过状态模块的 CAS 接缝落账。 */
export async function registerRepositoryFact(
  root: string,
  id: string,
  expectedRevision: number,
  input: RepositoryFactInput,
  host: "claude" | "codex",
): Promise<RepositoryFactRegistration> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const config = await readProjectConfig(root);
  const record = await normalizeRepositoryFact(root, input, config);
  const state = await mutate(root, id, expectedRevision, "repository-fact-recorded", (draft) => {
    applyRepositoryFacts(draft, [record], host);
  });
  return { state, recordId: record.recordId };
}

/** 一次 CAS 登记多条仓库事实；任一观察失败则整批不落账。 */
export async function registerRepositoryFacts(
  root: string,
  id: string,
  expectedRevision: number,
  inputs: RepositoryFactInput[],
  host: "claude" | "codex",
): Promise<RepositoryFactsRegistration> {
  if (!inputs.length) throw new DevFlowError("INVALID_REPOSITORY_FACT", "repository fact batch must not be empty");
  if (inputs.length > MAX_REPOSITORY_FACT_BATCH) {
    throw new DevFlowError("INVALID_REPOSITORY_FACT", `repository fact batch cannot exceed ${MAX_REPOSITORY_FACT_BATCH} items`, { limit: MAX_REPOSITORY_FACT_BATCH });
  }
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const config = await readProjectConfig(root);
  const records = await Promise.all(inputs.map((input) => normalizeRepositoryFact(root, input, config)));
  let created: string[] = [];
  let existing: string[] = [];
  const state = await mutate(root, id, expectedRevision, "repository-facts-recorded", (draft) => {
    const applied = applyRepositoryFacts(draft, records, host);
    created = applied.created;
    existing = applied.existing;
  });
  return { state, recordIds: records.map((record) => record.recordId), created, existing };
}
