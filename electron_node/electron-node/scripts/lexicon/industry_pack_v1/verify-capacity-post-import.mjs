#!/usr/bin/env node
/**
 * Post-import capacity validation — sqlite + runtime recall spot checks (Electron ABI).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = path.join(root, 'dist/main/electron-node/main/src');

const SQLITE = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
const MANIFEST = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'manifest.json');

const SAMPLE_WORDS = [
  { word: '智能体', domain: 'tech_ai' },
  { word: '网约车', domain: 'tourism_transport' },
  { word: '挂号', domain: 'medical' },
  { word: '议程', domain: 'meeting' },
  { word: '澳白', domain: 'coffee' },
];

function charLen(s) {
  return [...s.trim()].length;
}

function main() {
  const Database = require('better-sqlite3');
  const { pinyin } = require('pinyin-pro');
  const { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } = require(path.join(
    dist,
    'lexicon-v2/lexicon-runtime-v2-holder.js'
  ));
  const { recallSpanTopKV3 } = require(path.join(dist, 'lexicon-v2/recall-span-topkv3.js'));

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const db = new Database(SQLITE, { readonly: true });

  const results = {
    manifest: {
      bundleVersion: manifest.bundleVersion,
      lastPatchId: manifest.lastPatchId,
      term: manifest.tables?.term,
      term_domain_tags: manifest.tables?.term_domain_tags,
      domain: manifest.tables?.domain,
    },
    sqliteChecks: [],
    recallChecks: [],
    appendChecks: [],
    counterfactual: [],
  };

  for (const { word, domain } of SAMPLE_WORDS) {
    const termRow = db
      .prepare(
        `SELECT t.id, t.word, t.repair_target, t.enabled FROM term t WHERE t.word = ? LIMIT 5`
      )
      .all(word);
    const tags = termRow.length
      ? db
          .prepare(`SELECT domain_id, weight FROM term_domain_tags WHERE term_id = ?`)
          .all(termRow[0].id)
      : [];
    const domainRows = db
      .prepare(
        `SELECT word, domain_id, repair_target FROM domain_lexicon
         WHERE word = ? AND domain_id = ? AND enabled = 1 LIMIT 3`
      )
      .all(word, domain);

    results.sqliteChecks.push({
      word,
      domain,
      termCount: termRow.length,
      repair_target: termRow[0]?.repair_target,
      enabled: termRow[0]?.enabled,
      domain_tags: tags.map((t) => t.domain_id),
      domain_lexicon_rows: domainRows.length,
      materialized: domainRows.length > 0,
    });
  }

  const runtimeState = ensureLexiconRuntimeV2Loaded();
  if (runtimeState.status !== 'ok') {
    results.recallError = runtimeState.errorMessage ?? runtimeState.status;
  } else {
    const runtimeV2 = getLexiconRuntimeV2();
    for (const { word, domain } of SAMPLE_WORDS) {
      const syllables = pinyin(word, { toneType: 'none', type: 'array' }).map((s) =>
        String(s).toLowerCase()
      );
      const recall = recallSpanTopKV3(runtimeV2, {
        syllables,
        windowText: word,
        termLength: [...word].length,
        topK: 8,
        domainIds: [domain],
        perSpanLimit: 8,
      });
      const hitWords = (recall.hits ?? []).map((h) => h.hotword?.word).filter(Boolean);
      results.recallChecks.push({
        word,
        domain,
        hit: hitWords.includes(word),
        hitWords: hitWords.slice(0, 5),
        hitCount: recall.hits?.length ?? 0,
      });
    }
  }

  const airportTags = db
    .prepare(
      `SELECT tdt.domain_id FROM term t
       JOIN term_domain_tags tdt ON tdt.term_id = t.id
       WHERE t.word = '机场'`
    )
    .all();
  results.appendChecks.push({
    word: '机场',
    domains: airportTags.map((r) => r.domain_id),
    has_tech_ai: airportTags.some((r) => r.domain_id === 'tech_ai'),
  });

  const cfTerm = db
    .prepare(`SELECT id FROM term WHERE word = '智能体' LIMIT 1`)
    .get();
  if (cfTerm) {
    const rtFalse = db
      .prepare(`SELECT repair_target FROM term WHERE id = ?`)
      .get(cfTerm.id);
    results.counterfactual.push({
      id: 'CF-01',
      word: '智能体',
      repair_target_in_db: rtFalse?.repair_target,
      note: 'repair_target must be 1 for Apply chain',
    });
  }

  db.close();
  console.log(JSON.stringify(results, null, 2));

  const recallOk = results.recallChecks.every((r) => r.hit);
  const sqliteOk = results.sqliteChecks.every((r) => r.materialized && r.repair_target === 1);
  const appendOk = results.appendChecks.every((r) => r.has_tech_ai);

  if (!recallOk || !sqliteOk || !appendOk) {
    process.exit(1);
  }
}

main();
