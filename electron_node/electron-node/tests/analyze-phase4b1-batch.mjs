#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.join(__dirname, 'fw-detector-dialog-200-phase4b1-batch-result.json');
const MANIFEST = path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json');

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { normalizeForImeAlignment } = require('../dist/main/electron-node/main/src/fw-detector/pinyin-ime-v2/normalize-for-ime-alignment.js');

const report = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  return levenshtein(r, h) / r.length;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

const ev = report.cases.filter((c) => !c.skip);
const pipelineMs = ev.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const asrLatency = ev
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms)
  .filter((n) => typeof n === 'number');
const audioMs = ev
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.audio_ms)
  .filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
let exactFinal = 0;
let improved = 0;
let degraded = 0;
const worstFinal = [];

let imeCand = 0;
let imeApproved = 0;
let diffSpanZeroWithCand = 0;
let openccCases = 0;
let openccCharTotal = 0;
const decodeMs = [];
const fwStepMs = [];

for (const c of ev) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
  if (fc > 0.15) {
    worstFinal.push({ id: c.id, scenario: c.scenario, cer: fc, ref: ref.slice(0, 50), hyp: fin.slice(0, 50) });
  }

  const fw = c.extra?.fw_detector || {};
  const ime = fw.pinyinImeV2 || {};
  if ((ime.candidateCount || 0) > 0) imeCand += 1;
  if ((ime.approvedSpanCount || 0) > 0) imeApproved += 1;
  if ((ime.candidateCount || 0) > 0 && (ime.diffSpanCount || 0) === 0) diffSpanZeroWithCand += 1;
  let occ = ime.openccConvertedCount || 0;
  let trad = ime.traditionalCharCount || 0;
  if (!occ && raw) {
    const aligned = normalizeForImeAlignment(raw);
    occ = aligned.openccConvertedCount;
    trad = aligned.traditionalCharCount;
  }
  if (occ > 0) {
    openccCases += 1;
    openccCharTotal += occ;
  }
  if (ime.decodeMs) decodeMs.push(ime.decodeMs);
  if (c.extra?.fw_detector_step_ms) fwStepMs.push(c.extra.fw_detector_step_ms);
}

worstFinal.sort((a, b) => b.cer - a.cer);

const rows = ev.map((c) => {
  const ref = refById[c.id] || '';
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const fw = c.extra?.fw_detector || {};
  const ime = fw.pinyinImeV2 || {};
  return {
    id: c.id,
    scenario: c.scenario,
    cer: cer(ref, fin),
    fin,
    ref,
    ime,
    fw_triggered: c.fw_triggered,
    pipeline_ms: c.pipeline_ms,
  };
});

const triggered = rows.filter((r) => (r.ime.candidateCount || 0) > 0);
const bundleSample = ev[0]?.extra?.fw_detector?.runtime;

const out = {
  batch: {
    timestamp: report.timestamp,
    evaluated: ev.length,
    stoppedReason: report.stoppedReason,
    wall_clock_sec: report.summary?.wall_clock_sec,
    scope: 'Phase 4B.1 OpenCC alignment normalization',
  },
  quality: {
    avg_cer_raw: Number(avg(rawCers).toFixed(4)),
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    exact_match_final: exactFinal,
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
    worst_final_cer_top5: worstFinal.slice(0, 5),
  },
  perf: {
    pipeline_ms: {
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      min: Math.min(...pipelineMs),
      max: Math.max(...pipelineMs),
    },
    asr_latency_ms: {
      avg: Math.round(avg(asrLatency)),
      p50: pct(asrLatency, 50),
      p95: pct(asrLatency, 95),
    },
    audio_ms: { avg: Math.round(avg(audioMs)), p50: pct(audioMs, 50) },
    rtf_pipeline: Number((avg(pipelineMs) / avg(audioMs)).toFixed(3)),
    rtf_asr: Number((avg(asrLatency) / avg(audioMs)).toFixed(3)),
  },
  contract: report.summary,
  opencc: {
    cases_with_conversion: openccCases,
    total_converted_chars: openccCharTotal,
    avg_converted_per_case: openccCases
      ? Number((openccCharTotal / openccCases).toFixed(2))
      : 0,
  },
  ime: {
    cases_with_candidates: imeCand,
    cases_with_approved_spans: imeApproved,
    candidate_but_diff_span_zero: diffSpanZeroWithCand,
    decode_ms: {
      avg: Math.round(avg(decodeMs)),
      p50: pct(decodeMs, 50),
      p95: pct(decodeMs, 95),
      max: decodeMs.length ? Math.max(...decodeMs) : 0,
    },
    fw_step_ms: {
      avg: Math.round(avg(fwStepMs)),
      p50: pct(fwStepMs, 50),
      p95: pct(fwStepMs, 95),
      max: fwStepMs.length ? Math.max(...fwStepMs) : 0,
    },
  },
  runtime: {
    bundle_dir: bundleSample?.bundleDir,
    manifest_version: bundleSample?.manifestVersion,
    lexicon_rows: bundleSample?.lexiconRows,
  },
  samples: {
    opencc_heavy: [...rows]
      .map((r) => {
        const raw = (ev.find((c) => c.id === r.id)?.extra?.raw_asr_text || '').trim();
        const a = raw ? normalizeForImeAlignment(raw) : { openccConvertedCount: 0, traditionalCharCount: 0 };
        return { ...r, openccConvertedCount: a.openccConvertedCount, traditionalCharCount: a.traditionalCharCount };
      })
      .filter((r) => r.openccConvertedCount > 0)
      .sort((a, b) => b.openccConvertedCount - a.openccConvertedCount)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        scenario: r.scenario,
        traditionalCharCount: r.traditionalCharCount,
        openccConvertedCount: r.openccConvertedCount,
        diffSpanCount: r.ime.diffSpanCount,
        candidateCount: r.ime.candidateCount,
        hyp: r.fin.slice(0, 80),
      })),
    ime_with_candidates: triggered.slice(0, 6).map((r) => ({
      id: r.id,
      scenario: r.scenario,
      cer: Number(r.cer.toFixed(4)),
      candidateCount: r.ime.candidateCount,
      diffSpanCount: r.ime.diffSpanCount,
      approvedSpanCount: r.ime.approvedSpanCount,
      openccConvertedCount: r.ime.openccConvertedCount,
      hyp: r.fin.slice(0, 80),
    })),
    worst_cer: worstFinal.slice(0, 5),
    exact_match: rows
      .filter((r) => r.cer === 0)
      .slice(0, 5)
      .map((r) => ({ id: r.id, scenario: r.scenario, hyp: r.fin.slice(0, 70) })),
  },
};

const outPath = path.join(__dirname, 'fw-detector-dialog-200-phase4b1-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
