/**
 * V4 Pre Gate (G-01): granularity + alias legality + append semantics.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { validateAliasEntry } from './alias-ownership-contract.mjs';
import { EXPANSION_DENY_LIST, MAX_EXPANSION_CJK_LEN } from './expansion-v4-constants.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lexiconScripts = path.join(__dirname, '..');
const electronNodeRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

function cjkCount(text) {
  return [...text].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
}

function stepResult(step, status, message, t0) {
  return {
    step,
    status,
    message,
    duration_ms: Math.round(performance.now() - t0),
  };
}

function scanV4Granularity(patch) {
  const hits = [];
  for (const op of patch.operations || []) {
    const word = op.word?.trim();
    if (word) {
      if (EXPANSION_DENY_LIST.includes(word)) {
        hits.push({ op: op.op, word, reason: 'denylist canonical' });
      }
      if (cjkCount(word) > MAX_EXPANSION_CJK_LEN) {
        hits.push({ op: op.op, word, reason: 'canonical length > 5' });
      }
    }
    if (op.op === 'addLegalAlias' && op.alias) {
      if (EXPANSION_DENY_LIST.includes(op.alias)) {
        hits.push({ op: op.op, word, alias: op.alias, reason: 'denylist alias' });
      }
      if (cjkCount(op.alias) > MAX_EXPANSION_CJK_LEN) {
        hits.push({ op: op.op, alias: op.alias, reason: 'alias length > 5' });
      }
    }
    for (const entry of op.alias_entries || []) {
      if (EXPANSION_DENY_LIST.includes(entry.alias)) {
        hits.push({ op: op.op, word, alias: entry.alias, reason: 'denylist alias' });
      }
      if (cjkCount(entry.alias) > MAX_EXPANSION_CJK_LEN) {
        hits.push({ op: op.op, alias: entry.alias, reason: 'alias length > 5' });
      }
    }
  }
  return hits;
}

function collectV4AliasEntries(patch) {
  const entries = [];
  for (const op of patch.operations || []) {
    const canonical = op.word?.trim();
    if (!canonical) {
      continue;
    }
    if (op.op === 'addLegalAlias' && op.alias?.trim()) {
      entries.push({ alias: op.alias.trim(), canonical, alias_type: op.alias_type });
    }
    for (const e of op.alias_entries || []) {
      if (e.alias?.trim()) {
        entries.push({ alias: e.alias.trim(), canonical, alias_type: e.alias_type });
      }
    }
  }
  return entries;
}

function scanV4AliasLegality(patch) {
  const hits = [];
  for (const entry of collectV4AliasEntries(patch)) {
    const result = validateAliasEntry(entry);
    if (!result.ok) {
      hits.push({
        patchId: patch.patchId,
        op: 'addLegalAlias',
        canonical: entry.canonical,
        alias: entry.alias,
        alias_type: entry.alias_type ?? null,
        violation: result.violation,
        reason: result.reason,
      });
    }
  }
  return hits;
}

function loadAppendSemanticsValidator() {
  const distPath = path.join(
    electronNodeRoot,
    'dist/main/electron-node/main/src/lexicon-patch-v4/append-semantics-v4.js'
  );
  if (!fs.existsSync(distPath)) {
    throw new Error('append-semantics-v4 not built — run npm run build:main');
  }
  return require(distPath).validateAppendSemanticsV4;
}

/**
 * @param {string} patchPath absolute path to patch JSON
 * @returns {{ ok: boolean, results: import('../../../main/src/lexicon-patch-v4/import-report-v4').GateStepResult[] }}
 */
export function runPatchV4PreGate(patchPath) {
  const resolved = path.resolve(patchPath);
  const patch = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const results = [];

  const tGran = performance.now();
  const granHits = scanV4Granularity(patch);
  if (granHits.length) {
    results.push(
      stepResult('scan-patch-granularity', 'fail', JSON.stringify(granHits), tGran)
    );
  } else {
    results.push(stepResult('scan-patch-granularity', 'pass', undefined, tGran));
  }

  const tAlias = performance.now();
  const aliasHits = scanV4AliasLegality(patch);
  if (aliasHits.length) {
    results.push(stepResult('scan-alias-legality', 'fail', JSON.stringify(aliasHits), tAlias));
  } else {
    results.push(stepResult('scan-alias-legality', 'pass', undefined, tAlias));
  }

  const tAppend = performance.now();
  const validateAppendSemanticsV4 = loadAppendSemanticsValidator();
  const appendErr = validateAppendSemanticsV4(patch);
  if (appendErr) {
    results.push(
      stepResult('validate-append-semantics', 'fail', `${appendErr.code}: ${appendErr.message}`, tAppend)
    );
  } else {
    results.push(stepResult('validate-append-semantics', 'pass', undefined, tAppend));
  }

  const ok = results.every((r) => r.status === 'pass');
  return { ok, results };
}

/**
 * Spawn legacy granularity script (V3-shaped patches) — kept for CLI parity.
 */
export function runLegacyGranularityScript(patchPath) {
  return spawnSync('node', [path.join(lexiconScripts, 'scan-patch-granularity.mjs'), patchPath], {
    cwd: electronNodeRoot,
    encoding: 'utf8',
  });
}
