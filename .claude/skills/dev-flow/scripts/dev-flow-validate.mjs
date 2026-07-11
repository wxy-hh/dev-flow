#!/usr/bin/env node
/**
 * Small, dependency-free validation helper for dev-flow shell commands.
 * It deliberately validates only unambiguous machine data: identifiers,
 * repository-relative paths and context JSONL manifests.
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
  default:
    fail(`unknown command: ${command ?? ''}`);
}
