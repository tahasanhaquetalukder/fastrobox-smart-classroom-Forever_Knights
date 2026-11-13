#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const ROOT = path.resolve(__dirname, '..');

const SECRET_RULES = [
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: 'api-token', re: /\b(?:sk-[A-Za-z0-9]{20,}|rnd_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: 'credential-url',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@'"]+:[^\s/@'"]+@[^\s/'"]+/gi,
    value: (m) => m[0],
  },
  {
    name: 'literal-secret',
    re: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|token|password|passwd|pwd|wifi[_-]?(?:ssid|password)|device[_-]?token|admin[_-]?token|database[_-]?url)\b\s*[:=]\s*(['"])([^'"\r\n]{8,})\1/gi,
    value: (m) => m[2],
  },
  {
    name: 'environment-secret',
    re: /^\s*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|TOKEN|PASSWORD|PASSWD|PWD|WIFI_SSID|WIFI_PASSWORD|DEVICE_TOKEN|ADMIN_TOKEN|DATABASE_URL)\s*=\s*([^\s#]{8,})\s*$/gim,
    value: (m) => m[1],
  },
];

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || '').trim() || 'unknown error'}`);
  }
  return result.stdout;
}

function lines(text) {
  return text.split(/\r?\n/).filter(Boolean);
}

function normalize(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function forbiddenPath(filePath) {
  const p = normalize(filePath).toLowerCase();
  const base = path.posix.basename(p);
  const parts = p.split('/');
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example') || base.endsWith('.env')) return 'environment-file';
  if (/^secrets\./.test(base)) return 'secrets-file';
  if (parts.some((part) => ['node_modules', '.pio', 'coverage', 'backups', 'snapshots', 'faces', 'face-data', 'embeddings'].includes(part))) return 'forbidden-directory';
  if (/\.(?:bin|elf|map|log|dump|backup|pgdump|sqlite3?|npy|npz|embeddings?)$/.test(base)) return 'forbidden-artifact';
  if (/(?:spool|dump)/.test(base) && /\.(?:jsonl?|sql)(?:\.gz)?$/.test(base)) return 'spool-or-dump';
  return null;
}

function isPlaceholder(value) {
  return /^(?:<[^>]+>|\$\{[^}]+\})$/.test(value)
    || /YOUR_|EXAMPLE|PLACEHOLDER|DUMMY|CHANGE[_-]?ME|TOKEN_HERE|TEST-TOKEN|USER:PASSWORD@HOST/i.test(value);
}

function scanText(text, source) {
  const findings = [];
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0;
    let match;
    while ((match = rule.re.exec(text)) !== null) {
      const value = rule.value ? rule.value(match) : match[0];
      if (!isPlaceholder(value)) findings.push({ source, rule: rule.name });
      if (match[0] === '') rule.re.lastIndex++;
    }
  }
  return findings;
}

function scanCommitMessage(text, source = 'commit-message') {
  const findings = scanText(text, source);
  if (/^\s*(?:Co-authored-by|Generated-with|AI-Assisted-by)\s*:/gim.test(text)) {
    findings.push({ source, rule: 'ai-trailer' });
  }
  return findings;
}

function textFromBuffer(buffer) {
  if (!buffer || buffer.length > MAX_TEXT_BYTES) return null;
  if (buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0)) return null;
  return buffer.toString('utf8');
}

function scanTree(staged) {
  const files = lines(git(['ls-files']));
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    const forbidden = forbiddenPath(file);
    if (forbidden) {
      findings.push({ source: file, rule: forbidden });
      continue;
    }
    let buffer;
    if (staged) {
      const result = spawnSync('git', ['show', `:${file}`], { cwd: ROOT, maxBuffer: MAX_TEXT_BYTES + 1 });
      if (result.status !== 0) throw new Error(`git show failed for ${file}`);
      buffer = result.stdout;
    } else {
      const absolute = path.resolve(ROOT, file);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      buffer = fs.readFileSync(absolute);
    }
    const text = textFromBuffer(buffer);
    if (text === null) continue;
    scanned++;
    findings.push(...scanText(text, file));
  }
  return { findings, scanned };
}

function historyObjects(range) {
  const args = range ? [range] : ['--all'];
  const objectLines = lines(git(['rev-list', '--objects', ...args]));
  const objects = objectLines.map((line) => {
    const split = line.indexOf(' ');
    return { oid: split < 0 ? line : line.slice(0, split), path: split < 0 ? '' : line.slice(split + 1) };
  });
  if (!objects.length) return [];
  const check = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: objects.map((object) => object.oid).join('\n') + '\n',
  });
  const types = new Map(lines(check).map((line) => {
    const [oid, type, size] = line.split(' ');
    return [oid, { type, size: Number(size) }];
  }));
  return objects.filter((object) => {
    const meta = types.get(object.oid);
    return object.path && meta && meta.type === 'blob' && meta.size <= MAX_TEXT_BYTES;
  });
}

function historyCommits(range) {
  const args = range ? [range] : ['--all'];
  return lines(git(['rev-list', ...args]));
}

function scanHistory(range) {
  const findings = [];
  const objects = historyObjects(range);
  let scanned = 0;
  for (const object of objects) {
    const source = `history:${object.oid.slice(0, 12)}:${object.path}`;
    const forbidden = forbiddenPath(object.path);
    if (forbidden) {
      findings.push({ source, rule: forbidden });
      continue;
    }
    const result = spawnSync('git', ['cat-file', 'blob', object.oid], { cwd: ROOT, maxBuffer: MAX_TEXT_BYTES + 1 });
    if (result.status !== 0) throw new Error(`git cat-file failed for ${object.oid.slice(0, 12)}`);
    const text = textFromBuffer(result.stdout);
    if (text === null) continue;
    scanned++;
    findings.push(...scanText(text, source));
  }

  const commits = historyCommits(range);
  for (const commit of commits) {
    const message = git(['show', '-s', '--format=%B', commit]);
    findings.push(...scanCommitMessage(message, `commit:${commit.slice(0, 12)}`));
  }
  return { findings, scanned, commits: commits.length };
}

function printFindings(findings) {
  for (const finding of findings) console.error(`[rules-guard] FAIL ${finding.rule} ${finding.source}`);
}

function main() {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--commit-message') {
      if (!args[1]) throw new Error('--commit-message requires a file path');
      const findings = scanCommitMessage(fs.readFileSync(args[1], 'utf8'));
      printFindings(findings);
      if (findings.length) process.exitCode = 1;
      else console.log('[rules-guard] PASS commit message');
      return;
    }
    if (args[0] === '--history') {
      const result = scanHistory(args[1]);
      printFindings(result.findings);
      if (result.findings.length) process.exitCode = 1;
      else console.log(`[rules-guard] PASS history: ${result.scanned} text blobs, ${result.commits} commit messages`);
      return;
    }
    const staged = args[0] === '--staged';
    const result = scanTree(staged);
    printFindings(result.findings);
    if (result.findings.length) process.exitCode = 1;
    else console.log(`[rules-guard] PASS ${staged ? 'staged tree' : 'worktree'}: ${result.scanned} text files`);
  } catch (error) {
    console.error(`[rules-guard] ERROR ${error.message}`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { forbiddenPath, scanCommitMessage, scanHistory, scanText, scanTree };