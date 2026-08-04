import { createHash } from "node:crypto";
import path from "node:path";

export type RiskClass = "task-reusable" | "always-confirm";

export interface RiskAssessment {
  riskClass: RiskClass;
  category: "destructive-worktree" | "external-action";
  commandFingerprint: string;
}

interface RiskEventInput {
  toolName?: unknown;
  toolInput?: Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function commandFor(input: RiskEventInput): string {
  const command = input.toolInput?.command;
  if (typeof command === "string") return command.trim().replace(/\s+/g, " ");
  return canonical(input.toolInput ?? {});
}

function targetScope(command: string, root: string): "inside" | "outside" | "unknown" {
  if (/[$`*?{]/.test(command) || /(?:^|\s)~(?:\/|\s|$)/.test(command)) return "unknown";
  const candidates = [...command.matchAll(/(?:^|[\s"'=])((?:\/|(?:\.\.\/)+)[^\s'"`;|&]*)/g)].map((match) => match[1]);
  for (const target of candidates) {
    const absolute = path.resolve(root, target);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return "outside";
  }
  return "inside";
}

function fingerprint(input: RiskEventInput, riskClass: RiskClass, category: RiskAssessment["category"], command: string): string {
  return createHash("sha256").update(canonical({ riskClass, category, toolName: String(input.toolName ?? ""), command })).digest("hex");
}

/** Pure risk classification used only after the host has decided to ask. */
export function classifyRisk(input: RiskEventInput, root: string): RiskAssessment | undefined {
  const toolName = String(input.toolName ?? "").toLowerCase();
  const command = commandFor(input);
  if (!command && !toolName) return undefined;

  const external = /\b(?:git\s+push|(?:npm|pnpm|yarn|bun)\s+(?:publish|release)|docker\s+push)\b/i.test(command)
    || /\b(?:deploy|deployment|publish|release)\b/i.test(command)
    || /\b(?:production|prod)\b/i.test(command) && /\b(?:change|apply|delete|deploy|push|publish|release|migrate)\b/i.test(command)
    || /\b(?:terraform\s+destroy|kubectl\s+delete|helm\s+(?:uninstall|delete)|(?:aws|gcloud|az)\b[^\n]*(?:delete|destroy|remove))\b/i.test(command);
  if (external) {
    return {
      riskClass: "always-confirm",
      category: "external-action",
      commandFingerprint: fingerprint(input, "always-confirm", "external-action", command),
    };
  }

  const destructive = /\brm\s+(?:-[^\s]*r[^\s]*|--recursive)\b/i.test(command)
    || /\bgit\s+(?:reset\s+--hard|clean\s+[^\n]*-[^\n]*f|(?:checkout|restore)\s+--|rebase)\b/i.test(command)
    || /\b(?:delete|remove)\b/i.test(toolName);
  if (!destructive) return undefined;
  const scope = targetScope(command, root);
  if (scope !== "inside") {
    return {
      riskClass: "always-confirm",
      category: "external-action",
      commandFingerprint: fingerprint(input, "always-confirm", "external-action", command),
    };
  }
  return {
    riskClass: "task-reusable",
    category: "destructive-worktree",
    commandFingerprint: fingerprint(input, "task-reusable", "destructive-worktree", command),
  };
}
