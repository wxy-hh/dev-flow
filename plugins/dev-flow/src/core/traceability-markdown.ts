import type {
  TraceArtifactKind,
  TraceNodeInput,
  VerificationDispositionKind,
} from "../policy/traceability.js";
import { validateTraceDelta } from "./traceability.js";

/**
 * v6 structured-Markdown block parser. This is the only place that turns
 * `<!-- dev-flow:... -->` blocks and `- key: value` bullets into
 * TraceNodeInput. It is intentionally strict and line-oriented; the existing
 * Core graph/schema validators are reused for semantic checks instead of
 * duplicating a weaker validator here.
 */

export interface TraceMarkdownDiagnostic {
  code: "TRACE_MARKDOWN_INVALID";
  artifactKind: TraceArtifactKind;
  /** Block ID when known; otherwise the offending line text prefix. */
  position: string;
  message: string;
  line?: number;
  field?: string;
}

export interface TraceMarkdownBlock {
  id: string;
  kind: TraceNodeInput["kind"];
  anchorLine: number;
  fields: Array<{ key: string; raw: string; line: number }>;
}

export interface TraceMarkdownParseResult {
  artifactKind: TraceArtifactKind;
  ok: boolean;
  diagnostics: TraceMarkdownDiagnostic[];
  blocks: TraceMarkdownBlock[];
  nodes: TraceNodeInput[];
}

const allowedKindsByArtifact: Record<TraceArtifactKind, ReadonlySet<string>> = {
  requirements: new Set(["requirement", "acceptance-criterion"]),
  "implementation-plan": new Set(["task", "test", "implementation-unit", "recovery"]),
};

const allowedFieldsByKind: Record<string, ReadonlySet<string>> = {
  requirement: new Set([]),
  "acceptance-criterion": new Set(["parent_requirement", "verification_kind", "verification_reason", "verification_target"]),
  task: new Set(["covers", "implementation_unit", "tdd"]),
  test: new Set(["verifies"]),
  "implementation-unit": new Set(["tasks", "depends_on", "file_scope", "covers", "forward_verification"]),
  recovery: new Set(["step_ref", "recovery_kind", "method", "risk_ref"]),
};

const requiredFieldsByKind: Record<string, readonly string[]> = {
  requirement: [],
  "acceptance-criterion": ["parent_requirement"],
  task: ["covers", "implementation_unit"],
  test: ["verifies"],
  "implementation-unit": ["tasks", "depends_on", "file_scope", "covers", "forward_verification"],
  recovery: ["step_ref", "recovery_kind", "method", "risk_ref"],
};

const listFields = new Set(["covers", "tasks", "depends_on", "file_scope", "verifies", "forward_verification"]);

const idPatterns: Record<string, string> = {
  requirement: "REQ",
  "acceptance-criterion": "AC",
  task: "TASK",
  test: "TEST",
  "implementation-unit": "UNIT",
  recovery: "REC",
};

const anchorKindPrefix: Record<string, string> = {
  REQ: "requirement",
  AC: "acceptance-criterion",
  TASK: "task",
  TEST: "test",
  UNIT: "implementation-unit",
  REC: "recovery",
};

const anchorPattern = /^<!--\s*dev-flow:id=(REQ|AC|TASK|TEST|UNIT|REC)-([0-9]{3,})\s+kind=(requirement|acceptance-criterion|task|test|implementation-unit|recovery)\s*-->\s*$/;
const fieldPattern = /^- ([a-z][a-z0-9_]*):[ \t]*(.*)$/;

function diagnostic(artifactKind: TraceArtifactKind, position: string, message: string, line?: number, field?: string): TraceMarkdownDiagnostic {
  return { code: "TRACE_MARKDOWN_INVALID", artifactKind, position, message, ...(line === undefined ? {} : { line }), ...(field === undefined ? {} : { field }) };
}

function nfc(value: string): string {
  return value.normalize("NFC").trim();
}

/** Parse one field value into either the bracket list or scalar contract. */
function parseFieldValue(
  result: TraceMarkdownParseResult,
  block: TraceMarkdownBlock,
  field: { key: string; raw: string; line: number },
): string | string[] | undefined {
  if (!listFields.has(field.key)) return nfc(field.raw);

  const raw = field.raw.trim();
  if (!raw.startsWith("[") || !raw.endsWith("]")) {
    result.diagnostics.push(diagnostic(result.artifactKind, block.id, `${field.key} 只接受统一的 bracket 形式 [A, B]`, field.line, field.key));
    return undefined;
  }
  const inner = raw.slice(1, -1).trim();
  const items = inner.length === 0
    ? []
    : inner.split(",").map((item) => item.normalize("NFC").trim()).filter((item) => item.length > 0);
  if (items.length !== (inner.match(/,/g)?.length ?? 0) + (inner.length > 0 ? 1 : 0)) {
    result.diagnostics.push(diagnostic(result.artifactKind, block.id, `${field.key} 包含空元素`, field.line, field.key));
    return undefined;
  }
  if (field.key !== "depends_on" && items.length === 0) {
    result.diagnostics.push(diagnostic(result.artifactKind, block.id, `${field.key} 不能为空`, field.line, field.key));
    return undefined;
  }
  const duplicates = items.filter((item, index) => items.indexOf(item) !== index);
  if (duplicates.length > 0) {
    result.diagnostics.push(diagnostic(result.artifactKind, block.id, `${field.key} 包含重复元素：${duplicates[0]}`, field.line, field.key));
    return undefined;
  }
  return items;
}

function buildNode(
  result: TraceMarkdownParseResult,
  block: TraceMarkdownBlock,
  fields: Map<string, { value: string | string[]; line: number }>,
): TraceNodeInput | undefined {
  const scalar = (key: string): string | undefined => {
    const value = fields.get(key)?.value;
    return typeof value === "string" ? value : undefined;
  };
  const list = (key: string): string[] | undefined => {
    const value = fields.get(key)?.value;
    return Array.isArray(value) ? value : undefined;
  };
  switch (block.kind) {
    case "requirement":
      return { kind: "requirement", id: block.id as `REQ-${string}` };
    case "acceptance-criterion": {
      const parent = scalar("parent_requirement");
      const kind = scalar("verification_kind");
      const reason = scalar("verification_reason");
      const target = scalar("verification_target");
      if (kind !== undefined && !["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"].includes(kind)) {
        result.diagnostics.push(diagnostic(result.artifactKind, block.id, "verification_kind 不是合法枚举", fields.get("verification_kind")?.line, "verification_kind"));
        return undefined;
      }
      if (kind === undefined && (reason !== undefined || target !== undefined)) {
        result.diagnostics.push(diagnostic(result.artifactKind, block.id, "verification_reason/target 必须与 verification_kind 一起提供", fields.get(reason !== undefined ? "verification_reason" : "verification_target")?.line));
        return undefined;
      }
      const disposition = kind === undefined
        ? undefined
        : {
            kind: kind as VerificationDispositionKind,
            ...(reason !== undefined ? { reason } : {}),
            ...(target !== undefined ? { target } : {}),
          };
      return {
        kind: "acceptance-criterion",
        id: block.id as `AC-${string}`,
        parentRequirement: parent as `REQ-${string}`,
        ...(disposition ? { verificationDisposition: disposition } : {}),
      };
    }
    case "task": {
      const covers = list("covers");
      const unit = scalar("implementation_unit");
      const tdd = scalar("tdd");
      if (tdd !== undefined && tdd !== "test-first" && tdd !== "direct") {
        result.diagnostics.push(diagnostic(result.artifactKind, block.id, "tdd 只能是 test-first 或 direct", fields.get("tdd")?.line, "tdd"));
        return undefined;
      }
      return {
        kind: "task",
        id: block.id as `TASK-${string}`,
        covers: covers as Array<`REQ-${string}` | `AC-${string}`>,
        implementationUnit: unit as `UNIT-${string}`,
        ...(tdd ? { tdd } : {}),
      };
    }
    case "test":
      return {
        kind: "test",
        id: block.id as `TEST-${string}`,
        verifies: list("verifies") as Array<`AC-${string}`>,
      };
    case "implementation-unit":
      return {
        kind: "implementation-unit",
        id: block.id as `UNIT-${string}`,
        tasks: list("tasks") as Array<`TASK-${string}`>,
        dependsOn: list("depends_on") as Array<`UNIT-${string}`>,
        fileScope: list("file_scope") as string[],
        covers: list("covers") as Array<`REQ-${string}` | `AC-${string}`>,
        forwardVerification: list("forward_verification") as string[],
      };
    case "recovery":
      return {
        kind: "recovery",
        id: block.id as `REC-${string}`,
        stepRef: scalar("step_ref") as `UNIT-${string}` | `TASK-${string}`,
        recoveryKind: scalar("recovery_kind") as "rollback" | "compensation",
        method: scalar("method") as string,
        riskRef: scalar("risk_ref") as string,
      };
  }
}

/**
 * Parse one trace artifact's Markdown into TraceNodeInput[] with source
 * locations and one aggregate diagnostic set. Semantic graph validation is
 * still owned by applyTraceDelta/validateTraceGraph.
 */
export function parseTraceMarkdown(markdown: string, artifactKind: TraceArtifactKind): TraceMarkdownParseResult {
  const result: TraceMarkdownParseResult = { artifactKind, ok: true, diagnostics: [], blocks: [], nodes: [] };
  if (artifactKind !== "requirements" && artifactKind !== "implementation-plan") {
    result.diagnostics.push(diagnostic(artifactKind, "artifact", `${artifactKind} 不再是 v6 Trace artifact`));
    result.ok = false;
    return result;
  }
  const lines = markdown.split("\n");
  const anchors: Array<{ id: string; kind: TraceNodeInput["kind"]; line: number; comment: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const commentIndex = line.indexOf("<!-- dev-flow:");
    if (commentIndex < 0) continue;
    const comment = line.slice(commentIndex).trim();
    const match = anchorPattern.exec(comment);
    if (!match) {
      result.diagnostics.push(diagnostic(artifactKind, "artifact", `未知或畸形 anchor：${line.trim()}`, index + 1));
      continue;
    }
    if (commentIndex !== 0) {
      result.diagnostics.push(diagnostic(artifactKind, "artifact", "anchor 必须独占一行", index + 1));
    }
    const [, prefix, suffix, kind] = match;
    if (anchorKindPrefix[prefix] !== kind) {
      result.diagnostics.push(diagnostic(artifactKind, `${prefix}-${suffix}`, "anchor ID 前缀与 kind 不匹配", index + 1));
      continue;
    }
    const id = `${prefix}-${suffix}`;
    if (anchors.some((candidate) => candidate.id === id)) {
      result.diagnostics.push(diagnostic(artifactKind, id, "anchor ID 重复", index + 1));
      continue;
    }
    anchors.push({ id, kind: kind as TraceNodeInput["kind"], line: index, comment });
  }

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const endLine = anchors[anchorIndex + 1]?.line ?? lines.length;
    const block: TraceMarkdownBlock = { id: anchor.id, kind: anchor.kind, anchorLine: anchor.line + 1, fields: [] };
    const fields = new Map<string, { value: string | string[]; line: number }>();
    for (let index = anchor.line + 1; index < endLine; index += 1) {
      const match = fieldPattern.exec(lines[index]);
      if (!match) continue;
      const [, key, raw] = match;
      if (fields.has(key)) {
        result.diagnostics.push(diagnostic(artifactKind, block.id, `字段 ${key} 只能出现一次`, index + 1, key));
        continue;
      }
      if (!allowedFieldsByKind[block.kind].has(key)) {
        result.diagnostics.push(diagnostic(artifactKind, block.id, `${block.kind} block 不接受未知结构化字段 ${key}`, index + 1, key));
        continue;
      }
      const value = parseFieldValue(result, block, { key, raw, line: index + 1 });
      if (value === undefined) continue;
      fields.set(key, { value, line: index + 1 });
      block.fields.push({ key, raw, line: index + 1 });
    }
    if (!allowedKindsByArtifact[artifactKind].has(block.kind)) {
      result.diagnostics.push(diagnostic(artifactKind, block.id, `${block.kind} 不属于 ${artifactKind} artifact`, block.anchorLine));
      continue;
    }
    for (const key of requiredFieldsByKind[block.kind]) {
      if (!fields.has(key)) {
        result.diagnostics.push(diagnostic(artifactKind, block.id, `缺少必填字段 ${key}`, block.anchorLine));
      }
    }
    result.blocks.push(block);
    const node = buildNode(result, block, fields);
    if (node !== undefined) result.nodes.push(node);
  }

  for (const node of result.nodes) {
    try {
      validateTraceDelta({ nodes: [node] });
    } catch (error) {
      result.diagnostics.push(diagnostic(
        artifactKind,
        node.id,
        error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, "") : String(error),
      ));
    }
  }

  if (result.diagnostics.length > 0 || result.nodes.length !== anchors.length) {
    result.ok = false;
  }
  return result;
}
