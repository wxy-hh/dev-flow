import type { ReviewFinding, } from "../policy/review.js";
import type { ReviewFindingEvent, ReviewLedger } from "../policy/review.js";

export type EffectiveFindingStatus = "unresolved" | "resolved" | "needs-revalidation" | "still-blocking" | "risk-accepted";

export interface EffectiveFindingState {
  findingId: string;
  status: EffectiveFindingStatus;
  blocking: boolean;
  origin: ReviewFindingEvent & { type: "origin" };
  latestEvent?: ReviewFindingEvent;
}

export type FindingBasisResolver = string | ((origin: ReviewFindingEvent & { type: "origin" }) => string | undefined);

function eventsFor(ledger: Pick<ReviewLedger, "findingEvents">, findingId: string): ReviewFindingEvent[] {
  return (ledger.findingEvents ?? []).filter((event) => event.type === "origin"
    ? event.finding.findingId === findingId
    : event.findingId === findingId);
}

function originFor(ledger: Pick<ReviewLedger, "findingEvents">, findingId: string): (ReviewFindingEvent & { type: "origin" }) | undefined {
  return (ledger.findingEvents ?? []).find((event): event is ReviewFindingEvent & { type: "origin" } => event.type === "origin" && event.finding.findingId === findingId);
}

function latestEvent(events: ReviewFindingEvent[]): ReviewFindingEvent | undefined {
  return events.filter((event) => event.type !== "origin").at(-1);
}

export function effectiveFindingState(
  ledger: Pick<ReviewLedger, "findingEvents">,
  findingId: string,
  currentBasisHash?: FindingBasisResolver,
): EffectiveFindingState | undefined {
  const origin = originFor(ledger, findingId);
  if (!origin) return undefined;
  const latest = latestEvent(eventsFor(ledger, findingId));
  const expectedBasis = typeof currentBasisHash === "function" ? currentBasisHash(origin) : currentBasisHash;
  const basisCurrent = !expectedBasis || !latest || latest.basisHash === expectedBasis;
  const status: EffectiveFindingStatus = !basisCurrent
    ? "needs-revalidation"
    : latest?.type === "resolved"
    ? "resolved"
    : latest?.type === "still-blocking"
      ? "still-blocking"
      : latest?.type === "risk-accepted"
        ? "risk-accepted"
        : "unresolved";
  return {
    findingId,
    status,
    blocking: origin.finding.severity === "blocking" && status !== "resolved" && status !== "risk-accepted",
    origin,
    ...(latest ? { latestEvent: latest } : {}),
  };
}

export function unresolvedBlockingFindings(ledger: Pick<ReviewLedger, "findingEvents">, currentBasisHash?: FindingBasisResolver): ReviewFinding[] {
  const ids = new Set((ledger.findingEvents ?? [])
    .filter((event): event is ReviewFindingEvent & { type: "origin" } => event.type === "origin" && event.finding.severity === "blocking")
    .map((event) => event.finding.findingId));
  return [...ids]
    .map((findingId) => effectiveFindingState(ledger, findingId, currentBasisHash))
    .filter((state): state is EffectiveFindingState => Boolean(state?.blocking))
    .map((state) => state.origin.finding);
}

export function appendFindingEvents(
  ledger: Pick<ReviewLedger, "findingEvents">,
  events: ReviewFindingEvent[],
): ReviewFindingEvent[] {
  return [...(ledger.findingEvents ?? []), ...events.map((event) => structuredClone(event))];
}

export function carriedFindings(
  ledger: Pick<ReviewLedger, "findingEvents">,
  role: string,
  currentBasisHash?: FindingBasisResolver,
): Array<{ finding: ReviewFinding; originBatchId: string; basisHash: string }> {
  return unresolvedBlockingFindings(ledger, currentBasisHash)
    .map((finding) => {
      const origin = originFor(ledger, finding.findingId);
      return origin && origin.role === role ? { finding, originBatchId: origin.batchId, basisHash: origin.basisHash } : undefined;
    })
    .filter((value): value is { finding: ReviewFinding; originBatchId: string; basisHash: string } => Boolean(value));
}
