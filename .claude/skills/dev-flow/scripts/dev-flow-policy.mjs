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

export const STANDARD_REQUIREMENT_ENTRY_GATES = Object.freeze([
  'req-probe',
  'openspec',
  'grillme',
  'writing-plans',
]);

export const REQUIREMENT_ENTRY_BY_STATE = Object.freeze({
  'missing-or-unclear': 'req-probe',
  openspec: 'openspec',
  'documented-unconfirmed': 'grillme',
  confirmed: 'writing-plans',
});

export function validateTopology(contract, level, topology) {
  if (!contract.classification_topologies.includes(topology)) {
    return `topology must be one of: ${contract.classification_topologies.join(', ')}`;
  }
  const allowed = contract.topology_levels?.[topology] ?? [];
  if (!allowed.includes(level)) {
    return `topology ${topology} requires level ${allowed.join(' or ') || '(none)'}; got ${level}`;
  }
  return null;
}

/** Translate high-level start inputs into the existing profile/route primitives. */
export function deriveStartPlan(contract, input) {
  const { level, topology } = input;
  const riskLabels = input.riskLabels ?? [];
  const execution = input.execution;
  const requirements = input.requirements;
  const processMode = input.processMode ?? 'normal';
  if (!contract.levels.includes(level)) {
    throw new Error(`level must be one of: ${contract.levels.join(', ')}`);
  }
  const topologyError = validateTopology(contract, level, topology);
  if (topologyError) throw new Error(topologyError);
  if (['XS', 'S'].includes(level) && execution) {
    throw new Error(`${level} derives the light route and must not set --execution`);
  }
  if (['M', 'L'].includes(level) && !contract.execution_modes.includes(execution)) {
    throw new Error(`${level} requires --execution light|standard`);
  }
  if (execution === 'standard' && !contract.requirement_states.includes(requirements)) {
    throw new Error('standard execution requires --requirements');
  }
  if (execution !== 'standard' && requirements) {
    throw new Error('--requirements is only valid with --execution standard');
  }

  if (processMode === 'normal' && ['XS', 'S'].includes(level) && riskLabels.length === 0) {
    return { kind: 'authorize', route: 'xs-s', level, profile: null };
  }
  if (processMode === 'normal' && level === 'M' && execution === 'light' && riskLabels.length === 0) {
    return { kind: 'authorize', route: 'light-m', level, profile: null };
  }

  let profile = 'standard';
  let lightweightL = false;
  if (
    (riskLabels.length > 0 || processMode === 'retrospective') &&
    (['XS', 'S'].includes(level) || (level === 'M' && execution === 'light'))
  ) {
    profile = 'risk-minimal';
  } else if (level === 'L' && execution === 'light') {
    lightweightL = true;
  }
  const entryGate = execution === 'standard' && processMode === 'normal'
    ? REQUIREMENT_ENTRY_BY_STATE[requirements]
    : undefined;
  const derived = deriveRoute(contract, {
    level,
    profile,
    riskLabels,
    lightweightL,
    entryGate,
    processMode,
  });
  if (derived.route === 'unknown') throw new Error('classification does not map to a supported route');
  return { kind: 'status', level, profile, lightweightL, entryGate, ...derived };
}

export function nextActionForGate(gate) {
  if (gate === 'requirement_confirmation' || gate === 'implementation_approval') {
    return `await ${gate}`;
  }
  if (gate === 'finish') return 'finish feature';
  return `run ${gate}`;
}

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
 * @param {{ level: string, profile: string, riskLabels?: string[], lightweightL?: boolean, entryGate?: string }} input
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
  const processMode = input.processMode ?? 'normal';
  const rank = gateRank(contract);
  const riskGates = riskGatesForLabels(contract, labels);

  let route = 'unknown';
  let codeReview = { required: false, evidence_level: 'none' };
  const humanGates = {
    requirement_confirmation: { required: false },
    implementation_approval: { required: false },
  };
  let initialCurrentGate = 'req-probe';
  let initialNextAction = nextActionForGate(initialCurrentGate);

  if (profile === 'risk-minimal') {
    route = level === 'M' ? 'risk-minimal-m' : 'risk-minimal';
    humanGates.implementation_approval.required = true;
  } else if (profile === 'standard' && level === 'M') {
    // Lightweight M does not create status; when status exists it is standard M.
    route = 'standard-m';
    humanGates.requirement_confirmation.required = true;
    humanGates.implementation_approval.required = true;
    raiseGate(riskGates, rank, 'plan_review', 'light');
    codeReview = { required: true, evidence_level: 'light' };
    initialCurrentGate = STANDARD_REQUIREMENT_ENTRY_GATES.includes(input.entryGate)
      ? input.entryGate
      : 'req-probe';
    initialNextAction = nextActionForGate(initialCurrentGate);
  } else if (profile === 'standard' && level === 'L' && lightweightL) {
    route = 'lightweight-l';
    humanGates.requirement_confirmation.required = false;
    humanGates.implementation_approval.required = true;
    raiseGate(riskGates, rank, 'rollback_units', 'light');
    raiseGate(riskGates, rank, 'behavior_verification', 'full');
    codeReview = { required: true, evidence_level: 'light' };
  } else if (profile === 'standard' && level === 'L') {
    route = 'standard-l';
    humanGates.requirement_confirmation.required = true;
    humanGates.implementation_approval.required = true;
    raiseGate(riskGates, rank, 'requirements_coverage', 'full');
    raiseGate(riskGates, rank, 'plan_review', 'light');
    raiseGate(riskGates, rank, 'behavior_verification', 'full');
    codeReview = { required: true, evidence_level: 'full' };
    initialCurrentGate = STANDARD_REQUIREMENT_ENTRY_GATES.includes(input.entryGate)
      ? input.entryGate
      : 'req-probe';
    initialNextAction = nextActionForGate(initialCurrentGate);
  } else if (['XS', 'S'].includes(level) && labels.length === 0) {
    route = 'xs-s';
  }

  if (processMode === 'retrospective' && route !== 'unknown') {
    humanGates.requirement_confirmation.required = false;
    humanGates.implementation_approval.required = true;
    if (!codeReview.required) codeReview = { required: true, evidence_level: 'light' };
    initialCurrentGate = 'implementation_approval';
    initialNextAction = nextActionForGate(initialCurrentGate);
  }

  // Route-derived code-review (not a risk_gates field). Any risk label raises
  // at least light; high-consequence labels raise full. Never forces plan-review.
  if (labels.length > 0) {
    const levelRank = { none: 0, light: 1, full: 2 };
    const current = codeReview.required ? (levelRank[codeReview.evidence_level] ?? 0) : 0;
    let want = Math.max(current, 1);
    if (
      labels.includes('critical_correctness') ||
      labels.includes('irreversible_consequence')
    ) {
      want = Math.max(want, 2);
    }
    if (want >= 2) codeReview = { required: true, evidence_level: 'full' };
    else if (want >= 1) codeReview = { required: true, evidence_level: 'light' };
  }

  if (processMode !== 'retrospective' && (route === 'risk-minimal' || route === 'risk-minimal-m' || route === 'lightweight-l')) {
    const firstPreImplementationGate = contract.risk_gates
      .filter((gate) => gate !== 'behavior_verification' && riskGates[gate] !== 'none')
      .map((gate) => RISK_GATE_COMPLETION_GATES[gate])[0];
    initialCurrentGate = firstPreImplementationGate ?? 'implementation_approval';
    initialNextAction = nextActionForGate(initialCurrentGate);
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
export function codeReviewObligation(
  contract,
  { level, profile, humanGates, lightweightL, riskLabels = [], processMode = 'normal', execution },
) {
  const isLightL =
    lightweightL === true || execution === 'light' || (processMode !== 'retrospective' && inferLightweightL(level, humanGates));
  const derived = deriveRoute(contract, {
    level,
    profile,
    riskLabels,
    lightweightL: isLightL,
    processMode,
  });
  return derived.codeReview;
}

/**
 * Compare label-minimum gates to the route gate map before labels are applied.
 * Returns labels whose minima are already covered by the base route.
 */
export function labelsWithNoGateIncrement(contract, labels, baseRouteRiskGates) {
  const rank = gateRank(contract);
  const noIncrement = [];
  for (const label of labels) {
    const minima = contract.minimum_risk_gates[label] ?? {};
    const keys = Object.keys(minima);
    if (keys.length === 0) {
      noIncrement.push(label);
      continue;
    }
    const covered = keys.every((gate) => {
      const actual = baseRouteRiskGates[gate] ?? 'none';
      return rank[actual] >= rank[minima[gate]];
    });
    if (covered) noIncrement.push(label);
  }
  return noIncrement;
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
  { level, profile, riskLabels = [], humanGates = {}, riskGates = {}, processMode = 'normal', execution },
) {
  const lightweightL = level === 'L' && (
    execution === 'light' || (processMode !== 'retrospective' && inferLightweightL(level, humanGates))
  );
  const route = deriveRoute(contract, {
    level,
    profile,
    riskLabels,
    lightweightL,
    processMode,
  });
  const effectiveRiskGates = {};
  for (const gate of contract.risk_gates) {
    effectiveRiskGates[gate] = riskGates[gate] ?? route.riskGates[gate] ?? 'none';
  }

  const approvalProcessGates = [];
  if (processMode !== 'retrospective' && (route.route === 'standard-m' || route.route === 'standard-l')) {
    approvalProcessGates.push('writing-plans');
  }
  for (const gate of contract.risk_gates) {
    if (gate === 'behavior_verification') continue;
    if (effectiveRiskGates[gate] !== 'none') {
      if (processMode !== 'retrospective') approvalProcessGates.push(RISK_GATE_COMPLETION_GATES[gate]);
    }
  }

  const finishProcessGates = processMode === 'retrospective'
    ? contract.risk_gates
        .filter((gate) => (
          !['requirements_coverage', 'plan_review', 'behavior_verification'].includes(gate) &&
          effectiveRiskGates[gate] !== 'none'
        ))
        .map((gate) => RISK_GATE_COMPLETION_GATES[gate])
    : [...approvalProcessGates];
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
      else if (rest[i] === '--entry-gate') flags.entryGate = rest[++i];
    }
    if (!flags.level || !flags.profile) {
      process.stderr.write('usage: dev-flow-policy.mjs derive --level <L> --profile <p> [--risk-labels a,b] [--lightweight-l] [--entry-gate <gate>]\n');
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
