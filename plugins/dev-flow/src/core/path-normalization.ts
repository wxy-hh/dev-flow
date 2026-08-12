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

export function isAbsoluteProjectPath(value: string): boolean {
  return path.posix.isAbsolute(value);
}

export function isCanonicalProjectPath(value: string): boolean {
  return normalizeProjectPath(value) === value;
}
