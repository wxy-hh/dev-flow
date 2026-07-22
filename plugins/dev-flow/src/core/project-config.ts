import path from "node:path";
import { DevFlowError } from "./errors.js";

export interface VerificationCommand { id: string; command: string; args: string[]; cwd: string }
export interface ProjectConfig {
  schemaVersion: 1;
  verification: { commands: VerificationCommand[]; behaviorCommands: string[] };
  enforcement: { mode: "strict"; gitWriteRequiresLogicComplete: true; oneActiveFeature: true; requireExplicitHumanReply: true };
  protectedRoots: string[];
}

function relativeDirectory(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}

export function validateProjectConfig(value: unknown): asserts value is ProjectConfig {
  const config = value as Partial<ProjectConfig>;
  if (config?.schemaVersion !== 1 || config.enforcement?.mode !== "strict") throw new DevFlowError("INVALID_PROJECT_CONFIG", "only schema v1 strict configuration is supported");
  if (config.enforcement.gitWriteRequiresLogicComplete !== true || config.enforcement.oneActiveFeature !== true || config.enforcement.requireExplicitHumanReply !== true) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "all strict enforcement controls must be enabled");
  }
  if (!Array.isArray(config.protectedRoots) || !config.protectedRoots.length || config.protectedRoots.some((root) => !relativeDirectory(root) || root.startsWith(".dev-flow"))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "protectedRoots must be project-relative non-.dev-flow directories");
  }
  const commands = config.verification?.commands;
  if (!Array.isArray(commands) || !commands.length) throw new DevFlowError("INVALID_PROJECT_CONFIG", "at least one verification command is required");
  const ids = new Set<string>();
  for (const command of commands) {
    if (!command?.id || !command.command || !Array.isArray(command.args) || !relativeDirectory(command.cwd)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "invalid verification command");
    if (ids.has(command.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command.id);
  }
  const behaviorCommands = config.verification?.behaviorCommands;
  if (!Array.isArray(behaviorCommands) || behaviorCommands.some((id) => !ids.has(id))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "behaviorCommands must reference configured command ids");
  }
}
