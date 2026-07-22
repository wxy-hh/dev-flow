import contractJson from "../../policy/contract.json" with { type: "json" };
import type { RiskEnhancement, RouteDefinition, RouteId } from "./types.js";

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

export function routeDefinition(route: RouteId): RouteDefinition {
  return contract.routes[route];
}
