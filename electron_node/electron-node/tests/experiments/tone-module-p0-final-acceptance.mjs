#!/usr/bin/env node
/**
 * ToneModule P0.5 — Clean Correction validation (recall-path only; no wTone A/B).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');
const OUT_JSON = path.join(__dirname, 'tone-module-p0-final-acceptance.json');
const PERF_JSON = path.join(
  PROJECT_ROOT,
  'electron_node/services/faster_whisper_vad/tone_module/_audit_perf.json'
);

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
  isToneAlignmentValid,
  resolveCandidateToneKey,
} = require(path.join(DIST, 'fw-detector/tone-match-score.js'));
const { sortRecallHitsByToneCompatibility } = require(path.join(DIST, 'lexicon/tone-recall-sort.js'));

function makeToken(token, toneNum, start) {
  const posterior = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  posterior[`t${toneNum}`] = 0.88;
  return { token, start, end: start + 0.1, tonePosterior: posterior, confidence: 0.88 };
}

function buildTone(rawText, pattern) {
  const chars = [...rawText].filter((c) => /[\u4e00-\u9fff]/.test(c));
  const tones = pattern.split('|').map(Number);
  return {
    toneEnabled: true,
    alignmentText: rawText,
    toneTokens: chars.map((ch, i) => makeToken(ch, tones[i] || 1, i * 0.12)),
    toneTokenCount: chars.length,
  };
}

function auditShaoBingRecall() {
  const raw = '少病';
  const tone = buildTone(raw, '3|1');
  const pattern = extractAcousticTonePattern(raw, 0, 2, tone);
  const hits = [
    { hotword: { word: '烧饼', priorScore: 0.7, tonePinyinKey: 'shao1|bing3' }, candidateScore: 1.2 },
    { hotword: { word: '少冰', priorScore: 0.65, tonePinyinKey: 'shao3|bing1' }, candidateScore: 1.15 },
    { hotword: { word: '哨兵', priorScore: 0.6, tonePinyinKey: 'shao4|bing1' }, candidateScore: 1.1 },
  ];
  const sorted = sortRecallHitsByToneCompatibility(hits, pattern);
  return {
    acousticTonePattern: pattern,
    top1: sorted.hits[0]?.hotword.word,
    recallToneCompatibleCount: sorted.recallToneCompatibleCount,
    candidates: ['少冰', '烧饼', '哨兵'].map((w) => ({
      word: w,
      key: resolveCandidateToneKey(w),
      compatible: isCandidateToneCompatible(pattern, resolveCandidateToneKey(w), w),
    })),
  };
}

function auditSsot() {
  const raw = '少病';
  const good = buildTone(raw, '3|1');
  const bad = { ...good, alignmentText: '烧病' };
  return {
    aligned: isToneAlignmentValid(raw, good),
    misaligned: isToneAlignmentValid(raw, bad),
    patternWhenAligned: extractAcousticTonePattern(raw, 0, 2, good),
    patternWhenMisaligned: extractAcousticTonePattern(raw, 0, 2, bad),
  };
}

function auditNoToneFallback() {
  const raw = '少病';
  const tone = buildTone(raw, '3|1');
  const hits = [
    { hotword: { word: '烧饼', priorScore: 0.7, tonePinyinKey: 'shao1|bing3' }, candidateScore: 1.2 },
    { hotword: { word: '少冰', priorScore: 0.65, tonePinyinKey: 'shao3|bing1' }, candidateScore: 1.15 },
  ];
  const plain = sortRecallHitsByToneCompatibility(hits, null);
  return { top1: plain.hits[0]?.hotword.word, fallbackCount: plain.recallToneFallbackCount };
}

async function main() {
  const report = {
    audit: 'ToneModule P0.5 Clean Correction',
    timestamp: new Date().toISOString(),
    shaoBingRecall: auditShaoBingRecall(),
    ssot: auditSsot(),
    noToneFallback: auditNoToneFallback(),
    legacyRemoved: {
      fwToneConfigExists: fs.existsSync(path.join(DIST, 'fw-detector/fw-tone-config.js')),
      computeToneMatchScoreExported:
        typeof require(path.join(DIST, 'fw-detector/tone-match-score.js')).computeToneMatchScore ===
        'function',
    },
  };

  if (fs.existsSync(PERF_JSON)) {
    try {
      report.performance = JSON.parse(fs.readFileSync(PERF_JSON, 'utf8')).performanceDialog200?.percentiles;
    } catch (_) {}
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
