#!/usr/bin/env node
/** V2 post-import recall spot — 12 domains. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const genReport = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot(), 'electron_node/docs/lexicon-assets/industry_pack_v2/entries.industry-pack-v2-full.generation-report.json'),
    'utf8'
  )
);

const SPOTS = [
  { word: '丹麦酥', domain: 'bakery' },
  { word: '阿拉比卡', domain: 'coffee' },
  { word: '凉拌黄瓜', domain: 'food_order' },
  { word: '导诊台', domain: 'medical' },
  { word: '股票', domain: 'meeting' },
  { word: '阿萨姆红茶', domain: 'milk_tea' },
  { word: '向量数据库', domain: 'tech_ai' },
  { word: '大堂', domain: 'tourism_hotel' },
  { word: '接机牌', domain: 'tourism_pickup' },
  { word: '历史博物馆', domain: 'tourism_route' },
  { word: '旅游巴士', domain: 'tourism_transport' },
  { word: '旅游巴士', domain: 'transport' },
];

async function main() {
  const { pinyin } = require('pinyin-pro');
  const { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } = require(path.join(
    dist,
    'lexicon-v2/lexicon-runtime-v2-holder.js'
  ));
  const { recallSpanTopKV3 } = require(path.join(dist, 'lexicon-v2/recall-span-topkv3.js'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(repoRoot(), 'node_runtime/lexicon/v3/lexicon.sqlite'), {
    readonly: true,
  });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot(), 'node_runtime/lexicon/v3/manifest.json'), 'utf8')
  );

  const state = ensureLexiconRuntimeV2Loaded();
  if (state.status !== 'ok') {
    console.error(JSON.stringify({ status: 'fail', error: state.errorMessage }));
    process.exit(1);
  }
  const runtimeV2 = getLexiconRuntimeV2();

  const sqliteChecks = [];
  const recallChecks = [];
  for (const s of SPOTS) {
    const termRow = db.prepare(`SELECT id, repair_target FROM term WHERE word = ? LIMIT 1`).get(s.word);
    const tags = termRow
      ? db.prepare(`SELECT domain_id FROM term_domain_tags WHERE term_id = ?`).all(termRow.id)
      : [];
    const mat = db
      .prepare(
        `SELECT COUNT(*) AS c FROM domain_lexicon WHERE word = ? AND domain_id = ? AND enabled = 1`
      )
      .get(s.word, s.domain);
    sqliteChecks.push({
      word: s.word,
      domain: s.domain,
      exists: !!termRow,
      repair_target: termRow?.repair_target,
      domain_tags: tags.map((t) => t.domain_id),
      materialized: (mat?.c ?? 0) > 0,
    });

    const syllables = pinyin(s.word, { toneType: 'none', type: 'array' }).map((x) =>
      String(x).toLowerCase()
    );
    const recall = recallSpanTopKV3(runtimeV2, {
      syllables,
      windowText: s.word,
      termLength: [...s.word].length,
      topK: 8,
      domainIds: [s.domain],
      perSpanLimit: 8,
    });
    const words = (recall.hits ?? []).map((h) => h.hotword?.word).filter(Boolean);
    recallChecks.push({
      word: s.word,
      domain: s.domain,
      hit: words.includes(s.word),
      hitCount: words.filter((w) => w === s.word).length,
    });
  }
  db.close();

  const allHit = recallChecks.every((r) => r.hit);
  console.log(
    JSON.stringify(
      {
        status: allHit ? 'ok' : 'fail',
        manifest: {
          bundleVersion: manifest.bundleVersion,
          lastPatchId: manifest.lastPatchId,
          term: manifest.tables?.term,
        },
        generation: {
          candidateRecords: genReport.candidateRecords,
          skippedExisting: genReport.skippedExisting,
          duplicateInBatch: genReport.duplicateInBatch,
          filteredTerms: genReport.filteredTerms,
          newTerms: genReport.newTerms,
          appendedDomains: genReport.appendedDomains,
        },
        sqliteChecks,
        recallChecks,
      },
      null,
      2
    )
  );
  process.exit(allHit ? 0 : 1);
}

main();
