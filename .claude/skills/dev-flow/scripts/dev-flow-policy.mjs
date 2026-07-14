#!/usr/bin/env node
/**
 * Layer 0: pure route/gate policy for dev-flow.
 * Derives default risk gates, human gates, and code-review obligations from
 * level/profile/labels. Does not read or write status, assets, stamps, or auth.
 * Does not call any Layer 1+ scripts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadContract(contractPath = path.join(__dirname, '../contract.json')) {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

export function emptyRiskGates(contract) {
  return Object.fromEntries(contract.risk_gates.map((gate) => [gate, 'none']));
}

export function gateRank(contract) {
  return Object.fromEntries(contract.gate_levels.map((name, index) => [name, index]));
}

/** Canonical completed-gate names stay hyphenated even though risk_gates use snake_case. */
export const RISK_GATE_COMPLETION_GATES = Object.freeze({
  requirements_coverage: 'requirements-coverage',
  plan_review: 'plan-review',
  rollback_units: 'rollback-units',
  security_review: 'security-review',
  behavior_verification: 'verification-before-completion',
});

export function canonicalCompletedGate(contract, gate) {
  const value = String(gate ?? '');
  const riskGate = value.replace(/-/g, '_');
  if (Object.hasOwn(RISK_GATE_COMPLETION_GATES, riskGate)) {
    return RISK_GATE_COMPLETION_GATES[riskGate];
  }
  return contract.known_gates.includes(value) ? value : null;
}

/** Raise each risk gate to at least the minimum required by the given labels. */
export function riskGatesForLabels(contract, labels) {
  const gates = emptyRiskGates(contract);
  const rank = gateRank(contract);
  for (const label of labels) {
    for (const [gate, minimum] of Object.entries(contract.minimum_risk_gates[label] ?? {})) {
      if (!gates[gate] || rank[gates[gate]] < rank[minimum]) gates[gate] = minimum;
    }
  }
  return gates;
}

function raiseGate(gates, rank, gate, minimum) {
  if (!Object.hasOwn(gates, gate)) return;
  if (rank[gates[gate]] < rank[minimum]) gates[gate] = minimum;
}

/**
 * Derive the full route policy for a feature.
 *
 * @param {object} contract
 * @param {{ level: string, profile: string, riskLabels?: string[], lightweightL?: boolean }} input
 * @returns {{
 *   route: string,
 *   riskGates: Record<string, string>,
 *   humanGates: Record<string, { required: boolean }>,
 *   codeReview: { required: boolean, evidence_level: 'none'|'light'|'full' },
 *   initialCurrentGate: string,
 *   initialNextAction: string,
 * }}
 */
export function deriveRoute(contract, input) {
  const level = input.level;
  const profile = input.profile;
  const labels = input.riskLabels ?? [];
  const lightweightL = Boolean(input.lightweightL);
  const rank = gateRank(contract);
  const riskGates = riskGatesForLabels(contract, labels);

  let route = 'unknown';
  let codeReview = { required: false, evidence_level: 'none' };
  const humanGates = {
    requirement_confirmation: { required: false },
    implementation_approval: { required: false },
  };
  let initialCurrentGate = 'req-probe';
  let initialNextAction = 'clarify requirements';

  if (profile === 'risk-minimal') {
    route = 'risk-minimal';
    humanGates.implementation_approval.required = true;
    initialCurrentGate = 'implementation_approval';
    initialNextAction = 'await implementation_approval';
    // code-review not required by default for risk-minimal
  } else if (profile === 'standard' && level === 'M') {
    // Lightweight M does not create status; when status exists it is standard M.
    route = 'standard-m';
    humanGates.requirement_confirmation.required = true;
    humanGates.implementation_approval.required = true;
    raiseGate(riskGates, rank, 'plan_review', 'light');
    codeReview = { required: true, evidence_level: 'light' };
  } else if (profile === 'standard' && level === 'L' && lightweightL) {
    route = 'lightweight-l';
    humanGates.requirement_confirmation.required = false;
    humanGates.implementation_approval.required = true;
    raiseGate(riskGates, rank, 'rollback_units', 'light');
    raiseGate(riskGates, rank, 'behavior_verification', 'light');
    codeReview = { required: true, evidence_level: 'light' };
    initialCurrentGate = 'implementation_approval';
    initialNextAction = 'await implementation_approval';
  } else if (profile === 'standard' && level === 'L') {
    route = 'standard-l';
    humanGates.requirement_confirmation.required = true;
    humanGates.implementation_approval.required = true;
    raiseGate(riskGates, rank, 'requirements_coverage', 'full');
    raiseGate(riskGates, rank, 'plan_review', 'light');
    raiseGate(riskGates, rank, 'behavior_verification', 'full');
    codeReview = { required: true, evidence_level: 'full' };
  } else if (['XS', 'S'].includes(level) && labels.length === 0) {
    route = 'xs-s';
  }

  return {
    route,
    riskGates,
    humanGates,
    codeReview,
    initialCurrentGate,
    initialNextAction,
  };
}

/**
 * Infer whether a status model is lightweight-L from declared human gates.
 * Used by validators that only see the status file.
 */
export function inferLightweightL(level, humanGates) {
  if (level !== 'L') return false;
  const req = humanGates?.requirement_confirmation;
  const impl = humanGates?.implementation_approval;
  const reqRequired = req?.required === true || req?.required === 'true';
  const implRequired = impl?.required === true || impl?.required === 'true';
  return !reqRequired && implRequired;
}

/**
 * Finish-stage code-review obligation for a status model.
 * code-review is NOT a risk_gates field; it is a route-derived finish duty.
 */
export function codeReviewObligation(contract, { level, profile, humanGates, lightweightL }) {
  const isLightL =
    lightweightL === true || inferLightweightL(level, humanGates);
  const derived = deriveRoute(contract, {
    level,
    profile,
    riskLabels: [],
    lightweightL: isLightL,
  });
  return derived.codeReview;
}

/**
 * Derive the machine-enforced duties for approval and finish.
 *
 * Approval includes only pre-implementation work. Behavior verification and
 * code review remain finish duties. Declared risk gates may be promoted above
 * route minimums; every promoted pre-implementation gate becomes an approval
 * duty as well.
 */
export function routeObligations(
  contract,
  { level, profile, riskLabels = [], humanGates = {}, riskGates = {} },
) {
  const lightweightL = inferLightweightL(level, humanGates);
  const route = deriveRoute(contract, {
    level,
    profile,
    riskLabels,
    lightweightL,
  });
  const effectiveRiskGates = {};
  for (const gate of contract.risk_gates) {
    effectiveRiskGates[gate] = riskGates[gate] ?? route.riskGates[gate] ?? 'none';
  }

  const approvalProcessGates = [];
  if (route.route === 'standard-m' || route.route === 'standard-l') {
    approvalProcessGates.push('writing-plans');
  }
  for (const gate of contract.risk_gates) {
    if (gate === 'behavior_verification') continue;
    if (effectiveRiskGates[gate] !== 'none') {
      approvalProcessGates.push(RISK_GATE_COMPLETION_GATES[gate]);
    }
  }

  const finishProcessGates = [...approvalProcessGates];
  if (route.codeReview.required) finishProcessGates.push('code-review');
  if (route.route !== 'xs-s' && route.route !== 'unknown') {
    finishProcessGates.push('verification-before-completion');
  }

  return {
    ...route,
    lightweightL,
    effectiveRiskGates,
    approvalProcessGates: [...new Set(approvalProcessGates)],
    finishProcessGates: [...new Set(finishProcessGates)],
  };
}

// CLI for doctor / debugging: print derived policy as JSON
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dev-flow-policy.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'derive') {
    const contract = loadContract();
    const flags = {};
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--level') flags.level = rest[++i];
      else if (rest[i] === '--profile') flags.profile = rest[++i];
      else if (rest[i] === '--risk-labels') flags.riskLabels = rest[++i].split(',').filter(Boolean);
      else if (rest[i] === '--lightweight-l') flags.lightweightL = true;
    }
    if (!flags.level || !flags.profile) {
      process.stderr.write('usage: dev-flow-policy.mjs derive --level <L> --profile <p> [--risk-labels a,b] [--lightweight-l]\n');
      process.exit(2);
    }
    process.stdout.write(`${JSON.stringify(deriveRoute(contract, flags), null, 2)}\n`);
  } else if (cmd === 'version') {
    process.stdout.write(`${loadContract().workflow_version}\n`);
  } else if (cmd === '--help' || cmd === '-h' || !cmd) {
    process.stdout.write('usage: dev-flow-policy.mjs derive|version\n');
  } else {
    process.stderr.write(`unknown command: ${cmd}\n`);
    process.exit(2);
  }
}
