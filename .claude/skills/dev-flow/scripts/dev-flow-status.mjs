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
 *   dev-flow-status authorize --level <XS|S> [--note <text>]
 *   dev-flow-status init <feature-id> --level <XS|S|M|L> --profile <profile> \
 *     --topology <topology> --evidence-result <result> [--note <text>] [--risk-labels a,b] [--lightweight-l]
 *   dev-flow-status activate <feature-id>
 *   dev-flow-status add-asset <feature-id> --path <repo-path> --kind <kind>
 *   dev-flow-status complete-gate <feature-id> <gate> \
 *     [--evidence-file <repo-path> --heading <markdown-heading>]
 *   dev-flow-status promote-gate <feature-id> <risk-gate> --to <light|full> --reason <text>
 *   dev-flow-status record-risk-evidence <feature-id> <label> \
 *     [--mode <inline|report>] [--conclusion <text>] [--verification <text>] [--report <path>]
 *   dev-flow-status confirm-human <feature-id> <gate> \
 *     --status <confirmed|skipped> --evidence <user-evidence>
 *   dev-flow-status record-validation <feature-id> --command <command>
 *   dev-flow-status complete-verification <feature-id> --command <command> \
 *     [--report <path>] [--manual-test <path>]
 *   dev-flow-status accept-risk <feature-id> --id <AR-xxx> \
 *     --step <manual-test-step-id> --reason <reason> --evidence <user-evidence>
 *   dev-flow-status repair <feature-id>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  canonicalCompletedGate,
  codeReviewObligation,
  deriveRoute,
  gateRank,
  loadContract,
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
  note,
  currentGate,
  nextAction,
  humanGates,
  riskGates,
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
  body += '  classification:\n';
  body += `    topology: ${yamlQuote(topology)}\n`;
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
      body += `      path: ${yamlQuote(evidence.path)}\n`;
      body += `      heading: ${yamlQuote(evidence.heading)}\n`;
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
    const field = line.match(/^      (path|heading):\s*(.*)$/);
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
  body += '  classification:\n';
  body += `    topology: ${yamlQuote(model.classification.topology || 'local')}\n`;
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
      body += `      path: ${yamlQuote(evidence.path)}\n`;
      body += `      heading: ${yamlQuote(evidence.heading)}\n`;
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

function humanGateSatisfied(gate) {
  return gate?.status === 'confirmed' || gate?.status === 'skipped';
}

function requiredHumanGatesSatisfied(model) {
  for (const name of contract.human_gates) {
    const gate = model.humanGates[name] || {};
    if (isRequiredFlag(gate.required) && !humanGateSatisfied(gate)) return false;
  }
  return true;
}

function assertApprovalUpstream(model, gate) {
  // implementation_approval may not be confirmed/skipped while a required
  // requirement_confirmation is still pending.
  if (gate !== 'implementation_approval') return;
  const req = model.humanGates.requirement_confirmation || {};
  if (isRequiredFlag(req.required) && !humanGateSatisfied(req)) {
    fail(
      'cannot confirm/skip implementation_approval while required requirement_confirmation is still pending',
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
  if (!['XS', 'S'].includes(level)) fail('authorize --level must be XS or S');
  if (flags.profile) fail('authorize must not accept --profile (use init for risk-minimal/standard)');
  closeExistingAuth(root);
  const auth = {
    feature_id: `xs-s-${level.toLowerCase()}-${createHash('sha1').update(nowIso()).digest('hex').slice(0, 8)}`,
    level,
    profile: null,
    state: 'classified',
    protected_roots: workflow.protectedWriteRoots,
    note: flags.note || '',
    created_at: nowIso(),
    approved_at: nowIso(),
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
  if (profile === 'risk-minimal' && labels.length === 0) {
    fail('risk-minimal profile requires --risk-labels');
  }
  if (profile === 'standard' && ['XS', 'S'].includes(level) && labels.length > 0) {
    fail('XS/S with risk labels must use profile risk-minimal');
  }

  const absolute = statusAbs(root, workflow, featureId);
  if (fs.existsSync(absolute)) fail(`status already exists: ${statusPath(workflow, featureId)}`, 1);

  const route = deriveRoute(contract, {
    level,
    profile,
    riskLabels: labels,
    lightweightL: Boolean(flags['lightweight-l']),
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
    note: flags.note || '',
    currentGate: route.initialCurrentGate,
    nextAction: route.initialNextAction,
    humanGates,
    riskGates: route.riskGates,
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
    feature_id: featureId,
    level,
    profile,
    state: 'approval-pending',
    protected_roots: workflow.protectedWriteRoots,
    created_at: nowIso(),
    approved_at: null,
  });

  process.stdout.write(`initialized ${statusPath(workflow, featureId)}\n`);
  process.stdout.write(`write-authorization state: approval-pending\n`);
}

function cmdActivate(root, workflow, featureId) {
  validateFeatureId(featureId);
  const model = loadStatusModel(root, workflow, featureId);
  // Approval-stage: required human gates and route-required upstream process
  // gates must all pass the same validator used by confirm-human.
  let state = 'approval-pending';
  let approvedAt = null;
  if (
    requiredHumanGatesSatisfied(model) &&
    runValidatorStatus(root, model.relative, 'approval') === 0
  ) {
    state = 'approved';
    approvedAt = nowIso();
  }
  closeExistingAuth(root);
  writeAuth(root, {
    feature_id: featureId,
    level: model.level,
    profile: model.profile,
    state,
    protected_roots: workflow.protectedWriteRoots,
    created_at: nowIso(),
    approved_at: approvedAt,
  });
  process.stdout.write(`activated ${featureId} (state: ${state})\n`);
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
  const hasEvidenceFlags = Boolean(flags['evidence-file'] || flags.heading);

  if (hasEvidenceFlags) {
    if (!flags['evidence-file'] || !flags.heading) {
      fail('gate evidence requires both --evidence-file and --heading');
    }
    const evidencePath = flags['evidence-file'];
    assertEvidenceFile(root, workflow, evidencePath, flags.heading);
    model.gateEvidence = model.gateEvidence || {};
    model.gateEvidence[gateEvidenceKey(canonicalGate)] = {
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
  model.currentGate = canonicalGate;
  model.nextAction = `after ${canonicalGate}`;
  saveModel(root, model);
  process.stdout.write(`completed gate ${canonicalGate}\n`);
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
  });
  if (obligation.required) {
    if (!model.completedGates.includes('code-review')) {
      fail('complete-verification requires completed_gates to include code-review', 1);
    }
    const evidence = model.gateEvidence?.code_review;
    if (!evidence?.path || !evidence?.heading) {
      fail(
        'complete-verification requires gate_evidence.code_review with path and heading',
        1,
      );
    }
    const abs = path.join(root, evidence.path);
    if (!fs.existsSync(abs)) {
      fail(`code-review evidence file does not exist: ${evidence.path}`, 1);
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
  model.currentGate = 'verification-before-completion';
  model.nextAction = 'finish';

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
  if (!['confirmed', 'skipped'].includes(status)) {
    fail('--status must be confirmed or skipped');
  }
  const evidence = flags.evidence;
  if (!evidence || !String(evidence).trim()) fail('--evidence is required');
  if (['none', 'n/a', 'not required', 'not-applicable', '无', '不适用'].includes(String(evidence).trim().toLowerCase())) {
    fail('--evidence must be meaningful user evidence');
  }

  const model = loadStatusModel(root, workflow, featureId);
  if (!model.humanGates[gate]) fail(`status is missing human_gates.${gate}`, 1);
  assertApprovalUpstream(model, gate);
  model.humanGates[gate].status = status;
  model.humanGates[gate].evidence = evidence;
  if (!model.completedGates.includes(gate)) model.completedGates.push(gate);
  model.currentGate = gate;
  model.nextAction = status === 'confirmed' ? `after ${gate}` : `skipped ${gate}`;
  saveModel(root, model, {
    stage: gate === 'implementation_approval' ? 'approval' : 'current',
  });

  // Sync write-authorization only when every required human gate is satisfied.
  if (gate === 'implementation_approval' && requiredHumanGatesSatisfied(model)) {
    const auth = readAuth(root);
    if (auth && auth.feature_id === featureId) {
      auth.state = 'approved';
      auth.approved_at = nowIso();
      writeAuth(root, auth);
    } else {
      writeAuth(root, {
        feature_id: featureId,
        level: model.level,
        profile: model.profile,
        state: 'approved',
        protected_roots: workflow.protectedWriteRoots,
        created_at: nowIso(),
        approved_at: nowIso(),
      });
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
  const step = flags.step;
  const reason = flags.reason;
  const evidence = flags.evidence;
  if (!id || !/^AR-[A-Za-z0-9_-]+$/.test(id)) fail('--id must look like AR-xxx');
  if (!step || !String(step).trim()) fail('--step is required');
  if (!reason || !String(reason).trim()) fail('--reason is required');
  if (!evidence || !String(evidence).trim()) fail('--evidence is required');

  const model = loadStatusModel(root, workflow, featureId);
  if (!model.acceptedRisks.includes(id)) model.acceptedRisks.push(id);
  saveModel(root, model);
  const acceptance = updatePartialAcceptance(root, workflow, featureId, {
    id,
    step,
    reason,
    evidence,
    confirmed_at: nowIso(),
  });
  process.stdout.write(`accepted risk ${id} for step ${step}\n`);
  process.stdout.write(`${acceptance}\n`);
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
  dev-flow-status authorize --level <XS|S> [--note <text>]
  dev-flow-status init <feature-id> --level <XS|S|M|L> --profile <profile> \\
    --topology <topology> --evidence-result <result> [--note <text>] [--risk-labels a,b] [--lightweight-l]
  dev-flow-status activate <feature-id>
  dev-flow-status add-asset <feature-id> --path <repo-path> --kind <kind>
  dev-flow-status complete-gate <feature-id> <gate> \\
    [--evidence-file <repo-path> --heading <markdown-heading>]
  dev-flow-status promote-gate <feature-id> <risk-gate> --to <light|full> --reason <text>
  dev-flow-status record-risk-evidence <feature-id> <label> \\
    [--mode <inline|report>] [--conclusion <text>] [--verification <text>] [--report <path>]
  dev-flow-status confirm-human <feature-id> <gate> \\
    --status <confirmed|skipped> --evidence <user-evidence>
  dev-flow-status record-validation <feature-id> --command <command>
  dev-flow-status complete-verification <feature-id> --command <command> \\
    [--report <path>] [--manual-test <path>]
  dev-flow-status accept-risk <feature-id> --id <AR-xxx> \\
    --step <manual-test-step-id> --reason <reason> --evidence <user-evidence>
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
    case 'repair':
      if (!positional[1]) fail('repair requires <feature-id>');
      cmdRepair(root, workflow, positional[1]);
      break;
    default:
      fail(`unknown command: ${command}`);
  }
}

main();
