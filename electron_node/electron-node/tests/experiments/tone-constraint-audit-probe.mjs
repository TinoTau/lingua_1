#!/usr/bin/env node
/** READONLY — Tone Constraint Audit probe */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

try {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: {
        getPath: (n) =>
          n === 'userData'
            ? path.join(PROJECT_ROOT, 'electron_node/electron-node/tmp-experiment')
            : PROJECT_ROOT,
      },
    },
  };
} catch (_) {}

const Database = require('better-sqlite3');
const { pinyin } = require('pinyin-pro');

const { textToSyllables } = require('../../dist/main/electron-node/main/src/lexicon/phonetic/pinyin.js');
const { textToToneSyllables, toneSyllablesKey, toneDistance } = require('../../dist/main/electron-node/main/src/lexicon/phonetic/tone-pinyin.js');
const { syllablesKey } = require('../../dist/main/electron-node/main/src/lexicon/pinyin-index.js');
const { scorePinyinSimilarity } = require('../../dist/main/electron-node/main/src/lexicon/phonetic/pinyin.js');
const { recallSpanTopK } = require('../../dist/main/electron-node/main/src/lexicon/local-span-recall.js');
const { recallSpanTopKV2 } = require('../../dist/main/electron-node/main/src/lexicon-v2/recall-span-topk-v2.js');
const { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } = require('../../dist/main/electron-node/main/src/lexicon-v2/lexicon-runtime-v2-holder.js');
const { defaultGeneralProfile } = require('../../dist/main/electron-node/main/src/lexicon-v2/profile-registry.js');
const { computeCandidateScoreBreakdown } = require('../../dist/main/electron-node/main/src/lexicon/candidate-score.js');
const { getAsrRepairQualityConfig } = require('../../dist/main/electron-node/main/src/asr-repair-quality/quality-config.js');

const SQLITE = path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3/lexicon.sqlite');
const MANIFEST = path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3/manifest.json');
const OUT = path.join(__dirname, 'tone-constraint-audit-probe.json');

const WORDS = ['少病', '少冰', '烧饼', '哨兵', '评审', '平身', '进度', '筋斗', '文档', '稳当', '上线', '上限'];
const SPANS = ['少病', '赶时', '进都', '评审', '检查', '叫吗', '解一'];
const PAIRS = [
  ['少病', '少冰'],
  ['少病', '烧饼'],
  ['少病', '哨兵'],
  ['进都', '进度'],
  ['进都', '筋斗'],
  ['评审', '平身'],
  ['文档', '稳当'],
  ['上线', '上限'],
];
const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];
const MIN_PRIOR = 0.5;

function schemaAudit(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  const out = { tables: {}, indexes: {} };
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all();
    out.tables[t] = cols.map((c) => ({
      name: c.name,
      type: c.type,
      pk: c.pk,
    }));
    out.indexes[t] = db
      .prepare(`PRAGMA index_list(${t})`)
      .all()
      .map((idx) => {
        const info = db.prepare(`PRAGMA index_info(${idx.name})`).all();
        return { name: idx.name, unique: idx.unique === 1, columns: info.map((i) => i.name) };
      });
  }
  return out;
}

function wordLookup(db, word) {
  const rows = [];
  for (const table of ['base_lexicon', 'domain_lexicon', 'idiom_lexicon']) {
    const r = db.prepare(
      `SELECT * FROM ${table} WHERE word = ? OR normalized = ?`
    ).all(word, word);
    for (const row of r) {
      rows.push({ table, ...row });
    }
  }
  return rows;
}

function bucketLookup(db, key, len) {
  const rows = [];
  for (const table of ['base_lexicon', 'domain_lexicon']) {
    const q =
      table === 'domain_lexicon'
        ? `SELECT * FROM domain_lexicon WHERE pinyin_key = ? AND length(word) = ? ORDER BY prior_score DESC LIMIT 30`
        : `SELECT * FROM base_lexicon WHERE pinyin_key = ? AND length(word) = ? ORDER BY prior_score DESC LIMIT 30`;
    for (const row of db.prepare(q).all(key, len)) {
      rows.push({ table, ...row });
    }
  }
  return rows;
}

function scorePair(spanText, candidateWord, hotword, profile) {
  const syllables = textToSyllables(spanText);
  const asrToneKey = toneSyllablesKey(textToToneSyllables(spanText));
  const candToneKey = hotword?.tonePinyinKey || hotword?.tone_pinyin_key || '';
  const phonetic = scorePinyinSimilarity(syllables, hotword?.pinyin || textToSyllables(candidateWord));
  const breakdown = hotword
    ? computeCandidateScoreBreakdown({
        hotword,
        windowSyllables: syllables,
        windowText: spanText,
        phoneticScore: phonetic,
        profile,
      })
    : null;
  const candidateScore = breakdown
    ? breakdown.priorScore +
      breakdown.phoneticSimilarity +
      breakdown.exactLengthBonus +
      breakdown.domainBoost -
      breakdown.editDistancePenalty
    : null;
  return {
    spanPlainKey: syllablesKey(syllables),
    spanToneKey: asrToneKey,
    spanPlain: syllables.join(' '),
    spanTone: textToToneSyllables(spanText).join(' '),
    candidatePlainKey: syllablesKey(textToSyllables(candidateWord)),
    candidateToneKey: candToneKey || toneSyllablesKey(textToToneSyllables(candidateWord)),
    plainMatch: syllablesKey(syllables) === syllablesKey(textToSyllables(candidateWord)),
    toneDistance: candToneKey ? toneDistance(asrToneKey, candToneKey) : toneDistance(asrToneKey, toneSyllablesKey(textToToneSyllables(candidateWord))),
    phoneticScore: phonetic,
    priorScore: hotword?.priorScore ?? hotword?.prior_score ?? null,
    candidateScore,
    passesMinPrior: (hotword?.priorScore ?? hotword?.prior_score ?? 0) >= MIN_PRIOR,
    minCandidateScore: getAsrRepairQualityConfig().minCandidateScore,
    passesMinCandidateScore: candidateScore == null ? null : candidateScore >= getAsrRepairQualityConfig().minCandidateScore,
    breakdown,
  };
}

function spanPinyinAudit(text) {
  const plain = textToSyllables(text);
  const tone = textToToneSyllables(text);
  const pinyinProNone = pinyin(text, { toneType: 'none', type: 'array' });
  const pinyinProNum = pinyin(text, { toneType: 'num', type: 'array' });
  return {
    text,
    plainSyllables: plain,
    toneSyllables: tone,
    plainKey: syllablesKey(plain),
    toneKey: toneSyllablesKey(tone),
    plainJoined: plain.join(' '),
    toneJoined: tone.join(' '),
    pinyinProNone,
    pinyinProNum,
  };
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const db = new Database(SQLITE, { readonly: true });
  const schema = schemaAudit(db);

  const wordRows = {};
  for (const w of WORDS) {
    wordRows[w] = wordLookup(db, w).map((r) => ({
      word: r.word,
      table: r.table,
      domain: r.domain_id || null,
      pinyin_plain: r.pinyin_key,
      pinyin_tone: r.tone_pinyin_key || null,
      tone_key: r.tone_pinyin_key || null,
      priorScore: r.prior_score,
      repairTarget: r.repair_target === 1,
      source: r.source,
      enabled: r.enabled === 1,
      is_alias: r.is_alias === 1,
    }));
  }

  const shaobingKey = syllablesKey(textToSyllables('少病'));
  const bucketShaobing = bucketLookup(db, shaobingKey, 2).map((r) => ({
    word: r.word,
    table: r.table,
    domain: r.domain_id || null,
    pinyin_key: r.pinyin_key,
    tone_pinyin_key: r.tone_pinyin_key,
    prior_score: r.prior_score,
    repair_target: r.repair_target,
  }));

  ensureLexiconRuntimeV2Loaded();
  const runtime = getLexiconRuntimeV2();
  const profile = defaultGeneralProfile();
  const spanAudits = {};
  for (const s of SPANS) {
    const syllables = textToSyllables(s);
    const key = syllablesKey(syllables);
    const recall = recallSpanTopK(s, profile, 8, MIN_PRIOR, DOMAINS, { perSpanLimit: 8 });
    const v2 = recallSpanTopKV2(runtime, {
      syllables,
      windowText: s,
      termLength: s.length,
      topK: 8,
      profile,
      domainIds: DOMAINS,
      perSpanLimit: 8,
    });
    spanAudits[s] = {
      pinyin: spanPinyinAudit(s),
      recallLocalSpanTopK: recall.hits.map((h) => ({
        word: h.word,
        source: h.source,
        priorScore: h.priorScore,
        candidateScore: h.candidateScore,
        tonePinyinKey: h.tonePinyinKey,
        repairTarget: h.repairTarget,
        domains: h.domains,
      })),
      recallV2Raw: v2.hits.map((h) => ({
        word: h.hotword.word,
        priorScore: h.hotword.priorScore,
        candidateScore: h.candidateScore,
        tonePinyinKey: h.hotword.tonePinyinKey,
        pinyin: h.hotword.pinyin,
        repairTarget: h.hotword.repairTarget,
        source: h.source,
      })),
      sqlBucketCount: bucketLookup(db, key, s.length).length,
      sqlBucketTop10: bucketLookup(db, key, s.length).slice(0, 10).map((r) => r.word),
    };
  }

  const pairScores = [];
  for (const [span, cand] of PAIRS) {
    const dbRows = wordLookup(db, cand);
    const hotword = dbRows[0]
      ? {
          word: dbRows[0].word,
          pinyin: (dbRows[0].pinyin_key || '').split('|').filter(Boolean),
          priorScore: dbRows[0].prior_score,
          tonePinyinKey: dbRows[0].tone_pinyin_key,
          repairTarget: dbRows[0].repair_target === 1,
          enabled: dbRows[0].enabled === 1,
          domains: dbRows[0].domain_id ? [dbRows[0].domain_id] : [],
        }
      : null;
    pairScores.push({ span, candidate: cand, dbFound: !!dbRows.length, tables: dbRows.map((r) => r.table), ...scorePair(span, cand, hotword, profile) });
  }

  const out = {
    readonly: true,
    timestamp: new Date().toISOString(),
    sqlitePath: SQLITE,
    manifestSchemaVersion: manifest.schemaVersion,
    schema,
    wordRows,
    shaobingBucket: { key: shaobingKey, entries: bucketShaobing, hasShaobing: bucketShaobing.some((r) => r.word === '少冰') },
    spanAudits,
    pairScores,
    sqlUsedByRuntime: {
      base: `SELECT id, pinyin_key, tone_pinyin_key, word, ... FROM base_lexicon WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ? ORDER BY prior_score DESC LIMIT ?`,
      domain: `SELECT ... FROM domain_lexicon WHERE domain_id = ? AND pinyin_key = ? AND enabled = 1 AND length(word) = ? ORDER BY prior_score DESC LIMIT ?`,
      recallQueryField: 'pinyin_key (plain, no tone)',
      toneUsedInSql: false,
      toneUsedInRecallV2Sort: false,
      toneUsedInPipelineSort: 'fw-sentence-rerank-pipeline.ts after recallSpanTopK',
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('[tone-audit] wrote', OUT);
  console.log('[tone-audit] 少冰 in DB:', (wordRows['少冰'] || []).length);
  console.log('[tone-audit] shao|bing bucket has 少冰:', out.shaobingBucket.hasShaobing);
  console.log('[tone-audit] 少病 recall:', spanAudits['少病']?.recallLocalSpanTopK?.map((h) => h.word).join(', '));
  db.close();
}

main();
