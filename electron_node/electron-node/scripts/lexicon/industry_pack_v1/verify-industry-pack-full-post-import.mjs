#!/usr/bin/env node
/**
 * Post-import spot checks for industry-pack-v1-full (~2000 terms).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.join(root, 'dist/main/electron-node/main/src');

const SQLITE = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
const MANIFEST = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'manifest.json');
const STATS = path.join(
  repoRoot(),
  'electron_node/docs/lexicon-assets/industry_pack_v1/entries.industry-pack-v1-full.stats.json'
);

const SAMPLE_WORDS = [
  { word: '丹麦酥', domain: 'bakery' },
  { word: '阿萨姆红茶', domain: 'milk_tea' },
  { word: '凉拌黄瓜', domain: 'food_order' },
  { word: '平行投影', domain: 'meeting' },
  { word: '大堂', domain: 'tourism_hotel' },
  { word: '历史博物馆', domain: 'tourism_route' },
  { word: '接机牌', domain: 'tourism_pickup' },
  { word: '旅游巴士', domain: 'tourism_transport' },
  { word: '节点端', domain: 'tech_ai' },
  { word: '导诊台', domain: 'medical' },
  { word: '阿拉比卡', domain: 'coffee' },
];

function main() {
  const Database = require('better-sqlite3');
  const { pinyin } = require('pinyin-pro');
  const { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } = require(path.join(
    dist,
    'lexicon-v2/lexicon-runtime-v2-holder.js'
  ));
  const { recallSpanTopKV3 } = require(path.join(dist, 'lexicon-v2/recall-span-topkv3.js'));

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const stats = JSON.parse(fs.readFileSync(STATS, 'utf8'));
  const db = new Database(SQLITE, { readonly: true });

  const results = {
    manifest: {
      bundleVersion: manifest.bundleVersion,
      lastPatchId: manifest.lastPatchId,
      term: manifest.tables?.term,
      term_domain_tags: manifest.tables?.term_domain_tags,
    },
    packStats: stats,
    sqliteChecks: [],
    recallChecks: [],
  };

  for (const { word, domain } of SAMPLE_WORDS) {
    const termRow = db.prepare(`SELECT id, word, repair_target FROM term WHERE word = ? LIMIT 1`).get(word);
    const tags = termRow
      ? db.prepare(`SELECT domain_id FROM term_domain_tags WHERE term_id = ?`).all(termRow.id)
      : [];
    const domainRows = db
      .prepare(
        `SELECT COUNT(*) AS c FROM domain_lexicon WHERE word = ? AND domain_id = ? AND enabled = 1`
      )
      .get(word, domain);

    results.sqliteChecks.push({
      word,
      domain,
      exists: !!termRow,
      repair_target: termRow?.repair_target,
      domain_tags: tags.map((t) => t.domain_id),
      materialized: (domainRows?.c ?? 0) > 0,
    });
  }

  const state = ensureLexiconRuntimeV2Loaded();
  if (state.status !== 'ok') {
    results.recallError = state.errorMessage ?? state.status;
  } else {
    const runtimeV2 = getLexiconRuntimeV2();
    for (const { word, domain } of SAMPLE_WORDS) {
      const syllables = pinyin(word, { toneType: 'none', type: 'array' }).map((s) => String(s).toLowerCase());
      const recall = recallSpanTopKV3(runtimeV2, {
        syllables,
        windowText: word,
        termLength: [...word].length,
        topK: 8,
        domainIds: [domain],
        perSpanLimit: 8,
      });
      const hitWords = (recall.hits ?? []).map((h) => h.hotword?.word).filter(Boolean);
      results.recallChecks.push({ word, domain, hit: hitWords.includes(word), hitCount: recall.hits?.length ?? 0 });
    }
  }

  db.close();
  console.log(JSON.stringify(results, null, 2));

  const recallOk = results.recallChecks.every((r) => r.hit);
  const sqliteOk = results.sqliteChecks.every((r) => r.exists && r.materialized && r.repair_target === 1);
  if (!recallOk || !sqliteOk) process.exit(1);
}

main();
