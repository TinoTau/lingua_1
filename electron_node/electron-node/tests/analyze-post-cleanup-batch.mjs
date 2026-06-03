#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fw-detector-dialog-200-post-cleanup-batch-result.json'), 'utf8')
);
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '');
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
let imeCand = 0;
let imeApproved = 0;
let gateNoNeighbor = 0;
let gateSupport = 0;
const decodeMs = [];
const fwStepMs = [];
const skippedReasonCounts = {};

for (const c of ev) {
  const fw = c.extra?.fw_detector || {};
  const ime = fw.pinyinImeV2 || {};
  if (ime.candidateCount > 0) imeCand += 1;
  if ((ime.approvedSpanCount || 0) > 0) imeApproved += 1;
  gateNoNeighbor += ime.gateDroppedNoNeighbor || 0;
  gateSupport += ime.gateDroppedSupport || 0;
  if (ime.decodeMs) decodeMs.push(ime.decodeMs);
  if (c.extra?.fw_detector_step_ms) fwStepMs.push(c.extra.fw_detector_step_ms);
  if (ime.skippedReason) {
    skippedReasonCounts[ime.skippedReason] = (skippedReasonCounts[ime.skippedReason] || 0) + 1;
  }
}

const rows = ev.map((c) => {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const fw = c.extra?.fw_detector || {};
  return {
    id: c.id,
    scenario: c.scenario,
    cer: cer(ref, fin),
    raw,
    fin,
    ref,
    fw,
    pipeline_ms: c.pipeline_ms,
    fw_triggered: c.fw_triggered,
    fw_applied: c.fw_applied_count || 0,
  };
});

const triggered = rows.filter((r) => (r.fw.summary?.spanCount || 0) > 0);
const bundleSample = ev[0]?.extra?.fw_detector?.runtime;

const out = {
  ime: {
    cases_with_candidates: imeCand,
    cases_with_approved_spans: imeApproved,
    skipped_reason_counts: skippedReasonCounts,
    decode_ms: {
      avg: Math.round(avg(decodeMs)),
      p50: pct(decodeMs, 50),
      p95: pct(decodeMs, 95),
      max: decodeMs.length ? Math.max(...decodeMs) : 0,
    },
    gate_dropped_no_neighbor_total: gateNoNeighbor,
    gate_dropped_support_total: gateSupport,
  },
  runtime: {
    bundle_dir: bundleSample?.bundleDir,
    manifest_version: bundleSample?.manifestVersion,
    lexicon_rows: bundleSample?.lexiconRows,
    status_ok_rate: ev.filter((c) => c.lexicon_runtime_status === 'ok').length / ev.length,
  },
  fw: {
    triggered_cases: triggered.length,
    applied_cases: ev.filter((c) => (c.fw_applied_count || 0) > 0).length,
    fw_step_ms: {
      avg: Math.round(avg(fwStepMs)),
      p50: pct(fwStepMs, 50),
      p95: pct(fwStepMs, 95),
      max: fwStepMs.length ? Math.max(...fwStepMs) : 0,
    },
  },
  samples: {
    fw_triggered: triggered.slice(0, 7).map((r) => ({
      id: r.id,
      scenario: r.scenario,
      cer: Number(r.cer.toFixed(4)),
      span_count: r.fw.summary?.spanCount,
      applied: r.fw.summary?.appliedCount,
      ime: r.fw.pinyinImeV2,
      reason: r.fw.reason,
      ref: r.ref.slice(0, 100),
      hyp: r.fin.slice(0, 100),
    })),
    worst_cer: [...rows]
      .sort((a, b) => b.cer - a.cer)
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        scenario: r.scenario,
        cer: Number(r.cer.toFixed(4)),
        ref: r.ref.slice(0, 80),
        hyp: r.fin.slice(0, 80),
      })),
    exact_match: rows
      .filter((r) => r.cer === 0)
      .slice(0, 6)
      .map((r) => ({ id: r.id, scenario: r.scenario, hyp: r.fin.slice(0, 70) })),
  },
};

const outPath = path.join(__dirname, 'fw-detector-dialog-200-post-cleanup-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
