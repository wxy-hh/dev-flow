#!/usr/bin/env node
/**
 * Layer 2: sole status/authorization writer for dev-flow.
 * All status.md mutations go through this tool; after each write the
 * validator re-checks the file and the previous content is restored on failure.
 *
 * Calls Layer 0 (policy, fingerprint) and Layer 1 (validator) only.
 * Must not call feature-check or feature-finalize. Must not write check-ok stamps.
 *
 * Usage:
 *   dev-flow-status start <feature-id> --level <XS|S|M|L> --topology <topology> [options]
 *   dev-flow-status next [feature-id]
 *   dev-flow-status scaffold <feature-id> --asset <kind> [--refresh]
 *   dev-flow-status authorize --level <XS|S|M> [--note <text>]
 *   dev-flow-status init <feature-id> --level <XS|S|M|L> --profile <profile> \
 *     --topology <topology> --evidence-result <result> [--entry-gate <gate>] \
 *     [--note <text>] [--risk-labels a,b] [--lightweight-l]
 *   dev-flow-status activate <feature-id>
 *   dev-flow-status add-asset <feature-id> --path <repo-path> --kind <kind>
 *   dev-flow-status complete-gate <feature-id> <gate> \
 *     [--evidence-file <repo-path> --heading <markdown-heading>]
 *   dev-flow-status promote-gate <feature-id> <risk-gate> --to <light|full> --reason <text>
 *   dev-flow-status record-risk-evidence <feature-id> <label> \
 *     [--mode <inline|report>] [--conclusion <text>] [--verification <text>] [--report <path>]
 *   dev-flow-status confirm-human <feature-id> <gate> \
 *     --status confirmed --evidence <user-evidence>
 *   dev-flow-status record-validation <feature-id> --command <command>
 *   dev-flow-status complete-verification <feature-id> --command <command> \
 *     [--report <path>] [--manual-test <path>]
 *   dev-flow-status propose-risk <feature-id> --id <AR-xxx> --step <step> --reason <reason>
 *   dev-flow-status accept-risk <feature-id> --id <AR-xxx> \
 *     --proposal-token <token> --evidence <exact-user-reply>
 *   dev-flow-status mark-retrospective <feature-id> --reason <reason>
 *   dev-flow-status repair <feature-id>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import {
  canonicalCompletedGate,
  codeReviewObligation,
  deriveRoute,
  deriveStartPlan,
  gateRank,
  labelsWithNoGateIncrement,
  loadContract,
  nextActionForGate,
  routeObligations,
  STANDARD_REQUIREMENT_ENTRY_GATES,
  validateTopology,
} from './dev-flow-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contract = loadContract();
const validator = path.join(__dirname, 'dev-flow-validate.mjs');

function fail(message, code = 2) {
  process.stderr.write(`ERROR ${message}\n`);
  process.exit(code);
}

function gitRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) fail('not inside a git repository');
  return result.stdout.trim();
}

function hasTraversal(value) {
  return value.split(/[\\/]/).some((segment) => segment === '.' || segment === '..');
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
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
  if (!isInside(root, resolved)) fail(`${label} escapes the repository: ${value}`);
  return resolved;
}

function validateFeatureId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    fail(`feature-id must contain only letters, digits, dots, underscores or hyphens: ${value ?? ''}`);
  }
  if (value.startsWith('.')) fail(`feature-id must not start with a dot: ${value}`);
}

function configValue(workflowFile, key) {
  const lines = fs.readFileSync(workflowFile, 'utf8').split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}:\\s*(.*)$`);
  for (const line of lines) {
    const match = line.match(re);
    if (match) {
      let value = match[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  return '';
}

function loadWorkflow(root) {
  const workflowFile = path.join(root, '.claude/rules/project-workflow.md');
  if (!fs.existsSync(workflowFile)) fail('project workflow is missing: .claude/rules/project-workflow.md');
  const featureRoot = configValue(workflowFile, 'feature_root');
  const reviewRoot = configValue(workflowFile, 'review_root');
  if (!featureRoot || !reviewRoot) fail('project workflow has no feature_root/review_root');
  repositoryPath(root, featureRoot, 'feature root');
  repositoryPath(root, reviewRoot, 'review root');
  return {
    workflowFile,
    featureRoot,
    reviewRoot,
    featureRootAbs: path.join(root, featureRoot),
    reviewRootAbs: path.join(root, reviewRoot),
    enforcementMode: configValue(workflowFile, 'enforcement_mode') || 'off',
    retention: configValue(workflowFile, 'retention') || 'compact',
    protectedWriteRoots: parseProtectedRoots(workflowFile),
  };
}

function parseProtectedRoots(workflowFile) {
  const lines = fs.readFileSync(workflowFile, 'utf8').split(/\r?\n/);
  const roots = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^\s*protected_write_roots:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        let value = item[1].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        roots.push(value);
        continue;
      }
      if (/^\s*[a-z_]+:/.test(line) || line.trim() === '') {
        if (line.trim() === '') continue;
        break;
      }
    }
    const inline = line.match(/^\s*protected_write_roots:\s*\[(.*)\]\s*$/);
    if (inline) {
      const body = inline[1].trim();
      if (body) {
        for (const part of body.split(',')) {
          let value = part.trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (value) roots.push(value);
        }
      }
    }
  }
  return roots;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function authPath(root) {
  return path.join(root, '.claude/runtime/dev-flow/write-authorization.json');
}

function ensureRuntimeDir(root) {
  fs.mkdirSync(path.join(root, '.claude/runtime/dev-flow'), { recursive: true });
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readAuth(root) {
  const file = authPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot parse write-authorization.json: ${error.message}`);
  }
}

function writeAuth(root, data) {
  ensureRuntimeDir(root);
  writeJsonAtomic(authPath(root), data);
}

function closeExistingAuth(root) {
  const existing = readAuth(root);
  if (existing && existing.state !== 'closed') {
    existing.state = 'closed';
    existing.closed_at = nowIso();
    writeAuth(root, existing);
  }
}

function activeStatusBackedAuthorization(root, workflow) {
  const auth = readAuth(root);
  if (!auth?.feature_id || !['approval-pending', 'approved'].includes(auth.state)) return null;
  return fs.existsSync(statusAbs(root, workflow, auth.feature_id)) ? auth : null;
}

function assertNoStatusBackedDowngrade(root, workflow) {
  const active = activeStatusBackedAuthorization(root, workflow);
  if (!active) return;
  fail(
    `cannot replace active status-backed authorization for ${active.feature_id}; finish or close that feature first`,
    1,
  );
}

function workflowOwnedPath(workflow, filePath) {
  const normalized = String(filePath).replace(/^"|"$/g, '').replace(/\\/g, '/');
  return (
    normalized === '.claude' ||
    normalized.startsWith('.claude/') ||
    normalized === workflow.featureRoot ||
    normalized.startsWith(`${workflow.featureRoot}/`) ||
    normalized === workflow.reviewRoot ||
    normalized.startsWith(`${workflow.reviewRoot}/`) ||
    normalized === 'openspec' ||
    normalized.startsWith('openspec/') ||
    normalized.startsWith('docs/claude-dev-flow-')
  );
}

function businessDiffEntries(root, workflow) {
  const result = spawnSync(
    'git',
    ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) fail('failed to inspect working tree');
  const entries = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const status = line.slice(0, 2).trim() || 'modified';
    const rawPath = line.slice(3);
    const paths = rawPath.includes(' -> ') ? rawPath.split(' -> ') : [rawPath];
    if (paths.every((candidate) => workflowOwnedPath(workflow, candidate))) continue;
    entries.push({ status, path: rawPath });
  }
  return entries;
}

function processForStart(root, workflow, flags) {
  const entries = businessDiffEntries(root, workflow);
  const declared = flags['existing-diff'];
  const reason = flags.reason === undefined ? '' : String(flags.reason).trim();
  if (entries.length === 0) {
    if (declared) fail('--existing-diff is only valid when business diff already exists');
    return {
      mode: 'normal',
      started_at: nowIso(),
      baseline_business_diff_fingerprint: computeFingerprint(root, workflow),
      existing_diff: 'clean',
      reason: 'none',
      entries,
    };
  }
  if (!['unrelated', 'in-scope'].includes(declared)) {
    process.stderr.write('Business diff already exists:\n');
    for (const entry of entries) process.stderr.write(`  ${entry.status} ${entry.path}\n`);
    fail('dirty business diff requires --existing-diff unrelated|in-scope --reason <text>', 1);
  }
  if (!reason) fail('dirty business diff requires a non-empty --reason', 1);
  return {
    mode: declared === 'in-scope' ? 'retrospective' : 'normal',
    started_at: nowIso(),
    baseline_business_diff_fingerprint: computeFingerprint(root, workflow),
    existing_diff: declared,
    reason,
    entries,
  };
}

function statusPath(workflow, featureId) {
  return path.join(workflow.featureRoot, featureId, 'status.md');
}

function statusAbs(root, workflow, featureId) {
  return path.join(root, statusPath(workflow, featureId));
}

function runValidatorStatus(root, relativeStatusPath, stage = 'current') {
  const args = [validator, 'status', root, relativeStatusPath];
  if (stage !== 'current') args.push('--stage', stage);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 2;
}

function runValidatorFeature(root, featureId, stage) {
  const args = [validator, 'feature', root, featureId, '--stage', stage];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 2;
}

function atomicWriteText(filePath, content, validate) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
  try {
    const ok = validate();
    if (!ok) {
      if (previous === null) fs.rmSync(filePath, { force: true });
      else fs.writeFileSync(filePath, previous, 'utf8');
      fail('validator rejected the write; previous content restored', 1);
    }
  } catch (error) {
    if (previous === null) fs.rmSync(filePath, { force: true });
    else fs.writeFileSync(filePath, previous, 'utf8');
    throw error;
  }
}

function renderRiskEvidence(labels) {
  if (labels.length === 0) return '  risk_evidence: {}\n';
  let out = '  risk_evidence:\n';
  for (const label of labels) {
    out += `    ${label}:\n`;
    out += '      mode: "inline"\n';
    out += '      conclusion: "pending"\n';
    out += '      verification: "pending"\n';
    out += '      report: ""\n';
  }
  return out;
}

function renderStatus({
  featureId,
  level,
  profile,
  labels,
  topology,
  evidenceResult,
  execution,
  note,
  currentGate,
  nextAction,
  humanGates,
  riskGates,
  processInfo,
  assets,
  acceptedRisks,
  gateEvidence,
  validation,
}) {
  const labelList =
    labels.length === 0 ? '[]' : `[${labels.map((l) => yamlQuote(l)).join(', ')}]`;
  let body = '';
  body += '---\n';
  body += 'dev_flow_status:\n';
  body += `  schema_version: ${yamlQuote(contract.status_schema)}\n`;
  body += `  feature_id: ${yamlQuote(featureId)}\n`;
  body += `  level: ${yamlQuote(level)}\n`;
  body += `  profile: ${yamlQuote(profile)}\n`;
  body += `  risk_labels: ${labelList}\n`;
  body += renderRiskEvidence(labels);
  body += '  process:\n';
  body += `    mode: ${yamlQuote(processInfo.mode)}\n`;
  body += `    started_at: ${yamlQuote(processInfo.started_at)}\n`;
  body += `    baseline_business_diff_fingerprint: ${yamlQuote(processInfo.baseline_business_diff_fingerprint)}\n`;
  body += `    existing_diff: ${yamlQuote(processInfo.existing_diff)}\n`;
  body += `    reason: ${yamlQuote(processInfo.reason)}\n`;
  body += '  classification:\n';
  body += `    topology: ${yamlQuote(topology)}\n`;
  body += `    execution: ${yamlQuote(execution)}\n`;
  body += `    evidence_result: ${yamlQuote(evidenceResult)}\n`;
  body += `    note: ${yamlQuote(note || '')}\n`;
  body += `  current_gate: ${yamlQuote(currentGate)}\n`;
  body += '  completed_gates: []\n';
  body += `  next_action: ${yamlQuote(nextAction)}\n`;
  body += '  auto_continue: false\n';
  body += '  human_gates:\n';
  for (const gate of contract.human_gates) {
    const g = humanGates[gate];
    body += `    ${gate}:\n`;
    body += `      required: ${g.required ? 'true' : 'false'}\n`;
    body += `      status: ${yamlQuote(g.status)}\n`;
    body += `      evidence: ${yamlQuote(g.evidence || 'not required')}\n`;
  }
  body += '  risk_gates:\n';
  for (const gate of contract.risk_gates) {
    body += `    ${gate}: ${yamlQuote(riskGates[gate] || 'none')}\n`;
  }
  if (assets.length === 0) {
    body += '  assets: []\n';
  } else {
    body += '  assets:\n';
    for (const asset of assets) {
      body += `    - {path: ${yamlQuote(asset.path)}, kind: ${yamlQuote(asset.kind)}}\n`;
    }
  }
  body += '  validation:\n';
  body += `    last_at: ${yamlQuote(validation?.last_at || 'none')}\n`;
  if (validation?.commands?.length) {
    body += '    commands:\n';
    for (const command of validation.commands) {
      body += `      - ${yamlQuote(command)}\n`;
    }
  } else {
    body += '    commands: []\n';
  }
  body += `    business_diff_fingerprint: ${yamlQuote(validation?.business_diff_fingerprint || 'unknown')}\n`;
  if (acceptedRisks.length === 0) {
    body += '  accepted_risks: []\n';
  } else {
    body += '  accepted_risks:\n';
    for (const risk of acceptedRisks) {
      body += `    - ${yamlQuote(risk)}\n`;
    }
  }
  if (gateEvidence && Object.keys(gateEvidence).length > 0) {
    body += '  gate_evidence:\n';
    for (const [gate, evidence] of Object.entries(gateEvidence)) {
      body += `    ${gate}:\n`;
      body += `      mode: ${yamlQuote(evidence.mode)}\n`;
      if (evidence.mode === 'inline') {
        body += `      summary: ${yamlQuote(evidence.summary)}\n`;
      } else {
        body += `      path: ${yamlQuote(evidence.path)}\n`;
        body += `      heading: ${yamlQuote(evidence.heading)}\n`;
      }
    }
  }
  body += '---\n';
  body += '\n# Status\n\nManaged by `dev-flow-status`. Do not hand-edit machine fields.\n';
  return body;
}

// ---------- constrained YAML-subset parsing (mirrors validate) ----------

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function statusLines(content) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'dev_flow_status:');
  if (start === -1) fail('status file has no dev_flow_status frontmatter');
  const end = lines.findIndex((line, index) => index > start && line === '---');
  if (end === -1) fail('status file has unterminated frontmatter');
  return { prefix: lines.slice(0, start + 1), body: lines.slice(start + 1, end), suffix: lines.slice(end) };
}

function topLevelValue(lines, key) {
  const matches = lines.filter((line) => line.match(new RegExp(`^  ${key}:\\s*(.*)$`)));
  if (matches.length === 0) return undefined;
  return unquote(matches[0].replace(new RegExp(`^  ${key}:\\s*`), ''));
}

function blockLines(lines, key) {
  const indexes = lines
    .map((line, index) => (line.match(new RegExp(`^  ${key}:\\s*$`)) ? index : -1))
    .filter((index) => index !== -1);
  if (indexes.length === 0) return undefined;
  const [index] = indexes;
  const block = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    if (lines[i].match(/^  [a-z_]+:/)) break;
    block.push(lines[i]);
  }
  return { index, lines: block };
}

function parseStringList(lines, key) {
  const inline = topLevelValue(lines, key);
  if (inline !== undefined && inline !== '') {
    if (inline === '[]') return [];
    if (!inline.startsWith('[') || !inline.endsWith(']')) return undefined;
    const body = inline.slice(1, -1).trim();
    if (body === '') return [];
    return body.split(',').map((item) => unquote(item));
  }
  const block = blockLines(lines, key);
  if (!block) return undefined;
  const items = [];
  for (const line of block.lines) {
    if (line.trim() === '') continue;
    const match = line.match(/^    - (.*)$/);
    if (!match) continue;
    items.push(unquote(match[1]));
  }
  return items;
}

function parseAssets(lines) {
  const inline = topLevelValue(lines, 'assets');
  if (inline === '[]') return [];
  const block = blockLines(lines, 'assets');
  if (!block) return [];
  const assets = [];
  for (const line of block.lines) {
    if (line.trim() === '') continue;
    const match = line.match(/^    - \{path: "([^"]+)", kind: "([a-z]+)"\}$/);
    if (match) assets.push({ path: match[1], kind: match[2] });
  }
  return assets;
}

function parseNestedMap(lines, key) {
  const block = blockLines(lines, key);
  if (!block) return {};
  const map = {};
  let current;
  for (const line of block.lines) {
    if (line.trim() === '') continue;
    const entry = line.match(/^    ([a-z_]+):\s*$/);
    if (entry) {
      current = entry[1];
      map[current] = {};
      continue;
    }
    const field = line.match(/^      ([a-z_]+):\s*(.*)$/);
    if (field && current) map[current][field[1]] = unquote(field[2]);
  }
  return map;
}

function parseFlatBlock(lines, key) {
  const block = blockLines(lines, key);
  if (!block) return {};
  const map = {};
  for (const line of block.lines) {
    if (line.trim() === '') continue;
    const listItem = line.match(/^      - (.*)$/);
    if (listItem) {
      const lastKey = Object.keys(map).at(-1);
      if (!Array.isArray(map[lastKey])) map[lastKey] = [];
      map[lastKey].push(unquote(listItem[1]));
      continue;
    }
    const field = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (!field) continue;
    map[field[1]] = field[2].trim() === '' ? [] : unquote(field[2]);
    if (map[field[1]] === '[]') map[field[1]] = [];
  }
  return map;
}

function parseGateEvidence(lines) {
  const block = blockLines(lines, 'gate_evidence');
  if (!block) return {};
  const map = {};
  let current;
  for (const line of block.lines) {
    if (line.trim() === '') continue;
    const entry = line.match(/^    ([a-z_]+):\s*$/);
    if (entry) {
      current = entry[1];
      map[current] = {};
      continue;
    }
    const field = line.match(/^      (mode|summary|path|heading):\s*(.*)$/);
    if (field && current) map[current][field[1]] = unquote(field[2]);
  }
  return map;
}

function loadStatusModel(root, workflow, featureId) {
  const relative = statusPath(workflow, featureId);
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) fail(`status.md is missing: ${relative}`, 1);
  const content = fs.readFileSync(absolute, 'utf8');
  const { body } = statusLines(content);
  return {
    relative,
    absolute,
    content,
    featureId: topLevelValue(body, 'feature_id'),
    level: topLevelValue(body, 'level'),
    profile: topLevelValue(body, 'profile'),
    labels: parseStringList(body, 'risk_labels') ?? [],
    completedGates: (parseStringList(body, 'completed_gates') ?? []).map(
      (gate) => canonicalCompletedGate(contract, gate) ?? gate,
    ),
    currentGate:
      canonicalCompletedGate(contract, topLevelValue(body, 'current_gate')) ??
      topLevelValue(body, 'current_gate'),
    nextAction: topLevelValue(body, 'next_action'),
    humanGates: parseNestedMap(body, 'human_gates'),
    riskGates: parseFlatBlock(body, 'risk_gates'),
    assets: parseAssets(body),
    validation: parseFlatBlock(body, 'validation'),
    acceptedRisks: parseStringList(body, 'accepted_risks') ?? [],
    gateEvidence: parseGateEvidence(body),
    classification: parseFlatBlock(body, 'classification'),
    riskEvidence: parseNestedMap(body, 'risk_evidence'),
    process: parseFlatBlock(body, 'process'),
  };
}

function rebuildFromModel(model) {
  const riskEvidenceLabels = Object.keys(model.riskEvidence || {});
  // Prefer structured risk_evidence when present; else seed from labels.
  const labels = model.labels;
  let riskEvidenceBlock;
  if (labels.length === 0) {
    riskEvidenceBlock = '  risk_evidence: {}\n';
  } else if (riskEvidenceLabels.length > 0) {
    riskEvidenceBlock = '  risk_evidence:\n';
    for (const label of labels) {
      const entry = model.riskEvidence[label] || {
        mode: 'inline',
        conclusion: 'pending',
        verification: 'pending',
        report: '',
      };
      riskEvidenceBlock += `    ${label}:\n`;
      riskEvidenceBlock += `      mode: ${yamlQuote(entry.mode || 'inline')}\n`;
      riskEvidenceBlock += `      conclusion: ${yamlQuote(entry.conclusion || 'pending')}\n`;
      riskEvidenceBlock += `      verification: ${yamlQuote(entry.verification || 'pending')}\n`;
      riskEvidenceBlock += `      report: ${yamlQuote(entry.report || '')}\n`;
    }
  } else {
    riskEvidenceBlock = renderRiskEvidence(labels);
  }

  const labelList =
    labels.length === 0 ? '[]' : `[${labels.map((l) => yamlQuote(l)).join(', ')}]`;
  let body = '';
  body += '---\n';
  body += 'dev_flow_status:\n';
  body += `  schema_version: ${yamlQuote(contract.status_schema)}\n`;
  body += `  feature_id: ${yamlQuote(model.featureId)}\n`;
  body += `  level: ${yamlQuote(model.level)}\n`;
  body += `  profile: ${yamlQuote(model.profile)}\n`;
  body += `  risk_labels: ${labelList}\n`;
  body += riskEvidenceBlock;
  body += '  process:\n';
  body += `    mode: ${yamlQuote(model.process.mode)}\n`;
  body += `    started_at: ${yamlQuote(model.process.started_at)}\n`;
  body += `    baseline_business_diff_fingerprint: ${yamlQuote(model.process.baseline_business_diff_fingerprint)}\n`;
  body += `    existing_diff: ${yamlQuote(model.process.existing_diff)}\n`;
  body += `    reason: ${yamlQuote(model.process.reason)}\n`;
  body += '  classification:\n';
  body += `    topology: ${yamlQuote(model.classification.topology || 'local')}\n`;
  body += `    execution: ${yamlQuote(model.classification.execution || 'light')}\n`;
  body += `    evidence_result: ${yamlQuote(model.classification.evidence_result || 'not-applicable')}\n`;
  body += `    note: ${yamlQuote(model.classification.note || '')}\n`;
  body += `  current_gate: ${yamlQuote(model.currentGate)}\n`;
  if (model.completedGates.length === 0) {
    body += '  completed_gates: []\n';
  } else {
    body += '  completed_gates:\n';
    for (const gate of model.completedGates) body += `    - ${gate}\n`;
  }
  body += `  next_action: ${yamlQuote(model.nextAction || 'continue')}\n`;
  body += '  auto_continue: false\n';
  body += '  human_gates:\n';
  for (const gate of contract.human_gates) {
    const g = model.humanGates[gate] || {
      required: 'false',
      status: 'pending',
      evidence: 'not required',
    };
    body += `    ${gate}:\n`;
    body += `      required: ${g.required === true || g.required === 'true' ? 'true' : 'false'}\n`;
    body += `      status: ${yamlQuote(g.status || 'pending')}\n`;
    body += `      evidence: ${yamlQuote(g.evidence || 'not required')}\n`;
  }
  body += '  risk_gates:\n';
  for (const gate of contract.risk_gates) {
    body += `    ${gate}: ${yamlQuote(model.riskGates[gate] || 'none')}\n`;
  }
  if (model.assets.length === 0) {
    body += '  assets: []\n';
  } else {
    body += '  assets:\n';
    for (const asset of model.assets) {
      body += `    - {path: ${yamlQuote(asset.path)}, kind: ${yamlQuote(asset.kind)}}\n`;
    }
  }
  body += '  validation:\n';
  body += `    last_at: ${yamlQuote(model.validation.last_at || 'none')}\n`;
  const commands = Array.isArray(model.validation.commands)
    ? model.validation.commands
    : [];
  if (commands.length === 0) {
    body += '    commands: []\n';
  } else {
    body += '    commands:\n';
    for (const command of commands) body += `      - ${yamlQuote(command)}\n`;
  }
  body += `    business_diff_fingerprint: ${yamlQuote(model.validation.business_diff_fingerprint || 'unknown')}\n`;
  if (model.acceptedRisks.length === 0) {
    body += '  accepted_risks: []\n';
  } else {
    body += '  accepted_risks:\n';
    for (const risk of model.acceptedRisks) body += `    - ${yamlQuote(risk)}\n`;
  }
  if (model.gateEvidence && Object.keys(model.gateEvidence).length > 0) {
    body += '  gate_evidence:\n';
    for (const [gate, evidence] of Object.entries(model.gateEvidence)) {
      body += `    ${gate}:\n`;
      body += `      mode: ${yamlQuote(evidence.mode)}\n`;
      if (evidence.mode === 'inline') {
        body += `      summary: ${yamlQuote(evidence.summary)}\n`;
      } else {
        body += `      path: ${yamlQuote(evidence.path)}\n`;
        body += `      heading: ${yamlQuote(evidence.heading)}\n`;
      }
    }
  }
  body += '---\n';
  body += '\n# Status\n\nManaged by `dev-flow-status`. Do not hand-edit machine fields.\n';
  return body;
}

function saveModel(root, model, { stage = 'current' } = {}) {
  const content = rebuildFromModel(model);
  atomicWriteText(model.absolute, content, () => {
    if (runValidatorStatus(root, model.relative, stage) !== 0) return false;
    // Finish writes also re-check the active feature contract (never stamps check-ok).
    if (stage === 'finish' && runValidatorFeature(root, model.featureId, 'active') !== 0) {
      return false;
    }
    return true;
  });
}

function partialAcceptancePath(workflow, featureId) {
  return path.join(workflow.reviewRoot, `${featureId}-partial-acceptance.md`);
}

function updatePartialAcceptance(root, workflow, featureId, entry) {
  const relative = partialAcceptancePath(workflow, featureId);
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  let content = fs.existsSync(absolute)
    ? fs.readFileSync(absolute, 'utf8')
    : `# Partial acceptance — ${featureId}\n\n`;
  const block = [
    `## ${entry.id}`,
    '',
    `- step: ${entry.step}`,
    `- reason: ${entry.reason}`,
    `- evidence: ${entry.evidence}`,
    `- confirmed_at: ${entry.confirmed_at}`,
    '',
  ].join('\n');
  const re = new RegExp(`## ${entry.id}\\n[\\s\\S]*?(?=\\n## |$)`);
  if (re.test(content)) content = content.replace(re, `${block}\n`);
  else content = `${content.trimEnd()}\n\n${block}\n`;
  fs.writeFileSync(absolute, content, 'utf8');
  return relative;
}

function headingCount(filePath, heading) {
  const content = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const matches = content.match(new RegExp(re.source, 'gm'));
  return matches ? matches.length : 0;
}

function gateEvidenceKey(gate) {
  return String(gate).replace(/-/g, '_');
}

function normalizeRiskGateName(gate) {
  const snake = String(gate).replace(/-/g, '_');
  if (contract.risk_gates.includes(snake)) return snake;
  return null;
}

function isRequiredFlag(value) {
  return value === true || value === 'true';
}

/** Every required HUMAN GATE only counts when explicitly confirmed. */
function requiredHumanGatesSatisfied(model) {
  for (const name of contract.human_gates) {
    const gate = model.humanGates[name] || {};
    if (!isRequiredFlag(gate.required)) continue;
    if (gate.status !== 'confirmed') return false;
  }
  return true;
}

function nextGateAfter(model, completedGate) {
  if (completedGate === 'req-probe' || completedGate === 'openspec') return 'grillme';
  if (completedGate === 'grillme') return 'requirement_confirmation';
  if (completedGate === 'requirement_confirmation') return 'writing-plans';
  if (completedGate === 'implementation_approval') return 'implementation';
  if (completedGate === 'code-review') return 'verification-before-completion';
  if (completedGate === 'verification-before-completion') return 'finish';

  const obligations = routeObligations(contract, {
    level: model.level,
    profile: model.profile,
    riskLabels: model.labels,
    humanGates: model.humanGates,
    riskGates: model.riskGates,
    processMode: model.process.mode,
    execution: model.classification.execution,
  });
  if (obligations.approvalProcessGates.includes(completedGate)) {
    return (
      obligations.approvalProcessGates.find(
        (gate) => !model.completedGates.includes(gate),
      ) ?? 'implementation_approval'
    );
  }
  if (obligations.finishProcessGates.includes(completedGate)) {
    return (
      obligations.finishProcessGates.find(
        (gate) => !model.completedGates.includes(gate),
      ) ?? 'finish'
    );
  }
  return completedGate;
}

function computeApprovalBasisForModel(root, workflow, model) {
  const result = spawnSync(
    process.execPath,
    [
      validator,
      'approval-basis',
      root,
      model.relative,
      '--protected-roots',
      (workflow.protectedWriteRoots || []).join(','),
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stderr.write(result.stdout);
    fail('failed to compute approval basis', 1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`invalid approval-basis JSON: ${error.message}`, 1);
  }
}

function buildApprovedAuth(root, workflow, model, existing) {
  const basis = computeApprovalBasisForModel(root, workflow, model);
  return {
    schema_version: String(contract.authorization_schema || '1'),
    workflow_version: contract.workflow_version,
    feature_id: model.featureId,
    level: model.level,
    profile: model.profile,
    state: 'approved',
    protected_roots: workflow.protectedWriteRoots || [],
    approval_basis: {
      algorithm: basis.algorithm || 'sha256',
      hash: basis.hash,
      route_hash: basis.route_hash,
      assets: basis.assets || [],
      baseline_business_diff_fingerprint: basis.baseline_business_diff_fingerprint,
    },
    created_at: existing?.created_at || nowIso(),
    approved_at: nowIso(),
    closed_at: null,
  };
}

function assertApprovalUpstream(model, gate) {
  // implementation_approval may not be confirmed while a required
  // requirement_confirmation is still pending.
  if (gate !== 'implementation_approval') return;
  const req = model.humanGates.requirement_confirmation || {};
  if (isRequiredFlag(req.required) && req.status !== 'confirmed') {
    fail(
      'cannot confirm implementation_approval while required requirement_confirmation is still pending',
      1,
    );
  }
}

function computeFingerprint(root, workflow) {
  const fingerprintCmd = path.join(__dirname, 'dev-flow-fingerprint');
  if (!fs.existsSync(fingerprintCmd)) fail('dev-flow-fingerprint is missing', 1);
  const result = spawnSync(fingerprintCmd, [workflow.featureRoot, workflow.reviewRoot], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    fail('failed to compute business diff fingerprint', 1);
  }
  const hash = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(hash)) fail(`invalid fingerprint: ${hash}`, 1);
  return hash;
}

function assertNormalApprovalFingerprint(root, workflow, model) {
  if (model.process.mode !== 'normal') return;
  const current = computeFingerprint(root, workflow);
  const baseline = model.process.baseline_business_diff_fingerprint;
  if (current !== baseline) {
    fail(
      `business diff changed before implementation approval; no status/auth changes were made. Run: dev-flow-status mark-retrospective ${model.featureId} --reason "<why implementation already changed>"`,
      1,
    );
  }
}

function registerAsset(model, assetPath, kind) {
  if (model.assets.some((a) => a.path === assetPath)) return;
  model.assets.push({ path: assetPath, kind });
}

function assertEvidenceFile(root, workflow, evidencePath, heading) {
  if (evidencePath.includes('#')) fail('gate evidence path must not contain #');
  repositoryPath(root, evidencePath, 'evidence file');
  const abs = path.join(root, evidencePath);
  if (!fs.existsSync(abs)) fail(`evidence file does not exist: ${evidencePath}`, 1);
  if (!isInside(workflow.featureRootAbs, abs) && !isInside(workflow.reviewRootAbs, abs)) {
    fail(`evidence file is outside feature/review roots: ${evidencePath}`, 1);
  }
  const count = headingCount(abs, heading);
  if (count !== 1) {
    fail(`heading ${JSON.stringify(heading)} must appear exactly once (found ${count})`, 1);
  }
  return abs;
}

// ---------- commands ----------

function cmdAuthorize(root, workflow, flags) {
  const level = flags.level;
  if (!['XS', 'S', 'M'].includes(level)) fail('authorize --level must be XS, S, or M');
  if (flags.profile) fail('authorize must not accept --profile (use init for risk-minimal/standard)');
  if (flags['risk-labels']) fail('authorize does not accept risk labels; use start for risk-minimal-m');
  assertNoStatusBackedDowngrade(root, workflow);
  const processInfo = processForStart(root, workflow, flags);
  closeExistingAuth(root);
  const auth = {
    schema_version: String(contract.authorization_schema || '1'),
    workflow_version: contract.workflow_version,
    feature_id: `xs-s-${level.toLowerCase()}-${createHash('sha1').update(nowIso()).digest('hex').slice(0, 8)}`,
    level,
    profile: null,
    state: 'classified',
    protected_roots: workflow.protectedWriteRoots,
    process: processInfo,
    note: flags.note || '',
    created_at: nowIso(),
    approved_at: nowIso(),
    closed_at: null,
  };
  writeAuth(root, auth);
  process.stdout.write(`authorized ${level} writes (state: classified)\n`);
  process.stdout.write(`${path.relative(root, authPath(root))}\n`);
}

function cmdInit(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const level = flags.level;
  const profile = flags.profile;
  if (!contract.levels.includes(level)) fail(`--level must be one of: ${contract.levels.join(', ')}`);
  if (!Object.hasOwn(contract.profiles, profile)) {
    fail(`--profile must be one of: ${Object.keys(contract.profiles).join(', ')}`);
  }
  if (!contract.profiles[profile].levels.includes(level)) {
    fail(`profile ${profile} is not valid for level ${level}`);
  }
  const topology = flags.topology;
  const evidenceResult = flags['evidence-result'];
  if (!contract.classification_topologies.includes(topology)) {
    fail(`--topology must be one of: ${contract.classification_topologies.join(', ')}`);
  }
  const topologyError = validateTopology(contract, level, topology);
  if (topologyError) fail(topologyError);
  if (!contract.classification_evidence_results.includes(evidenceResult)) {
    fail(`--evidence-result must be one of: ${contract.classification_evidence_results.join(', ')}`);
  }

  const labels = flags['risk-labels']
    ? String(flags['risk-labels'])
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  for (const label of labels) {
    if (!contract.risk_labels.includes(label)) fail(`unknown risk label: ${label}`);
  }
  if (profile === 'standard' && ['XS', 'S'].includes(level) && labels.length > 0) {
    fail('XS/S with risk labels must use profile risk-minimal');
  }

  const processInfo = processForStart(root, workflow, flags);
  if (profile === 'risk-minimal' && labels.length === 0 && processInfo.mode !== 'retrospective') {
    fail('risk-minimal profile requires --risk-labels except for an in-scope retrospective start');
  }
  const lightweightL = Boolean(flags['lightweight-l']);
  const entryGate = flags['entry-gate'];
  const requiresRequirementEntry =
    processInfo.mode === 'normal' && profile === 'standard' && ['M', 'L'].includes(level) && !lightweightL;
  if (requiresRequirementEntry && !entryGate) {
    fail(
      `standard M/L requires --entry-gate (${STANDARD_REQUIREMENT_ENTRY_GATES.join(', ')})`,
    );
  }
  if (entryGate && !STANDARD_REQUIREMENT_ENTRY_GATES.includes(entryGate)) {
    fail(`--entry-gate must be one of: ${STANDARD_REQUIREMENT_ENTRY_GATES.join(', ')}`);
  }
  if (!requiresRequirementEntry && entryGate) {
    fail('--entry-gate is only valid for standard M/L (not lightweight L)');
  }

  const absolute = statusAbs(root, workflow, featureId);
  if (fs.existsSync(absolute)) fail(`status already exists: ${statusPath(workflow, featureId)}`, 1);

  const route = deriveRoute(contract, {
    level,
    profile,
    riskLabels: labels,
    lightweightL,
    entryGate,
    processMode: processInfo.mode,
  });
  const baseRoute = deriveRoute(contract, {
    level,
    profile,
    riskLabels: [],
    lightweightL,
    entryGate,
    processMode: processInfo.mode,
  });
  const humanGates = {};
  for (const gate of contract.human_gates) {
    const required = route.humanGates[gate]?.required === true;
    humanGates[gate] = {
      required,
      status: 'pending',
      evidence: 'not required',
    };
  }

  const content = renderStatus({
    featureId,
    level,
    profile,
    labels,
    topology,
    evidenceResult,
    execution: lightweightL || profile === 'risk-minimal' ? 'light' : 'standard',
    note: flags.note || '',
    currentGate: route.initialCurrentGate,
    nextAction: route.initialNextAction,
    humanGates,
    riskGates: route.riskGates,
    processInfo,
    assets: [],
    acceptedRisks: [],
    gateEvidence: {},
    validation: {
      last_at: 'none',
      commands: [],
      business_diff_fingerprint: 'unknown',
    },
  });

  atomicWriteText(absolute, content, () => runValidatorStatus(root, statusPath(workflow, featureId)) === 0);

  closeExistingAuth(root);
  writeAuth(root, {
    schema_version: String(contract.authorization_schema || '1'),
    workflow_version: contract.workflow_version,
    feature_id: featureId,
    level,
    profile,
    state: 'approval-pending',
    protected_roots: workflow.protectedWriteRoots,
    process: processInfo,
    approval_basis: null,
    created_at: nowIso(),
    approved_at: null,
    closed_at: null,
  });

  const noInc = labelsWithNoGateIncrement(contract, labels, baseRoute.riskGates);
  for (const label of noInc) {
    process.stdout.write(
      `INFO risk label ${label} does not raise gate strength beyond the current route (kept for audit; not auto-stripped)\n`,
    );
  }
  if (labels.length > 0) {
    process.stdout.write(
      'NOTE: when a required risk gate is full, risk_evidence must use report mode pointing at a real report before approval/finish (pending inline is OK at init).\n',
    );
  }

  process.stdout.write(`initialized ${statusPath(workflow, featureId)}\n`);
  process.stdout.write(`write-authorization state: approval-pending\n`);
}

function cmdActivate(root, workflow, featureId) {
  validateFeatureId(featureId);
  const model = loadStatusModel(root, workflow, featureId);
  // Approval-stage: required human gates and route-required upstream process
  // gates must all pass the same validator used by confirm-human.
  let authPayload;
  if (
    requiredHumanGatesSatisfied(model) &&
    runValidatorStatus(root, model.relative, 'approval') === 0
  ) {
    authPayload = buildApprovedAuth(root, workflow, model, null);
  } else {
    authPayload = {
      schema_version: String(contract.authorization_schema || '1'),
      workflow_version: contract.workflow_version,
      feature_id: featureId,
      level: model.level,
      profile: model.profile,
      state: 'approval-pending',
      protected_roots: workflow.protectedWriteRoots,
      approval_basis: null,
      created_at: nowIso(),
      approved_at: null,
      closed_at: null,
    };
  }
  closeExistingAuth(root);
  writeAuth(root, authPayload);
  process.stdout.write(`activated ${featureId} (state: ${authPayload.state})\n`);
}

function cmdAddAsset(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const assetPath = flags.path;
  const kind = flags.kind;
  if (!assetPath) fail('add-asset requires --path');
  if (!kind) fail('add-asset requires --kind');
  if (!contract.asset_kinds.includes(kind)) {
    fail(`--kind must be one of: ${contract.asset_kinds.join(', ')}`);
  }
  if (assetPath.includes('#')) fail('assets must be real file paths; path#heading is forbidden');
  repositoryPath(root, assetPath, 'asset path');
  const abs = path.join(root, assetPath);
  if (!fs.existsSync(abs)) fail(`asset path does not exist: ${assetPath}`, 1);
  if (!isInside(workflow.featureRootAbs, abs) && !isInside(workflow.reviewRootAbs, abs)) {
    fail(`asset path is outside feature/review roots: ${assetPath}`, 1);
  }
  const model = loadStatusModel(root, workflow, featureId);
  if (model.assets.some((a) => a.path === assetPath)) {
    process.stdout.write(`asset already registered: ${assetPath}\n`);
    return;
  }
  model.assets.push({ path: assetPath, kind });
  saveModel(root, model);
  process.stdout.write(`added asset ${assetPath} (${kind})\n`);
}

function cmdCompleteGate(root, workflow, featureId, gate, flags) {
  validateFeatureId(featureId);
  const canonicalGate = canonicalCompletedGate(contract, gate);
  if (!canonicalGate) fail(`unknown gate: ${gate}`);
  if (contract.human_gates.includes(canonicalGate)) {
    fail(`${canonicalGate} must be updated with confirm-human`, 1);
  }
  if (canonicalGate === 'verification-before-completion') {
    fail('verification-before-completion must be updated with complete-verification', 1);
  }
  const model = loadStatusModel(root, workflow, featureId);
  if (model.completedGates.includes(canonicalGate)) {
    fail(`gate already completed: ${canonicalGate}`, 1);
  }

  const isCoverage = canonicalGate === 'requirements-coverage';
  const hasReportEvidence = Boolean(flags['evidence-file'] || flags.heading);
  const hasInlineEvidence = flags['evidence-inline'] !== undefined;
  if (hasReportEvidence && hasInlineEvidence) {
    fail('gate evidence must use either --evidence-inline or --evidence-file/--heading');
  }
  const obligations = routeObligations(contract, {
    level: model.level,
    profile: model.profile,
    riskLabels: model.labels,
    humanGates: model.humanGates,
    riskGates: model.riskGates,
    processMode: model.process.mode,
    execution: model.classification.execution,
  });
  const riskGate = normalizeRiskGateName(canonicalGate);
  const requiredLevel = canonicalGate === 'code-review'
    ? obligations.codeReview.evidence_level
    : riskGate
      ? model.riskGates[riskGate]
      : 'light';

  if (hasInlineEvidence) {
    const summary = String(flags['evidence-inline']).trim();
    if (!summary) fail('--evidence-inline requires a non-empty summary');
    if (requiredLevel === 'full') {
      fail(`${canonicalGate} full evidence requires --evidence-file and --heading`, 1);
    }
    model.gateEvidence = model.gateEvidence || {};
    model.gateEvidence[gateEvidenceKey(canonicalGate)] = { mode: 'inline', summary };
  } else if (hasReportEvidence) {
    if (!flags['evidence-file'] || !flags.heading) {
      fail('gate evidence requires both --evidence-file and --heading');
    }
    const evidencePath = flags['evidence-file'];
    assertEvidenceFile(root, workflow, evidencePath, flags.heading);
    if (requiredLevel === 'full' && !model.assets.some((asset) => asset.path === evidencePath)) {
      fail(`${canonicalGate} full evidence file must be registered with add-asset first`, 1);
    }
    model.gateEvidence = model.gateEvidence || {};
    model.gateEvidence[gateEvidenceKey(canonicalGate)] = {
      mode: 'report',
      path: evidencePath,
      heading: flags.heading,
    };
  } else if (isCoverage) {
    const coverageLevel = model.riskGates.requirements_coverage || 'none';
    if (coverageLevel === 'light') {
      const hasCoverageAsset = model.assets.some((a) => /requirements-coverage/.test(a.path));
      if (!hasCoverageAsset) {
        fail(
          'light requirements-coverage requires --evidence-file and --heading, or a coverage asset',
          1,
        );
      }
    }
  }

  model.completedGates.push(canonicalGate);
  const nextGate = nextGateAfter(model, canonicalGate);
  model.currentGate = nextGate;
  model.nextAction = nextActionForGate(nextGate);
  saveModel(root, model);
  process.stdout.write(`completed gate ${canonicalGate}\n`);
  if (canonicalGate === 'code-review' && flags['evidence-file']) {
    const evidencePath = flags['evidence-file'];
    const registered = model.assets.some((a) => a.path === evidencePath);
    if (!registered) {
      process.stdout.write(
        `HINT: register the code-review report before complete-verification:\n` +
          `  dev-flow-status add-asset ${featureId} --path ${evidencePath} --kind review\n`,
      );
    }
  }
}

function cmdPromoteGate(root, workflow, featureId, gate, flags) {
  validateFeatureId(featureId);
  const riskGate = normalizeRiskGateName(gate);
  if (!riskGate) {
    fail(
      `promote-gate only accepts contract risk gates (${contract.risk_gates.join(', ')}); got: ${gate}`,
    );
  }
  const to = flags.to;
  if (!['light', 'full'].includes(to)) fail('promote-gate --to must be light or full');
  const reason = flags.reason;
  if (!reason || !String(reason).trim()) fail('promote-gate requires --reason');

  const model = loadStatusModel(root, workflow, featureId);
  const current = model.riskGates[riskGate] || 'none';
  const rank = gateRank(contract);
  if (rank[to] < rank[current]) {
    fail(`cannot downgrade risk gate ${riskGate} from ${current} to ${to}`, 1);
  }
  if (rank[to] === rank[current]) {
    fail(`risk gate ${riskGate} is already ${current}`, 1);
  }
  model.riskGates[riskGate] = to;
  const promotionNote = `promote ${riskGate} ${current}->${to}: ${String(reason).trim()}`;
  model.classification.note = [model.classification.note, promotionNote]
    .filter((value) => value && String(value).trim())
    .join(' | ');
  model.nextAction = `promoted ${riskGate} to ${to}`;
  saveModel(root, model);
  process.stdout.write(`promoted ${riskGate}: ${current} -> ${to}\n`);
  process.stdout.write(`reason: ${reason}\n`);
}

function cmdRecordRiskEvidence(root, workflow, featureId, label, flags) {
  validateFeatureId(featureId);
  if (!contract.risk_labels.includes(label)) {
    fail(`unknown risk label: ${label}`);
  }
  const model = loadStatusModel(root, workflow, featureId);
  if (!model.labels.includes(label)) {
    fail(`feature does not declare risk label: ${label}`, 1);
  }
  const entry = model.riskEvidence[label] || {
    mode: 'inline',
    conclusion: 'pending',
    verification: 'pending',
    report: '',
  };
  if (flags.mode !== undefined) {
    if (!contract.evidence_modes.includes(flags.mode)) {
      fail(`--mode must be one of: ${contract.evidence_modes.join(', ')}`);
    }
    entry.mode = flags.mode;
  }
  if (flags.conclusion !== undefined) entry.conclusion = String(flags.conclusion);
  if (flags.verification !== undefined) entry.verification = String(flags.verification);
  if (flags.report !== undefined) {
    const reportPath = String(flags.report);
    if (reportPath) {
      const abs = repositoryPath(root, reportPath, 'risk evidence report');
      if (!fs.existsSync(abs)) fail(`risk evidence report does not exist: ${reportPath}`, 1);
      if (!isInside(workflow.featureRootAbs, abs) && !isInside(workflow.reviewRootAbs, abs)) {
        fail(`risk evidence report is outside feature/review roots: ${reportPath}`, 1);
      }
      if (!fs.statSync(abs).isFile()) fail(`risk evidence report is not a file: ${reportPath}`, 1);
    }
    entry.report = reportPath;
  }
  if (entry.mode === 'report' && (!entry.report || !String(entry.report).trim())) {
    fail('report mode requires --report <path>', 1);
  }
  model.riskEvidence[label] = entry;
  saveModel(root, model);
  process.stdout.write(`recorded risk evidence for ${label}\n`);
}

function cmdCompleteVerification(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const command = flags.command;
  if (!command || !String(command).trim()) fail('complete-verification requires --command');

  const model = loadStatusModel(root, workflow, featureId);

  // Optional report / manual-test paths must exist when provided.
  if (flags.report) {
    const reportPath = String(flags.report);
    repositoryPath(root, reportPath, 'verification report');
    const abs = path.join(root, reportPath);
    if (!fs.existsSync(abs)) fail(`verification report does not exist: ${reportPath}`, 1);
    if (!isInside(workflow.featureRootAbs, abs) && !isInside(workflow.reviewRootAbs, abs)) {
      fail(`verification report is outside feature/review roots: ${reportPath}`, 1);
    }
    registerAsset(model, reportPath, 'verification');
  }
  if (flags['manual-test']) {
    const manualPath = String(flags['manual-test']);
    repositoryPath(root, manualPath, 'manual-test report');
    const abs = path.join(root, manualPath);
    if (!fs.existsSync(abs)) fail(`manual-test report does not exist: ${manualPath}`, 1);
    if (!isInside(workflow.featureRootAbs, abs) && !isInside(workflow.reviewRootAbs, abs)) {
      fail(`manual-test report is outside feature/review roots: ${manualPath}`, 1);
    }
    registerAsset(model, manualPath, 'verification');
  }

  // Route-derived code-review obligation (not a risk_gates field).
  const obligation = codeReviewObligation(contract, {
    level: model.level,
    profile: model.profile,
    humanGates: model.humanGates,
    riskLabels: model.labels || [],
    processMode: model.process.mode,
    execution: model.classification.execution,
  });
  if (obligation.required) {
    if (!model.completedGates.includes('code-review')) {
      fail('complete-verification requires completed_gates to include code-review', 1);
    }
    const evidence = model.gateEvidence?.code_review;
    const hasInline = evidence?.mode === 'inline' && String(evidence.summary || '').trim();
    const hasReport = evidence?.mode === 'report' && evidence.path && evidence.heading;
    if (!hasInline && !hasReport) {
      fail(
        'complete-verification requires valid inline or report gate_evidence.code_review',
        1,
      );
    }
    if (obligation.evidence_level === 'full' && !hasReport) {
      fail('full code-review requires report gate evidence', 1);
    }
    if (hasReport) {
      const abs = path.join(root, evidence.path);
      if (!fs.existsSync(abs)) {
        fail(`code-review evidence file does not exist: ${evidence.path}`, 1);
      }
    }
  }

  const fingerprint = computeFingerprint(root, workflow);
  const commands = Array.isArray(model.validation.commands) ? model.validation.commands : [];
  commands.push(String(command));
  model.validation.commands = commands;
  model.validation.last_at = nowIso();
  model.validation.business_diff_fingerprint = fingerprint;

  if (!model.completedGates.includes('verification-before-completion')) {
    model.completedGates.push('verification-before-completion');
  }
  model.currentGate = 'finish';
  model.nextAction = nextActionForGate('finish');

  // Atomic write + finish validation; restore on failure. Never writes check-ok.
  saveModel(root, model, { stage: 'finish' });
  process.stdout.write(`completed verification for ${featureId}\n`);
  process.stdout.write(`business_diff_fingerprint: ${fingerprint}\n`);
}

function cmdConfirmHuman(root, workflow, featureId, gate, flags) {
  validateFeatureId(featureId);
  if (!contract.human_gates.includes(gate)) {
    fail(`human gate must be one of: ${contract.human_gates.join(', ')}`);
  }
  const status = flags.status;
  if (status !== 'confirmed') {
    fail('--status must be confirmed; accepting residual risk is confirmed with evidence');
  }
  const evidence = flags.evidence;
  if (!evidence || !String(evidence).trim()) fail('--evidence is required');
  if (['none', 'n/a', 'not required', 'not-applicable', '无', '不适用'].includes(String(evidence).trim().toLowerCase())) {
    fail('--evidence must be meaningful user evidence');
  }

  const model = loadStatusModel(root, workflow, featureId);
  if (!model.humanGates[gate]) fail(`status is missing human_gates.${gate}`, 1);
  assertApprovalUpstream(model, gate);
  const firstImplementationApproval =
    gate === 'implementation_approval' && model.humanGates[gate].status !== 'confirmed';
  if (firstImplementationApproval) {
    assertNormalApprovalFingerprint(root, workflow, model);
  }
  model.humanGates[gate].status = status;
  model.humanGates[gate].evidence = evidence;
  if (!model.completedGates.includes(gate)) model.completedGates.push(gate);
  const nextGate = nextGateAfter(model, gate);
  model.currentGate = nextGate;
  model.nextAction = nextActionForGate(nextGate);
  saveModel(root, model, {
    stage: gate === 'implementation_approval' ? 'approval' : 'current',
  });

  // Sync write-authorization only when all required gates are confirmed.
  if (gate === 'implementation_approval') {
    if (requiredHumanGatesSatisfied(model)) {
      const existing = readAuth(root);
      writeAuth(root, buildApprovedAuth(root, workflow, model, existing));
      process.stdout.write('write-authorization state: approved (approval_basis bound)\n');
    }
  }

  process.stdout.write(`human gate ${gate}: ${status}\n`);
}

function cmdRecordValidation(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const command = flags.command;
  if (!command || !String(command).trim()) fail('--command is required');
  const model = loadStatusModel(root, workflow, featureId);
  const commands = Array.isArray(model.validation.commands) ? model.validation.commands : [];
  commands.push(String(command));
  model.validation.commands = commands;
  model.validation.last_at = nowIso();

  // Refresh business diff fingerprint via shared script when available.
  const fingerprintCmd = path.join(__dirname, 'dev-flow-fingerprint');
  if (fs.existsSync(fingerprintCmd)) {
    const result = spawnSync(fingerprintCmd, [workflow.featureRoot, workflow.reviewRoot], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      model.validation.business_diff_fingerprint = result.stdout.trim();
    }
  }

  saveModel(root, model);
  process.stdout.write(`recorded validation command\n`);
}

function cmdAcceptRisk(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const id = flags.id;
  const token = flags['proposal-token'];
  const evidence = flags.evidence;
  if (!id || !/^AR-[A-Za-z0-9_-]+$/.test(id)) fail('--id must look like AR-xxx');
  if (!token || !/^[0-9a-f]{64}$/.test(String(token))) fail('--proposal-token must be the one-time 64-hex token');
  if (!evidence || !String(evidence).trim()) fail('--evidence is required');
  const normalizedEvidence = String(evidence).trim();

  const proposalFile = riskProposalPath(root, featureId, id);
  if (!fs.existsSync(proposalFile)) fail('risk proposal is missing; run propose-risk again', 1);
  let proposal;
  try {
    proposal = JSON.parse(fs.readFileSync(proposalFile, 'utf8'));
  } catch (error) {
    fail(`risk proposal is unreadable; run propose-risk again: ${error.message}`, 1);
  }
  if (proposal.consumed_at) fail('risk proposal token was already consumed; run propose-risk again', 1);
  const expiresAt = Date.parse(proposal.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    fail('risk proposal token expired; run propose-risk again', 1);
  }
  const tokenHash = createHash('sha256').update(String(token)).digest('hex');
  if (tokenHash !== proposal.token_hash || proposal.feature_id !== featureId || proposal.id !== id) {
    fail('risk proposal token does not match this feature and AR', 1);
  }
  const vague = new Set(['确认', '继续', '完成吧', '完成', '行', '行吧', '可以', 'ok', 'okay', 'continue', 'finish']);
  const namesProposal = normalizedEvidence.toLowerCase().includes(id.toLowerCase());
  const acceptsRisk =
    /(接受|同意承担).*(风险)|(accept|assume).*(risk)/i.test(normalizedEvidence) ||
    (namesProposal && /(接受|同意承担)|(accept|assume)/i.test(normalizedEvidence));
  const continues = /(继续|收尾|完成)|(continue|proceed|close(?:\s|-)?out|finish)/i.test(normalizedEvidence);
  const referencesNamedRisk =
    /(?:具名|残余|剩余|上述|上面|前述|刚列出|刚才列出|该项|这项|所列).{0,16}风险|风险.{0,16}(?:具名|残余|剩余|上述|上面|前述|刚列出|刚才列出|该项|这项|所列)/.test(normalizedEvidence) ||
    /(?:named|residual|remaining|listed|above|described|this|that)(?:\s+\w+){0,4}\s+risk|risk(?:\s+\w+){0,4}\s+(?:named|residual|remaining|listed|above|described|this|that)/i.test(normalizedEvidence);
  if (
    vague.has(normalizedEvidence.toLowerCase()) ||
    !acceptsRisk ||
    !continues ||
    (!namesProposal && !referencesNamedRisk)
  ) {
    fail('accept-risk requires an explicit reply accepting this proposal\'s named residual risk and continuing/closing out; generic risk acceptance is insufficient', 1);
  }
  const currentFingerprint = computeFingerprint(root, workflow);
  if (proposal.business_diff_fingerprint !== currentFingerprint) {
    fail('risk proposal is stale because business diff changed; run propose-risk again', 1);
  }

  const model = loadStatusModel(root, workflow, featureId);
  if (!model.acceptedRisks.includes(id)) model.acceptedRisks.push(id);
  saveModel(root, model);
  const acceptance = updatePartialAcceptance(root, workflow, featureId, {
    id,
    step: proposal.step,
    reason: proposal.reason,
    evidence: normalizedEvidence,
    confirmed_at: nowIso(),
  });
  proposal.consumed_at = nowIso();
  writeJsonAtomic(proposalFile, proposal);
  process.stdout.write(`accepted risk ${id} for step ${proposal.step}\n`);
  process.stdout.write(`${acceptance}\n`);
}

function riskProposalPath(root, featureId, id) {
  validateFeatureId(featureId);
  if (!/^AR-[A-Za-z0-9_-]+$/.test(id)) fail('--id must look like AR-xxx');
  return path.join(root, '.claude/runtime/dev-flow/risk-proposals', featureId, `${id}.json`);
}

function cmdProposeRisk(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const id = flags.id;
  const step = String(flags.step || '').trim();
  const reason = String(flags.reason || '').trim();
  if (!id || !/^AR-[A-Za-z0-9_-]+$/.test(id)) fail('--id must look like AR-xxx');
  if (!step) fail('--step is required');
  if (!reason) fail('--reason is required');
  loadStatusModel(root, workflow, featureId);
  const token = randomBytes(32).toString('hex');
  const proposal = {
    schema_version: '1',
    workflow_version: contract.workflow_version,
    feature_id: featureId,
    id,
    step,
    reason,
    business_diff_fingerprint: computeFingerprint(root, workflow),
    token_hash: createHash('sha256').update(token).digest('hex'),
    created_at: nowIso(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    consumed_at: null,
  };
  writeJsonAtomic(riskProposalPath(root, featureId, id), proposal);
  process.stdout.write(`[HANDOFF]\nFeature ID: ${featureId}\n`);
  process.stdout.write('Current gate: verification-before-completion\n');
  process.stdout.write('Next skill: verification-before-completion\n');
  process.stdout.write(`Next inputs:\n- ${id}: ${step}\n- reason: ${reason}\n- proposal-token: ${token}\n`);
  process.stdout.write('Auto-continue: no\n');
  process.stdout.write('Stop reason: awaiting explicit residual-risk acceptance or an actual test result\n[/HANDOFF]\n');
}

function pendingAuth(root, workflow, model) {
  return {
    schema_version: String(contract.authorization_schema || '1'),
    workflow_version: contract.workflow_version,
    feature_id: model.featureId,
    level: model.level,
    profile: model.profile,
    state: 'approval-pending',
    protected_roots: workflow.protectedWriteRoots,
    process: model.process,
    approval_basis: null,
    created_at: readAuth(root)?.created_at || nowIso(),
    approved_at: null,
    closed_at: null,
  };
}

function cmdMarkRetrospective(root, workflow, featureId, flags) {
  const reason = String(flags.reason || '').trim();
  if (!reason) fail('mark-retrospective requires --reason');
  const model = loadStatusModel(root, workflow, featureId);
  if (model.process.mode === 'retrospective') {
    process.stdout.write(`process mode is already retrospective for ${featureId}\n`);
    return;
  }
  if (model.humanGates.implementation_approval?.status === 'confirmed') {
    fail('cannot switch to retrospective after implementation approval; start a new recovery feature', 1);
  }
  model.process.mode = 'retrospective';
  model.process.reason = reason;
  model.humanGates.requirement_confirmation.required = 'false';
  model.currentGate = 'implementation_approval';
  model.nextAction = 'await implementation_approval';
  saveModel(root, model);
  writeAuth(root, pendingAuth(root, workflow, model));
  process.stdout.write(`marked ${featureId} retrospective; implementation approval is still pending\n`);
}

function parseRiskLabels(flags) {
  const labels = flags['risk-labels']
    ? String(flags['risk-labels']).split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicate) fail(`duplicate risk label: ${duplicate}`);
  for (const label of labels) {
    if (!contract.risk_labels.includes(label)) fail(`unknown risk label: ${label}`);
  }
  return labels;
}

function snapshotFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function restoreFile(filePath, snapshot) {
  if (snapshot === null) fs.rmSync(filePath, { force: true });
  else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, snapshot);
  }
}

function cmdStart(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const statusFile = statusAbs(root, workflow, featureId);
  if (fs.existsSync(statusFile)) fail(`status already exists: ${statusPath(workflow, featureId)}`, 1);
  const labels = parseRiskLabels(flags);
  const processInfo = processForStart(root, workflow, flags);
  let startPlan;
  try {
    startPlan = deriveStartPlan(contract, {
      level: flags.level,
      topology: flags.topology,
      riskLabels: labels,
      execution: flags.execution,
      requirements: flags.requirements,
      processMode: processInfo.mode,
    });
  } catch (error) {
    fail(error.message);
  }
  const summary = {
    feature_id: featureId,
    level: flags.level,
    topology: flags.topology,
    risk_labels: labels,
    process: processInfo,
    action: startPlan.kind,
    route: startPlan.route,
    profile: startPlan.profile,
    entry_gate: startPlan.entryGate || null,
  };
  if (flags['dry-run']) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (startPlan.kind === 'authorize') {
    assertNoStatusBackedDowngrade(root, workflow);
    writeAuth(root, {
      schema_version: String(contract.authorization_schema || '2'),
      workflow_version: contract.workflow_version,
      feature_id: featureId,
      level: flags.level,
      profile: null,
      state: 'classified',
      protected_roots: workflow.protectedWriteRoots,
      process: processInfo,
      note: flags.note || '',
      created_at: nowIso(),
      approved_at: nowIso(),
      closed_at: null,
    });
    process.stdout.write(`started ${featureId}: ${startPlan.route} (classified)\n`);
    return;
  }

  const authFile = authPath(root);
  const authSnapshot = snapshotFile(authFile);
  const args = [process.argv[1], 'init', featureId, '--level', flags.level, '--profile', startPlan.profile,
    '--topology', flags.topology, '--evidence-result', flags['evidence-result'] || 'partial'];
  if (labels.length) args.push('--risk-labels', labels.join(','));
  if (startPlan.lightweightL) args.push('--lightweight-l');
  if (startPlan.entryGate) args.push('--entry-gate', startPlan.entryGate);
  if (flags.note) args.push('--note', flags.note);
  if (processInfo.existing_diff !== 'clean') {
    args.push('--existing-diff', processInfo.existing_diff, '--reason', processInfo.reason);
  }
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    fs.rmSync(statusFile, { force: true });
    restoreFile(authFile, authSnapshot);
    fail('start failed atomically; status and authorization were restored', 1);
  }
  process.stdout.write(`started ${featureId}: ${startPlan.route}\n`);
}

function nextCommand(model) {
  const action = model.nextAction || '';
  if (action.startsWith('await ')) {
    const gate = action.slice('await '.length);
    return `dev-flow-status confirm-human ${model.featureId} ${gate} --status confirmed --evidence "<exact user reply>"`;
  }
  if (action === 'run implementation' || action === 'implementation') return '/executing-plans';
  if (action.startsWith('run ')) return `/${action.slice('run '.length)}`;
  if (action.includes('finish')) return '/finish';
  return action || 'none';
}

function cmdNext(root, workflow, featureId) {
  const auth = readAuth(root);
  const id = featureId || auth?.feature_id;
  if (!id) fail('next requires a feature id when no active authorization exists', 1);
  validateFeatureId(id);
  const statusFile = statusAbs(root, workflow, id);
  if (!fs.existsSync(statusFile)) {
    const completion = path.join(root, workflow.featureRoot, id, 'completion.md');
    if (fs.existsSync(completion)) {
      process.stdout.write(`feature: ${id}\nstate: finalized\nnext: none\n`);
      return;
    }
    if (auth?.feature_id === id && auth.state === 'classified') {
      process.stdout.write(`feature: ${id}\nroute: ${auth.level === 'M' ? 'light-m' : 'xs-s'}\nprocess: ${auth.process?.mode || 'normal'}\nauthorization: classified\ncurrent_gate: implementation\nblocked: no\nblocker: none\ncommand: /executing-plans\n`);
      return;
    }
    fail(`no status or classified authorization found for ${id}`, 1);
  }
  const model = loadStatusModel(root, workflow, id);
  const obligations = routeObligations(contract, {
    level: model.level,
    profile: model.profile,
    riskLabels: model.labels,
    humanGates: model.humanGates,
    riskGates: model.riskGates,
    processMode: model.process.mode,
    execution: model.classification.execution,
  });
  const authState = auth?.feature_id === id ? auth.state : 'inactive';
  const blocked = authState !== 'approved';
  const blocker = blocked
    ? authState === 'approval-pending'
      ? `awaiting ${model.currentGate}`
      : `authorization ${authState}`
    : 'none';
  process.stdout.write(`feature: ${id}\nroute: ${obligations.route}\nprocess: ${model.process.mode}\nauthorization: ${authState}\n`);
  process.stdout.write(`current_gate: ${model.currentGate}\nblocked: ${blocked ? 'yes' : 'no'}\nblocker: ${blocker}\ncommand: ${nextCommand(model)}\n`);
}

function scaffoldPath(workflow, featureId, asset) {
  if (asset === 'rollback-units') return path.join(workflow.featureRoot, featureId, 'rollback-units.md');
  if (asset === 'completion') return path.join(workflow.featureRoot, featureId, 'completion.md');
  return path.join(workflow.reviewRoot, `${featureId}-${asset}.md`);
}

function completionContent(root, workflow, model) {
  const risks = model.acceptedRisks;
  const labels = model.labels;
  const list = (values) => values.length ? `[${values.map(yamlQuote).join(', ')}]` : '[]';
  const approval = model.humanGates.implementation_approval?.evidence || '';
  const verification = labels.map((label) => model.riskEvidence[label]?.verification).filter(Boolean).join(' | ');
  let content = '---\ndev_flow_completion:\n';
  content += `  schema_version: ${yamlQuote(contract.completion_schema)}\n`;
  content += `  feature_id: ${yamlQuote(model.featureId)}\n  level: ${yamlQuote(model.level)}\n`;
  content += `  outcome: ${yamlQuote(risks.length ? 'partial' : 'verified')}\n  completed_at: ${yamlQuote(nowIso())}\n`;
  content += `  retention: ${yamlQuote(workflow.retention)}\n  workflow_version: ${yamlQuote(contract.workflow_version)}\n`;
  content += `  process_mode: ${yamlQuote(model.process.mode)}\n`;
  content += `  retrospective_reason: ${yamlQuote(model.process.mode === 'retrospective' ? model.process.reason : 'none')}\n`;
  content += `  retrospective_evidence: ${yamlQuote(model.process.mode === 'retrospective' ? approval : 'none')}\n`;
  content += `  risk_labels: ${list(labels)}\n  risk_approval_evidence: ${yamlQuote(approval)}\n`;
  content += `  risk_verification_summary: ${yamlQuote(verification)}\n`;
  content += `  business_diff_fingerprint: ${yamlQuote(model.validation.business_diff_fingerprint)}\n`;
  content += `  commits: []\n  pull_request: "none"\n  accepted_risks: ${list(risks)}\n---\n\n# Completion\n`;
  const acceptance = partialAcceptancePath(workflow, model.featureId);
  const acceptanceAbs = path.join(root, acceptance);
  if (risks.length && fs.existsSync(acceptanceAbs)) {
    const source = fs.readFileSync(acceptanceAbs, 'utf8');
    for (const id of risks) {
      const block = source.match(new RegExp(`^## ${id}\\n[\\s\\S]*?(?=^## |$)`, 'm'))?.[0];
      if (block) content += `\n${block.trim()}\n`;
    }
  }
  return content;
}

function cmdScaffold(root, workflow, featureId, flags) {
  validateFeatureId(featureId);
  const asset = flags.asset;
  const allowed = new Set(['rollback-units', 'security-review', 'code-review', 'verification', 'manual-test', 'partial-acceptance', 'completion']);
  if (!allowed.has(asset)) fail(`--asset must be one of: ${[...allowed].join(', ')}`);
  const refresh = Boolean(flags.refresh);
  if (refresh && asset !== 'completion') fail('--refresh is only valid for completion');
  const model = loadStatusModel(root, workflow, featureId);
  const relative = scaffoldPath(workflow, featureId, asset);
  const absolute = path.join(root, relative);
  if (fs.existsSync(absolute) && !refresh) fail(`asset already exists: ${relative}`, 1);
  let content;
  if (asset === 'completion') {
    content = completionContent(root, workflow, model);
  } else if (asset === 'manual-test') {
    content = `---\nmanual_test_steps:\n  - id: MT-001\n    result: delegated\n    risk_id: null\n    observed: pending\n    evidence: pending\n    method: null\n---\n\n# Manual test — ${featureId}\n`;
  } else if (asset === 'partial-acceptance') {
    content = `# Partial acceptance — ${featureId}\n`;
  } else {
    const title = asset.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
    content = `# ${title} — ${featureId}\n\n## Summary\n\nPending.\n`;
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  if (asset !== 'completion') {
    const kind = ['verification', 'manual-test'].includes(asset) ? 'verification' : 'review';
    registerAsset(model, relative, kind);
    saveModel(root, model);
  }
  process.stdout.write(`${refresh ? 'refreshed' : 'created'} ${relative}\n`);
}

function cmdRepair(root, workflow, featureId) {
  validateFeatureId(featureId);
  const model = loadStatusModel(root, workflow, featureId);
  // Deterministic field order only — no invented facts.
  saveModel(root, model);
  process.stdout.write(`repaired field order for ${featureId}\n`);
}

function usage() {
  process.stdout.write(`Usage:
  dev-flow-status start <feature-id> --level <XS|S|M|L> --topology <topology> \\
    [--risk-labels a,b] [--execution <light|standard>] [--requirements <state>] \\
    [--evidence-result <result>] [--existing-diff <unrelated|in-scope> --reason <text>] [--dry-run]
  dev-flow-status next [feature-id]
  dev-flow-status scaffold <feature-id> --asset <kind> [--refresh]
  dev-flow-status authorize --level <XS|S|M> [--note <text>]
  dev-flow-status init <feature-id> --level <XS|S|M|L> --profile <profile> \\
    --topology <topology> --evidence-result <result> [--entry-gate <gate>] \
    [--note <text>] [--risk-labels a,b] [--lightweight-l]
  dev-flow-status activate <feature-id>
  dev-flow-status add-asset <feature-id> --path <repo-path> --kind <kind>
  dev-flow-status complete-gate <feature-id> <gate> \\
    [--evidence-inline <summary> | --evidence-file <repo-path> --heading <markdown-heading>]
  dev-flow-status promote-gate <feature-id> <risk-gate> --to <light|full> --reason <text>
  dev-flow-status record-risk-evidence <feature-id> <label> \\
    [--mode <inline|report>] [--conclusion <text>] [--verification <text>] [--report <path>]
  dev-flow-status confirm-human <feature-id> <gate> \\
    --status confirmed --evidence <user-evidence>
  dev-flow-status record-validation <feature-id> --command <command>
  dev-flow-status complete-verification <feature-id> --command <command> \\
    [--report <path>] [--manual-test <path>]
  dev-flow-status propose-risk <feature-id> --id <AR-xxx> --step <step> --reason <reason>
  dev-flow-status accept-risk <feature-id> --id <AR-xxx> \\
    --proposal-token <token> --evidence <exact-user-reply>
  dev-flow-status mark-retrospective <feature-id> --reason <reason>
  dev-flow-status repair <feature-id>
`);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || positional.length === 0) {
    usage();
    process.exit(flags.help ? 0 : 2);
  }
  const command = positional[0];
  const root = gitRoot();
  const workflow = loadWorkflow(root);

  switch (command) {
    case 'start':
      if (!positional[1]) fail('start requires <feature-id>');
      cmdStart(root, workflow, positional[1], flags);
      break;
    case 'next':
      cmdNext(root, workflow, positional[1]);
      break;
    case 'scaffold':
      if (!positional[1]) fail('scaffold requires <feature-id>');
      cmdScaffold(root, workflow, positional[1], flags);
      break;
    case 'authorize':
      cmdAuthorize(root, workflow, flags);
      break;
    case 'init':
      if (!positional[1]) fail('init requires <feature-id>');
      cmdInit(root, workflow, positional[1], flags);
      break;
    case 'activate':
      if (!positional[1]) fail('activate requires <feature-id>');
      cmdActivate(root, workflow, positional[1]);
      break;
    case 'add-asset':
      if (!positional[1]) fail('add-asset requires <feature-id>');
      cmdAddAsset(root, workflow, positional[1], flags);
      break;
    case 'complete-gate':
      if (!positional[1] || !positional[2]) fail('complete-gate requires <feature-id> <gate>');
      cmdCompleteGate(root, workflow, positional[1], positional[2], flags);
      break;
    case 'promote-gate':
      if (!positional[1] || !positional[2]) fail('promote-gate requires <feature-id> <risk-gate>');
      cmdPromoteGate(root, workflow, positional[1], positional[2], flags);
      break;
    case 'record-risk-evidence':
      if (!positional[1] || !positional[2]) {
        fail('record-risk-evidence requires <feature-id> <label>');
      }
      cmdRecordRiskEvidence(root, workflow, positional[1], positional[2], flags);
      break;
    case 'confirm-human':
      if (!positional[1] || !positional[2]) fail('confirm-human requires <feature-id> <gate>');
      cmdConfirmHuman(root, workflow, positional[1], positional[2], flags);
      break;
    case 'record-validation':
      if (!positional[1]) fail('record-validation requires <feature-id>');
      cmdRecordValidation(root, workflow, positional[1], flags);
      break;
    case 'complete-verification':
      if (!positional[1]) fail('complete-verification requires <feature-id>');
      cmdCompleteVerification(root, workflow, positional[1], flags);
      break;
    case 'accept-risk':
      if (!positional[1]) fail('accept-risk requires <feature-id>');
      cmdAcceptRisk(root, workflow, positional[1], flags);
      break;
    case 'propose-risk':
      if (!positional[1]) fail('propose-risk requires <feature-id>');
      cmdProposeRisk(root, workflow, positional[1], flags);
      break;
    case 'mark-retrospective':
      if (!positional[1]) fail('mark-retrospective requires <feature-id>');
      cmdMarkRetrospective(root, workflow, positional[1], flags);
      break;
    case 'repair':
      if (!positional[1]) fail('repair requires <feature-id>');
      cmdRepair(root, workflow, positional[1]);
      break;
    default:
      fail(`unknown command: ${command}`);
  }
}

main();
