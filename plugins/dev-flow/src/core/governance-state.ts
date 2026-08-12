import type {
  CurrentBasis,
} from "./basis-state.js";
import { deriveCurrency } from "./basis-state.js";
import { EMPTY_GOVERNANCE_LEDGER, type GovernanceAuthorization, type GovernanceDecision, type GovernanceLedger } from "../policy/types.js";
import type { FeatureState } from "./state-store.js";

export function governanceLedger(state: Pick<FeatureState, "governance">): GovernanceLedger {
  return state.governance ?? EMPTY_GOVERNANCE_LEDGER;
}

export function currentDecisions(
  state: Pick<FeatureState, "governance">,
  basis: CurrentBasis,
): GovernanceDecision[] {
  return governanceLedger(state).decisions.filter((decision) => decision.supersededBy === undefined && deriveCurrency(decision, basis) === "current");
}

export function openDecisions(state: Pick<FeatureState, "governance">): GovernanceDecision[] {
  return governanceLedger(state).decisions.filter((decision) => decision.supersededBy === undefined);
}

export function currentRiskAuthorizations(
  state: Pick<FeatureState, "governance">,
  basis: CurrentBasis,
): GovernanceAuthorization[] {
  return governanceLedger(state).authorizations.filter((authorization) => authorization.authorizationType === "risk-acceptance" && deriveCurrency(authorization, basis) === "current");
}

