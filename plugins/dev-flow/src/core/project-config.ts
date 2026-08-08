import path from "node:path";
import { DevFlowError } from "./errors.js";
import { normalizeProjectPath } from "./path-normalization.js";

export type VerificationGuarantee = "targeted" | "behavior" | "integration" | "full";
export interface VerificationCommand {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  provides: VerificationGuarantee[];
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

function relativeDirectory(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}

function normalizedRelativeDirectory(value: string): string | undefined {
  if (!relativeDirectory(value)) return undefined;
  const normalized = normalizeProjectPath(value).replace(/\/+$/u, "");
  return normalized || undefined;
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
    if (ids.has(command.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command.id);
  }
  const preflightCommands = config.verification?.preflightCommands;
  if (preflightCommands !== undefined && (!Array.isArray(preflightCommands) || preflightCommands.some((id) => typeof id !== "string" || !ids.has(id)))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflightCommands must reference configured command ids");
  }
  if (preflightCommands && config.verification) config.verification.preflightCommands = [...new Set(preflightCommands)];
}
