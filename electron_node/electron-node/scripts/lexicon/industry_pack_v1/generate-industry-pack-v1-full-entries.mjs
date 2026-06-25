#!/usr/bin/env node
/**
 * Industry Expansion Pack V1 — Full ~2000 term JSONL generator.
 * Reads word_banks/*.txt + word_banks_supplement/*.txt (domain from filename).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';
import { loadTermIndex } from './lib/term-index.mjs';
import { EXPANSION_DENY_LIST } from './lib/constants.mjs';
import { rejectPhraseLike } from './lib/reject-phrase-like.mjs';

const require = createRequire(import.meta.url);
const { EXISTING_TERM_ID_BY_WORD } = require('../expansion-v1_1/terms-manifest.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = path.join(repoRoot(), 'electron_node', 'docs', 'lexicon-assets', 'industry_pack_v1');
const OUT = path.join(ASSET_ROOT, 'entries.industry-pack-v1-full.jsonl');

const TARGET_ADD_TERMS = Number(process.env.INDUSTRY_PACK_TARGET_ADD ?? 2000);
const DOMAIN_DIRS = ['word_banks_curated', 'word_banks'];

const APPEND_OPS = [
  { word: '机场', term_id: EXISTING_TERM_ID_BY_WORD['机场'], domain_tags: ['meeting'], weight: 0.72 },
  { word: '预订', term_id: EXISTING_TERM_ID_BY_WORD['预订'], domain_tags: ['medical'], weight: 0.68 },
  { word: '中杯', term_id: EXISTING_TERM_ID_BY_WORD['中杯'], domain_tags: ['bakery'], weight: 0.7 },
  { word: '大杯', term_id: EXISTING_TERM_ID_BY_WORD['大杯'], domain_tags: ['food_order'], weight: 0.75 },
  { word: '小杯', term_id: EXISTING_TERM_ID_BY_WORD['小杯'], domain_tags: ['tourism_route'], weight: 0.65 },
  { word: '少冰', term_id: EXISTING_TERM_ID_BY_WORD['少冰'], domain_tags: ['bakery'], weight: 0.6 },
  { word: '蓝莓马芬', term_id: EXISTING_TERM_ID_BY_WORD['蓝莓马芬'], domain_tags: ['food_order'], weight: 0.72 },
];

const SKIP_WORDS = new Set([...EXPANSION_DENY_LIST, ...Object.keys(EXISTING_TERM_ID_BY_WORD)]);

function pinyinSpaced(word) {
  return pinyin(word, { toneType: 'none', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function tonePinyinSpaced(word) {
  return pinyin(word, { toneType: 'num', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function loadWordBankByDomain() {
  const byDomain = new Map();
  for (const sub of DOMAIN_DIRS) {
    const dir = path.join(ASSET_ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
      const domain = file.replace(/\.txt$/, '');
      const list = byDomain.get(domain) ?? [];
      for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        const w = line.trim();
        if (w) list.push(w);
      }
      byDomain.set(domain, list);
    }
  }
  return byDomain;
}

function makeAddRow(word, domain) {
  return {
    word,
    pinyin: pinyinSpaced(word),
    tone_pinyin: tonePinyinSpaced(word),
    domain_tags: [domain],
    domain_weights: { [domain]: 1.0 },
    repair_target: true,
    enabled: true,
    prior_score: 0.86,
    lexiconLayer: 'domain_patch',
    source: 'industry_pack_v1',
    wave: 'full_v1',
    mutation: 'add',
  };
}

function makeAppendRow(spec) {
  const weights = Object.fromEntries(spec.domain_tags.map((t) => [t, spec.weight ?? 1.0]));
  return {
    word: spec.word,
    pinyin: pinyinSpaced(spec.word),
    tone_pinyin: tonePinyinSpaced(spec.word),
    mutation: 'append',
    term_id: spec.term_id,
    domain_tags: spec.domain_tags,
    domain_weights: weights,
    repair_target: true,
    enabled: true,
    prior_score: 0.85,
    lexiconLayer: 'domain_patch',
    source: 'industry_pack_v1',
    wave: 'full_v1',
  };
}

function loadExistingWords() {
  const sqlite = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
  const idx = loadTermIndex(sqlite);
  const existing = new Set(SKIP_WORDS);
  const existingTermIds = new Set();
  if (idx) {
    for (const word of idx.byWord.keys()) existing.add(word);
    for (const list of idx.byWord.values()) {
      for (const rec of list) existingTermIds.add(rec.termId);
    }
    for (const rec of idx.byWordPinyin.values()) existingTermIds.add(rec.termId);
  }
  return { existingWords: existing, existingTermIds };
}

function termIdForWord(word) {
  const pk = pinyinSpaced(word).split(' ').join('|');
  return `term-${Buffer.from(`${word}|${pk}`, 'utf8').toString('hex').slice(0, 16)}`;
}

function main() {
  const { existingWords, existingTermIds } = loadExistingWords();
  const byDomain = loadWordBankByDomain();
  const globalSeen = new Set();
  const usedTermIds = new Set();
  const rows = [];

  for (const [domain, words] of byDomain) {
    for (const word of words) {
      if (globalSeen.has(word) || existingWords.has(word)) continue;
      if (EXPANSION_DENY_LIST.includes(word)) continue;
      if (rejectPhraseLike(word)) continue;
      const cjk = [...word].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
      if (cjk < 2 || cjk > 5) continue;
      const termId = termIdForWord(word);
      if (usedTermIds.has(termId) || existingTermIds.has(termId)) continue;
      globalSeen.add(word);
      usedTermIds.add(termId);
      rows.push(makeAddRow(word, domain));
      if (rows.filter((r) => r.mutation === 'add').length >= TARGET_ADD_TERMS) break;
    }
    if (rows.filter((r) => r.mutation === 'add').length >= TARGET_ADD_TERMS) break;
  }

  for (const spec of APPEND_OPS) {
    if (spec.term_id) rows.push(makeAppendRow(spec));
  }

  const addCount = rows.filter((r) => r.mutation === 'add').length;
  const appendCount = rows.filter((r) => r.mutation === 'append').length;

  if (addCount < TARGET_ADD_TERMS - 50) {
    throw new Error(
      `[generate-industry-pack-v1-full] need ~${TARGET_ADD_TERMS} addTerm, got ${addCount} (expand word_banks_supplement)`
    );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

  const stats = {
    out: OUT,
    addTerm: addCount,
    append: appendCount,
    total: rows.length,
    skippedExisting: existingWords.size,
    domains: [...byDomain.keys()],
  };
  fs.writeFileSync(
    path.join(ASSET_ROOT, 'entries.industry-pack-v1-full.stats.json'),
    `${JSON.stringify(stats, null, 2)}\n`
  );

  console.log('[generate-industry-pack-v1-full]', JSON.stringify(stats));
}

main();
