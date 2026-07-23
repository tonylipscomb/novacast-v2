#!/usr/bin/env node
'use strict';

/**
 * Thin wrapper around `expo start` that raises Node's old-space heap ceiling
 * before launching Metro.
 *
 * Metro has been observed crashing on this project after long-running dev
 * sessions with:
 *   FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed
 *   - JavaScript heap out of memory
 * with heap usage sitting right at Node's default ~4GB old-space ceiling on
 * 64-bit builds. Raising the ceiling here is a safety net (not a fix for any
 * underlying leak) so Metro has more room before it OOMs.
 *
 * Usage: node ./scripts/start-metro.js [...expo start args]
 */

const { spawnSync } = require('child_process');

const MAX_OLD_SPACE_MB = 8192;

const existingNodeOptions = process.env.NODE_OPTIONS || '';
process.env.NODE_OPTIONS = existingNodeOptions.includes('max-old-space-size')
  ? existingNodeOptions
  : `${existingNodeOptions} --max-old-space-size=${MAX_OLD_SPACE_MB}`.trim();

const args = process.argv.slice(2);
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(npxCommand, ['expo', 'start', ...args], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
