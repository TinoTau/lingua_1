#!/usr/bin/env node
/** Offline benefit probes — no sqlite, uses dist recall. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;
const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');

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

const {
  extractAcousticTonePattern,
  isCandidateToneCompatible,
  resolveCandidateToneKey,
} = require(path.join(DIST, 'fw-detector/tone-match-score.js'));
const { sortRecallHitsByToneCompatibility } = require(path.join(DIST, 'lexicon/tone-recall-sort.js'));
const { recallSpanTopK } = require(path.join(DIST, 'lexicon/local-span-recall.js'));
const { ensureLexiconRuntimeV2Loaded } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2-holder.js'));
const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));

const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];
const OUT = path.join(__dirname, 'tone-module-p1-probe-offline.json');

function makeToken(ch, t, s) {
  const p = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  p[`t${t}`] = 0.88;
  return { token: ch, start: s, end: s + 0.1, tonePosterior: p, confidence: 0.88 };
}

function buildTone(raw, pat) {
  const chars = [...raw].filter((c) => /[\u4e00-\u9fff]/.test(c));
  const tones = pat.split('|').map(Number);
  return {
    toneEnabled: true,
    alignmentText: raw,
    toneTokens: chars.map((ch, i) => makeToken(ch, tones[i] || 1, i * 0.12)),
  };
}

function probe(asrWord, goldenWord, tonePat, spanText = asrWord) {
  const tone = buildTone(spanText, tonePat);
  const pattern = extractAcousticTonePattern(spanText, 0, spanText.length, tone);
  const recall = recallSpanTopK(spanText, profile, 8, 0.5, DOMAINS, { perSpanLimit: 8 });
  const hits = recall.hits.map((h) => ({
    hotword: {
      word: h.word,
      priorScore: h.priorScore,
      tonePinyinKey: h.tonePinyinKey || resolveCandidateToneKey(h.word),
    },
    candidateScore: h.candidateScore,
  }));
  const off = sortRecallHitsByToneCompatibility(hits, null);
  const on = sortRecallHitsByToneCompatibility(hits, pattern);
  const rows = [];
  for (const h of on.hits) {
    const key = h.hotword.tonePinyinKey;
    if (!isCandidateToneCompatible(pattern, key, h.hotword.word)) continue;
    rows.push({
      原词: goldenWord,
      ASR词: asrWord,
      Recall候选: h.hotword.word,
      acousticTonePattern: pattern,
      candidateTonePattern: key,
      toneCompatible: true,
      offRank: off.hits.findIndex((x) => x.hotword.word === h.hotword.word) + 1,
      onRank: on.hits.findIndex((x) => x.hotword.word === h.hotword.word) + 1,
    });
  }
  return {
    span: spanText,
    pattern,
    offTop5: off.hits.map((h) => h.hotword.word),
    onTop5: on.hits.map((h) => h.hotword.word),
    compatibleHits: rows,
    rankChanged: off.hits[0]?.hotword.word !== on.hits[0]?.hotword.word,
  };
}

ensureLexiconRuntimeV2Loaded();
const profile = defaultGeneralProfile();

const probes = [
  probe('少病', '少冰', '3|1'),
  probe('钟贝', '中杯', '1|4'),
  probe('大悲', '大杯', '4|1'),
  probe('美食', '美式', '3|3'),
  probe('拿铁', '拿铁', '2|3'),
  probe('评审', '评审', '2|3'),
  probe('平身', '平身', '2|1'),
  probe('上线', '上线', '4|4'),
  probe('上限', '上限', '4|4'),
  probe('检查', '检查', '3|3'),
  probe('检察', '检察', '3|3'),
];

const allHits = probes.flatMap((p) =>
  p.compatibleHits.map((h) => ({
    ...h,
    rankChanged: h.offRank !== h.onRank,
    最终排序变化: h.offRank !== h.onRank ? `${h.offRank}→${h.onRank}` : '不变',
  }))
);
allHits.sort((a, b) => (b.rankChanged - a.rankChanged) || a.onRank - b.onRank);

fs.writeFileSync(
  OUT,
  JSON.stringify({ probes, top20TrueHits: allHits.slice(0, 20), totalCompatibleHits: allHits.length }, null, 2),
  'utf8'
);
console.log('compatible hits', allHits.length, 'rank changed', allHits.filter((h) => h.rankChanged).length);
