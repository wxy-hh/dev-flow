#!/usr/bin/env node
/**
 * Dependency-free validation helper for dev-flow.
 * All workflow contract values (labels, gates, minimums, enums) come from
 * ../contract.json — the single source of truth. This script validates:
 *   - identifiers and repository-relative paths
 *   - v3 dev_flow_status frontmatter (schema, profiles, risk contract, assets)
 * Prose rules live in the dev-flow skill; this file only checks machine facts.
 */
import fs from 'node:fs';
import path from 'node:path';

const contract = JSON.parse(
  fs.readFileSync(new URL('../contract.json', import.meta.url), 'utf8'),
);

const [command, ...args] = process.argv.slice(2);

let checkFailures = 0;
function pass(message) {
  process.stdout.write(`PASS ${message}\n`);
}
function failCheck(message) {
  process.stdout.write(`FAIL ${message}\n`);
  checkFailures += 1;
}
function fail(message) {
  process.stderr.write(`ERROR ${message}\n`);
  process.exit(2);
}

// ---------- path safety ----------

function hasTraversal(value) {
  return value.split(/[\\/]/).some((segment) => segment === '.' || segment === '..');
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function rejectSymlinks(root, target, label) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative === '' ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        fail(`${label} passes through a symbolic link: ${current}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      fail(`cannot inspect ${label}: ${error.message}`);
    }
  }
}

function repositoryPath(root, value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    fail(`${label} contains a control character: ${value}`);
  }
  if (path.isAbsolute(value) || value.includes('\\') || hasTraversal(value)) {
    fail(`${label} must be a traversal-free repository-relative path: ${value}`);
  }
  const resolved = path.resolve(root, value);
  if (!isInside(root, resolved)) {
    fail(`${label} escapes the repository: ${value}`);
  }
  return resolved;
}

function validateFeatureId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    fail(`feature-id must contain only letters, digits, dots, underscores or hyphens: ${value ?? ''}`);
  }
  if (value.startsWith('.')) {
    fail(`feature-id must not start with a dot: ${value}`);
  }
}

function validateRoots(root, featureRoot, reviewRoot) {
  const featureRootPath = repositoryPath(root, featureRoot, 'feature root');
  const reviewRootPath = repositoryPath(root, reviewRoot, 'review root');
  rejectSymlinks(root, featureRootPath, 'feature root');
  rejectSymlinks(root, reviewRootPath, 'review root');
  return { featureRootPath, reviewRootPath };
}

function validateAsset(root, featureRoot, reviewRoot, asset) {
  const absoluteRoot = path.resolve(root);
  const { featureRootPath, reviewRootPath } = validateRoots(absoluteRoot, featureRoot, reviewRoot);
  const assetPath = repositoryPath(absoluteRoot, asset, 'asset path');
  if (!isInside(featureRootPath, assetPath) && !isInside(reviewRootPath, assetPath)) {
    fail(`asset path is outside feature/review roots: ${asset}`);
  }
  rejectSymlinks(absoluteRoot, assetPath, 'asset path');
}

// ---------- constrained YAML-subset parsing ----------

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readStatus(root, statusPath) {
  const absoluteRoot = path.resolve(root);
  const absoluteStatusPath = repositoryPath(absoluteRoot, statusPath, 'status path');
  rejectSymlinks(absoluteRoot, absoluteStatusPath, 'status path');
  let content;
  try {
    content = fs.readFileSync(absoluteStatusPath, 'utf8');
  } catch (error) {
    fail(`cannot read status file ${statusPath}: ${error.message}`);
  }
  return { absoluteRoot, content };
}

function statusLines(content) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'dev_flow_status:');
  if (start === -1) fail('status file has no dev_flow_status frontmatter');
  const end = lines.findIndex((line, index) => index > start && line === '---');
  if (end === -1) fail('status file has unterminated frontmatter');
  return lines.slice(start + 1, end);
}

function topLevelValue(lines, key) {
  const matches = lines.filter((line) => line.match(new RegExp(`^  ${key}:\\s*(.*)$`)));
  if (matches.length > 1) fail(`status has duplicate ${key} fields`);
  if (matches.length === 0) return undefined;
  return unquote(matches[0].replace(new RegExp(`^  ${key}:\\s*`), ''));
}

function blockLines(lines, key) {
  const indexes = lines
    .map((line, index) => (line.match(new RegExp(`^  ${key}:\\s*$`)) ? index : -1))
    .filter((index) => index !== -1);
  if (indexes.length === 0) return undefined;
  if (indexes.length > 1) fail(`status has duplicate ${key} blocks`);
  const [index] = indexes;
  const block = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    if (lines[i].match(/^  [a-z_]+:/)) break;
    block.push(lines[i]);
  }
  return block;
}

function parseInlineList(value, label) {
  if (typeof value !== 'string' || !value.startsWith('[') || !value.endsWith(']')) {
    fail(`${label} must be an inline YAML list`);
  }
  const body = value.slice(1, -1).trim();
  if (body === '') return [];
  const values = body.split(',').map((item) => unquote(item));
  if (values.some((item) => item === '')) fail(`${label} must not contain empty entries`);
  return values;
}

// Accepts either `  key: []` or a block of `    - item` lines.
function parseStringList(lines, key, label) {
  const inline = topLevelValue(lines, key);
  if (inline !== undefined && inline !== '') return parseInlineList(inline, label);
  const block = blockLines(lines, key);
  if (block === undefined) return undefined;
  const items = [];
  for (const line of block) {
    if (line.trim() === '') continue;
    const match = line.match(/^    - (.*)$/);
    if (!match) fail(`${label} has unsupported syntax: ${line}`);
    items.push(unquote(match[1]));
  }
  return items;
}

// Parses `  key:` blocks of `    name:` entries each holding `      field: value`.
function parseNestedMap(lines, key, label) {
  const block = blockLines(lines, key);
  if (block === undefined) return undefined;
  const map = {};
  let current;
  for (const line of block) {
    if (line.trim() === '') continue;
    const entry = line.match(/^    ([a-z_]+):\s*$/);
    if (entry) {
      current = entry[1];
      if (Object.hasOwn(map, current)) fail(`${label} has duplicate entry: ${current}`);
      map[current] = {};
      continue;
    }
    const field = line.match(/^      ([a-z_]+):\s*(.*)$/);
    if (!field || !current) fail(`${label} has unsupported syntax: ${line}`);
    if (Object.hasOwn(map[current], field[1])) fail(`${label}.${current} has duplicate ${field[1]}`);
    map[current][field[1]] = unquote(field[2]);
  }
  return map;
}

// Parses `  key:` block of flat `    field: value` lines.
function parseFlatBlock(lines, key, label) {
  const block = blockLines(lines, key);
  if (block === undefined) return undefined;
  const map = {};
  for (const line of block) {
    if (line.trim() === '') continue;
    const listItem = line.match(/^      - (.*)$/);
    if (listItem) {
      const lastKey = Object.keys(map).at(-1);
      if (!Array.isArray(map[lastKey])) fail(`${label} has a stray list item: ${line}`);
      map[lastKey].push(unquote(listItem[1]));
      continue;
    }
    const field = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (!field) fail(`${label} has unsupported syntax: ${line}`);
    if (Object.hasOwn(map, field[1])) fail(`${label} has duplicate ${field[1]}`);
    map[field[1]] = field[2].trim() === '' ? [] : unquote(field[2]);
    if (map[field[1]] === '[]') map[field[1]] = [];
  }
  return map;
}

// Parses `  assets:` entries written as `    - {path: "...", kind: "..."}`.
function parseAssets(lines) {
  const inline = topLevelValue(lines, 'assets');
  if (inline === '[]') return [];
  const block = blockLines(lines, 'assets');
  if (block === undefined) return undefined;
  const assets = [];
  for (const line of block) {
    if (line.trim() === '') continue;
    const match = line.match(/^    - \{path: "([^"]+)", kind: "([a-z]+)"\}$/);
    if (!match) fail(`assets entry must look like - {path: "<repo-path>", kind: "<kind>"}: ${line}`);
    assets.push({ path: match[1], kind: match[2] });
  }
  return assets;
}

function hasMeaningfulEvidence(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return !new Set(['none', 'n/a', 'not required', 'not-applicable', '无', '不适用']).has(value.trim().toLowerCase());
}

// ---------- v3 status validation ----------

function validateStatus(root, statusPath, finish) {
  const { absoluteRoot, content } = readStatus(root, statusPath);
  const lines = statusLines(content);

  const schemaVersion = topLevelValue(lines, 'schema_version');
  if (schemaVersion !== contract.status_schema) {
    failCheck(`status schema_version must be "${contract.status_schema}": ${schemaVersion ?? ''}`);
    return finishChecks();
  }
  pass('status schema_version is v3');

  const featureId = topLevelValue(lines, 'feature_id');
  if (featureId && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(featureId) && !featureId.startsWith('.')) {
    pass('status feature_id is well-formed');
  } else {
    failCheck(`status feature_id is missing or malformed: ${featureId ?? ''}`);
  }

  const level = topLevelValue(lines, 'level');
  if (!contract.levels.includes(level)) {
    failCheck(`status level must be one of: ${contract.levels.join(', ')}`);
  } else {
    pass('status level is recognized');
  }

  const profile = topLevelValue(lines, 'profile');
  if (!Object.hasOwn(contract.profiles, profile)) {
    failCheck(`status profile must be one of: ${Object.keys(contract.profiles).join(', ')}`);
  } else if (!contract.profiles[profile].levels.includes(level)) {
    failCheck(`profile ${profile} is not valid for level ${level}`);
  } else {
    pass('status profile matches level');
  }

  const labels = parseStringList(lines, 'risk_labels', 'risk_labels');
  if (labels === undefined) {
    failCheck('status requires risk_labels');
    return finishChecks();
  }
  const duplicateLabels = labels.filter((label, index) => labels.indexOf(label) !== index);
  if (duplicateLabels.length > 0) failCheck(`risk_labels has duplicates: ${[...new Set(duplicateLabels)].join(', ')}`);
  const unknownLabels = labels.filter((label) => !contract.risk_labels.includes(label));
  if (unknownLabels.length > 0) {
    failCheck(`risk_labels has unknown entries: ${unknownLabels.join(', ')}`);
  } else {
    pass('risk_labels are recognized');
  }

  if (profile === 'risk-minimal' && labels.length === 0) {
    failCheck('risk-minimal profile requires non-empty risk_labels');
  }
  if (profile === 'standard' && ['XS', 'S'].includes(level) && labels.length > 0) {
    failCheck('XS/S features with risk_labels must use the risk-minimal profile');
  }

  // classification
  const classification = parseFlatBlock(lines, 'classification', 'classification');
  if (!classification) {
    failCheck('status requires a classification block');
  } else {
    if (!contract.classification_topologies.includes(classification.topology)) {
      failCheck(`classification.topology must be one of: ${contract.classification_topologies.join(', ')}`);
    } else if (!contract.classification_evidence_results.includes(classification.evidence_result)) {
      failCheck(`classification.evidence_result must be one of: ${contract.classification_evidence_results.join(', ')}`);
    } else {
      pass('classification block is valid');
    }
  }

  // gates
  const currentGate = topLevelValue(lines, 'current_gate');
  if (contract.known_gates.includes(currentGate)) {
    pass('status current_gate is recognized');
  } else {
    failCheck(`status current_gate is missing or unknown: ${currentGate ?? ''}`);
  }

  const nextAction = topLevelValue(lines, 'next_action');
  if (nextAction && nextAction !== '<next-action>') {
    pass('status next_action is recorded');
  } else {
    failCheck('status next_action is missing');
  }

  const completedGates = parseStringList(lines, 'completed_gates', 'completed_gates') ?? [];
  const duplicateGates = completedGates.filter((gate, index) => completedGates.indexOf(gate) !== index);
  if (duplicateGates.length > 0) {
    failCheck(`completed_gates has duplicates: ${[...new Set(duplicateGates)].join(', ')}`);
  } else {
    pass('completed_gates has no duplicates');
  }
  const unknownGates = completedGates.filter((gate) => !contract.known_gates.includes(gate));
  if (unknownGates.length > 0) {
    failCheck(`completed_gates has unknown gates: ${unknownGates.join(', ')}`);
  } else {
    pass('completed_gates are recognized');
  }

  // risk gates
  const gates = parseFlatBlock(lines, 'risk_gates', 'risk_gates');
  if (!gates) {
    failCheck('status requires risk_gates');
    return finishChecks();
  }
  for (const [gate, value] of Object.entries(gates)) {
    if (!contract.risk_gates.includes(gate)) failCheck(`risk_gates has unknown gate: ${gate}`);
    if (!contract.gate_levels.includes(value)) failCheck(`risk_gates.${gate} must be one of: ${contract.gate_levels.join(', ')}`);
  }

  const gateRank = Object.fromEntries(contract.gate_levels.map((name, index) => [name, index]));
  let minimumsOk = true;
  for (const label of labels) {
    for (const [gate, minimum] of Object.entries(contract.minimum_risk_gates[label] ?? {})) {
      const actual = gates[gate];
      if (!actual || gateRank[actual] < gateRank[minimum]) {
        failCheck(`risk label ${label} requires ${gate}: ${minimum} or higher`);
        minimumsOk = false;
      }
    }
  }
  if (labels.length > 0 && minimumsOk) pass('risk labels meet their minimum gates');

  // risk evidence
  const inlineEvidence = topLevelValue(lines, 'risk_evidence');
  const evidence = inlineEvidence === '{}' ? {} : parseNestedMap(lines, 'risk_evidence', 'risk_evidence');
  if (evidence === undefined) {
    failCheck('status requires risk_evidence (use {} when no labels)');
    return finishChecks();
  }
  const extraEvidence = Object.keys(evidence).filter((label) => !labels.includes(label));
  if (extraEvidence.length > 0) failCheck(`risk_evidence has entries without matching risk_labels: ${extraEvidence.join(', ')}`);
  const missingEvidence = labels.filter((label) => !Object.hasOwn(evidence, label));
  if (missingEvidence.length > 0) failCheck(`risk_evidence is missing labels: ${missingEvidence.join(', ')}`);

  let evidenceOk = missingEvidence.length === 0 && extraEvidence.length === 0;
  for (const label of labels) {
    const entry = evidence[label];
    if (!entry) continue;
    const unsupported = Object.keys(entry).filter((key) => !['mode', 'conclusion', 'verification', 'report'].includes(key));
    if (unsupported.length > 0) { failCheck(`risk_evidence.${label} has unsupported fields: ${unsupported.join(', ')}`); evidenceOk = false; }
    if (!contract.evidence_modes.includes(entry.mode)) { failCheck(`risk_evidence.${label}.mode must be "inline" or "report"`); evidenceOk = false; continue; }
    if (!hasMeaningfulEvidence(entry.conclusion)) { failCheck(`risk_evidence.${label}.conclusion must be non-empty evidence`); evidenceOk = false; }
    if (!hasMeaningfulEvidence(entry.verification)) { failCheck(`risk_evidence.${label}.verification must be non-empty evidence`); evidenceOk = false; }
    const needsReport = Object.keys(contract.minimum_risk_gates[label] ?? {}).some((gate) => gates[gate] === 'full');
    if (needsReport && entry.mode !== 'report') { failCheck(`risk_evidence.${label} must use report mode when a required gate is full`); evidenceOk = false; }
    if (entry.mode === 'report') {
      if (!hasMeaningfulEvidence(entry.report)) { failCheck(`risk_evidence.${label}.report is required for report mode`); evidenceOk = false; continue; }
      const reportPath = repositoryPath(absoluteRoot, entry.report, `risk_evidence.${label}.report`);
      rejectSymlinks(absoluteRoot, reportPath, `risk_evidence.${label}.report`);
      let stat;
      try {
        stat = fs.statSync(reportPath);
      } catch (error) {
        if (error.code === 'ENOENT') { failCheck(`risk_evidence.${label}.report does not exist: ${entry.report}`); evidenceOk = false; continue; }
        fail(`cannot inspect risk_evidence.${label}.report: ${error.message}`);
      }
      if (!stat.isFile()) { failCheck(`risk_evidence.${label}.report is not a file: ${entry.report}`); evidenceOk = false; }
    }
  }
  if (labels.length > 0 && evidenceOk) pass('risk_evidence satisfies the contract');
  if (labels.length === 0 && Object.keys(evidence).length === 0) pass('no risk labels; empty risk_evidence is valid');

  // human gates
  const humanGates = parseNestedMap(lines, 'human_gates', 'human_gates');
  if (!humanGates) {
    failCheck('status requires human_gates');
    return finishChecks();
  }
  for (const gateName of contract.human_gates) {
    const gate = humanGates[gateName];
    if (!gate) { failCheck(`human_gates is missing ${gateName}`); continue; }
    if (!['true', 'false'].includes(gate.required)) failCheck(`human_gates.${gateName}.required must be true or false`);
    if (!contract.human_gate_statuses.includes(gate.status)) failCheck(`human_gates.${gateName}.status must be one of: ${contract.human_gate_statuses.join(', ')}`);
  }

  // assets
  const assets = parseAssets(lines);
  if (assets === undefined) {
    failCheck('status requires an assets list (use [] when empty)');
  } else {
    let assetsOk = true;
    for (const asset of assets) {
      if (asset.path.includes('#')) {
        failCheck(`asset path must not use path#heading form: ${asset.path}`);
        assetsOk = false;
        continue;
      }
      if (!contract.asset_kinds.includes(asset.kind)) { failCheck(`asset ${asset.path} has unknown kind: ${asset.kind}`); assetsOk = false; continue; }
      const assetPath = repositoryPath(absoluteRoot, asset.path, `asset ${asset.path}`);
      rejectSymlinks(absoluteRoot, assetPath, `asset ${asset.path}`);
      if (!fs.existsSync(assetPath)) { failCheck(`asset is registered but missing: ${asset.path}`); assetsOk = false; }
    }
    if (assetsOk) pass('registered assets exist and have valid kinds');
  }

  // accepted_risks (optional list of AR-xxx ids)
  const acceptedRisks = parseStringList(lines, 'accepted_risks', 'accepted_risks') ?? [];
  const badAr = acceptedRisks.filter((id) => !/^AR-[A-Za-z0-9_-]+$/.test(id));
  if (badAr.length > 0) {
    failCheck(`accepted_risks entries must look like AR-xxx: ${badAr.join(', ')}`);
  } else if (acceptedRisks.length > 0) {
    pass('accepted_risks ids are well-formed');
  }

  // optional gate_evidence (schema v3 optional block)
  const gateEvidence = parseGateEvidence(lines);
  if (gateEvidence !== undefined) {
    let geOk = true;
    for (const [gateName, evidence] of Object.entries(gateEvidence)) {
      if (!evidence.path || !evidence.heading) {
        failCheck(`gate_evidence.${gateName} requires path and heading`);
        geOk = false;
        continue;
      }
      if (evidence.path.includes('#')) {
        failCheck(`gate_evidence.${gateName}.path must not use path#heading form`);
        geOk = false;
        continue;
      }
      if (
        typeof evidence.path !== 'string' ||
        evidence.path.length === 0 ||
        path.isAbsolute(evidence.path) ||
        evidence.path.includes('\\') ||
        hasTraversal(evidence.path)
      ) {
        failCheck(`gate_evidence.${gateName}.path must be a traversal-free repository-relative path`);
        geOk = false;
        continue;
      }
      const evidenceAbs = path.resolve(absoluteRoot, evidence.path);
      if (!isInside(absoluteRoot, evidenceAbs)) {
        failCheck(`gate_evidence.${gateName}.path escapes the repository`);
        geOk = false;
        continue;
      }
      try {
        rejectSymlinks(absoluteRoot, evidenceAbs, `gate_evidence.${gateName}.path`);
      } catch {
        failCheck(`gate_evidence.${gateName}.path is unsafe`);
        geOk = false;
        continue;
      }
      if (!fs.existsSync(evidenceAbs)) {
        failCheck(`gate_evidence.${gateName}.path does not exist: ${evidence.path}`);
        geOk = false;
        continue;
      }
      const headingRe = new RegExp(
        `^#{1,6}\\s+${evidence.heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`,
        'gm',
      );
      const content = fs.readFileSync(evidenceAbs, 'utf8');
      const matches = content.match(headingRe) || [];
      if (matches.length !== 1) {
        failCheck(`gate_evidence.${gateName}.heading must appear exactly once (found ${matches.length})`);
        geOk = false;
      }
    }
    if (geOk && Object.keys(gateEvidence).length > 0) pass('gate_evidence is valid');
  }

  // validation block
  const validation = parseFlatBlock(lines, 'validation', 'validation');
  if (!validation || validation.business_diff_fingerprint === undefined) {
    failCheck('status requires validation.business_diff_fingerprint');
  } else {
    pass('validation block is present');
  }

  // finish-mode human gate enforcement
  // Lightweight vs standard is inferred from declared required gates:
  // - lightweight M: no required human gates
  // - standard M: both gates required
  // - lightweight L: only implementation_approval required
  // - standard L: both gates required
  // - risk-minimal XS/S: only implementation_approval required
  if (finish) {
    const requireGate = (gateName) => {
      const gate = humanGates?.[gateName];
      if (!gate || gate.required !== 'true') {
        failCheck(`${gateName} must be required for this feature`);
      } else if (gate.status === 'confirmed' || gate.status === 'skipped') {
        if (!hasMeaningfulEvidence(gate.evidence)) {
          failCheck(`${gateName} is ${gate.status} but has no evidence`);
        } else {
          pass(`${gateName} is ${gate.status} with evidence`);
        }
      } else {
        failCheck(`${gateName} is not confirmed`);
      }
    };

    const reqRequired = humanGates?.requirement_confirmation?.required === 'true';
    const implRequired = humanGates?.implementation_approval?.required === 'true';

    if (level === 'L') {
      // Lightweight L only needs implementation_approval; standard L needs both.
      if (reqRequired) {
        requireGate('requirement_confirmation');
        requireGate('implementation_approval');
      } else if (implRequired) {
        requireGate('implementation_approval');
        pass('lightweight L requires only implementation_approval');
      } else {
        failCheck('L features require implementation_approval (lightweight) or both human gates (standard)');
      }
    } else if (level === 'M') {
      if (reqRequired || implRequired) {
        // Standard M: both gates must be required and satisfied.
        requireGate('requirement_confirmation');
        requireGate('implementation_approval');
      } else {
        pass('lightweight M has no required human gates');
      }
    } else if (profile === 'risk-minimal') {
      requireGate('implementation_approval');
      if (!completedGates.includes('verification-before-completion')) {
        failCheck('risk-minimal feature must complete verification-before-completion');
      }
    } else {
      failCheck('finish check applies to M/L features or risk-minimal XS/S');
    }

    if (completedGates.includes('verification-before-completion')) {
      if (validation?.last_at === undefined || ['none', 'unknown', ''].includes(validation.last_at)) {
        failCheck('verification is completed but validation.last_at is missing');
      }
      const commands = validation?.commands;
      if (!Array.isArray(commands) || commands.length === 0) {
        failCheck('verification is completed but validation.commands is empty');
      } else {
        pass('validation commands are recorded');
      }
      if (!/^[0-9a-f]{40}$/.test(validation?.business_diff_fingerprint ?? '')) {
        failCheck('business_diff_fingerprint is missing or not a Git hash');
      }
    }

    // partial / verified outcome from manual-test steps when present
    validatePartialContract(absoluteRoot, featureId, acceptedRisks, assets);
  }

  return finishChecks();
}

function parseGateEvidence(lines) {
  const block = blockLines(lines, 'gate_evidence');
  if (block === undefined) return undefined;
  const map = {};
  let current;
  for (const line of block) {
    if (line.trim() === '') continue;
    const entry = line.match(/^    ([a-z_]+):\s*$/);
    if (entry) {
      current = entry[1];
      if (Object.hasOwn(map, current)) fail(`gate_evidence has duplicate entry: ${current}`);
      map[current] = {};
      continue;
    }
    const field = line.match(/^      (path|heading):\s*(.*)$/);
    if (!field || !current) fail(`gate_evidence has unsupported syntax: ${line}`);
    if (Object.hasOwn(map[current], field[1])) fail(`gate_evidence.${current} has duplicate ${field[1]}`);
    map[current][field[1]] = unquote(field[2]);
  }
  return map;
}

/**
 * Parse manual_test_steps from frontmatter or a 7-column markdown table.
 * Returns { steps, source } or null when no manual-test asset is registered.
 */
function loadManualTestSteps(root, assets) {
  const manualAssets = assets.filter((a) => /manual-test/.test(a.path));
  if (manualAssets.length === 0) return null;
  const file = path.resolve(root, manualAssets[0].path);
  if (!fs.existsSync(file)) return { steps: null, error: `manual-test missing: ${manualAssets[0].path}` };
  const content = fs.readFileSync(file, 'utf8');

  // Prefer YAML frontmatter / sidecar-style list
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const steps = [];
    const body = fm[1].split(/\r?\n/);
    let inSteps = false;
    let current = null;
    for (const line of body) {
      if (/^manual_test_steps:\s*$/.test(line)) {
        inSteps = true;
        continue;
      }
      if (inSteps) {
        const start = line.match(/^  - id:\s*(.+)$/);
        if (start) {
          if (current) steps.push(current);
          current = { id: unquote(start[1]), result: null, risk_id: null, observed: '', evidence: '' };
          continue;
        }
        if (current) {
          const field = line.match(/^    (result|risk_id|observed|evidence):\s*(.*)$/);
          if (field) {
            let value = unquote(field[2]);
            if (value === 'null' || value === '~' || value === '') value = null;
            current[field[1]] = value;
            continue;
          }
        }
        if (/^[a-z_]+:/.test(line) && !/^\s/.test(line)) {
          inSteps = false;
        }
      }
    }
    if (current) steps.push(current);
    if (steps.length > 0) return { steps, source: 'frontmatter' };
  }

  // Fallback: 7-column table
  // | ID | 操作 | 预期 | 结果 | 实测 | 证据 | 风险 ID |
  const steps = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (/ID|操作|预期|结果/.test(line) && /实测|证据|风险/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const [id, , , result, observed, evidence, riskId] = cells;
    if (!id || id === 'ID') continue;
    steps.push({
      id,
      result: result || null,
      risk_id: !riskId || riskId === '-' || riskId.toLowerCase() === 'null' ? null : riskId,
      observed: observed || '',
      evidence: evidence || '',
    });
  }
  if (steps.length === 0) return { steps: null, error: 'manual-test has no structured steps or parsable table' };
  return { steps, source: 'table' };
}

function loadPartialAcceptanceIds(root, featureId, assets) {
  const candidates = [
    ...assets.filter((a) => /partial-acceptance/.test(a.path)).map((a) => path.resolve(root, a.path)),
  ];
  // Also look beside review assets for <feature-id>-partial-acceptance.md
  for (const asset of assets) {
    const dir = path.dirname(path.resolve(root, asset.path));
    candidates.push(path.join(dir, `${featureId}-partial-acceptance.md`));
  }
  const seen = new Set();
  const ids = new Set();
  let foundFile = false;
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fs.existsSync(file)) continue;
    foundFile = true;
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/^##\s+(AR-[A-Za-z0-9_-]+)\s*$/gm)) {
      ids.add(match[1]);
    }
  }
  return { foundFile, ids };
}

function validatePartialContract(root, featureId, acceptedRisks, assets) {
  const loaded = loadManualTestSteps(root, assets ?? []);
  if (loaded === null) {
    // No manual-test asset: if accepted_risks non-empty, still require partial-acceptance
    if (acceptedRisks.length > 0) {
      const { foundFile, ids } = loadPartialAcceptanceIds(root, featureId, assets ?? []);
      if (!foundFile) {
        failCheck('accepted_risks is non-empty but partial-acceptance file is missing');
      } else {
        for (const id of acceptedRisks) {
          if (!ids.has(id)) failCheck(`accepted risk ${id} is missing from partial-acceptance`);
        }
      }
    }
    return;
  }
  if (loaded.error) {
    failCheck(loaded.error);
    return;
  }
  const steps = loaded.steps;
  const allowed = new Set(['passed', 'failed', 'skipped']);
  let hasFailed = false;
  let hasPending = false;
  const skippedRisks = [];
  for (const step of steps) {
    const result = (step.result || '').toLowerCase();
    if (!result || result === 'pending' || result === '待执行' || result === '_待执行_') {
      failCheck(`manual-test step ${step.id} has pending/empty result`);
      hasPending = true;
      continue;
    }
    if (!allowed.has(result)) {
      failCheck(`manual-test step ${step.id} has invalid result: ${step.result}`);
      continue;
    }
    if (result === 'failed') {
      failCheck(`manual-test step ${step.id} failed`);
      hasFailed = true;
    }
    if (result === 'skipped') {
      if (!step.risk_id || !/^AR-[A-Za-z0-9_-]+$/.test(step.risk_id)) {
        failCheck(`skipped step ${step.id} requires risk_id AR-xxx`);
      } else {
        skippedRisks.push(step.risk_id);
      }
    }
  }
  if (hasFailed || hasPending) return;

  const uniqueSkipped = [...new Set(skippedRisks)];
  const acceptedSet = new Set(acceptedRisks);
  for (const id of uniqueSkipped) {
    if (!acceptedSet.has(id)) failCheck(`skipped step risk ${id} is not in accepted_risks`);
  }
  for (const id of acceptedRisks) {
    if (!uniqueSkipped.includes(id)) {
      failCheck(`accepted risk ${id} is not referenced by any skipped step`);
    }
  }

  if (uniqueSkipped.length > 0) {
    const { foundFile, ids } = loadPartialAcceptanceIds(root, featureId, assets ?? []);
    if (!foundFile) {
      failCheck('partial outcome requires partial-acceptance file');
    } else {
      for (const id of uniqueSkipped) {
        if (!ids.has(id)) failCheck(`partial-acceptance is missing ${id}`);
      }
      for (const id of ids) {
        if (!uniqueSkipped.includes(id)) {
          failCheck(`partial-acceptance has extra ${id} not referenced by skipped steps`);
        }
      }
      pass('partial verification tri-party contract is consistent');
    }
  } else if (acceptedRisks.length === 0) {
    // verified path: no AR, no partial-acceptance required
    const { foundFile } = loadPartialAcceptanceIds(root, featureId, assets ?? []);
    if (foundFile) {
      // Allow empty/closed file; only fail if it still lists open ARs
      const { ids } = loadPartialAcceptanceIds(root, featureId, assets ?? []);
      if (ids.size > 0) {
        failCheck('verified outcome cannot retain open partial-acceptance AR entries');
      }
    }
    pass('manual-test steps are all passed (verified)');
  }
}

function finishChecks() {
  process.exit(checkFailures > 0 ? 1 : 0);
}

// ---------- entry ----------

switch (command) {
  case 'feature-id':
    if (args.length !== 1) fail('usage: dev-flow-validate.mjs feature-id <feature-id>');
    validateFeatureId(args[0]);
    break;
  case 'roots':
    if (args.length !== 3) fail('usage: dev-flow-validate.mjs roots <repo-root> <feature-root> <review-root>');
    validateRoots(path.resolve(args[0]), args[1], args[2]);
    break;
  case 'asset':
    if (args.length !== 4) fail('usage: dev-flow-validate.mjs asset <repo-root> <feature-root> <review-root> <asset-path>');
    validateAsset(...args);
    break;
  case 'status': {
    const finish = args.includes('--finish');
    const rest = args.filter((arg) => arg !== '--finish');
    if (rest.length !== 2) fail('usage: dev-flow-validate.mjs status <repo-root> <status-path> [--finish]');
    validateStatus(path.resolve(rest[0]), rest[1], finish);
    break;
  }
  case 'contract': {
    const required = ['workflow_version', 'status_schema', 'risk_labels', 'risk_gates', 'gate_levels',
      'minimum_risk_gates', 'profiles', 'human_gates', 'known_gates', 'asset_kinds', 'line_budgets'];
    const missing = required.filter((key) => !Object.hasOwn(contract, key));
    if (missing.length > 0) fail(`contract.json is missing keys: ${missing.join(', ')}`);
    const unmapped = contract.risk_labels.filter((label) => !Object.hasOwn(contract.minimum_risk_gates, label));
    if (unmapped.length > 0) fail(`contract.json risk labels lack minimum gates: ${unmapped.join(', ')}`);
    process.stdout.write(`${contract.workflow_version}\n`);
    break;
  }
  default:
    fail(`unknown command: ${command ?? ''}`);
}
