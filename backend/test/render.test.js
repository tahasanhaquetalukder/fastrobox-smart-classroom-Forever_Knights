'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const backendDir = path.join(__dirname, '..');
const repoRoot = path.join(backendDir, '..');

test('server module loads without a live database (Render boot path)', () => {
  // Render runs `npm start` -> `node src/server.js`. Requiring the app must not
  // open a DB connection or throw when env vars are absent, otherwise the
  // service would crash-loop before /health can report the real DB state.
  const out = execFileSync(
    process.execPath,
    ['-e', "const app=require('./src/server');if(typeof app!=='function')throw new Error('not an express app');console.log('ok')"],
    { cwd: backendDir, env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '' }, encoding: 'utf8', timeout: 20000 }
  );
  assert.match(out, /ok/);
});

test('dashboard static assets exist for the Render deployment', () => {
  for (const file of ['index.html', 'app.js', 'styles.css']) {
    const full = path.join(backendDir, 'public', file);
    assert.ok(fs.existsSync(full), `missing public/${file}`);
    assert.ok(fs.statSync(full).size > 0, `empty public/${file}`);
  }
});

test('render.yaml keeps the backend rootDir, migration start and health check', () => {
  const raw = fs.readFileSync(path.join(repoRoot, 'render.yaml'), 'utf8');
  assert.match(raw, /rootDir:\s*backend/);
  assert.match(raw, /npm run migrate && npm start/);
  assert.match(raw, /healthCheckPath:\s*\/health/);
  assert.doesNotMatch(raw, /DEVICE_TOKEN:\s*\S+/i, 'secrets must be generated, not committed');
});
