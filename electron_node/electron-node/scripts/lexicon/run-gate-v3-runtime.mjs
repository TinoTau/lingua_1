#!/usr/bin/env node
/**
 * FW V3 runtime gate — single manifest bundle under node_runtime/lexicon/v3.
 */
import fs from 'fs';
import path from 'path';
import {
  RUNTIME_MANIFEST,
  RUNTIME_SQLITE,
  RUNTIME_STATS,
  V3_SCHEMA_VERSION_V2,
  assertTableThresholds,
  normalizeChecksum,
  sha256File,
  v3BundleFiles,
  v3RuntimeDir,
} from './lib/lexicon-v3-runtime.mjs';
import {
  domainAvailabilityEqual,
  readDomainAvailabilityFromSqlitePath,
} from './lib/manifest-domain-stats.cjs';

const bundleDir = process.env.LEXICON_V3_BUNDLE_DIR?.trim() || v3RuntimeDir();
const files = v3BundleFiles(bundleDir);
const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error('[lexicon:gate:v3-runtime] FAIL:', msg);
}

const forbidden = [
  'manifest_v2.json',
  'manifest_v3.json',
  'stats_v2.json',
  'stats_v3.json',
  'lexicon_v2.sqlite',
  'lexicon_v3.sqlite',
];

for (const name of forbidden) {
  if (fs.existsSync(path.join(bundleDir, name))) {
    fail(`deprecated file present: ${name} (run npm run lexicon:migrate:v3-runtime)`);
  }
}

if (!fs.existsSync(files.manifestPath)) {
  fail(`missing ${RUNTIME_MANIFEST} (run npm run lexicon:prepare:v3-runtime)`);
}
if (!fs.existsSync(files.sqlitePath)) {
  fail(`missing ${RUNTIME_SQLITE}`);
}
if (!fs.existsSync(files.statsPath)) {
  fail(`missing ${RUNTIME_STATS}`);
}

if (failures.length === 0) {
  const manifest = JSON.parse(fs.readFileSync(files.manifestPath, 'utf-8'));
  if (manifest.schemaVersion !== V3_SCHEMA_VERSION_V2) {
    fail(
      `schemaVersion must be ${V3_SCHEMA_VERSION_V2}, got ${manifest.schemaVersion ?? 'unknown'}`
    );
  }
  if (!manifest.checksum) {
    fail('manifest.checksum missing');
  }
  if (!manifest.tables) {
    fail('manifest.tables missing');
  } else {
    assertTableThresholds(manifest.tables, fail, manifest.schemaVersion);
  }

  const expected = normalizeChecksum(manifest.checksum);
  const actual = sha256File(files.sqlitePath);
  if (expected !== actual) {
    fail(`sqlite checksum mismatch: manifest=${expected} actual=${actual}`);
  }

  const stats = JSON.parse(fs.readFileSync(files.statsPath, 'utf-8'));
  const t = manifest.tables;
  if (stats.baseCount !== t.base) {
    fail(`stats.baseCount ${stats.baseCount} != manifest.tables.base ${t.base}`);
  }
  if (stats.ngramsCount != null && stats.ngramsCount !== t.ngrams) {
    fail(`stats.ngramsCount ${stats.ngramsCount} != manifest.tables.ngrams ${t.ngrams}`);
  }

  if (!stats.domainAvailability || typeof stats.domainAvailability !== 'object') {
    fail('stats.domainAvailability missing (BG-02)');
  }
  if (!manifest.domainAvailability || typeof manifest.domainAvailability !== 'object') {
    fail('manifest.domainAvailability missing (BG-03)');
  }

  const sqliteAvailability = readDomainAvailabilityFromSqlitePath(files.sqlitePath);
  if (!domainAvailabilityEqual(manifest.domainAvailability, sqliteAvailability)) {
    fail('manifest.domainAvailability != sqlite term_domain_tags (BG-03)');
  }
  if (!domainAvailabilityEqual(stats.domainAvailability, sqliteAvailability)) {
    fail('stats.domainAvailability != sqlite term_domain_tags (BG-03)');
  }
}

if (failures.length) {
  process.exit(1);
}
console.log('[lexicon:gate:v3-runtime] PASS — FW v3 runtime bundle OK');
console.log(`  path: ${bundleDir}`);
