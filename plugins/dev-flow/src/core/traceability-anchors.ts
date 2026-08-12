import { createHash } from "node:crypto";
import type { TraceId } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";

export type TraceAnchorKind =
  | "requirement"
  | "acceptance-criterion"
  | "task"
  | "test"
  | "implementation-unit"
  | "rollback"
  | "recovery";

export interface TraceSourceBlock {
  id: TraceId;
  kind: TraceAnchorKind;
  sourceAnchor: string;
  sourceBlockSha256: string;
}

const TRACE_ANCHOR = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|UNIT|RU|REC)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|implementation-unit|rollback|recovery) -->/g;
const expectedKind: Record<string, TraceAnchorKind> = {
  REQ: "requirement",
  AC: "acceptance-criterion",
  TASK: "task",
  TEST: "test",
  UNIT: "implementation-unit",
  RU: "rollback",
  REC: "recovery",
};

function invalidAnchor(message: string, details: Record<string, unknown> = {}): never {
  throw new DevFlowError("TRACE_SOURCE_ANCHOR_INVALID", message, details);
}

interface ParsedAnchor {
  id: TraceId;
  kind: TraceAnchorKind;
  sourceAnchor: string;
  index: number;
}

export function parseTraceSourceBlocks(markdown: string): TraceSourceBlock[] {
  const devFlowComments = markdown.match(/<!-- dev-flow:[\s\S]*?-->/g) ?? [];
  TRACE_ANCHOR.lastIndex = 0;
  const anchors: ParsedAnchor[] = [];
  let match: RegExpExecArray | null;
  while ((match = TRACE_ANCHOR.exec(markdown)) !== null) {
    const [, prefix, suffix, rawKind] = match;
    const kind = rawKind as TraceAnchorKind;
    if (expectedKind[prefix] !== kind) {
      invalidAnchor("anchor ID prefix does not match its kind", { prefix, kind });
    }
    const id = `${prefix}-${suffix}` as TraceId;
    if (anchors.some((anchor) => anchor.id === id)) {
      invalidAnchor("anchor ID is declared more than once", { id });
    }
    anchors.push({ id, kind, sourceAnchor: match[0], index: match.index });
  }
  if (anchors.length === 0 || anchors.length !== devFlowComments.length) {
    invalidAnchor("trace artifacts require one or more exact declaration anchors");
  }
  return anchors.map((anchor, index) => {
    const end = anchors[index + 1]?.index ?? markdown.length;
    const sourceBlock = markdown.slice(anchor.index, end);
    return {
      id: anchor.id,
      kind: anchor.kind,
      sourceAnchor: anchor.sourceAnchor,
      sourceBlockSha256: createHash("sha256").update(sourceBlock, "utf8").digest("hex"),
    };
  });
}
