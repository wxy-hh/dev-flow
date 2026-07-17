#!/usr/bin/env node
/** Layer 0 quote-aware classifier for one shell command. No execution or writes. */
import path from 'node:path';

const KINDS = Object.freeze({
  'dev-flow-status': 'status',
  'dev-flow-status.mjs': 'status',
  'dev-flow-validate': 'validate',
  'dev-flow-validate.mjs': 'validate',
  'dev-flow-policy': 'policy',
  'dev-flow-policy.mjs': 'policy',
  'dev-flow-doctor': 'doctor',
  'dev-flow-feature-check': 'feature-check',
  'dev-flow-feature-finalize': 'feature-finalize',
  'dev-flow-fingerprint': 'fingerprint',
  'dev-flow-manifest': 'manifest',
  'dev-flow-command': 'classifier',
  'dev-flow-command.mjs': 'classifier',
});

export function tokenizeShell(command) {
  const tokens = [];
  let token = '';
  let state = 'normal';
  let escaped = false;
  let control = '';
  const push = () => {
    if (token !== '') tokens.push(token);
    token = '';
  };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    const next = command[i + 1];
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (state === 'single') {
      if (char === "'") state = 'normal';
      else token += char;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (state === 'double') {
      if (char === '"') state = 'normal';
      else if (char === '`' || (char === '$' && next === '(')) control ||= 'command substitution';
      else token += char;
      continue;
    }
    if (char === "'") {
      state = 'single';
      continue;
    }
    if (char === '"') {
      state = 'double';
      continue;
    }
    if (char === '\n' || char === '\r') {
      control ||= 'newline';
      push();
      continue;
    }
    if ('|;&<>'.includes(char)) {
      control ||= `unquoted ${char}`;
      push();
      tokens.push(char);
      continue;
    }
    if (char === '`' || (char === '$' && next === '(')) {
      control ||= 'command substitution';
      token += char;
      continue;
    }
    if (/\s/.test(char)) push();
    else token += char;
  }
  if (escaped || state !== 'normal') control ||= 'unterminated quote or escape';
  push();
  return { tokens, has_shell_control: Boolean(control), control_reason: control };
}

function isSecretFileToken(token) {
  const base = path.posix.basename(String(token || '').replace(/\\/g, '/'));
  if (base === '.env.example') return false;
  return (
    base === '.env' ||
    base.startsWith('.env.') ||
    /\.(?:pem|key)$/i.test(base) ||
    /^(?:secrets|credentials)\./i.test(base)
  );
}

function writesSecretFile(tokens, depth = 0) {
  const outerCommand = path.posix.basename(tokens[0] || '');
  if (depth < 2 && ['bash', 'sh'].includes(outerCommand)) {
    const commandFlag = tokens.findIndex((token, index) => index > 0 && token === '-c');
    if (commandFlag >= 0 && tokens[commandFlag + 1]) {
      const inner = tokenizeShell(tokens[commandFlag + 1]);
      if (writesSecretFile(inner.tokens, depth + 1)) return true;
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === '>' && isSecretFileToken(tokens[index + 1])) return true;
  }
  const commandIndex = ['node', 'bash', 'sh'].includes(tokens[0]) ? 1 : 0;
  const command = path.posix.basename(tokens[commandIndex] || '');
  const args = tokens.slice(commandIndex + 1).filter((token) => !'|;&<>'.includes(token));
  if (['touch', 'truncate', 'tee'].includes(command)) {
    return args.some((token) => !token.startsWith('-') && isSecretFileToken(token));
  }
  if (['cp', 'mv', 'install'].includes(command)) return isSecretFileToken(args.at(-1));
  if (command === 'sed' && args.some((token) => token === '-i' || token.startsWith('-i'))) {
    return isSecretFileToken(args.at(-1));
  }
  return false;
}

function knownScript(token, root) {
  const normalized = token.replace(/\\/g, '/');
  const base = path.posix.basename(normalized);
  if (!Object.hasOwn(KINDS, base)) return null;
  if (!normalized.includes('/')) return { kind: KINDS[base], script: base };
  const expected = `.claude/skills/dev-flow/scripts/${base}`;
  const relative = normalized.replace(/^\.\//, '');
  if (relative === expected || (root && relative === `${root.replace(/\/$/, '')}/${expected}`)) {
    return { kind: KINDS[base], script: base };
  }
  return null;
}

export function classifyCommand(command, { root = '' } = {}) {
  const parsed = tokenizeShell(String(command ?? ''));
  const result = {
    is_control: false,
    has_shell_control: parsed.has_shell_control,
    writes_secret_file: writesSecretFile(parsed.tokens),
    command_kind: 'other',
    reason: parsed.control_reason || 'not a managed control command',
  };
  if (parsed.has_shell_control || parsed.tokens.length === 0) return result;
  let script = knownScript(parsed.tokens[0], root);
  if (!script && ['node', 'bash', 'sh'].includes(parsed.tokens[0]) && parsed.tokens[1]) {
    script = knownScript(parsed.tokens[1], root);
  }
  if (script) {
    return {
      is_control: true,
      has_shell_control: false,
      writes_secret_file: result.writes_secret_file,
      command_kind: script.kind,
      reason: `exact managed ${script.kind} command`,
    };
  }
  if (parsed.tokens[0] === 'git' && ['add', 'commit', 'push', 'merge'].includes(parsed.tokens[1])) {
    result.command_kind = 'git-closeout';
    result.reason = 'single Git close-out command';
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dev-flow-command.mjs')) {
  const command = process.argv.slice(2).join(' ');
  const root = process.env.DEV_FLOW_REPO_ROOT || '';
  process.stdout.write(`${JSON.stringify(classifyCommand(command, { root }))}\n`);
}
