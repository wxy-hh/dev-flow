#!/usr/bin/env node
/**
 * Atomic status / write-authorization CLI for dev-flow.
 * All status.md mutations go through this tool; after each write the
 * validator re-checks the file and the previous content is restored on failure.
 *
 * Usage:
 *   dev-flow-status authorize --level <XS|S> [--note <text>]
 *   dev-flow-status init <feature-id> --level <XS|S|M|L> --profile <profile> \
 *     --topology <topology> --evidence-result <result> [--note <text>] [--risk-labels a,b]
 *   dev-flow-status activate <feature-id>
 *   dev-flow-status add-asset <feature-id> --path <repo-path> --kind <kind>
 *   dev-flow-status complete-gate <feature-id> <gate> \
 *     [--evidence-file <repo-path> --heading <markdown-heading>]
 *   dev-flow-status confirm-human <feature-id> <gate> \
 *     --status <confirmed|skipped> --evidence <user-evidence>
 *   dev-flow-status record-validation <feature-id> --command <command>
 *   dev-flow-status accept-risk <feature-id> --id <AR-xxx> \
 *     --step <manual-test-step-id> --reason <reason> --evidence <user-evidence>
 *   dev-flow-status repair <feature-id>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../contract.json'), 'utf8'),
);
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

function runValidatorStatus(root, relativeStatusPath, finish = false) {
  const args = [validator, 'status', root, relativeStatusPath];
  if (finish) args.push('--finish');
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

function emptyRiskGates() {
  return Object.fromEntries(contract.risk_gates.map((gate) => [gate, 'none']));
}

function riskGatesForLabels(labels) {
  const gates = emptyRiskGates();
  const rank = Object.fromEntries(contract.gate_levels.map((name, index) => [name, index]));
  for (const label of labels) {
    for (const [gate, minimum] of Object.entries(contract.minimum_risk_gates[label] ?? {})) {
      if (!gates[gate] || rank[gates[gate]] < rank[minimum]) gates[gate] = minimum;
    }
  }
  return gates;
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
    completedGates: parseStringList(body, 'completed_gates') ?? [],
    currentGate: topLevelValue(body, 'current_gate'),
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

function saveModel(root, model) {
  const content = rebuildFromModel(model);
  atomicWriteText(model.absolute, content, () => runValidatorStatus(root, model.relative) === 0);
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

  const riskGates = riskGatesForLabels(labels);
  if (profile === 'standard' && level === 'M') {
    if (riskGates.plan_review === 'none') riskGates.plan_review = 'light';
  }
  if (profile === 'standard' && level === 'L') {
    if (riskGates.requirements_coverage === 'none') riskGates.requirements_coverage = 'full';
    if (riskGates.plan_review === 'none') riskGates.plan_review = 'light';
    if (riskGates.behavior_verification === 'none') riskGates.behavior_verification = 'full';
  }

  const humanGates = {
    requirement_confirmation: {
      required: profile === 'standard' && (level === 'M' || level === 'L') && !(level === 'L' && flags['lightweight-l']),
      status: 'pending',
      evidence: 'not required',
    },
    implementation_approval: {
      required: true,
      status: 'pending',
      evidence: 'not required',
    },
  };
  // Lightweight L: only implementation_approval
  if (level === 'L' && flags['lightweight-l']) {
    humanGates.requirement_confirmation.required = false;
  }
  // Standard M/L both gates; risk-minimal only impl approval
  if (profile === 'risk-minimal') {
    humanGates.requirement_confirmation.required = false;
  }
  if (profile === 'standard' && level === 'M') {
    humanGates.requirement_confirmation.required = true;
    humanGates.implementation_approval.required = true;
  }
  if (profile === 'standard' && level === 'L' && !flags['lightweight-l']) {
    humanGates.requirement_confirmation.required = true;
    humanGates.implementation_approval.required = true;
  }

  const content = renderStatus({
    featureId,
    level,
    profile,
    labels,
    topology,
    evidenceResult,
    note: flags.note || '',
    currentGate: profile === 'risk-minimal' ? 'implementation_approval' : 'req-probe',
    nextAction:
      profile === 'risk-minimal'
        ? 'await implementation_approval'
        : 'clarify requirements',
    humanGates,
    riskGates,
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
  const impl = model.humanGates.implementation_approval || {};
  const required = impl.required === true || impl.required === 'true';
  const status = impl.status;
  let state = 'approval-pending';
  let approvedAt = null;
  if (!required || status === 'confirmed' || status === 'skipped') {
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
  if (!contract.known_gates.includes(gate) && !contract.risk_gates.includes(gate)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(gate)) fail(`unknown gate: ${gate}`);
  }
  // Normalize risk-gate snake names used as skill gates when needed.
  const model = loadStatusModel(root, workflow, featureId);
  if (model.completedGates.includes(gate)) fail(`gate already completed: ${gate}`, 1);

  if (gate === 'requirements-coverage' || gate === 'requirements_coverage') {
    const coverageLevel = model.riskGates.requirements_coverage || 'none';
    if (flags['evidence-file'] || flags.heading) {
      if (!flags['evidence-file'] || !flags.heading) {
        fail('gate evidence requires both --evidence-file and --heading');
      }
      const evidencePath = flags['evidence-file'];
      if (evidencePath.includes('#')) fail('gate evidence path must not contain #');
      repositoryPath(root, evidencePath, 'evidence file');
      const abs = path.join(root, evidencePath);
      if (!fs.existsSync(abs)) fail(`evidence file does not exist: ${evidencePath}`, 1);
      if (!isInside(workflow.featureRootAbs, abs) && !isInside(workflow.reviewRootAbs, abs)) {
        fail(`evidence file is outside feature/review roots: ${evidencePath}`, 1);
      }
      const count = headingCount(abs, flags.heading);
      if (count !== 1) {
        fail(`heading ${JSON.stringify(flags.heading)} must appear exactly once (found ${count})`, 1);
      }
      model.gateEvidence = model.gateEvidence || {};
      model.gateEvidence.requirements_coverage = {
        path: evidencePath,
        heading: flags.heading,
      };
    } else if (coverageLevel === 'light') {
      const hasCoverageAsset = model.assets.some((a) => /requirements-coverage/.test(a.path));
      if (!hasCoverageAsset) {
        fail('light requirements-coverage requires --evidence-file and --heading, or a coverage asset', 1);
      }
    }
  } else if (flags['evidence-file'] || flags.heading) {
    // Generic path/heading evidence only for requirements_coverage in v0.7.
    if (!flags['evidence-file'] || !flags.heading) {
      fail('gate evidence requires both --evidence-file and --heading');
    }
    const evidencePath = flags['evidence-file'];
    repositoryPath(root, evidencePath, 'evidence file');
    const abs = path.join(root, evidencePath);
    if (!fs.existsSync(abs)) fail(`evidence file does not exist: ${evidencePath}`, 1);
    const count = headingCount(abs, flags.heading);
    if (count !== 1) {
      fail(`heading ${JSON.stringify(flags.heading)} must appear exactly once (found ${count})`, 1);
    }
  }

  model.completedGates.push(gate);
  model.currentGate = gate;
  model.nextAction = `after ${gate}`;
  saveModel(root, model);
  process.stdout.write(`completed gate ${gate}\n`);
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
  model.humanGates[gate].status = status;
  model.humanGates[gate].evidence = evidence;
  if (!model.completedGates.includes(gate)) model.completedGates.push(gate);
  model.currentGate = gate;
  model.nextAction = status === 'confirmed' ? `after ${gate}` : `skipped ${gate}`;
  saveModel(root, model);

  // Sync write-authorization when implementation_approval is satisfied.
  if (gate === 'implementation_approval') {
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
  dev-flow-status confirm-human <feature-id> <gate> \\
    --status <confirmed|skipped> --evidence <user-evidence>
  dev-flow-status record-validation <feature-id> --command <command>
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
    case 'confirm-human':
      if (!positional[1] || !positional[2]) fail('confirm-human requires <feature-id> <gate>');
      cmdConfirmHuman(root, workflow, positional[1], positional[2], flags);
      break;
    case 'record-validation':
      if (!positional[1]) fail('record-validation requires <feature-id>');
      cmdRecordValidation(root, workflow, positional[1], flags);
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
