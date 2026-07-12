#!/usr/bin/env node
/**
 * Small, dependency-free validation helper for dev-flow shell commands.
 * It deliberately validates only unambiguous machine data: identifiers,
 * repository-relative paths, context JSONL manifests and the constrained
 * machine-readable parts of dev-flow status frontmatter.
 */
import fs from 'node:fs';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`ERROR ${message}\n`);
  process.exit(2);
}

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

function validateAsset(root, featureRoot, reviewRoot, asset) {
  const absoluteRoot = path.resolve(root);
  const { featureRootPath, reviewRootPath } = validateRoots(absoluteRoot, featureRoot, reviewRoot);
  const assetPath = repositoryPath(absoluteRoot, asset, 'asset path');

  if (!isInside(featureRootPath, assetPath) && !isInside(reviewRootPath, assetPath)) {
    fail(`asset path is outside feature/review roots: ${asset}`);
  }
  rejectSymlinks(absoluteRoot, assetPath, 'asset path');
}

function validateRoots(root, featureRoot, reviewRoot) {
  const featureRootPath = repositoryPath(root, featureRoot, 'feature root');
  const reviewRootPath = repositoryPath(root, reviewRoot, 'review root');
  rejectSymlinks(root, featureRootPath, 'feature root');
  rejectSymlinks(root, reviewRootPath, 'review root');
  return { featureRootPath, reviewRootPath };
}

function validateManifest(root, manifestPath) {
  const absoluteRoot = path.resolve(root);
  const absoluteManifestPath = repositoryPath(absoluteRoot, manifestPath, 'context manifest path');
  rejectSymlinks(absoluteRoot, absoluteManifestPath, 'context manifest path');
  let content;
  try {
    content = fs.readFileSync(absoluteManifestPath, 'utf8');
  } catch (error) {
    fail(`cannot read context manifest ${manifestPath}: ${error.message}`);
  }

  const kinds = new Set(['spec', 'requirement', 'plan', 'research', 'review', 'verification']);
  const files = new Set();
  const output = [];

  content.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      fail(`context manifest ${manifestPath} line ${index + 1} is invalid JSON: ${error.message}`);
    }

    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      fail(`context manifest ${manifestPath} line ${index + 1} must be an object`);
    }
    if (typeof entry.file !== 'string' || entry.file.trim() === '') {
      fail(`context manifest ${manifestPath} line ${index + 1} has no non-empty file`);
    }
    if (!kinds.has(entry.kind)) {
      fail(`context manifest ${manifestPath} line ${index + 1} has an unknown kind: ${entry.kind ?? ''}`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      fail(`context manifest ${manifestPath} line ${index + 1} has no non-empty reason`);
    }
    const entryPath = repositoryPath(absoluteRoot, entry.file, `context manifest ${manifestPath} line ${index + 1} file`);
    rejectSymlinks(absoluteRoot, entryPath, `context manifest ${manifestPath} line ${index + 1} file`);
    if (files.has(entry.file)) {
      fail(`context manifest ${manifestPath} has a duplicate file entry: ${entry.file}`);
    }
    files.add(entry.file);
    output.push(entry.file);
  });

  process.stdout.write(output.length === 0 ? '' : `${output.join('\n')}\n`);
}

function validateClassification(root, statusPath) {
  const absoluteRoot = path.resolve(root);
  const absoluteStatusPath = repositoryPath(absoluteRoot, statusPath, 'status path');
  rejectSymlinks(absoluteRoot, absoluteStatusPath, 'status path');

  let content;
  try {
    content = fs.readFileSync(absoluteStatusPath, 'utf8');
  } catch (error) {
    fail(`cannot read status file ${statusPath}: ${error.message}`);
  }

  // Extract classification YAML block from frontmatter
  const lines = content.split(/\r?\n/);
  let inClassification = false;
  let classificationLines = [];

  for (const line of lines) {
    if (line.match(/^  classification:/)) {
      inClassification = true;
      continue;
    }
    if (inClassification) {
      if (line.match(/^  [a-z_]/) && !line.startsWith('   ')) {
        break; // next top-level key
      }
      classificationLines.push(line);
    }
  }

  if (classificationLines.length === 0) {
    // No classification block - not an error for non-classified features
    return;
  }

  // Parse key-value pairs from classification
  const fields = {};
  for (const line of classificationLines) {
    const m = line.match(/^    (\w+):\s*(.*)$/);
    if (m) {
      let value = m[2].trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fields[m[1]] = value;
    }
  }

  // Validate schema_version
  if (!fields.schema_version || fields.schema_version !== '1') {
    fail('classification schema_version must be "1"');
  }

  // Validate topology
  const validTopologies = ['local', 'shared-contract', 'multi-chain', 'coordinated-rollback'];
  if (!fields.topology || !validTopologies.includes(fields.topology)) {
    fail(`classification topology must be one of: ${validTopologies.join(', ')}`);
  }

  // Validate evidence_result
  const validEvidence = ['verified', 'partial', 'not-applicable'];
  if (fields.evidence_result && !validEvidence.includes(fields.evidence_result)) {
    fail(`classification evidence_result must be one of: ${validEvidence.join(', ')}`);
  }
}

const riskLabels = new Set([
  'security',
  'data',
  'money',
  'external',
  'availability',
  'critical_correctness',
  'irreversible_consequence',
]);

const gateLevels = {
  none: 0,
  light: 1,
  full: 2,
};

const knownRiskGates = new Set([
  'requirements_coverage',
  'plan_review',
  'rollback_units',
  'security_review',
  'behavior_verification',
]);

const minimumRiskGates = {
  security: {
    security_review: 'light',
    behavior_verification: 'light',
  },
  data: {
    rollback_units: 'light',
    behavior_verification: 'light',
  },
  money: {
    rollback_units: 'light',
    behavior_verification: 'light',
  },
  external: {
    behavior_verification: 'light',
  },
  availability: {
    behavior_verification: 'light',
  },
  critical_correctness: {
    behavior_verification: 'light',
  },
  irreversible_consequence: {
    rollback_units: 'light',
    behavior_verification: 'light',
  },
};

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

  return { absoluteRoot, absoluteStatusPath, content };
}

function statusLines(content) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'dev_flow_status:');
  if (start === -1) {
    fail('status file has no dev_flow_status frontmatter');
  }

  const end = lines.findIndex((line, index) => index > start && line === '---');
  if (end === -1) {
    fail('status file has unterminated frontmatter');
  }

  return lines.slice(start + 1, end);
}

function topLevelValue(lines, key) {
  const matches = lines.filter((line) => line.match(new RegExp(`^  ${key}:\\s*(.*)$`)));
  if (matches.length > 1) {
    fail(`status has duplicate ${key} fields`);
  }
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
    const line = lines[i];
    if (line.match(/^  [a-z_]+:/)) break;
    block.push(line);
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
  if (values.some((item) => item === '')) {
    fail(`${label} must not contain empty entries`);
  }
  return values;
}

function parseRiskGates(lines) {
  const block = blockLines(lines, 'risk_gates');
  if (!block) fail('v2 status requires risk_gates');

  const gates = {};
  for (const line of block) {
    if (line.trim() === '') continue;
    const match = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (!match) fail(`risk_gates has unsupported syntax: ${line}`);
    const [, gate, rawValue] = match;
    if (Object.hasOwn(gates, gate)) fail(`risk_gates has duplicate gate: ${gate}`);
    if (!knownRiskGates.has(gate)) fail(`risk_gates has unknown gate: ${gate}`);
    const value = unquote(rawValue);
    if (!Object.hasOwn(gateLevels, value)) {
      fail(`risk_gates.${gate} must be one of: ${Object.keys(gateLevels).join(', ')}`);
    }
    gates[gate] = value;
  }
  return gates;
}

function parseRiskEvidence(lines) {
  const inlineValue = topLevelValue(lines, 'risk_evidence');
  const block = blockLines(lines, 'risk_evidence');
  if (inlineValue === undefined && block === undefined) {
    fail('v2 status requires risk_evidence');
  }
  if (inlineValue === '{}') return {};
  if (!block) fail('risk_evidence must be a mapping or {}');

  const evidence = {};
  let currentLabel;
  for (const line of block) {
    if (line.trim() === '') continue;
    const entry = line.match(/^    ([a-z_]+):\s*$/);
    if (entry) {
      currentLabel = entry[1];
      if (Object.hasOwn(evidence, currentLabel)) {
        fail(`risk_evidence has duplicate label: ${currentLabel}`);
      }
      evidence[currentLabel] = {};
      continue;
    }

    const field = line.match(/^      ([a-z_]+):\s*(.*)$/);
    if (!field || !currentLabel) fail(`risk_evidence has unsupported syntax: ${line}`);
    const [, key, rawValue] = field;
    if (Object.hasOwn(evidence[currentLabel], key)) {
      fail(`risk_evidence.${currentLabel} has duplicate ${key}`);
    }
    evidence[currentLabel][key] = unquote(rawValue);
  }
  return evidence;
}

function hasMeaningfulEvidence(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return !new Set(['none', 'n/a', 'not required', 'not-applicable', '无', '不适用']).has(value.trim().toLowerCase());
}

function validateRiskContract(root, statusPath) {
  const { absoluteRoot, content } = readStatus(root, statusPath);
  const lines = statusLines(content);
  const schemaVersion = topLevelValue(lines, 'schema_version');

  // v1 predates the machine-checkable risk evidence contract.
  if (schemaVersion === '1') return;
  if (schemaVersion !== '2') {
    fail(`status schema_version must be "1" or "2": ${schemaVersion ?? ''}`);
  }

  const level = topLevelValue(lines, 'level');
  if (!['XS', 'S', 'M', 'L'].includes(level)) {
    fail(`v2 status level must be one of: XS, S, M, L`);
  }

  const profile = topLevelValue(lines, 'profile');
  if (!['standard', 'risk-minimal'].includes(profile)) {
    fail('v2 status profile must be "standard" or "risk-minimal"');
  }

  const labels = parseInlineList(topLevelValue(lines, 'risk_labels'), 'risk_labels');
  const duplicateLabels = labels.filter((label, index) => labels.indexOf(label) !== index);
  if (duplicateLabels.length > 0) {
    fail(`risk_labels has duplicate entries: ${[...new Set(duplicateLabels)].join(', ')}`);
  }
  const unknownLabels = labels.filter((label) => !riskLabels.has(label));
  if (unknownLabels.length > 0) {
    fail(`risk_labels has unknown entries: ${unknownLabels.join(', ')}`);
  }

  if (profile === 'risk-minimal') {
    if (!['XS', 'S'].includes(level)) {
      fail('risk-minimal profile is only valid for XS/S features');
    }
    if (labels.length === 0) {
      fail('risk-minimal profile requires non-empty risk_labels');
    }
  } else if (labels.length > 0 && ['XS', 'S'].includes(level)) {
    fail('XS/S features with risk_labels must use the risk-minimal profile');
  }

  if (['M', 'L'].includes(level) && profile !== 'standard') {
    fail('M/L features must use the standard profile');
  }

  const gates = parseRiskGates(lines);
  const evidence = parseRiskEvidence(lines);
  const evidenceLabels = Object.keys(evidence);
  const unexpectedEvidence = evidenceLabels.filter((label) => !labels.includes(label));
  if (unexpectedEvidence.length > 0) {
    fail(`risk_evidence has entries without matching risk_labels: ${unexpectedEvidence.join(', ')}`);
  }
  const missingEvidence = labels.filter((label) => !Object.hasOwn(evidence, label));
  if (missingEvidence.length > 0) {
    fail(`risk_evidence is missing labels: ${missingEvidence.join(', ')}`);
  }

  for (const label of labels) {
    const requirements = minimumRiskGates[label];
    for (const [gate, minimum] of Object.entries(requirements)) {
      const actual = gates[gate];
      if (!actual || gateLevels[actual] < gateLevels[minimum]) {
        fail(`risk label ${label} requires ${gate}: ${minimum} or full`);
      }
    }

    const entry = evidence[label];
    const allowedFields = new Set(['mode', 'conclusion', 'verification', 'report']);
    const unsupportedFields = Object.keys(entry).filter((key) => !allowedFields.has(key));
    if (unsupportedFields.length > 0) {
      fail(`risk_evidence.${label} has unsupported fields: ${unsupportedFields.join(', ')}`);
    }
    if (!['inline', 'report'].includes(entry.mode)) {
      fail(`risk_evidence.${label}.mode must be "inline" or "report"`);
    }
    if (!hasMeaningfulEvidence(entry.conclusion)) {
      fail(`risk_evidence.${label}.conclusion must be non-empty evidence`);
    }
    if (!hasMeaningfulEvidence(entry.verification)) {
      fail(`risk_evidence.${label}.verification must be non-empty evidence`);
    }

    const needsReport = Object.keys(requirements).some((gate) => gates[gate] === 'full');
    if (needsReport && entry.mode !== 'report') {
      fail(`risk_evidence.${label} must use report mode when a required gate is full`);
    }
    if (entry.mode === 'report') {
      if (!hasMeaningfulEvidence(entry.report)) {
        fail(`risk_evidence.${label}.report is required for report mode`);
      }
      const reportPath = repositoryPath(absoluteRoot, entry.report, `risk_evidence.${label}.report`);
      rejectSymlinks(absoluteRoot, reportPath, `risk_evidence.${label}.report`);
      try {
        if (!fs.statSync(reportPath).isFile()) {
          fail(`risk_evidence.${label}.report is not a file: ${entry.report}`);
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          fail(`risk_evidence.${label}.report does not exist: ${entry.report}`);
        }
        fail(`cannot inspect risk_evidence.${label}.report: ${error.message}`);
      }
    }
  }
}

switch (command) {
  case 'feature-id':
    if (args.length !== 1) fail('usage: dev-flow-validate.mjs feature-id <feature-id>');
    validateFeatureId(args[0]);
    break;
  case 'asset':
    if (args.length !== 4) fail('usage: dev-flow-validate.mjs asset <repo-root> <feature-root> <review-root> <asset-path>');
    validateAsset(...args);
    break;
  case 'roots':
    if (args.length !== 3) fail('usage: dev-flow-validate.mjs roots <repo-root> <feature-root> <review-root>');
    validateRoots(path.resolve(args[0]), args[1], args[2]);
    break;
  case 'manifest':
    if (args.length !== 2) fail('usage: dev-flow-validate.mjs manifest <repo-root> <manifest-path>');
    validateManifest(...args);
    break;
  case 'classification':
    if (args.length !== 2) fail('usage: dev-flow-validate.mjs classification <repo-root> <status-path>');
    validateClassification(path.resolve(args[0]), args[1]);
    break;
  case 'risk-contract':
    if (args.length !== 2) fail('usage: dev-flow-validate.mjs risk-contract <repo-root> <status-path>');
    validateRiskContract(path.resolve(args[0]), args[1]);
    break;
  default:
    fail(`unknown command: ${command ?? ''}`);
}
