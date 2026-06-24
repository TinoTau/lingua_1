#!/usr/bin/env node
/**
 * Remove homophone variant standalone rows from runtime domain_lexicon (+ routing/ngrams).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { v3RuntimeDir } from './lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { HOMOPHONE_VARIANT_WORDS } = require('./expansion-v1_1/terms-manifest.cjs');

const bundleDir = v3RuntimeDir();
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const cleanupPatchPath = path.join(__dirname, 'expansion-v1_1/patches/exp-v1_1-alias-cleanup.patch.json');

function main() {
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath);
  const words = [...HOMOPHONE_VARIANT_WORDS];
  const placeholders = words.map(() => '?').join(',');

  const beforeDomain = db
    .prepare(`SELECT COUNT(*) AS c FROM domain_lexicon WHERE word IN (${placeholders})`)
    .get(...words).c;
  const beforeAlias = db
    .prepare(`SELECT COUNT(*) AS c FROM domain_lexicon WHERE is_alias = 1 AND word IN (${placeholders})`)
    .get(...words).c;

  const run = db.transaction(() => {
    const domainRows = db
      .prepare(`SELECT word, pinyin_key, domain_id FROM domain_lexicon WHERE word IN (${placeholders})`)
      .all(...words);
    db.prepare(`DELETE FROM term_pinyin_ngrams WHERE fragment_text IN (${placeholders})`).run(...words);
    db.prepare(`DELETE FROM term_pinyin_ngrams WHERE parent_word IN (${placeholders})`).run(...words);
    const delRoute = db.prepare(
      `DELETE FROM industry_routing_lexicon WHERE keyword = ? AND pinyin_key = ? AND domain_id = ?`
    );
    for (const row of domainRows) {
      delRoute.run(row.word, row.pinyin_key, row.domain_id);
    }
    db.prepare(`DELETE FROM domain_lexicon WHERE word IN (${placeholders})`).run(...words);
  });
  run();

  const patch = JSON.parse(fs.readFileSync(cleanupPatchPath, 'utf8'));
  const { lexiconV2BundleFileNames } = require('../../dist/main/electron-node/main/src/lexicon-v2/lexicon-v2-bundle-path.js');
  const { writeBundleManifestsAfterPatch } = require('../../dist/main/electron-node/main/src/lexicon-patch-v3/manifest-writer.js');
  const files = lexiconV2BundleFileNames(bundleDir);
  writeBundleManifestsAfterPatch(db, files, patch);

  const after = db
    .prepare(`SELECT COUNT(*) AS c FROM domain_lexicon WHERE word IN (${placeholders})`)
    .get(...words).c;
  db.close();

  console.log(
    JSON.stringify(
      {
        homophoneWords: words.length,
        removedDomainRows: beforeDomain,
        removedAliasRows: beforeAlias,
        remaining: after,
      },
      null,
      2
    )
  );
  if (after !== 0) {
    process.exit(1);
  }
}

main();
