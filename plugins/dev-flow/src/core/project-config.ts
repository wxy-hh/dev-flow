import path from "node:path";
import { createHash } from "node:crypto";
import { DevFlowError } from "./errors.js";
import { normalizeProjectPath } from "./path-normalization.js";

export type VerificationGuarantee = "targeted" | "behavior" | "integration" | "full";
export interface VerificationCommand {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  provides: VerificationGuarantee[];
  /** 单命令覆盖默认超时（毫秒）；省略时使用稳定默认值。 */
  timeoutMs?: number;
  /** 单命令覆盖默认输出上限（字节）；省略时使用稳定默认值。 */
  maxOutputBytes?: number;
}
export interface VerificationConfig {
  commands: VerificationCommand[];
  preflightCommands?: string[];
}
export interface ProjectConfig {
  schemaVersion: 2;
  verification: VerificationConfig;
  enforcement: { mode: "strict"; gitWriteRequiresLogicComplete: true; oneActiveFeature: true; requireExplicitHumanReply: true };
  governedRoots: string[];
  governedRootsExclude?: string[];
}

export interface ProjectConfigImpact {
  changedCommandIds: string[];
  addedCommandIds: string[];
  removedCommandIds: string[];
  modifiedCommandIds: string[];
  capabilityOnlyCommandIds: string[];
  verificationCapabilityChanged: boolean;
  governanceChanged: boolean;
  preflightChanged: boolean;
}

export function projectConfigImpact(previous: ProjectConfig, next: ProjectConfig): ProjectConfigImpact {
  const previousCommands = new Map(previous.verification.commands.map((command) => [command.id, command]));
  const nextCommands = new Map(next.verification.commands.map((command) => [command.id, command]));
  const addedCommandIds = [...nextCommands.keys()].filter((id) => !previousCommands.has(id)).sort();
  const removedCommandIds = [...previousCommands.keys()].filter((id) => !nextCommands.has(id)).sort();
  const modifiedCommandIds = [...nextCommands.keys()].filter((id) => previousCommands.has(id)
    && JSON.stringify({ ...previousCommands.get(id), provides: undefined }) !== JSON.stringify({ ...nextCommands.get(id), provides: undefined })).sort();
  const capabilityOnlyIds = [...nextCommands.keys()].filter((id) => previousCommands.has(id)
    && JSON.stringify({ ...previousCommands.get(id), provides: undefined }) === JSON.stringify({ ...nextCommands.get(id), provides: undefined })
    && JSON.stringify(previousCommands.get(id)?.provides) !== JSON.stringify(nextCommands.get(id)?.provides));
  const changedCommandIds = [...new Set([...addedCommandIds, ...removedCommandIds, ...modifiedCommandIds, ...capabilityOnlyIds])].sort();
  const governanceChanged = JSON.stringify({
    enforcement: previous.enforcement,
    governedRoots: previous.governedRoots,
    governedRootsExclude: previous.governedRootsExclude,
  }) !== JSON.stringify({
    enforcement: next.enforcement,
    governedRoots: next.governedRoots,
    governedRootsExclude: next.governedRootsExclude,
  });
  const preflightChanged = JSON.stringify(previous.verification.preflightCommands ?? []) !== JSON.stringify(next.verification.preflightCommands ?? []);
  return {
    changedCommandIds,
    addedCommandIds,
    removedCommandIds,
    modifiedCommandIds,
    capabilityOnlyCommandIds: capabilityOnlyIds.sort(),
    verificationCapabilityChanged: capabilityOnlyIds.length > 0 || addedCommandIds.length > 0 || removedCommandIds.length > 0,
    governanceChanged,
    preflightChanged,
  };
}

export function verificationCommandHashes(config: Pick<ProjectConfig, "verification">): Record<string, string> {
  return Object.fromEntries(config.verification.commands.map((command) => [
    command.id,
    // `provides` is a governance declaration, not executable command
    // identity. Expanding guarantees must not invalidate evidence that ran
    // the same command bytes with the same cwd/args.
    createHash("sha256").update(JSON.stringify({ id: command.id, command: command.command, args: command.args, cwd: command.cwd })).digest("hex"),
  ]));
}

/** Return the configured command identities referenced by a trace/checkpoint slice. */
export function verificationCommandIdsForRefs(
  refs: readonly (string | { command: string; args?: string[]; cwd?: string })[],
): string[] {
  return [...new Set(refs.filter((ref): ref is string => typeof ref === "string"))].sort();
}

/** Scope command hashes to the string command references actually consumed by a slice. */
export function verificationCommandHashesForRefs(
  config: Pick<ProjectConfig, "verification">,
  refs: readonly (string | { command: string; args?: string[]; cwd?: string })[],
): Record<string, string> {
  const all = verificationCommandHashes(config);
  return Object.fromEntries(verificationCommandIdsForRefs(refs)
    .filter((id) => all[id] !== undefined)
    .map((id) => [id, all[id]]));
}

/** Guarantees supplied by forward verification commands; preflight is audit-only. */
export function verificationGuarantees(config: Pick<ProjectConfig, "verification">): Set<VerificationGuarantee> {
  const preflight = new Set(config.verification.preflightCommands ?? []);
  return new Set(config.verification.commands
    .filter((command) => !preflight.has(command.id))
    .flatMap((command) => command.provides));
}

export function missingVerificationGuarantees(
  config: Pick<ProjectConfig, "verification">,
  required: readonly VerificationGuarantee[],
): VerificationGuarantee[] {
  const available = verificationGuarantees(config);
  return [...new Set(required)].filter((kind) => !available.has(kind));
}

function relativeDirectory(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}

function normalizedRelativeDirectory(value: string): string | undefined {
  if (!relativeDirectory(value)) return undefined;
  const normalized = normalizeProjectPath(value).replace(/\/+$/u, "");
  return normalized || ".";
}

export function validateProjectConfig(value: unknown): asserts value is ProjectConfig {
  const config = value as Partial<ProjectConfig>;
  if ((value as { schemaVersion?: unknown })?.schemaVersion === 1) throw new DevFlowError("UNSUPPORTED_PROJECT_SCHEMA", "项目仍使用 Dev Flow 4.x schema v1。", {
    schemaVersion: 1,
    recoveryHint: "先用 4.x 完成或放弃 active feature，备份 .dev-flow，再以 schema v2 重新初始化",
  });
  if (config?.schemaVersion !== 2 || config.enforcement?.mode !== "strict") throw new DevFlowError("INVALID_PROJECT_CONFIG", "only schema v2 strict configuration is supported");
  if (config.enforcement.gitWriteRequiresLogicComplete !== true || config.enforcement.oneActiveFeature !== true || config.enforcement.requireExplicitHumanReply !== true) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "all strict enforcement controls must be enabled");
  }
  if (!Array.isArray(config.governedRoots) || !config.governedRoots.length) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRoots must contain project-relative files or directories outside .dev-flow");
  }
  const governedRoots = config.governedRoots.map(normalizedRelativeDirectory);
  if (governedRoots.some((root) => !root || root === ".git" || root.startsWith(".git/") || root === ".dev-flow" || root.startsWith(".dev-flow/"))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRoots must contain project-relative files or directories outside control paths");
  }
  config.governedRoots = governedRoots as string[];
  if (config.governedRootsExclude !== undefined) {
    if (!Array.isArray(config.governedRootsExclude)
      || config.governedRootsExclude.some((pattern) => typeof pattern !== "string" || !relativeDirectory(pattern))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRootsExclude must contain non-empty relative patterns without ..");
    }
    config.governedRootsExclude = config.governedRootsExclude.map((pattern) => normalizeProjectPath(pattern));
  }
  const commands = config.verification?.commands;
  if (!Array.isArray(commands) || !commands.length) throw new DevFlowError("INVALID_PROJECT_CONFIG", "at least one verification command is required");
  const ids = new Set<string>();
  for (const command of commands) {
    if (!command?.id || !command.command || !Array.isArray(command.args) || !relativeDirectory(command.cwd)
      || !Array.isArray(command.provides) || command.provides.length === 0
      || command.provides.some((kind) => !["targeted", "behavior", "integration", "full"].includes(kind))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification commands require valid provides guarantees");
    }
    if (command.timeoutMs !== undefined && (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 1_000)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command.id} timeoutMs must be an integer of at least 1000ms`);
    }
    if (command.maxOutputBytes !== undefined && (!Number.isInteger(command.maxOutputBytes) || command.maxOutputBytes < 1024)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command.id} maxOutputBytes must be an integer of at least 1024 bytes`);
    }
    if (ids.has(command.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command.id);
  }
  const preflightCommands = config.verification?.preflightCommands;
  if (preflightCommands !== undefined && (!Array.isArray(preflightCommands) || preflightCommands.some((id) => typeof id !== "string" || !ids.has(id)))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflightCommands must reference configured command ids");
  }
  if (preflightCommands && config.verification) config.verification.preflightCommands = [...new Set(preflightCommands)];
  const missing = missingVerificationGuarantees(config as ProjectConfig, ["targeted"]);
  if (missing.length) {
    throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "项目必须配置至少一个非 preflight 命令提供 targeted guarantee。", {
      missingGuarantees: missing,
      userMessage: "项目验证配置缺少最终验证所需的 targeted guarantee。",
      cause: "preflight 命令只用于环境准备和诊断，不能作为业务验证证据。",
      impact: "项目无法安全创建会话或锁定路线。",
      recoveryKind: "repair",
      recoveryInstruction: "补充一个非 preflight 验证命令并重新初始化项目。",
      retryOriginal: false,
    });
  }
}
