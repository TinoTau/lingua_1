#!/usr/bin/env node
/**
 * Schema V2 Only — frozen build path:
 *   validate → build:v2-shadow → prepare:v3-runtime → gate:v3-runtime
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { electronNodeRoot } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lexiconDir = path.join(__dirname, '..');

function runStep(label, cmd, cmdArgs, opts = {}) {
  console.log(`[v2-build] ${label}...`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? electronNodeRoot(),
    encoding: 'utf-8',
    env: opts.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status})`);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.input - seed path relative to electron-node or absolute
 * @param {string} [opts.registry]
 * @param {string} [opts.bundleTag] - V2_BUNDLE_TAG env
 * @param {string} [opts.validateReport] - relative to electron-node
 * @param {boolean} [opts.skipValidate]
 * @param {boolean} [opts.strictValidate=true]
 */
export function runV2RuntimeBuildPipeline(opts) {
  const input = opts.input;
  const registry = opts.registry;
  const strict = opts.strictValidate !== false;

  if (!opts.skipValidate) {
    const validateArgs = [
      path.join(lexiconDir, 'validate-lexicon-seed.mjs'),
      '--input',
      input,
    ];
    if (strict) validateArgs.push('--strict');
    if (opts.validateReport) {
      validateArgs.push('--report', opts.validateReport);
    }
    if (registry) {
      validateArgs.push('--registry', registry);
    }
    runStep('validate', process.execPath, validateArgs);
  }

  const shadowArgs = [path.join(lexiconDir, 'build-v2-shadow-for-electron.mjs'), '--input', input];
  if (registry) {
    shadowArgs.push('--registry', registry);
  }
  runStep('build:v2-shadow', process.execPath, shadowArgs, {
    env: {
      ...process.env,
      ...(opts.bundleTag ? { V2_BUNDLE_TAG: opts.bundleTag, BUNDLE_TAG: opts.bundleTag } : {}),
    },
  });

  runStep('prepare:v3-runtime', process.execPath, [
    path.join(lexiconDir, 'prepare-lexicon-v3-runtime-from-shadow.mjs'),
    '--force',
  ]);

  runStep('gate:v3-runtime', process.execPath, [
    path.join(lexiconDir, 'run-gate-v3-runtime-for-electron.mjs'),
  ]);
}
