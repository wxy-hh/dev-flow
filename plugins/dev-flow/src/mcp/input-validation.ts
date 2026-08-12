import { DevFlowError } from "../core/errors.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export interface InputValidationIssue {
  path: string;
  keyword: string;
  message: string;
  unknownField?: string;
  allowedFields?: string[];
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function childPath(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;
}

function issue(path: string, keyword: string, message: string, extra: Partial<InputValidationIssue> = {}): InputValidationIssue {
  return { path, keyword, message, ...extra };
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeOf(value) === expected;
}

function discriminatorMatches(value: unknown, schema: JsonSchema): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  const record = value as Record<string, unknown>;
  let constrained = false;
  for (const [key, candidate] of Object.entries(properties as Record<string, JsonSchema>)) {
    if (!(key in record) || !candidate || typeof candidate !== "object") continue;
    if (candidate.const !== undefined) {
      constrained = true;
      if (stable(record[key]) !== stable(candidate.const)) return false;
    } else if (Array.isArray(candidate.enum)) {
      constrained = true;
      if (!candidate.enum.some((allowed) => stable(record[key]) === stable(allowed))) return false;
    }
  }
  return constrained;
}

function validate(value: unknown, schema: JsonSchema, path: string): InputValidationIssue[] {
  if (Object.keys(schema).length === 0) return [];
  const issues: InputValidationIssue[] = [];
  const expectedType = schema.type;
  if (typeof expectedType === "string" && !matchesType(value, expectedType)) {
    return [issue(path, "type", `expected ${expectedType}, got ${typeOf(value)}`)];
  }
  if (Array.isArray(expectedType) && !expectedType.some((candidate) => typeof candidate === "string" && matchesType(value, candidate))) {
    return [issue(path, "type", `expected one of ${expectedType.join(", ")}, got ${typeOf(value)}`)];
  }
  if (schema.const !== undefined && stable(value) !== stable(schema.const)) {
    issues.push(issue(path, "const", `must equal ${stable(schema.const)}`));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => stable(value) === stable(candidate))) {
    issues.push(issue(path, "enum", "must be one of the allowed values"));
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push(issue(path, "minLength", `must have length >= ${schema.minLength}`));
    if (typeof schema.pattern === "string") {
      let matches = false;
      try { matches = new RegExp(schema.pattern).test(value); } catch { matches = false; }
      if (!matches) issues.push(issue(path, "pattern", "does not match the required pattern"));
    }
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    issues.push(issue(path, "minimum", `must be >= ${schema.minimum}`));
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push(issue(path, "minItems", `must contain at least ${schema.minItems} items`));
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push(issue(path, "maxItems", `must contain at most ${schema.maxItems} items`));
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map(stable));
      if (seen.size !== value.length) issues.push(issue(path, "uniqueItems", "items must be unique"));
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      value.forEach((item, index) => issues.push(...validate(item, schema.items as JsonSchema, childPath(path, index))));
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, JsonSchema>
      : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
    for (const key of required) {
      if (!(key in record)) issues.push(issue(childPath(path, key), "required", "is required"));
    }
    const additional = schema.additionalProperties;
    for (const [key, item] of Object.entries(record)) {
      if (properties[key]) {
        issues.push(...validate(item, properties[key], childPath(path, key)));
      } else if (additional === false) {
        issues.push(issue(childPath(path, key), "additionalProperties", "unknown field", {
          unknownField: key,
          allowedFields: Object.keys(properties).sort(),
        }));
      } else if (additional && typeof additional === "object" && !Array.isArray(additional)) {
        issues.push(...validate(item, additional as JsonSchema, childPath(path, key)));
      }
    }
    const propertyNames = schema.propertyNames && typeof schema.propertyNames === "object" && !Array.isArray(schema.propertyNames)
      ? schema.propertyNames as JsonSchema
      : undefined;
    if (propertyNames) {
      for (const key of Object.keys(record)) issues.push(...validate(key, propertyNames, childPath(path, key)));
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const candidates = schema.oneOf.filter((candidate): candidate is JsonSchema => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate));
    const results = candidates.map((candidate) => validate(value, candidate, path));
    const valid = results.filter((result) => result.length === 0);
    if (valid.length !== 1) {
      const discriminatorResults = results.filter((_, index) => discriminatorMatches(value, candidates[index]));
      const bestPool = discriminatorResults.length ? discriminatorResults : results;
      const best = bestPool.sort((left, right) => left.length - right.length)[0] ?? [];
      issues.push(...best);
      issues.push(issue(path, "oneOf", "must match exactly one schema"));
    }
  }
  return issues;
}

function normalizeIssues(tool: string, issues: InputValidationIssue[]): InputValidationIssue[] {
  const normalized = tool === "dev_flow_classify"
    ? issues.map((candidate) => candidate.unknownField === "riskFactRefs"
      ? { ...candidate, path: "$.classificationBasis.riskFactRefs", message: "riskFactRefs belongs inside classificationBasis" }
      : candidate)
    : issues;
  return [...normalized].sort((left, right) => `${left.path}\0${left.keyword}`.localeCompare(`${right.path}\0${right.keyword}`));
}

/** Validate a tool call against the exact schema exposed by tools/list. */
export function validateToolInput(
  toolName: string,
  args: unknown,
  schemas: Record<string, { inputSchema: JsonSchema }>,
): void {
  const schema = schemas[toolName]?.inputSchema;
  if (!schema) throw new DevFlowError("UNKNOWN_TOOL", toolName, { mutationApplied: false });
  const issues = normalizeIssues(toolName, validate(args, schema!, "$"));
  if (issues.length) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${toolName} input does not match its schema`, {
      tool: toolName,
      issues,
      mutationApplied: false,
    });
  }
}
