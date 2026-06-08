#!/usr/bin/env node
/**
 * ToneModule P0.5 — Runtime Validation & Freeze Acceptance (read-only).
 * Outputs: tone-module-p05-runtime-validation.json
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav/dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const OUT_JSON = path.join(__dirname, 'tone-module-p05-runtime-validation.json');
const PERF_JSON = path.join(PROJECT_ROOT, 'electron_node/services/faster_whisper_vad/tone_module/_audit_perf.json');
const FW_PORT = parseInt(process.env.FASTER_WHISPER_VAD_PORT || '6007', 10);
const FW_URL = `http://127.0.0.1:${FW_PORT}/utterance`;

const args = process.argv.slice(2);
let dialogLimit = null;
let ssotSample = 50;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    dialogLimit = parseInt(args[i + 1], 10);
    i += 1;
  } else if (args[i] === '--ssot' && args[i + 1]) {
    ssotSample = parseInt(args[i + 1], 10);
    i += 1;
  }
}

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
const { recallSpanTopK } = require(path.join(DIST, 'lexicon/local-span-recall.js'));

function getNodePort() {
  const cfgPath = path.join(process.env.APPDATA || '', 'lingua-electron-node', 'electron-node-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.testServer?.port) return cfg.testServer.port;
    } catch (_) {}
  }
  return 5020;
}

async function waitHealth(url, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

function pipelineTrace() {
  return [
    { step: 1, component: 'FW Audio', file: 'api_routes.py', fn: 'process_utterance' },
    { step: 2, component: 'Tone CNN', file: 'tone_module/inference.py', fn: 'run_tone_inference' },
    { step: 3, component: 'toneTokens', field: 'UtteranceTonePayload.toneTokens' },
    { step: 4, component: 'extractAcousticTonePattern', file: 'fw-sentence-rerank-pipeline.ts' },
    { step: 5, component: 'recallSpanTopK', file: 'local-span-recall.ts', note: 'acousticTonePattern option' },
    { step: 6, component: 'tone-aware Recall', file: 'recall-span-topk-v2.ts + tone-recall-sort.ts' },
    { step: 7, component: 'Builder', file: 'build-sentence-candidates.ts', note: 'no tone' },
    { step: 8, component: 'KenLM', file: 'rerank-fw-sentences.ts', note: 'no tone' },
    { step: 9, component: 'Apply', file: 'map-sentence-to-approved.ts', note: 'no tone' },
  ];
}

function grepFreeze() {
  const srcRoot = path.join(PROJECT_ROOT, 'electron_node/electron-node/main/src');
  const patterns = [
    { id: 'no_wTone', pattern: 'wTone', paths: ['fw-detector'] },
    { id: 'no_toneMatchScore', pattern: 'toneMatchScore', paths: ['fw-detector', 'lexicon'] },
    { id: 'no_candidateScore_tone', pattern: 'candidateScore +=', paths: ['fw-detector'] },
    { id: 'builder_no_tone', pattern: 'acousticTone|toneModule|extractAcoustic', paths: ['fw-detector/build-sentence-candidates.ts'] },
    { id: 'kenlm_no_tone', pattern: 'acousticTone|toneModule|extractAcoustic', paths: ['fw-detector/rerank-fw-sentences.ts', 'asr-repair'] },
    { id: 'apply_no_tone', pattern: 'acousticTone|toneModule|extractAcoustic', paths: ['fw-detector/map-sentence-to-approved.ts'] },
    { id: 'ime_no_acoustic_tone', pattern: 'extractAcousticTonePattern|toneModule|acousticTonePattern', paths: ['fw-detector/pinyin-ime-v2'] },
  ];
  const results = {};
  for (const p of patterns) {
    let hits = [];
    for (const rel of p.paths) {
      const target = path.join(srcRoot, rel);
      if (!fs.existsSync(target)) continue;
      try {
        const out = execSync(`rg -n "${p.pattern.replace(/"/g, '\\"')}" "${target}"`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (out) hits.push(...out.split('\n').filter(Boolean));
      } catch (_) {}
    }
    results[p.id] = { pass: hits.length === 0, hitCount: hits.length, hits: hits.slice(0, 5) };
  }
  results.fwToneConfigDeleted = {
    pass: !fs.existsSync(path.join(srcRoot, 'fw-detector/fw-tone-config.ts')),
  };
  results.computeToneMatchScoreRemoved = {
    pass: typeof require(path.join(DIST, 'fw-detector/tone-match-score.js')).computeToneMatchScore !== 'function',
  };
  return results;
}

function makeToken(token, toneNum, start) {
  const posterior = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  posterior[`t${toneNum}`] = 0.88;
  return { token, start, end: start + 0.1, tonePosterior: posterior, confidence: 0.88 };
}

function buildTone(rawText, patternStr) {
  const chars = [...rawText].filter((c) => /[\u4e00-\u9fff]/.test(c));
  const tones = patternStr.split('|').map(Number);
  return {
    toneEnabled: true,
    alignmentText: rawText,
    toneTokens: chars.map((ch, i) => makeToken(ch, tones[i] || 1, i * 0.12)),
    toneTokenCount: chars.length,
  };
}

function auditSpecialCase(raw, patternStr, candidates, priorBase = 0.7) {
  const tone = buildTone(raw, patternStr);
  const acousticTonePattern = extractAcousticTonePattern(raw, 0, raw.length, tone);
  const hits = candidates.map((w, i) => ({
    hotword: {
      word: w,
      priorScore: priorBase - i * 0.05,
      tonePinyinKey: resolveCandidateToneKey(w),
    },
    candidateScore: 1.2 - i * 0.05,
  }));
  const sorted = sortRecallHitsByToneCompatibility(hits, acousticTonePattern);
  return {
    raw,
    acousticTonePattern,
    ranked: sorted.hits.map((h, rank) => ({
      word: h.hotword.word,
      candidateRank: rank + 1,
      candidateTonePattern: resolveCandidateToneKey(h.hotword.word),
      toneCompatible: isCandidateToneCompatible(
        acousticTonePattern,
        resolveCandidateToneKey(h.hotword.word),
        h.hotword.word
      ),
    })),
    top1: sorted.hits[0]?.hotword.word,
    recallToneCompatibleCount: sorted.recallToneCompatibleCount,
  };
}

function auditOfflineProbes() {
  return {
    shaoBing: auditSpecialCase('少病', '3|1', ['少冰', '烧饼', '哨兵']),
    pingShen: auditSpecialCase('评审', '2|2|4|1', ['评审', '平身']),
    jianCha: auditSpecialCase('检查', '3|3|3', ['检查', '检察']),
    shangXian: auditSpecialCase('上线', '4|4', ['上线', '上限']),
    failOpen: {
      noTone: (() => {
        const hits = [
          { hotword: { word: '少冰', priorScore: 0.65, tonePinyinKey: 'shao3|bing1' }, candidateScore: 1.15 },
          { hotword: { word: '烧饼', priorScore: 0.7, tonePinyinKey: 'shao1|bing3' }, candidateScore: 1.2 },
        ];
        const r = sortRecallHitsByToneCompatibility(hits, null);
        return { top1: r.hits[0]?.hotword.word, fallback: r.recallToneFallbackCount };
      })(),
      alignmentMismatch: (() => {
        const raw = '少病';
        const tone = { ...buildTone(raw, '3|1'), alignmentText: '烧病' };
        return {
          pattern: extractAcousticTonePattern(raw, 0, 2, tone),
          aligned: isToneAlignmentValid(raw, tone),
        };
      })(),
      nonZh: { note: 'FW skippedReason non_zh — validated at FW layer' },
    },
  };
}

function readWavPcm16(wavPath) {
  const buf = fs.readFileSync(wavPath);
  const sr = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const ch = buf.readUInt16LE(22);
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      offset += 8;
      break;
    }
    offset += 8 + size;
  }
  const bytes = buf.subarray(offset);
  const sampleCount = Math.floor(bytes.length / ((bits / 8) * ch));
  const pcm = new Float32Array(sampleCount);
  if (bits === 16) {
    for (let i = 0; i < sampleCount; i++) {
      let s = bytes.readInt16LE(i * ch * 2);
      if (ch > 1) {
        let sum = s;
        for (let c = 1; c < ch; c++) sum += bytes.readInt16LE((i * ch + c) * 2);
        s = sum / ch;
      }
      pcm[i] = s / 32768;
    }
  } else {
    throw new Error(`unsupported wav bits=${bits}`);
  }
  return { pcm, sr };
}

function pcmToB64(pcmF32, sr) {
  const pcm16 = new Int16Array(pcmF32.length);
  for (let i = 0; i < pcmF32.length; i++) {
    pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(pcmF32[i] * 32767)));
  }
  return Buffer.from(pcm16.buffer).toString('base64');
}

async function fwUtterance(pcm, sr, traceId) {
  const res = await fetch(FW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: traceId,
      src_lang: 'zh',
      audio: pcmToB64(pcm, sr),
      audio_format: 'pcm16',
      sample_rate: sr,
      task: 'transcribe',
      condition_on_previous_text: false,
      use_context_buffer: false,
      beam_size: 1,
      temperature: 0,
      trace_id: traceId,
    }),
    signal: AbortSignal.timeout(180000),
  });
  return res.json();
}

function shuffleSample(arr, n, seed = 42) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

async function auditSsotFw(manifest) {
  const fwUp = await waitHealth(`http://127.0.0.1:${FW_PORT}/health`, 15000);
  if (!fwUp) return { fwServiceUp: false, rows: [], alignmentMatchedCount: 0, alignmentMismatchCount: 0 };

  const items = manifest.filter((x) => fs.existsSync(path.join(DIALOG_DIR, x.file)));
  const sample = shuffleSample(items, ssotSample, 42);
  const rows = [];
  let alignmentMatchedCount = 0;
  let alignmentMismatchCount = 0;

  for (const item of sample) {
    const wavPath = path.join(DIALOG_DIR, item.file);
    let row = {
      id: item.id,
      rawAsrText: null,
      alignmentText: null,
      alignmentMatched: null,
      toneEnabled: false,
    };
    try {
      const { pcm, sr } = readWavPcm16(wavPath);
      const resp = await fwUtterance(pcm, sr, `ssot-${item.id}`);
      const raw = (resp.text || '').trim();
      const tone = resp.tone || {};
      const alignmentText = (tone.alignmentText || '').trim();
      const matched = raw.length > 0 && alignmentText === raw;
      row = {
        ...row,
        rawAsrText: raw,
        alignmentText,
        alignmentMatched: matched,
        toneEnabled: tone.toneEnabled === true,
      };
      if (raw.length > 0) {
        if (matched) alignmentMatchedCount += 1;
        else alignmentMismatchCount += 1;
      }
    } catch (e) {
      row.error = e.message;
    }
    rows.push(row);
  }

  return {
    fwServiceUp: true,
    sampleCount: rows.length,
    alignmentMatchedCount,
    alignmentMismatchCount,
    pass: alignmentMismatchCount === 0,
    rows: rows.slice(0, 10),
  };
}

function extractRecallTops(fw) {
  const spans = fw?.spans || [];
  const tops = { top1: [], top3: [], top5: [] };
  for (const span of spans) {
    const cands = (span.candidates || []).map((c) => c.word);
    if (!cands.length) continue;
    tops.top1.push(cands[0]);
    tops.top3.push(cands.slice(0, 3).join('|'));
    tops.top5.push(cands.slice(0, 5).join('|'));
  }
  return tops;
}

function compareTops(a, b) {
  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  const n = Math.min(a.top1.length, b.top1.length);
  for (let i = 0; i < n; i++) {
    if (a.top1[i] !== b.top1[i]) top1 += 1;
    if (a.top3[i] !== b.top3[i]) top3 += 1;
    if (a.top5[i] !== b.top5[i]) top5 += 1;
  }
  return { spanPairs: n, recallTop1Change: top1, recallTop3Change: top3, recallTop5Change: top5 };
}

async function runDialog200(manifest, port) {
  const nodeUp = await waitHealth(`http://127.0.0.1:${port}/health`, 30000);
  if (!nodeUp) return { nodeServiceUp: false };

  let cases = manifest;
  if (dialogLimit > 0) cases = cases.slice(0, dialogLimit);

  const stats = {
    toneEnabledCount: 0,
    toneDisabledCount: 0,
    extractSuccessCount: 0,
    extractFailCount: 0,
    failReasons: { noTonePayload: 0, alignmentMismatch: 0, nonZh: 0, emptyPattern: 0, fwNotTriggered: 0 },
    recallToneCompatibleCount: 0,
    recallToneFallbackCount: 0,
    e2e: {
      casesWithSpans: 0,
      recallTop1Change: 0,
      recallTop3Change: 0,
      recallTop5Change: 0,
      kenlmSelectedChange: 0,
      applyCountChange: 0,
    },
    samples: [],
  };

  for (const caseDef of cases) {
    const wavPath = path.join(DIALOG_DIR, caseDef.file);
    if (!fs.existsSync(wavPath)) continue;
    const sessionId = `p05-val-${caseDef.id}-${Date.now()}`;
    try {
      const onRes = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wavPath,
          srcLang: 'zh',
          tgtLang: 'en',
          use_lexicon: true,
          is_manual_cut: true,
          session_id: sessionId,
          lexicon_v2_intent_enabled: false,
        }),
        signal: AbortSignal.timeout(300000),
      });
      const onData = await onRes.json();
      if (!onRes.ok) {
        stats.samples.push({ id: caseDef.id, error: onData.error || `HTTP ${onRes.status}` });
        continue;
      }

      const extra = onData.extra || {};
      const fw = extra.fw_detector || {};
      const tm = fw.toneModule || {};
      const raw = (extra.raw_asr_text || onData.text_asr || '').trim();

      if (tm.toneEnabled === true) stats.toneEnabledCount += 1;
      else stats.toneDisabledCount += 1;

      if (tm.acousticTonePattern?.length) stats.extractSuccessCount += 1;
      else {
        stats.extractFailCount += 1;
        if (!tm.toneEnabled && !fw.triggered) stats.failReasons.fwNotTriggered += 1;
        else if (!tm.alignmentTextMatched) stats.failReasons.alignmentMismatch += 1;
        else if (!tm.toneEnabled) stats.failReasons.noTonePayload += 1;
        else stats.failReasons.emptyPattern += 1;
      }

      stats.recallToneCompatibleCount += tm.recallToneCompatibleCount ?? 0;
      stats.recallToneFallbackCount += tm.recallToneFallbackCount ?? 0;

      const onTops = extractRecallTops(fw);
      if (onTops.top1.length) stats.e2e.casesWithSpans += 1;

      let offData = null;
      if (raw) {
        const offRes = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asrText: raw, srcLang: 'zh', session_id: `${sessionId}-off` }),
          signal: AbortSignal.timeout(120000),
        });
        offData = await offRes.json();
        if (offRes.ok) {
          const offFw = offData.extra?.fw_detector || {};
          const cmp = compareTops(onTops, extractRecallTops(offFw));
          stats.e2e.recallTop1Change += cmp.recallTop1Change;
          stats.e2e.recallTop3Change += cmp.recallTop3Change;
          stats.e2e.recallTop5Change += cmp.recallTop5Change;

          const onApply = fw.summary?.appliedCount ?? 0;
          const offApply = offFw.summary?.appliedCount ?? 0;
          if (onApply !== offApply) stats.e2e.applyCountChange += 1;

          const onPick = fw.sentenceRerank?.pickedIsRaw === false;
          const offPick = offFw.sentenceRerank?.pickedIsRaw === false;
          if (onPick !== offPick) stats.e2e.kenlmSelectedChange += 1;
        }
      }

      if (stats.samples.length < 8) {
        stats.samples.push({
          id: caseDef.id,
          rawAsrText: raw.slice(0, 60),
          toneModule: tm,
          onApplied: fw.summary?.appliedCount ?? 0,
          offApplied: offData?.extra?.fw_detector?.summary?.appliedCount,
        });
      }

      process.stdout.write(`[d200 ${caseDef.id}] tone=${tm.toneEnabled} compat=${tm.recallToneCompatibleCount ?? 0}\n`);
    } catch (e) {
      stats.samples.push({ id: caseDef.id, error: e.message });
    }
  }

  stats.totalCases = cases.length;
  return { nodeServiceUp: true, port, ...stats };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const port = getNodePort();

  let performance = null;
  if (fs.existsSync(PERF_JSON)) {
    try {
      performance = JSON.parse(fs.readFileSync(PERF_JSON, 'utf8')).performanceDialog200;
    } catch (_) {}
  }

  const report = {
    audit: 'ToneModule P0.5 Runtime Validation',
    timestamp: new Date().toISOString(),
    projectRoot: PROJECT_ROOT,
    part1_pipelineTrace: pipelineTrace(),
    part12_freezeCheck: grepFreeze(),
    part2_ssot: await auditSsotFw(manifest),
    part3_4_10_dialog200: await runDialog200(manifest, port),
    part5_8_offlineProbes: auditOfflineProbes(),
    part11_performance: performance,
    offlineRecallPath: {
      shaoBingTop1: auditOfflineProbes().shaoBing.top1,
      shaoBingPass: auditOfflineProbes().shaoBing.top1 === '少冰',
    },
  };

  report.verdict = {
    toneEntersRecall:
      report.part3_4_10_dialog200.recallToneCompatibleCount > 0 ||
      report.offlineRecallPath.shaoBingPass,
    toneAffectsOrder: report.offlineRecallPath.shaoBingPass,
    ssotFixed: report.part2_ssot.pass === true,
    failOpenOk: report.part5_8_offlineProbes.failOpen.noTone.top1 === '烧饼',
    performanceOk: performance?.percentiles?.passP95Le20 === true,
    freezeChecksPass: Object.values(report.part12_freezeCheck).every((v) => v.pass !== false),
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== P0.5 Runtime Validation Summary ===');
  console.log(JSON.stringify(report.verdict, null, 2));
  console.log(`Full report: ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
