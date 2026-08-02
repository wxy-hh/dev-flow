import path from "node:path";

/**
 * Canonicalize user- and host-provided paths before they enter state, trace,
 * package, or filesystem comparisons. NFC keeps composed/decomposed Unicode
 * spellings equivalent across macOS and Windows hosts.
 */
export function normalizeUnicode(value: string): string {
  return value.normalize("NFC");
}

export function normalizeProjectPath(value: string): string {
  return path.posix.normalize(normalizeUnicode(value).replaceAll("\\", "/"));
}
