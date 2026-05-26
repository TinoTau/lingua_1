#!/usr/bin/env node
/**
 * Lexicon V3 runtime freeze gate — canonical-only, no confusion in bundle/manifest.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const bundleDir = path.join(repoRoot, 'node_runtime/lexicon/current');
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const manifestPath = path.join(bundleDir, 'manifest.json');
const srcRoot = path.resolve(__dirname, '../../main/src/lexicon');

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error('[v3-gate] FAIL:', msg);
}

function walkTsFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkTsFiles(full, out);
    } else if (ent.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

if (!fs.existsSync(sqlitePath)) {
  fail(`missing bundle sqlite: ${sqlitePath} (run npm run lexicon:build)`);
} else {
  const sqliteText = fs.readFileSync(sqlitePath);
  if (sqliteText.includes('lexicon_confusions')) {
    console.warn(
      '[v3-gate] WARN: bundle sqlite still contains lexicon_confusions schema (legacy artifact). ' +
        'Runtime does not load it; run npm run lexicon:build when refreshing seed to drop the table.'
    );
  }
}

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (manifest.confusion_count != null) {
    fail('manifest.confusion_count must be absent');
  }
  if (manifest.schemaVersion !== 'final-v1') {
    fail(`manifest.schemaVersion must be final-v1, got ${manifest.schemaVersion}`);
  }
}

const forbidden = ['confusionRecallEnabled', 'getConfusionObservedStrings', 'recallHotwordsByObserved'];
for (const full of walkTsFiles(srcRoot)) {
  const rel = path.relative(srcRoot, full);
  const text = fs.readFileSync(full, 'utf-8');
  for (const token of forbidden) {
    if (text.includes(token)) {
      fail(`forbidden token "${token}" in ${rel}`);
    }
  }
}

if (failures.length) {
  process.exit(1);
}
console.log('[v3-gate] PASS — canonical-only runtime freeze checks OK');
