#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SPECIAL_TAGS = new Set(['contest-start', 'pre-contest-final']);

function git(args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (!allowFailure && result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || '').trim()}`);
  return result;
}

function normalize(input) {
  if (/^\d{1,2}$/.test(input || '')) return `level-${input.padStart(2, '0')}`;
  if (/^level-\d{2}$/.test(input || '') || SPECIAL_TAGS.has(input)) return input;
  throw new Error('use level NN, level-NN, contest-start, or pre-contest-final');
}

function runGuard(argument) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'rules-guard.js'), argument], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('secrets guard failed; tag not created');
}

function verify(tag) {
  const result = git(['rev-parse', '--verify', `${tag}^{}`], true);
  if (result.status !== 0) throw new Error(`${tag} does not exist`);
  const commit = result.stdout.trim();
  console.log(`[tag] VERIFIED ${tag} -> ${commit}`);
  return commit;
}

function create(tag) {
  if (git(['status', '--porcelain']).stdout.trim()) throw new Error('working tree must be clean');
  runGuard('--staged');
  runGuard('--history');

  const level = /^level-(\d{2})$/.exec(tag);
  if (level && Number(level[1]) >= 2) {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    if (!readme.includes(tag)) {
      throw new Error(`update the README Levels section and per-level changelog with ${tag} first`);
    }
  }

  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  const existing = git(['tag', '-l', tag]).stdout.trim();
  if (existing) {
    const target = verify(tag);
    if (target !== head) throw new Error(`${tag} already points to another commit; never move tags`);
    console.log('[tag] tag already points to HEAD; nothing changed');
  } else {
    git(['tag', tag, head]);
    verify(tag);
    console.log(`[tag] CREATED ${tag}; review and push it manually when explicitly ready`);
  }
  console.log(`[tag] manual push command: git push origin ${tag}`);
}

try {
  const [command, rawTag] = process.argv.slice(2);
  if (!['create', 'verify'].includes(command) || !rawTag) {
    throw new Error('usage: node tools/create-level-tag.js create|verify <NN|level-NN|contest-start|pre-contest-final>');
  }
  const tag = normalize(rawTag);
  if (command === 'verify') verify(tag);
  else create(tag);
} catch (error) {
  console.error(`[tag] FAIL ${error.message}`);
  process.exitCode = 1;
}