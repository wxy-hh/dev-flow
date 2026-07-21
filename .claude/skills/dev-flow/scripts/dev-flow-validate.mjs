#!/usr/bin/env node
/**
 * Layer 1: read-only validator for dev-flow.
 * All workflow contract values (labels, gates, minimums, enums) come from
 * ../contract.json — the single source of truth. This script validates:
 *   - identifiers and repository-relative paths
 *   - v4 dev_flow_status frontmatter (schema, process, profiles, risk contract, assets)
 * Prose rules live in the dev-flow skill; this file only checks machine facts.
 * Calls Layer 0 (policy) only. Must not write status, check-ok, or assets.
 * Must not call status CLI, feature-check, or feature-finalize.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  RISK_GATE_COMPLETION_GATES,
  gateRank as policyGateRank,
  loadContract,
  routeObligations,
  labelsWithNoGateIncrement,
  validateTopology,
} from './dev-flow-policy.mjs';

const contract = loadContract();

const [command, ...args] = process.argv.slice(2);

const MANUAL_METHODS = new Set(['browser', 'device', 'api', 'cli', 'automated']);
const NON_RUNTIME_METHODS = new Set([
  'static-review',
  'static_review',
  'code-review',
  'code_review',
  'lint',
  'type-check',
  'typecheck',
  'type_check',
]);

function automatedEvidenceHasCommandAndTestId(evidence) {
  const value = String(evidence ?? '');
  const placeholder = '(?:none|n/a|pending|unknown|待执行|未知)';
  const commandRef = new RegExp(
    `(?:^|[\\s;,，；])(?:command|cmd|命令)\\s*[:=：]\\s*(?!${placeholder}(?:\\s|$))\\S+`,
    'i',
  );
  const testRef = new RegExp(
    `(?:^|[\\s;,，；])(?:test(?:[_ -]?(?:id|case))?|case|spec|测试(?:标识|id|用例)?)\\s*[:=：]\\s*(?!${placeholder}(?:\\s|$))\\S+`,
    'i',
  );
  return commandRef.test(value) && testRef.test(value);
}

let checkFailures = 0;
function pass(message) {
  process.stdout.write(`PASS ${message}\n`);
}
function failCheck(message) {
  process.stdout.write(`FAIL ${message}\n`);
  checkFailures += 1;
}
function warn(message) {
  process.stdout.write(`WARN ${message}\n`);
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

function hasCompletedEvidence(value) {
  if (!hasMeaningfulEvidence(value)) return false;
  return !new Set(['pending', 'unknown', 'todo', 'tbd', '待执行', '待确认']).has(
    value.trim().toLowerCase(),
  );
}

function securityInlineEvidenceProblem(summary) {
  const value = String(summary || '');
  const hasResult = /(通过|拒绝|失败|覆盖|已验证|验证通过|pass(?:ed)?|deny|denied|fail(?:ed)?|verified|covered|tested)/i.test(value);
  const authScope = /(?:scope\s*[:=]\s*auth|范围\s*[:：]\s*(?:鉴权|认证|授权)|鉴权|认证|授权|\bauth(?:entication|orization)?\b|\bsso\b)/i.test(value);
  const authMatrixOrBranch = /(矩阵|matrix|匿名|账号|oauth|token|session|角色|role|行为分支|分支|branch)/i.test(value);
  const authSurface = /(登录|login|sso|token|session|权限|permission|鉴权|认证|授权|auth(?:entication|orization)?)/i.test(value);
  const noAuthTouch = /(不触及|不涉及|未触及|未修改|没有(?:改动|修改|触及)|does not touch|not affected|not modify|not changed|no .*change|unaffected)/i.test(value);
  const reason = /(原因|因为|由于|鉴于|本次(?:仅|只)|仅修改|只修改|变更仅限|because|since|reason|rationale|why)/i.test(value);

  // Preserve v1.0.0's useful shorthand, such as
  // "Auth matrix verified: anonymous denied, account and OAuth allowed".
  if (authScope && hasResult && (authMatrixOrBranch || (authSurface && noAuthTouch && reason))) {
    return '';
  }

  const privacyScope = /(?:scope\s*[:=]\s*(?:privacy|sensitive)|范围\s*[:：]\s*(?:隐私|敏感(?:字段|信息)?)|隐私|敏感(?:字段|信息)?|\bprivacy\b|\bsensitive(?:[ -]?(?:field|data))?\b)/i.test(value);
  const allowlist = /(白名单|允许字段|允许输出|字段允许|whitelist|allow(?:ed)?(?:[ -]?fields?)?)/i.test(value);
  const exclusions = /(排除字段|排除|不包含|不得包含|黑名单|excluded?|exclude|blocklist|denylist)/i.test(value);
  const enforcement = /(数据构建|构建层|序列化|导出(?:\s*props?|层)?|props?|serialization|data construction|builder|强制边界|enforce(?:ment|d)?|boundary)/i.test(value);
  if (privacyScope && hasResult && allowlist && exclusions && enforcement) return '';

  if (!hasResult) return '缺少明确的验证结果';
  if (privacyScope) return '隐私证据必须同时说明白名单、排除字段和强制边界';
  if (authScope) return '鉴权证据必须列出矩阵/行为分支，或说明具体鉴权面未触及、原因和验证结论';
  return '缺少鉴权或隐私范围';
}

function scanOwnedSecretAssignments(root, relativePaths) {
  const findings = [];
  const placeholder = /^(?:none|null|n\/a|pending|unknown|redacted|masked|example|changeme|<.*>|\$\{.*\}|\*+)$/i;
  for (const relative of [...new Set(relativePaths.filter(Boolean))]) {
    const absolute = path.resolve(root, relative);
    if (!isInside(root, absolute) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const content = fs.readFileSync(absolute, 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
      findings.push({ path: relative, key: 'private-key' });
    }
    for (const line of content.split(/\r?\n/)) {
      const dotenv = line.match(/^\s*([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(.+)\s*$/);
      const structured = line.match(/^\s*["']?((?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|private[_-]?key))["']?\s*[:=]\s*["']?([^"'#\s][^"'#]*)["']?\s*[,#]?\s*$/i);
      const match = dotenv || structured;
      if (!match) continue;
      const value = String(match[2]).trim().replace(/^['"]|['"]$/g, '');
      if (value.length >= 8 && !placeholder.test(value)) findings.push({ path: relative, key: match[1] });
    }
  }
  return findings;
}

function isIso8601Timestamp(value) {
  const match = String(value ?? '').match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 23 || offsetMinute > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && !Number.isNaN(Date.parse(value));
}

// ---------- v4 status validation ----------

function validateStatus(root, statusPath, stage = 'current') {
  const { absoluteRoot, content } = readStatus(root, statusPath);
  const lines = statusLines(content);

  const schemaVersion = topLevelValue(lines, 'schema_version');
  if (schemaVersion !== contract.status_schema) {
    failCheck(`status schema_version must be "${contract.status_schema}": ${schemaVersion ?? ''}`);
    return finishChecks();
  }
  pass('status schema_version is v4');

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

  if (profile === 'standard' && ['XS', 'S'].includes(level) && labels.length > 0) {
    failCheck('XS/S features with risk_labels must use the risk-minimal profile');
  }

  const processInfo = parseFlatBlock(lines, 'process', 'process');
  if (!processInfo) {
    failCheck('status requires a process block');
    return finishChecks();
  }
  let processOk = true;
  if (!contract.process_modes.includes(processInfo.mode)) {
    failCheck(`process.mode must be one of: ${contract.process_modes.join(', ')}`);
    processOk = false;
  }
  if (profile === 'risk-minimal' && labels.length === 0 && processInfo.mode !== 'retrospective') {
    failCheck('risk-minimal profile requires non-empty risk_labels except in retrospective mode');
  }
  if (!isIso8601Timestamp(processInfo.started_at)) {
    failCheck('process.started_at must be an ISO-8601 timestamp');
    processOk = false;
  }
  if (!/^[0-9a-f]{40}$/.test(processInfo.baseline_business_diff_fingerprint ?? '')) {
    failCheck('process.baseline_business_diff_fingerprint must be a Git hash');
    processOk = false;
  }
  if (!contract.existing_diff_dispositions.includes(processInfo.existing_diff)) {
    failCheck(`process.existing_diff must be one of: ${contract.existing_diff_dispositions.join(', ')}`);
    processOk = false;
  }
  if (processInfo.mode === 'normal' && processInfo.existing_diff === 'clean' && processInfo.reason !== 'none') {
    failCheck('normal clean process requires reason: none');
    processOk = false;
  }
  if (
    (processInfo.existing_diff !== 'clean' || processInfo.mode === 'retrospective') &&
    !hasMeaningfulEvidence(processInfo.reason)
  ) {
    failCheck('retrospective or dirty process requires a meaningful reason');
    processOk = false;
  }
  if (processInfo.existing_diff === 'in-scope' && processInfo.mode !== 'retrospective') {
    failCheck('in-scope existing diff requires retrospective process mode');
    processOk = false;
  }
  if (processInfo.mode === 'normal' && processInfo.existing_diff === 'in-scope') {
    failCheck('normal process cannot declare in-scope existing diff');
    processOk = false;
  }
  if (processOk) pass('process block is valid');

  // classification
  const classification = parseFlatBlock(lines, 'classification', 'classification');
  if (!classification) {
    failCheck('status requires a classification block');
  } else {
    if (!contract.classification_topologies.includes(classification.topology)) {
      failCheck(`classification.topology must be one of: ${contract.classification_topologies.join(', ')}`);
    } else if (validateTopology(contract, level, classification.topology)) {
      failCheck(validateTopology(contract, level, classification.topology));
    } else if (!contract.execution_modes.includes(classification.execution)) {
      failCheck(`classification.execution must be one of: ${contract.execution_modes.join(', ')}`);
    } else if (profile === 'risk-minimal' && classification.execution !== 'light') {
      failCheck('risk-minimal status requires classification.execution: light');
    } else if (profile === 'standard' && level === 'M' && classification.execution !== 'standard') {
      failCheck('status-bearing standard M requires classification.execution: standard');
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

  const gateRank = policyGateRank(contract);
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
    // Stage-aware: init/current may keep pending evidence without report files
    // even when route gates are already full (reports are produced later).
    const pendingEvidence =
      stage === 'current' &&
      (!hasCompletedEvidence(entry.conclusion) || !hasCompletedEvidence(entry.verification));
    const enforceReportMode =
      !pendingEvidence &&
      Object.keys(contract.minimum_risk_gates[label] ?? {}).some((gate) => gates[gate] === 'full');
    if (enforceReportMode && entry.mode !== 'report') {
      failCheck(
        `risk_evidence.${label} must use report mode when a required gate is full (see status-cli.md; complete-gate + add-asset when report exists)`,
      );
      evidenceOk = false;
    }
    if (entry.mode === 'report') {
      if (!hasMeaningfulEvidence(entry.report)) {
        if (!pendingEvidence) {
          failCheck(`risk_evidence.${label}.report is required for report mode`);
          evidenceOk = false;
        }
        continue;
      }
      const reportPath = repositoryPath(absoluteRoot, entry.report, `risk_evidence.${label}.report`);
      rejectSymlinks(absoluteRoot, reportPath, `risk_evidence.${label}.report`);
      const config = loadProjectConfig(absoluteRoot);
      if (!config.featureRoot || !config.reviewRoot) {
        failCheck('project workflow has no feature_root/review_root');
        evidenceOk = false;
        continue;
      }
      const { featureRootPath, reviewRootPath } = validateRoots(
        absoluteRoot,
        config.featureRoot,
        config.reviewRoot,
      );
      if (!isInside(featureRootPath, reportPath) && !isInside(reviewRootPath, reportPath)) {
        failCheck(`risk_evidence.${label}.report is outside feature/review roots: ${entry.report}`);
        evidenceOk = false;
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(reportPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          if (!pendingEvidence) {
            failCheck(`risk_evidence.${label}.report does not exist: ${entry.report}`);
            evidenceOk = false;
          }
          continue;
        }
        fail(`cannot inspect risk_evidence.${label}.report: ${error.message}`);
      }
      if (stat && !stat.isFile()) {
        failCheck(`risk_evidence.${label}.report is not a file: ${entry.report}`);
        evidenceOk = false;
      }
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

  const obligations = routeObligations(contract, {
    level,
    profile,
    riskLabels: labels,
    humanGates,
    riskGates: gates,
    processMode: processInfo.mode,
    execution: classification?.execution,
  });
  if (labels.length > 0 && stage === 'current') {
    const baseRoute = routeObligations(contract, {
      level,
      profile,
      riskLabels: [],
      humanGates,
      riskGates: {},
      processMode: processInfo.mode,
      execution: classification?.execution,
    });
    const noInc = labelsWithNoGateIncrement(contract, labels, baseRoute.effectiveRiskGates);
    for (const label of noInc) {
      warn(
        `INFO risk label ${label} does not raise gate strength beyond the current route (kept for audit; not auto-stripped)`,
      );
    }
  }
  for (const gateName of contract.human_gates) {
    const expected = obligations.humanGates[gateName]?.required === true;
    const actual = humanGates?.[gateName]?.required === 'true';
    if (actual !== expected) {
      failCheck(
        `route ${obligations.route} requires human_gates.${gateName}.required to be ${expected}`,
      );
    }
  }
  let routeMinimumsOk = true;
  for (const gateName of contract.risk_gates) {
    const actual = gates[gateName];
    const minimum = obligations.riskGates[gateName] ?? 'none';
    if (!actual || gateRank[actual] < gateRank[minimum]) {
      failCheck(`route ${obligations.route} requires risk_gates.${gateName}: ${minimum} or higher`);
      routeMinimumsOk = false;
    }
  }
  if (routeMinimumsOk) pass(`risk gates satisfy route ${obligations.route}`);

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
  const secretFindings = scanOwnedSecretAssignments(
    absoluteRoot,
    [statusPath, ...(assets ?? []).map((asset) => asset.path)],
  );
  if (secretFindings.length > 0) {
    for (const finding of secretFindings) {
      failCheck(`managed asset contains a likely secret assignment: ${finding.path} (${finding.key})`);
    }
  } else {
    pass('managed assets contain no high-confidence secret assignments');
  }

  // accepted_risks (optional list of AR-xxx ids)
  const acceptedRisks = parseStringList(lines, 'accepted_risks', 'accepted_risks') ?? [];
  const badAr = acceptedRisks.filter((id) => !/^AR-[A-Za-z0-9_-]+$/.test(id));
  if (badAr.length > 0) {
    failCheck(`accepted_risks entries must look like AR-xxx: ${badAr.join(', ')}`);
  } else if (acceptedRisks.length > 0) {
    pass('accepted_risks ids are well-formed');
  }

  // optional gate_evidence reuses contract.evidence_modes
  const gateEvidence = parseGateEvidence(lines);
  if (gateEvidence !== undefined) {
    let geOk = true;
    for (const [gateName, evidence] of Object.entries(gateEvidence)) {
      if (!contract.evidence_modes.includes(evidence.mode)) {
        failCheck(`gate_evidence.${gateName}.mode must be inline or report`);
        geOk = false;
        continue;
      }
      const fields = Object.keys(evidence);
      if (evidence.mode === 'inline') {
        const unsupported = fields.filter((field) => !['mode', 'summary'].includes(field));
        if (unsupported.length || !hasMeaningfulEvidence(evidence.summary)) {
          failCheck(`gate_evidence.${gateName} inline mode requires only mode and meaningful summary`);
          geOk = false;
        } else if (gateName.replace(/-/g, '_') === 'security_review') {
          const problem = securityInlineEvidenceProblem(evidence.summary);
          if (problem) {
            failCheck(
              `gate_evidence.${gateName} inline summary invalid: ${problem}. ` +
                'Examples: scope=auth; anonymous denied, account allowed; result=verified. ' +
                'scope=privacy；白名单：id,name；排除字段：token,email；强制边界：序列化导出 props；结果：通过。',
            );
            geOk = false;
          }
        }
        continue;
      }
      const unsupported = fields.filter((field) => !['mode', 'path', 'heading'].includes(field));
      if (unsupported.length || !evidence.path || !evidence.heading) {
        failCheck(`gate_evidence.${gateName} report mode requires only mode, path, and heading`);
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

  if (stage === 'approval' || stage === 'finish') {
    for (const gateName of contract.human_gates) {
      if (obligations.humanGates[gateName]?.required !== true) continue;
      const gate = humanGates?.[gateName];
      if (gate?.status !== 'confirmed') {
        failCheck(`${stage} requires ${gateName} to be confirmed`);
      } else if (!hasMeaningfulEvidence(gate.evidence)) {
        failCheck(`${gateName} is ${gate.status} but has no meaningful evidence`);
      } else {
        pass(`${gateName} is ${gate.status} with evidence`);
      }
    }

    const registeredAssets = assets ?? [];
    const evidenceForRiskGate = (riskGate, requiredLevel) => {
      const relevantLabels = labels.filter((label) =>
        Object.hasOwn(contract.minimum_risk_gates[label] ?? {}, riskGate),
      );
      if (relevantLabels.length === 0) return false;
      return relevantLabels.every((label) => {
        const entry = evidence[label];
        if (
          !entry ||
          !hasCompletedEvidence(entry.conclusion) ||
          !hasCompletedEvidence(entry.verification)
        ) {
          return false;
        }
        return requiredLevel !== 'full' || (entry.mode === 'report' && hasCompletedEvidence(entry.report));
      });
    };
    const registeredRiskReportFor = (riskGate) => {
      const relevantLabels = labels.filter((label) =>
        Object.hasOwn(contract.minimum_risk_gates[label] ?? {}, riskGate),
      );
      return relevantLabels.length > 0 && relevantLabels.every((label) => {
        const entry = evidence[label];
        return entry?.mode === 'report' && registeredAssets.some((asset) => asset.path === entry.report);
      });
    };
    const gateEvidenceFor = (completedGate) =>
      gateEvidence?.[completedGate.replace(/-/g, '_')];
    const requireRegisteredEvidence = (completedGate, kind) => {
      const entry = gateEvidenceFor(completedGate);
      if (entry?.mode !== 'report' || !entry.path || !entry.heading) return false;
      return registeredAssets.some(
        (asset) => asset.path === entry.path && (!kind || asset.kind === kind),
      );
    };
    const completedToRiskGate = Object.fromEntries(
      Object.entries(RISK_GATE_COMPLETION_GATES).map(([riskGate, completedGate]) => [
        completedGate,
        riskGate,
      ]),
    );
    const requiredProcessGates =
      stage === 'approval' ? obligations.approvalProcessGates : obligations.finishProcessGates;

    for (const completedGate of requiredProcessGates) {
      if (!completedGates.includes(completedGate)) {
        failCheck(`${stage} requires completed_gates to include ${completedGate}`);
        continue;
      }
      pass(`${completedGate} is completed`);

      if (completedGate === 'writing-plans') {
        if (registeredAssets.some((asset) => asset.kind === 'plan')) {
          pass('writing-plans has a registered plan asset');
        } else {
          failCheck('writing-plans requires a registered plan asset');
        }
        continue;
      }

      if (completedGate === 'code-review') {
        const entry = gateEvidenceFor(completedGate);
        const inline = entry?.mode === 'inline' && hasMeaningfulEvidence(entry.summary);
        const report = entry?.mode === 'report' && entry.path && entry.heading;
        if (!inline && !report) {
          failCheck('code-review requires valid inline or report gate_evidence.code_review');
        } else if (
          obligations.codeReview.evidence_level === 'full' &&
          (!report || !requireRegisteredEvidence(completedGate, 'review'))
        ) {
          failCheck('full code-review requires its independent report to be a registered review asset');
        } else {
          pass(`code-review ${obligations.codeReview.evidence_level} evidence is present`);
        }
        continue;
      }

      if (completedGate === 'verification-before-completion') {
        if (
          validation?.last_at === undefined ||
          ['none', 'unknown', ''].includes(validation.last_at)
        ) {
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

        const behaviorLevel = gates.behavior_verification ?? 'none';
        if (
          behaviorLevel !== 'none' &&
          labels.some((label) =>
            Object.hasOwn(contract.minimum_risk_gates[label] ?? {}, 'behavior_verification'),
          ) &&
          !evidenceForRiskGate('behavior_verification', behaviorLevel)
        ) {
          failCheck('behavior_verification risk evidence is incomplete or still pending');
        }
        if (
          behaviorLevel === 'full' &&
          !evidenceForRiskGate('behavior_verification', 'full') &&
          !registeredAssets.some((asset) => asset.kind === 'verification')
        ) {
          failCheck('full behavior_verification requires an independent verification asset');
        }
        continue;
      }

      const riskGate = completedToRiskGate[completedGate];
      if (!riskGate) continue;
      const requiredLevel = gates[riskGate] ?? 'none';
      const inlineOrReportEvidence = evidenceForRiskGate(riskGate, requiredLevel);
      const entry = gateEvidenceFor(completedGate);
      const gateInline = entry?.mode === 'inline' && hasMeaningfulEvidence(entry.summary);
      const fileEvidence = entry?.mode === 'report' && entry.path && entry.heading;
      if (!inlineOrReportEvidence && !gateInline && !fileEvidence) {
        failCheck(
          `${completedGate} ${requiredLevel} requires completed risk_evidence or gate_evidence`,
        );
      } else if (
        requiredLevel === 'full' &&
        !registeredRiskReportFor(riskGate) &&
        (!fileEvidence || !requireRegisteredEvidence(completedGate))
      ) {
        failCheck(`${completedGate} full evidence must be a registered independent asset`);
      } else {
        pass(`${completedGate} ${requiredLevel} evidence is present`);
      }
    }

    if (stage === 'finish') {
      // partial / verified outcome from manual-test steps when present
      validatePartialContract(absoluteRoot, featureId, acceptedRisks, assets, {
        behaviorLevel: gates.behavior_verification ?? 'none',
      });
    }
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
    const field = line.match(/^      (mode|summary|path|heading):\s*(.*)$/);
    if (!field || !current) fail(`gate_evidence has unsupported syntax: ${line}`);
    if (Object.hasOwn(map[current], field[1])) fail(`gate_evidence.${current} has duplicate ${field[1]}`);
    map[current][field[1]] = unquote(field[2]);
  }
  return map;
}

function manualStepAgreementError(frontmatterSteps, tableSteps) {
  const duplicateIds = (steps) =>
    [...new Set(steps.map((step) => step.id).filter((id, index, ids) => ids.indexOf(id) !== index))];
  const frontmatterDuplicates = duplicateIds(frontmatterSteps);
  const tableDuplicates = duplicateIds(tableSteps);
  if (frontmatterDuplicates.length > 0 || tableDuplicates.length > 0) {
    return `manual-test has duplicate IDs (frontmatter: ${frontmatterDuplicates.join(', ') || 'none'}; table: ${tableDuplicates.join(', ') || 'none'})`;
  }
  const frontmatterById = new Map(frontmatterSteps.map((step) => [step.id, step]));
  const tableById = new Map(tableSteps.map((step) => [step.id, step]));
  const allIds = [...new Set([...frontmatterById.keys(), ...tableById.keys()])];
  const mismatches = [];
  for (const id of allIds) {
    const frontmatter = frontmatterById.get(id);
    const table = tableById.get(id);
    if (!frontmatter || !table) {
      mismatches.push(`${id}: missing from ${frontmatter ? 'table' : 'frontmatter'}`);
      continue;
    }
    const frontmatterResult = String(frontmatter.result ?? '').trim().toLowerCase();
    const tableResult = String(table.result ?? '').trim().toLowerCase();
    const frontmatterRisk = frontmatter.risk_id || null;
    const tableRisk = table.risk_id || null;
    if (frontmatterResult !== tableResult || frontmatterRisk !== tableRisk) {
      mismatches.push(
        `${id}: frontmatter(result=${frontmatterResult || 'empty'}, risk_id=${frontmatterRisk || 'null'}) != table(result=${tableResult || 'empty'}, risk_id=${tableRisk || 'null'})`,
      );
    }
  }
  return mismatches.length > 0
    ? `manual-test frontmatter/table mismatch: ${mismatches.join('; ')}`
    : null;
}

/**
 * Parse manual_test_steps from frontmatter and/or a 7-column markdown table.
 * When both representations exist, their ID/result/risk_id facts must agree.
 * Returns { steps, source } or null when no manual-test asset is registered.
 */
function loadManualTestSteps(root, assets) {
  const manualAssets = assets.filter((a) => /manual-test/.test(a.path));
  if (manualAssets.length === 0) return null;
  const file = path.resolve(root, manualAssets[0].path);
  if (!fs.existsSync(file)) return { steps: null, error: `manual-test missing: ${manualAssets[0].path}` };
  const content = fs.readFileSync(file, 'utf8');

  // YAML frontmatter / sidecar-style list
  let frontmatterSteps = [];
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
          current = {
            id: unquote(start[1]),
            result: null,
            risk_id: null,
            observed: '',
            evidence: '',
            method: null,
          };
          continue;
        }
        if (current) {
          const field = line.match(/^    (result|risk_id|observed|evidence|method):\s*(.*)$/);
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
    frontmatterSteps = steps;
  }

  // 7-column table
  // | ID | 操作 | 预期 | 结果 | 实测 | 证据 | 风险 ID |
  const tableSteps = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (/ID|操作|预期|结果/.test(line) && /实测|证据|风险/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const [id, , , result, observed, evidence, riskId] = cells;
    if (!id || id === 'ID') continue;
    tableSteps.push({
      id,
      result: result || null,
      risk_id: !riskId || riskId === '-' || riskId.toLowerCase() === 'null' ? null : riskId,
      observed: observed || '',
      evidence: evidence || '',
    });
  }
  if (frontmatterSteps.length > 0 && tableSteps.length > 0) {
    const mismatch = manualStepAgreementError(frontmatterSteps, tableSteps);
    if (mismatch) return { steps: null, error: mismatch };
    return { steps: frontmatterSteps, source: 'frontmatter+table' };
  }
  if (frontmatterSteps.length > 0) {
    return { steps: frontmatterSteps, source: 'frontmatter' };
  }
  if (tableSteps.length > 0) {
    return { steps: tableSteps, source: 'table' };
  }
  if (tableSteps.length === 0) {
    return {
      steps: null,
      error:
        'manual-test has no structured steps or parsable table (see references/partial-verification.md; expect 7-col: ID|操作|预期|结果|实测|证据|风险 ID or frontmatter manual_test_steps)',
    };
  }
  return { steps: tableSteps, source: 'table' };
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

function validatePartialContract(root, featureId, acceptedRisks, assets, options = {}) {
  const behaviorLevel = options.behaviorLevel ?? 'none';
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
  const allowed = new Set(contract.manual_test_results.filter((result) => result !== 'pending'));
  let hasFailed = false;
  let hasPending = false;
  const skippedRisks = [];
  for (const step of steps) {
    const result = (step.result || '').toLowerCase();
    if (!result || result === 'pending' || result === 'delegated' || result === '待执行' || result === '_待执行_') {
      failCheck(`manual-test step ${step.id} has pending/empty result`);
      hasPending = true;
      continue;
    }
    if (!allowed.has(result)) {
      failCheck(`manual-test step ${step.id} has invalid result: ${step.result}`);
      continue;
    }
    const method = (step.method || '').toString().trim().toLowerCase();
    if (result === 'passed') {
      if (!hasMeaningfulEvidence(step.observed) || !hasMeaningfulEvidence(step.evidence)) {
        failCheck(`manual-test step ${step.id} passed requires non-empty observed and evidence`);
      }
      if (method && NON_RUNTIME_METHODS.has(method)) {
        failCheck(
          `manual-test step ${step.id} cannot use non-runtime method "${method}" as passed (static-review/lint/type-check are not runtime evidence)`,
        );
      }
      if (behaviorLevel === 'full') {
        if (!method) {
          failCheck(
            `behavior_verification full requires method on passed step ${step.id} (browser|device|api|cli|automated); see partial-verification.md`,
          );
        } else if (!MANUAL_METHODS.has(method)) {
          failCheck(`manual-test step ${step.id} has unknown method: ${step.method}`);
        } else if (method === 'automated') {
          const hasVerification = (assets ?? []).some((a) => a.kind === 'verification');
          if (!hasVerification || !automatedEvidenceHasCommandAndTestId(step.evidence)) {
            failCheck(
              `automated method on ${step.id} requires a registered verification asset and explicit "command: ...; test: ..." identifiers in evidence`,
            );
          }
        }
      } else if (!method) {
        warn(`manual-test step ${step.id} missing method (WARN at light; full requires method)`);
      }
    }
    if (result === 'failed') {
      failCheck(`manual-test step ${step.id} failed`);
      hasFailed = true;
      if (behaviorLevel === 'full' && !method) {
        failCheck(`failed step ${step.id} should record method when behavior_verification is full`);
      }
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
  return checkFailures === 0;
}

function loadProjectConfig(root) {
  const workflowFile = path.join(root, '.claude/rules/project-workflow.md');
  if (!fs.existsSync(workflowFile)) {
    fail('project workflow is missing: .claude/rules/project-workflow.md');
  }
  const content = fs.readFileSync(workflowFile, 'utf8');
  const configValue = (key) => {
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(new RegExp(`^\\s*${key}:\\s*(.*)$`));
      if (!match) continue;
      let value = match[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
    return '';
  };
  const configList = (key) => {
    const values = [];
    let inBlock = false;
    for (const line of content.split(/\r?\n/)) {
      if (!inBlock) {
        const match = line.match(new RegExp(`^\\s*${key}:\\s*(.*)$`));
        if (!match) continue;
        const inline = match[1].trim();
        if (inline.startsWith('[') && inline.endsWith(']')) {
          return inline
            .slice(1, -1)
            .split(',')
            .map((value) => unquote(value.trim()))
            .filter(Boolean);
        }
        inBlock = true;
        continue;
      }
      if (line.trim() === '') continue;
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        values.push(unquote(item[1]));
        continue;
      }
      break;
    }
    return values;
  };
  return {
    featureRoot: configValue('feature_root'),
    reviewRoot: configValue('review_root'),
    retention: configValue('retention') || 'compact',
    protectedWriteRoots: configList('protected_write_roots'),
  };
}

const KNOWN_REVIEW_SUFFIXES = [
  'plan-review',
  'code-review',
  'security-review',
  'verification',
  'manual-test',
  'partial-acceptance',
];

function isFeatureOwnedReviewName(featureId, name) {
  if (!name.endsWith('.md')) return false;
  const base = name.slice(0, -3);
  for (const suffix of KNOWN_REVIEW_SUFFIXES) {
    if (base === `${featureId}-${suffix}`) return true;
    // YYYY-MM-DD-<feature-id>-<suffix>
    const match = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (match && match[2] === `${featureId}-${suffix}`) return true;
  }
  return false;
}

function completionField(content, key) {
  const match = content.match(new RegExp(`^  ${key}:\\s*(.*)$`, 'm'));
  if (!match) return null;
  return unquote(match[1]);
}

function completionListBody(content, key) {
  const match = content.match(new RegExp(`^  ${key}: \\[(.*)\\]$`, 'm'));
  if (!match) return null;
  return match[1].trim();
}

function completionList(content, key) {
  const body = completionListBody(content, key);
  if (body === null) return null;
  return parseInlineList(`[${body}]`, `completion ${key}`);
}

function duplicateValues(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function acceptedRiskSections(content) {
  const headings = [...content.matchAll(/^## ([^\r\n]+?)\s*$/gm)];
  return headings.flatMap((heading, index) => {
    if (!/^AR-[A-Za-z0-9_-]+$/.test(heading[1])) return [];
    const start = heading.index + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : content.length;
    return [{ id: heading[1], body: content.slice(start, end) }];
  });
}

/**
 * Pre-finalization final-assets contract.
 * - Always requires feature.md + completion outcome/retention.
 * - Active status means a newly produced completion: current workflow_version
 *   and the full current-version field set are mandatory.
 * - Finalized historical completion without the current version keeps the
 *   legacy minimal contract and emits a warning.
 */
function validateFinalAssets(root, featurePath, completionPath, statusPath, finish = true) {
  const result = () => (finish ? finishChecks() : checkFailures === 0);
  const absoluteRoot = path.resolve(root);
  const config = loadProjectConfig(absoluteRoot);
  if (!config.featureRoot || !config.reviewRoot) {
    failCheck('project workflow has no feature_root/review_root');
    return result();
  }
  validateRoots(absoluteRoot, config.featureRoot, config.reviewRoot);

  try {
    validateAsset(absoluteRoot, config.featureRoot, config.reviewRoot, featurePath);
    validateAsset(absoluteRoot, config.featureRoot, config.reviewRoot, completionPath);
  } catch {
    // validateAsset calls fail() on hard errors; soft-path failures already exited.
  }

  const featureAbs = path.join(absoluteRoot, featurePath);
  const completionAbs = path.join(absoluteRoot, completionPath);
  if (!fs.existsSync(featureAbs) || !fs.statSync(featureAbs).isFile()) {
    failCheck(`feature.md is missing: ${featurePath}`);
  } else {
    const body = fs.readFileSync(featureAbs, 'utf8').trim();
    if (body) pass('feature.md exists');
    else failCheck('feature.md is empty');
  }
  if (!fs.existsSync(completionAbs) || !fs.statSync(completionAbs).isFile()) {
    failCheck(`completion.md is missing: ${completionPath}`);
    return result();
  }
  const completion = fs.readFileSync(completionAbs, 'utf8');
  const finalSecretFindings = scanOwnedSecretAssignments(absoluteRoot, [featurePath, completionPath]);
  for (const finding of finalSecretFindings) {
    failCheck(`managed final asset contains a likely secret assignment: ${finding.path} (${finding.key})`);
  }
  if (!/^---\s*$/m.test(completion) || !/^dev_flow_completion:\s*$/m.test(completion)) {
    failCheck('completion.md is missing dev_flow_completion frontmatter');
    return result();
  }
  pass('completion.md has frontmatter');

  const outcome = completionField(completion, 'outcome');
  if (outcome === 'verified' || outcome === 'partial') pass('completion.md records a final outcome');
  else failCheck('completion.md has no verified/partial outcome');

  const retention = completionField(completion, 'retention');
  if (retention === 'compact' || retention === 'full') pass('completion.md records retention');
  else failCheck('completion.md has no compact/full retention');

  const workflowVersion = completionField(completion, 'workflow_version');
  const strict = Boolean(statusPath) || workflowVersion === contract.workflow_version;
  const completionRiskLabels = completionList(completion, 'risk_labels');
  const completionCommits = completionList(completion, 'commits');
  const completionAcceptedRisks = completionList(completion, 'accepted_risks');
  if (statusPath && workflowVersion !== contract.workflow_version) {
    failCheck(
      `active completion workflow_version must be "${contract.workflow_version}": ${workflowVersion ?? 'missing'}`,
    );
  } else if (!statusPath && workflowVersion !== contract.workflow_version) {
    warn(
      `legacy finalized completion uses minimal validation (workflow_version: ${workflowVersion ?? 'omitted'})`,
    );
  }

  if (strict) {
    const schemaVersion = completionField(completion, 'schema_version');
    if (schemaVersion === contract.completion_schema) {
      pass('completion schema_version is current');
    } else {
      failCheck(
        `current completion schema_version must be "${contract.completion_schema}": ${schemaVersion ?? ''}`,
      );
    }
    const featureId = completionField(completion, 'feature_id');
    if (featureId && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(featureId) && !featureId.startsWith('.')) {
      pass('completion feature_id is well-formed');
    } else {
      failCheck(`current completion feature_id is missing or malformed: ${featureId ?? ''}`);
    }
    const level = completionField(completion, 'level');
    if (contract.levels.includes(level)) pass('completion level is recognized');
    else failCheck(`current completion level is missing or unknown: ${level ?? ''}`);
    const completedAt = completionField(completion, 'completed_at');
    if (isIso8601Timestamp(completedAt)) {
      pass('completion completed_at is an ISO-8601 timestamp');
    } else {
      failCheck('current completion completed_at must be an ISO-8601 timestamp');
    }
    const fingerprint = completionField(completion, 'business_diff_fingerprint');
    if (/^[0-9a-f]{40}$/.test(fingerprint ?? '')) {
      pass('completion business_diff_fingerprint is a Git hash');
    } else {
      failCheck('current completion business_diff_fingerprint must be a Git hash');
    }
    for (const [listField, values] of [
      ['risk_labels', completionRiskLabels],
      ['commits', completionCommits],
      ['accepted_risks', completionAcceptedRisks],
    ]) {
      if (values !== null) {
        pass(`completion ${listField} field is present`);
      } else {
        failCheck(`current completion is missing ${listField}`);
      }
    }
    for (const scalarField of [
      'process_mode',
      'retrospective_reason',
      'retrospective_evidence',
      'risk_approval_evidence',
      'risk_verification_summary',
      'pull_request',
    ]) {
      if (completionField(completion, scalarField) !== null) {
        pass(`completion ${scalarField} field is present`);
      } else {
        failCheck(`current completion is missing ${scalarField}`);
      }
    }
    const processMode = completionField(completion, 'process_mode');
    const retrospectiveReason = completionField(completion, 'retrospective_reason');
    const retrospectiveEvidence = completionField(completion, 'retrospective_evidence');
    if (!contract.process_modes.includes(processMode)) {
      failCheck(`completion process_mode must be one of: ${contract.process_modes.join(', ')}`);
    } else if (
      processMode === 'normal' &&
      (retrospectiveReason !== 'none' || retrospectiveEvidence !== 'none')
    ) {
      failCheck('normal completion requires retrospective_reason/evidence: none');
    } else if (
      processMode === 'retrospective' &&
      (!hasMeaningfulEvidence(retrospectiveReason || '') ||
        !hasMeaningfulEvidence(retrospectiveEvidence || ''))
    ) {
      failCheck('retrospective completion requires meaningful reason and evidence');
    } else {
      pass('completion process mode is valid');
    }
    if (completionRiskLabels !== null) {
      const duplicateLabels = duplicateValues(completionRiskLabels);
      const unknownLabels = completionRiskLabels.filter(
        (label) => !contract.risk_labels.includes(label),
      );
      if (duplicateLabels.length > 0) {
        failCheck(`completion risk_labels has duplicates: ${duplicateLabels.join(', ')}`);
      }
      if (unknownLabels.length > 0) {
        failCheck(`completion risk_labels has unknown entries: ${unknownLabels.join(', ')}`);
      }
      if (duplicateLabels.length === 0 && unknownLabels.length === 0) {
        pass('completion risk_labels are recognized and unique');
      }
    }
    if (completionAcceptedRisks !== null) {
      const duplicateAccepted = duplicateValues(completionAcceptedRisks);
      const malformedAccepted = completionAcceptedRisks.filter(
        (id) => !/^AR-[A-Za-z0-9_-]+$/.test(id),
      );
      if (duplicateAccepted.length > 0) {
        failCheck(`completion accepted_risks has duplicates: ${duplicateAccepted.join(', ')}`);
      }
      if (malformedAccepted.length > 0) {
        failCheck(
          `completion accepted_risks entries must look like AR-xxx: ${malformedAccepted.join(', ')}`,
        );
      }
      if (duplicateAccepted.length === 0 && malformedAccepted.length === 0) {
        pass('completion accepted_risks ids are well-formed and unique');
      }
    }
  }

  if ((completionRiskLabels ?? []).length > 0) {
    const approval = completionField(completion, 'risk_approval_evidence');
    const summary = completionField(completion, 'risk_verification_summary');
    if (hasMeaningfulEvidence(approval || '') && hasMeaningfulEvidence(summary || '')) {
      pass('completion.md preserves risk summary');
    } else {
      failCheck('completion.md is missing risk approval evidence or verification summary');
    }
  }

  if (outcome === 'partial') {
    if ((completionAcceptedRisks ?? []).length > 0) pass('partial completion lists accepted_risks');
    else failCheck('partial completion must list accepted_risks');
  } else if (strict && outcome === 'verified' && (completionAcceptedRisks ?? []).length > 0) {
    failCheck('verified completion must have empty accepted_risks');
  }

  const arSections = acceptedRiskSections(completion);
  if (strict && completionAcceptedRisks !== null) {
    const sectionIds = arSections.map((section) => section.id);
    const duplicateSections = duplicateValues(sectionIds);
    if (duplicateSections.length > 0) {
      failCheck(`completion has duplicate accepted-risk sections: ${duplicateSections.join(', ')}`);
    }
    const missingSections = completionAcceptedRisks.filter((id) => !sectionIds.includes(id));
    const extraSections = sectionIds.filter((id) => !completionAcceptedRisks.includes(id));
    if (missingSections.length > 0) {
      failCheck(`completion is missing accepted-risk sections: ${missingSections.join(', ')}`);
    }
    if (extraSections.length > 0) {
      failCheck(`completion has unlisted accepted-risk sections: ${extraSections.join(', ')}`);
    }
    let sectionEvidenceOk = missingSections.length === 0 && duplicateSections.length === 0;
    for (const section of arSections) {
      if (!completionAcceptedRisks.includes(section.id)) continue;
      const reason = section.body.match(/^- reason:\s*(.*)$/m)?.[1] ?? '';
      const evidence = section.body.match(/^- evidence:\s*(.*)$/m)?.[1] ?? '';
      if (!hasCompletedEvidence(reason) || !hasCompletedEvidence(evidence)) {
        failCheck(
          `completion accepted-risk section ${section.id} requires meaningful reason and evidence`,
        );
        sectionEvidenceOk = false;
      }
    }
    if (
      sectionEvidenceOk &&
      extraSections.length === 0 &&
      sameStringSet(sectionIds, completionAcceptedRisks)
    ) {
      pass('completion accepted-risk sections preserve the accepted risk facts');
    }
  } else if (
    !strict &&
    outcome === 'partial' &&
    (completionAcceptedRisks ?? []).some((id) => !arSections.some((section) => section.id === id))
  ) {
    warn('legacy partial completion does not preserve one section per accepted risk');
  }

  if (statusPath) {
    try {
      validateAsset(absoluteRoot, config.featureRoot, config.reviewRoot, statusPath);
    } catch {
      // hard fail already exited
    }
    const statusAbs = path.join(absoluteRoot, statusPath);
    if (!fs.existsSync(statusAbs)) {
      failCheck(`status.md is missing for final-assets compare: ${statusPath}`);
      return result();
    }
    const statusContent = fs.readFileSync(statusAbs, 'utf8');
    const statusLinesArr = statusLines(statusContent);
    const statusFeatureId = topLevelValue(statusLinesArr, 'feature_id');
    const completionFeatureId = completionField(completion, 'feature_id');
    if (completionFeatureId && statusFeatureId && completionFeatureId !== statusFeatureId) {
      failCheck(
        `completion feature_id (${completionFeatureId}) does not match status (${statusFeatureId})`,
      );
    } else if (statusFeatureId) {
      pass('completion feature_id matches status');
    }
    const statusLevel = topLevelValue(statusLinesArr, 'level');
    const completionLevel = completionField(completion, 'level');
    if (statusLevel && completionLevel === statusLevel) {
      pass('completion level matches status');
    } else {
      failCheck(
        `completion level (${completionLevel ?? 'missing'}) does not match status (${statusLevel ?? 'missing'})`,
      );
    }
    const statusValidation = parseFlatBlock(statusLinesArr, 'validation', 'validation');
    const statusProcess = parseFlatBlock(statusLinesArr, 'process', 'process');
    const completionProcessMode = completionField(completion, 'process_mode');
    if (statusProcess?.mode === completionProcessMode) {
      pass('completion process_mode matches status');
    } else {
      failCheck('completion process_mode does not match status');
    }
    if (completionProcessMode === 'retrospective') {
      if (completionField(completion, 'retrospective_reason') !== statusProcess?.reason) {
        failCheck('completion retrospective_reason does not match status');
      } else {
        pass('completion retrospective_reason matches status');
      }
    }
    const completionFingerprint = completionField(completion, 'business_diff_fingerprint');
    if (
      statusValidation?.business_diff_fingerprint &&
      completionFingerprint === statusValidation.business_diff_fingerprint
    ) {
      pass('completion business_diff_fingerprint matches status');
    } else {
      failCheck('completion business_diff_fingerprint does not match status validation');
    }
    const statusRiskLabels = parseStringList(statusLinesArr, 'risk_labels', 'risk_labels') ?? [];
    if (
      completionRiskLabels !== null &&
      sameStringSet(completionRiskLabels, statusRiskLabels) &&
      duplicateValues(completionRiskLabels).length === 0
    ) {
      pass('completion risk_labels exactly match status');
    } else {
      failCheck('completion risk_labels do not exactly match status');
    }
    const statusAcceptedRisks =
      parseStringList(statusLinesArr, 'accepted_risks', 'accepted_risks') ?? [];
    if (
      completionAcceptedRisks !== null &&
      sameStringSet(completionAcceptedRisks, statusAcceptedRisks) &&
      duplicateValues(completionAcceptedRisks).length === 0
    ) {
      pass('completion accepted_risks exactly match status');
    } else {
      failCheck('completion accepted_risks do not exactly match status');
    }
    if (
      (outcome === 'verified' && statusAcceptedRisks.length === 0) ||
      (outcome === 'partial' && statusAcceptedRisks.length > 0)
    ) {
      pass('completion outcome is consistent with status accepted_risks');
    } else {
      failCheck('completion outcome is inconsistent with status accepted_risks');
    }
  }

  return result();
}

/**
 * Feature-level validation.
 * - active: status must exist; runs finish-level status checks; feature_id must match.
 *   Does not require feature.md/completion.md.
 * - finalized: does not depend on status; requires feature.md + completion outcome
 *   (+ archive when retention=full, risk summary when risk_labels non-empty).
 */
function validateFeature(root, featureId, stage) {
  validateFeatureId(featureId);
  const absoluteRoot = path.resolve(root);
  const config = loadProjectConfig(absoluteRoot);
  if (!config.featureRoot || !config.reviewRoot) {
    failCheck('project workflow has no feature_root/review_root');
    return finishChecks();
  }
  validateRoots(absoluteRoot, config.featureRoot, config.reviewRoot);

  const featureDir = path.join(absoluteRoot, config.featureRoot, featureId);
  const relativeStatus = path.join(config.featureRoot, featureId, 'status.md');
  const statusFile = path.join(absoluteRoot, relativeStatus);
  const featureFile = path.join(featureDir, 'feature.md');
  const completionFile = path.join(featureDir, 'completion.md');

  if (stage === 'active') {
    if (!fs.existsSync(statusFile)) {
      failCheck(`status.md is missing for active feature: ${relativeStatus}`);
      return finishChecks();
    }
    pass('active feature has status.md');
    // Finish-level status content/schema (accumulates into checkFailures).
    validateStatus(absoluteRoot, relativeStatus, 'finish');
    try {
      const content = fs.readFileSync(statusFile, 'utf8');
      const lines = statusLines(content);
      const statusFeatureId = topLevelValue(lines, 'feature_id');
      if (statusFeatureId === featureId) {
        pass('status feature_id matches requested feature');
      } else {
        failCheck(`status feature_id does not match requested feature: ${statusFeatureId ?? ''}`);
      }
    } catch {
      failCheck('cannot re-read status for feature_id match');
    }
    return finishChecks();
  }

  if (stage === 'finalized') {
    if (fs.existsSync(statusFile)) {
      failCheck('finalized feature must not keep status.md');
    } else {
      pass('finalized feature has no status.md');
    }
    validateFinalAssets(
      absoluteRoot,
      path.join(config.featureRoot, featureId, 'feature.md'),
      path.join(config.featureRoot, featureId, 'completion.md'),
      null,
      false,
    );
    if (!fs.existsSync(completionFile)) return finishChecks();
    const completion = fs.readFileSync(completionFile, 'utf8');

    let retention = completionField(completion, 'retention') || '';
    if (!retention) retention = config.retention;
    const archiveDir = path.join(featureDir, 'archive');
    const retainedManualTest = path.join(featureDir, 'manual-test.md');
    if (fs.existsSync(archiveDir) && fs.lstatSync(archiveDir).isSymbolicLink()) {
      failCheck('finalized feature archive must not be a symbolic link');
    } else if (fs.existsSync(archiveDir) && !fs.statSync(archiveDir).isDirectory()) {
      failCheck('finalized feature archive must be a directory');
    }
    if (
      fs.existsSync(retainedManualTest) &&
      fs.lstatSync(retainedManualTest).isSymbolicLink()
    ) {
      failCheck('finalized feature manual-test.md must not be a symbolic link');
    } else if (
      fs.existsSync(retainedManualTest) &&
      !fs.statSync(retainedManualTest).isFile()
    ) {
      failCheck('finalized feature manual-test.md must be a file');
    }
    if (retention === 'full') {
      let hasArchive = false;
      if (
        fs.existsSync(archiveDir) &&
        !fs.lstatSync(archiveDir).isSymbolicLink() &&
        fs.statSync(archiveDir).isDirectory()
      ) {
        for (const entry of fs.readdirSync(archiveDir)) {
          try {
            if (fs.statSync(path.join(archiveDir, entry)).isDirectory()) {
              hasArchive = true;
              break;
            }
          } catch {
            // ignore unreadable entries
          }
        }
      }
      if (hasArchive) pass('full-retention archive exists');
      else failCheck('full-retention feature has no archive directory');
    }

    // Shared review-root must not retain current feature-owned reports.
    const reviewAbs = path.join(absoluteRoot, config.reviewRoot);
    let leftover = 0;
    if (fs.existsSync(reviewAbs) && fs.statSync(reviewAbs).isDirectory()) {
      for (const name of fs.readdirSync(reviewAbs)) {
        const full = path.join(reviewAbs, name);
        try {
          if (!fs.statSync(full).isFile()) continue;
        } catch {
          continue;
        }
        if (isFeatureOwnedReviewName(featureId, name)) leftover += 1;
      }
    }
    if (leftover === 0) pass('finalized feature has no review-root leftovers');
    else failCheck(`finalized feature still has ${leftover} review-root leftover(s)`);

    // Main feature directory allowlist.
    const allow = new Set(['feature.md', 'completion.md', 'manual-test.md', 'archive']);
    if (fs.existsSync(featureDir) && fs.statSync(featureDir).isDirectory()) {
      const unexpected = fs.readdirSync(featureDir).filter((name) => !allow.has(name));
      if (unexpected.length === 0) pass('finalized feature directory matches allowlist');
      else failCheck(`finalized feature directory has unexpected entries: ${unexpected.join(', ')}`);
    }

    return finishChecks();
  }

  fail(`unknown feature stage: ${stage}`);
}

function parseStatusStage(args) {
  // Prefer --stage <name>; keep --finish as alias for finish during transition.
  let stage = 'current';
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--finish') {
      stage = 'finish';
      continue;
    }
    if (arg === '--stage') {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail('usage: --stage current|approval|finish');
      stage = value;
      continue;
    }
    rest.push(arg);
  }
  if (!['current', 'approval', 'finish'].includes(stage)) {
    fail(`status stage must be current|approval|finish: ${stage}`);
  }
  return { stage, rest };
}

function parseFeatureStage(args) {
  let stage = '';
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--stage') {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail('usage: --stage active|finalized');
      stage = value;
      continue;
    }
    rest.push(arg);
  }
  if (!['active', 'finalized'].includes(stage)) {
    fail('usage: dev-flow-validate.mjs feature <repo-root> <feature-id> --stage active|finalized');
  }
  return { stage, rest };
}

// ---------- approval basis / authorization ----------

function sha256File(absPath) {
  const buf = fs.readFileSync(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * Build approval basis from status frontmatter + protected roots.
 * Only pre-implementation assets and route structure enter the hash.
 */
function computeApprovalBasis(root, statusPath, protectedRoots = []) {
  const { absoluteRoot, content } = readStatus(root, statusPath);
  const lines = statusLines(content);
  const featureId = topLevelValue(lines, 'feature_id');
  const level = topLevelValue(lines, 'level');
  const profile = topLevelValue(lines, 'profile');
  const labels = parseStringList(lines, 'risk_labels', 'risk_labels') ?? [];
  const classification = parseFlatBlock(lines, 'classification', 'classification') || {};
  const processInfo = parseFlatBlock(lines, 'process', 'process') || {};
  const gates = parseFlatBlock(lines, 'risk_gates', 'risk_gates') || {};
  const humanGates = parseNestedMap(lines, 'human_gates', 'human_gates') || {};
  const assets = parseAssets(lines) || [];
  const gateEvidence = parseGateEvidence(lines) || {};
  const obligations = routeObligations(contract, {
    level,
    profile,
    riskLabels: labels,
    humanGates,
    riskGates: gates,
    processMode: processInfo.mode || 'normal',
    execution: classification.execution,
  });

  const preImplKinds = new Set(['requirement', 'plan', 'spec']);
  const preImplAssets = assets
    .filter((a) => preImplKinds.has(a.kind))
    .map((a) => ({ path: a.path.replace(/\\/g, '/'), kind: a.kind }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const assetManifests = [];
  for (const asset of preImplAssets) {
    const abs = path.join(absoluteRoot, asset.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      fail(`APPROVAL_BASIS_STRUCTURAL_CHANGE: approval asset missing: ${asset.path}`);
    }
    assetManifests.push({
      path: asset.path,
      kind: asset.kind,
      sha256: sha256File(abs),
    });
  }

  // Gate evidence files for pre-impl risk gates also bind content.
  const preImplCompleted = new Set([
    'requirements-coverage',
    'plan-review',
    'rollback-units',
    'security-review',
  ]);
  for (const [key, entry] of Object.entries(gateEvidence)) {
    const completed = key.replace(/_/g, '-');
    if (!preImplCompleted.has(completed)) continue;
    if (!entry?.path) continue;
    const norm = entry.path.replace(/\\/g, '/');
    if (assetManifests.some((m) => m.path === norm)) continue;
    const abs = path.join(absoluteRoot, entry.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      fail(`APPROVAL_BASIS_STRUCTURAL_CHANGE: gate evidence missing: ${entry.path}`);
    }
    assetManifests.push({
      path: norm,
      kind: 'review',
      sha256: sha256File(abs),
    });
  }
  assetManifests.sort((a, b) => a.path.localeCompare(b.path));

  const roots = [...protectedRoots].map((r) => String(r).replace(/\\/g, '/')).sort();
  const req = humanGates.requirement_confirmation || {};
  const routePayload = {
    feature_id: featureId,
    level,
    profile,
    topology: classification.topology || '',
    evidence_result: classification.evidence_result || '',
    execution: classification.execution || '',
    process_mode: processInfo.mode || '',
    existing_diff: processInfo.existing_diff || '',
    baseline_business_diff_fingerprint:
      processInfo.baseline_business_diff_fingerprint || '',
    risk_labels: [...labels].sort(),
    risk_gates: gates,
    code_review: obligations.codeReview,
    requirement_confirmation: {
      required: req.required === true || req.required === 'true',
      status: req.status || 'pending',
      evidence: req.evidence || '',
    },
    protected_roots: roots,
    asset_paths: assetManifests.map((m) => m.path),
  };
  const routeHash = createHash('sha256').update(canonicalJson(routePayload)).digest('hex');
  const fullPayload = {
    ...routePayload,
    assets: assetManifests,
  };
  const hash = createHash('sha256').update(canonicalJson(fullPayload)).digest('hex');
  return {
    algorithm: 'sha256',
    hash,
    route_hash: routeHash,
    assets: assetManifests,
    route: routePayload,
    baseline_business_diff_fingerprint:
      processInfo.baseline_business_diff_fingerprint || '',
  };
}

function compareApprovalBasis(expected, actual) {
  if (!expected || !actual) {
    return { ok: false, code: 'APPROVAL_BASIS_STRUCTURAL_CHANGE', detail: 'missing approval_basis' };
  }
  if (expected.route_hash !== actual.route_hash) {
    return {
      ok: false,
      code: 'APPROVAL_BASIS_STRUCTURAL_CHANGE',
      detail: 'route, risk labels, protected roots, or asset path set changed',
    };
  }
  if (
    expected.baseline_business_diff_fingerprint !==
    actual.baseline_business_diff_fingerprint
  ) {
    return {
      ok: false,
      code: 'APPROVAL_BASIS_STRUCTURAL_CHANGE',
      detail: 'baseline business diff fingerprint changed',
    };
  }
  if (expected.hash !== actual.hash) {
    const changed = [];
    const expMap = Object.fromEntries((expected.assets || []).map((a) => [a.path, a.sha256]));
    const actMap = Object.fromEntries((actual.assets || []).map((a) => [a.path, a.sha256]));
    for (const pathKey of new Set([...Object.keys(expMap), ...Object.keys(actMap)])) {
      if (expMap[pathKey] !== actMap[pathKey]) changed.push(pathKey);
    }
    return {
      ok: false,
      code: 'APPROVAL_BASIS_CONTENT_CHANGE',
      detail: `approved asset content changed: ${changed.join(', ') || '(unknown)'}`,
      changed,
    };
  }
  return { ok: true };
}

function validateAuthorization(root, authPath) {
  const absoluteRoot = path.resolve(root);
  const absAuth = path.resolve(absoluteRoot, authPath);
  if (!fs.existsSync(absAuth)) {
    failCheck(`authorization file missing: ${authPath}`);
    return finishChecks();
  }
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(absAuth, 'utf8'));
  } catch (error) {
    failCheck(`cannot parse authorization: ${error.message}`);
    return finishChecks();
  }
  if (auth.state === 'classified') {
    pass('classified authorization is valid without approval_basis');
    return finishChecks();
  }
  if (auth.state === 'closed') {
    pass('closed authorization accepted as historical');
    return finishChecks();
  }
  if (auth.state === 'approval-pending') {
    pass('approval-pending authorization has no approved basis yet');
    return finishChecks();
  }
  if (auth.state !== 'approved') {
    failCheck(`authorization state not processable: ${auth.state ?? ''}`);
    return finishChecks();
  }
  const config = loadProjectConfig(absoluteRoot);
  if (!config.featureRoot) {
    failCheck('project workflow has no feature_root');
    return finishChecks();
  }
  const statusRel = path.join(config.featureRoot, auth.feature_id, 'status.md');
  const statusAbs = path.join(absoluteRoot, statusRel);
  // Approved auth always carries the current schema/version/basis. Historical
  // authorization without an active status must be closed, never reusable.
  if (String(auth.schema_version) !== String(contract.authorization_schema || '1')) {
    failCheck(
      `authorization schema_version must be "${contract.authorization_schema || '1'}": ${auth.schema_version ?? ''}`,
    );
    return finishChecks();
  }
  pass('authorization schema_version matches');
  if (auth.workflow_version !== contract.workflow_version) {
    failCheck(
      `authorization workflow_version mismatch: ${auth.workflow_version ?? 'missing'} vs ${contract.workflow_version}`,
    );
    return finishChecks();
  }
  pass('authorization workflow_version matches');
  if (!auth.approval_basis || !auth.approval_basis.hash) {
    failCheck('APPROVAL_BASIS_STRUCTURAL_CHANGE: approved authorization missing approval_basis.hash');
    return finishChecks();
  }
  const normalizeRoots = (roots) =>
    (Array.isArray(roots) ? roots : []).map((root) => String(root).replace(/\\/g, '/')).sort();
  const authorizedRoots = normalizeRoots(auth.protected_roots);
  const currentRoots = normalizeRoots(config.protectedWriteRoots);
  if (JSON.stringify(authorizedRoots) !== JSON.stringify(currentRoots)) {
    failCheck(
      `APPROVAL_BASIS_STRUCTURAL_CHANGE: authorization protected_roots differ from current workflow (${authorizedRoots.join(', ') || 'none'} vs ${currentRoots.join(', ') || 'none'})`,
    );
    return finishChecks();
  }
  if (!fs.existsSync(statusAbs)) {
    failCheck('approved authorization has no active status; finalize/close it instead of reusing residual approval');
    return finishChecks();
  }
  let recomputed;
  try {
    recomputed = computeApprovalBasis(
      absoluteRoot,
      statusRel,
      config.protectedWriteRoots || [],
    );
  } catch (error) {
    failCheck(`APPROVAL_BASIS_STRUCTURAL_CHANGE: ${error.message}`);
    return finishChecks();
  }
  const cmp = compareApprovalBasis(auth.approval_basis, {
    hash: recomputed.hash,
    route_hash: recomputed.route_hash,
    assets: recomputed.assets,
    baseline_business_diff_fingerprint:
      recomputed.baseline_business_diff_fingerprint,
  });
  if (!cmp.ok) {
    failCheck(`${cmp.code}: ${cmp.detail}`);
    return finishChecks();
  }
  pass('authorization approval_basis matches current pre-implementation assets');
  return finishChecks();
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
    const { stage, rest } = parseStatusStage(args);
    if (rest.length !== 2) {
      fail('usage: dev-flow-validate.mjs status <repo-root> <status-path> [--stage current|approval|finish] [--finish]');
    }
    const ok = validateStatus(path.resolve(rest[0]), rest[1], stage);
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'feature': {
    const { stage, rest } = parseFeatureStage(args);
    if (rest.length !== 2) {
      fail('usage: dev-flow-validate.mjs feature <repo-root> <feature-id> --stage active|finalized');
    }
    const ok = validateFeature(path.resolve(rest[0]), rest[1], stage);
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'final-assets': {
    // final-assets <root> <feature-path> <completion-path> [--status <status-path>]
    let statusPath = null;
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '--status') {
        const value = args[++i];
        if (!value || value.startsWith('--')) {
          fail('usage: dev-flow-validate.mjs final-assets <repo-root> <feature-path> <completion-path> [--status <status-path>]');
        }
        statusPath = value;
        continue;
      }
      rest.push(arg);
    }
    if (rest.length !== 3) {
      fail('usage: dev-flow-validate.mjs final-assets <repo-root> <feature-path> <completion-path> [--status <status-path>]');
    }
    const ok = validateFinalAssets(path.resolve(rest[0]), rest[1], rest[2], statusPath);
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'approval-basis': {
    // approval-basis <root> <status-path> [--protected-roots a,b]
    let protectedRoots = [];
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--protected-roots') {
        protectedRoots = String(args[++i] || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        continue;
      }
      rest.push(args[i]);
    }
    if (rest.length !== 2) {
      fail('usage: dev-flow-validate.mjs approval-basis <repo-root> <status-path> [--protected-roots a,b]');
    }
    const basis = computeApprovalBasis(path.resolve(rest[0]), rest[1], protectedRoots);
    process.stdout.write(`${JSON.stringify(basis, null, 2)}\n`);
    break;
  }
  case 'authorization': {
    if (args.length !== 2) {
      fail('usage: dev-flow-validate.mjs authorization <repo-root> <authorization-path>');
    }
    const ok = validateAuthorization(path.resolve(args[0]), args[1]);
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'contract': {
    const required = [
      'workflow_version',
      'status_schema',
      'authorization_schema',
      'risk_labels',
      'risk_gates',
      'gate_levels',
      'minimum_risk_gates',
      'profiles',
      'human_gates',
      'known_gates',
      'asset_kinds',
      'line_budgets',
    ];
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
