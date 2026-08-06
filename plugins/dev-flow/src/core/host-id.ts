export type HostId = "claude" | "codex" | "kimi";

export function isHostId(value: unknown): value is HostId {
  return value === "claude" || value === "codex" || value === "kimi";
}
