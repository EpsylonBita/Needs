#!/usr/bin/env node
// These regressions use an offline SDK transport and mock persistence, never the network.
const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

const result = spawnSync(process.execPath, [
  join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
  'run', 'tests/api/payments/sdk-client.test.ts',
  'tests/api/payments/webhook/sdk-compatibility.test.ts', '--pool=forks', '--maxWorkers=1',
], { cwd: join(__dirname, '..'), stdio: 'inherit', windowsHide: true });
if (result.error) console.error('Could not start offline webhook verification. Install project dependencies first.');
process.exitCode = result.status ?? 1;
