#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const result = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, encoding: 'utf8' });
if (result.status !== 0) {
  console.error('[hooks] FAIL not a Git repository');
  process.exit(1);
}

const hooksDir = path.resolve(ROOT, result.stdout.trim(), 'hooks');
let failed = false;
for (const name of ['pre-commit', 'commit-msg']) {
  const source = path.join(ROOT, 'tools', 'git-hooks', name);
  const destination = path.join(hooksDir, name);
  if (fs.existsSync(destination)) {
    if (fs.readFileSync(destination, 'utf8') === fs.readFileSync(source, 'utf8')) {
      console.log(`[hooks] ${name} already installed`);
    } else {
      console.error(`[hooks] FAIL ${name} already exists with different content; not overwritten`);
      failed = true;
    }
    continue;
  }
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o755);
  console.log(`[hooks] installed ${name}`);
}

if (failed) process.exitCode = 1;
else console.log('[hooks] ready; Git configuration was not changed');