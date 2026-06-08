#!/usr/bin/env node
/**
 * ToneModule P0.5 — Runtime Integration Audit (recall-path; no wTone).
 */
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

const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');
const OUT_JSON = path.join(__dirname, 'tone-module-p0-runtime-acceptance-node.json');

const {
  extractAcousticTonePattern,
  isToneAlignmentValid,
} = require(path.join(DIST, 'fw-detector/tone-match-score.js'));
const { sortRecallHitsByToneCompatibility } = require(path.join(DIST, 'lexicon/tone-recall-sort.js'));
const { textToToneSyllables, toneDistance } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));

function makeToken(token, toneNum, start) {
  const posterior = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  posterior[`t${toneNum}`] = 0.9;
  return { token, start, end: start + 0.12, tonePosterior: posterior, confidence: 0.9 };
}

function buildToneFromText(rawText, tonePattern) {
  const chars = [...rawText].filter((c) => /[\u4e00-\u9fff]/.test(c));
  const tones = tonePattern.split('|').map((x) => parseInt(x, 10));
  const tokens = chars.map((ch, i) => makeToken(ch, tones[i] || 1, i * 0.15));
  return {
    toneEnabled: true,
    alignmentText: rawText,
    toneTokens: tokens,
    toneTokenCount: tokens.length,
    toneConfidenceAvg: 0.9,
  };
}

function auditLegacyTone() {
  const { execSync } = require('child_process');
  const grepBase = path.join(PROJECT_ROOT, 'electron_node/electron-node/main/src');
  const patterns = [
    { name: 'textToToneSyllables(span', cmd: `rg "textToToneSyllables\\(span" "${grepBase}" -g "*.ts" || true` },
    { name: 'toneDistance in fw-detector', cmd: `rg "toneDistance" "${grepBase}/fw-detector" -g "*.ts" || true` },
    { name: 'wTone in fw-detector', cmd: `rg "wTone" "${grepBase}/fw-detector" -g "*.ts" || true` },
    { name: 'toneMatchScore in fw-detector', cmd: `rg "toneMatchScore" "${grepBase}/fw-detector" -g "*.ts" || true` },
  ];
  const hits = {};
  for (const p of patterns) {
    try {
      hits[p.name] = execSync(p.cmd, { encoding: 'utf8', shell: true }).trim().split('\n').filter(Boolean);
    } catch {
      hits[p.name] = [];
    }
  }
  return {
    fwDetectorUsesToneDistance: hits['toneDistance in fw-detector'].length > 0,
    fwDetectorUsesTextToToneSyllablesSpan: hits['textToToneSyllables(span'].length > 0,
    fwDetectorUsesWTone: hits['wTone in fw-detector'].length > 0,
    fwDetectorUsesToneMatchScore: hits['toneMatchScore in fw-detector'].length > 0,
    hits,
  };
}

function auditShaoBingRecall() {
  const rawText = '少病';
  const tone = buildToneFromText(rawText, '3|1');
  const pattern = extractAcousticTonePattern(rawText, 0, 2, tone);
  const hits = [
    { hotword: { word: '少冰', priorScore: 0.65, tonePinyinKey: 'shao3|bing1' }, candidateScore: 1.1 },
    { hotword: { word: '烧饼', priorScore: 0.7, tonePinyinKey: 'shao1|bing3' }, candidateScore: 1.2 },
    { hotword: { word: '哨兵', priorScore: 0.6, tonePinyinKey: 'shao4|bing1' }, candidateScore: 1.0 },
  ];
  const sorted = sortRecallHitsByToneCompatibility(hits, pattern);
  return { rawText, pattern, ranked: sorted.hits.map((h) => h.hotword.word) };
}

function auditRankingImpact(n = 50, seed = 20260607) {
  const rng = (() => {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  })();
  const spans = [
    { raw: '少病', start: 0, end: 2, tonePat: '3|1', cands: ['少冰', '烧饼', '哨兵'] },
    { raw: '评审', start: 0, end: 2, tonePat: '2|3', cands: ['评审', '平身', '凭神'] },
  ];
  let toneAffectsSortCount = 0;
  for (let i = 0; i < n; i += 1) {
    const sp = spans[Math.floor(rng() * spans.length)];
    const tone = buildToneFromText(sp.raw, sp.tonePat);
    const pattern = extractAcousticTonePattern(sp.raw, sp.start, sp.end, tone);
    const hits = sp.cands.map((w, idx) => ({
      hotword: { word: w, priorScore: 1 - idx * 0.05, tonePinyinKey: '' },
      candidateScore: 1 - idx * 0.01,
    }));
    const withTone = sortRecallHitsByToneCompatibility(hits, pattern).hits;
    const withoutTone = sortRecallHitsByToneCompatibility(hits, undefined).hits;
    if (withTone[0]?.hotword.word !== withoutTone[0]?.hotword.word) {
      toneAffectsSortCount += 1;
    }
  }
  return { simulatedSpans: n, toneAffectsSortCount };
}

const report = {
  audit: 'ToneModule P0.5 Runtime Acceptance (Node)',
  timestamp: new Date().toISOString(),
  legacyToneCleanup: auditLegacyTone(),
  shaoBingRecall: auditShaoBingRecall(),
  rankingImpact: auditRankingImpact(50),
  ssotProbe: {
    aligned: isToneAlignmentValid('少病', buildToneFromText('少病', '3|1')),
    misaligned: isToneAlignmentValid('少病', buildToneFromText('烧病', '3|1')),
  },
  tonePinyinLibOnly: {
    textToToneSyllablesDefined: typeof textToToneSyllables === 'function',
    toneDistanceDefined: typeof toneDistance === 'function',
  },
};

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
