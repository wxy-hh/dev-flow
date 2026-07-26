import contractJson from "../../policy/contract.json" with { type: "json" };
import type { RiskEnhancement, RiskLabel, RouteDefinition, RouteId } from "./types.js";

interface ContractShape {
  schemaVersion: number;
  routes: Record<RouteId, RouteDefinition>;
  riskEnhancements: Record<string, RiskEnhancement>;
  topologyMinimumLevel: Record<string, string>;
  topologyStrictOrder: string[];
}

export const contract = contractJson as ContractShape;

if (contract.schemaVersion !== 1) {
  throw new Error(`unsupported contract schema ${String(contract.schemaVersion)}`);
}

export const allowedRiskLabels = Object.freeze(Object.keys(contract.riskEnhancements) as RiskLabel[]);

export function routeDefinition(route: RouteId): RouteDefinition {
  return contract.routes[route];
}
