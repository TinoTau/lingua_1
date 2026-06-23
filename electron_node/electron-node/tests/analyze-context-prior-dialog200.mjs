#!/usr/bin/env node
/**
 * Context Prior Dialog200 analysis — CP-M22 + quality/perf.
 * Input: context-prior-dialog200-batch-result.json
 * Output: context-prior-dialog200-quality-perf.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.join(__dirname, 'context-prior-dialog200-batch-result.json');
const manifestPath = path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json');
const outPath = path.join(__dirname, 'context-prior-dialog200-quality-perf.json');

if (!fs.existsSync(batchPath)) {
  console.error(`Missing batch file: ${batchPath}`);
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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

const cases = batch.cases.filter((c) => !c.skip);
const pipelineMs = cases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;
let exactFinal = 0;

let contextPriorAppliedCount = 0;
const skippedReasonCounts = {};
const multiplierMins = [];
const multiplierMaxs = [];
const domainAssemblyMs = [];
const recallSources = {};
const domainVotes = {};
const contextPriorDomains = {};
const sampleIds = ['d001', 'd004', 'd031', 'd046', 'd052', 'd067', 'd136', 'd181'];
const samples = [];

for (const c of cases) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  else if (fc > rc + 1e-9) degraded += 1;

  const fw = c.extra?.fw_detector || {};
  const v4 = fw.spanAssemblyV4 || {};
  const runtime = fw.runtime || {};

  if (runtime.contextPriorApplied === true) {
    contextPriorAppliedCount += 1;
  }
  const reason = runtime.contextPriorSkippedReason;
  if (reason) {
    skippedReasonCounts[reason] = (skippedReasonCounts[reason] || 0) + 1;
  }
  const cpDom = runtime.contextPriorDomain;
  if (cpDom) {
    contextPriorDomains[cpDom] = (contextPriorDomains[cpDom] || 0) + 1;
  }
  if (typeof v4.contextPriorMultiplierMin === 'number') {
    multiplierMins.push(v4.contextPriorMultiplierMin);
  }
  if (typeof v4.contextPriorMultiplierMax === 'number') {
    multiplierMaxs.push(v4.contextPriorMultiplierMax);
  }
  if (typeof v4.domainAssemblyMs === 'number') {
    domainAssemblyMs.push(v4.domainAssemblyMs);
  }

  const rs = runtime.recallScopeSource ?? v4.recallScopeSource;
  if (rs) recallSources[rs] = (recallSources[rs] || 0) + 1;
  const dom = v4.utteranceDomain ?? v4.domainVote?.utteranceDomain ?? 'general';
  domainVotes[dom] = (domainVotes[dom] || 0) + 1;

  if (sampleIds.includes(c.id)) {
    samples.push({
      id: c.id,
      scenario: c.scenario,
      ref: ref.slice(0, 80),
      raw_asr: raw.slice(0, 80),
      final_asr: fin.slice(0, 80),
      cer_final: Number(fc.toFixed(4)),
      utteranceDomain: dom,
      contextPriorDomain: runtime.contextPriorDomain ?? null,
      contextPriorApplied: runtime.contextPriorApplied ?? false,
      contextPriorSkippedReason: runtime.contextPriorSkippedReason ?? null,
      contextPriorMultiplierMin: v4.contextPriorMultiplierMin ?? null,
      contextPriorMultiplierMax: v4.contextPriorMultiplierMax ?? null,
      domainAssemblyMs: v4.domainAssemblyMs ?? null,
      recallScopeSource: rs ?? null,
      fw_applied_count: c.fw_applied_count ?? 0,
      pipeline_ms: c.pipeline_ms,
      text_changed: c.text_changed,
    });
  }
}

const evaluated = cases.length;
const out = {
  batch_meta: {
    timestamp: batch.timestamp,
    evaluated,
    wall_clock_sec: batch.summary?.wall_clock_sec,
    stoppedReason: batch.stoppedReason,
  },
  contract: batch.summary,
  quality: {
    avg_cer_raw: Number(avg(rawCers).toFixed(4)),
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    exact_match_final: exactFinal,
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
  },
  perf: {
    pipeline_ms: {
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      max: pipelineMs.length ? Math.max(...pipelineMs) : null,
    },
    asr_warmup_ms: batch.asrWarmup?.elapsedMs ?? null,
    domainAssemblyMs: {
      avg: Number(avg(domainAssemblyMs).toFixed(3)),
      p50: pct(domainAssemblyMs, 50),
      p95: pct(domainAssemblyMs, 95),
      max: domainAssemblyMs.length ? Math.max(...domainAssemblyMs) : null,
    },
  },
  context_prior: {
    contextPriorAppliedRate: evaluated ? contextPriorAppliedCount / evaluated : 0,
    contextPriorAppliedCount,
    contextPriorDomain_dist: contextPriorDomains,
    skippedReasonCounts,
    multiplierMin: multiplierMins.length ? Math.min(...multiplierMins) : null,
    multiplierMax: multiplierMaxs.length ? Math.max(...multiplierMaxs) : null,
    multiplierMinAvg: Number(avg(multiplierMins).toFixed(4)),
    multiplierMaxAvg: Number(avg(multiplierMaxs).toFixed(4)),
    utteranceDomain_dist: domainVotes,
    recallScopeSource_dist: recallSources,
  },
  samples,
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
