#!/usr/bin/env node
/**
 * Phase 3 Only audit — quality + perf analysis with P50/P95/P99.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(__dirname, 'lexicon-v2-phase3-hotfix-audit-batch-result.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function loadJson(name) {
  const p = path.join(__dirname, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const phase2 = loadJson('lexicon-v2-phase2-dialog200-quality-perf.json');
const preHotfix = loadJson('lexicon-v2-phase3-only-audit-quality-perf.json');

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
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function stats(arr) {
  if (!arr.length) {
    return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }
  return {
    count: arr.length,
    avg: Math.round(avg(arr)),
    p50: pct(arr, 50),
    p95: pct(arr, 95),
    p99: pct(arr, 99),
    min: Math.min(...arr),
    max: Math.max(...arr),
  };
}

const evaluated = report.cases.filter((c) => !c.skip && !c.error);
const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_text || '').trim();
  const fin = (c.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = evaluated.map((c) => c.fw_detector_step_ms).filter((n) => typeof n === 'number');
const kenlmMs = evaluated.map((c) => c.kenlm_ms).filter((n) => typeof n === 'number');
const gateMs = evaluated.map((c) => c.kenlm_span_gate_ms).filter((n) => typeof n === 'number');
const gateQueryCounts = evaluated
  .map((c) => c.kenlm_span_gate_query_count)
  .filter((n) => typeof n === 'number');
const spanCounts = evaluated.map((c) => c.span_count).filter((n) => typeof n === 'number');

const v2RecallMs = [];
const domainLookupMs = [];
const idiomLookupMs = [];
const mergeMs = [];
const sqlQueries = [];
const cacheHits = [];
const cacheMisses = [];
let routingLookupTotal = 0;
let spanRecallCount = 0;
const mergeAfterCounts = [];
const sentToKenlm = [];
const kenlmQueryCounts = [];
let mergeCapViolations = 0;

for (const c of evaluated) {
  const d = c.recall_v2_diagnostics;
  if (typeof c.kenlm_query_count === 'number') {
    kenlmQueryCounts.push(c.kenlm_query_count);
  }
  if (!d) continue;
  routingLookupTotal += d.industry_routing_lookup_count || 0;
  sqlQueries.push(d.v2_sql_query_count || 0);
  cacheHits.push(d.v2_cache_hits || 0);
  cacheMisses.push(d.v2_cache_misses || 0);
  for (const s of d.spans || []) {
    spanRecallCount += 1;
    if ((s.candidate_count_after_merge ?? 0) > 5) {
      mergeCapViolations += 1;
    }
    mergeAfterCounts.push(s.candidate_count_after_merge ?? 0);
    sentToKenlm.push(s.sent_to_kenlm ?? 0);
    v2RecallMs.push(s.v2_recall_ms || 0);
    domainLookupMs.push(s.domain_lookup_ms || 0);
    idiomLookupMs.push(s.idiom_lookup_ms || 0);
    mergeMs.push(s.merge_ms || 0);
  }
}

const cacheTotal = cacheHits.reduce((a, b) => a + b, 0) + cacheMisses.reduce((a, b) => a + b, 0);
const cacheHitRate = cacheTotal > 0 ? cacheHits.reduce((a, b) => a + b, 0) / cacheTotal : null;

const out = {
  config: report.config,
  contract: report.summary,
  recall_chain: {
    path: 'base_lexicon + domain_lexicon + idiom_lexicon → merge (cap 5) → KenLM weak_veto → pick',
    industry_routing_in_recall: false,
    industry_routing_lookup_count: routingLookupTotal,
    domain_resolver_used: routingLookupTotal > 0,
  },
  recall_tier: {
    span_recall_invocations: spanRecallCount,
    span_count_per_job: stats(spanCounts),
    merge_after_merge: stats(mergeAfterCounts),
    sent_to_kenlm: stats(sentToKenlm),
    merge_cap_violations: mergeCapViolations,
    kenlm_query_count: stats(kenlmQueryCounts),
  },
  quality: {
    avg_cer_raw: Number(avg(rawCers).toFixed(4)),
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    median_cer_raw: Number(pct(rawCers, 50).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    p95_cer_raw: Number(pct(rawCers, 95).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
  },
  perf: {
    pipeline_total_ms: stats(pipelineMs),
    fw_detector_total_ms: stats(fwStepMs),
    kenlm_veto_ms: stats(kenlmMs),
    kenlm_span_gate_ms: stats(gateMs),
    kenlm_span_gate_query_count: stats(gateQueryCounts),
    kenlm_ms: stats(kenlmMs),
    v2_recall_ms: stats(v2RecallMs),
    domain_lookup_ms: stats(domainLookupMs),
    idiom_lookup_ms: stats(idiomLookupMs),
    merge_ms: stats(mergeMs),
    batch_elapsed_sec: report.batch_elapsed_sec,
    avg_wall_sec_per_case: report.summary.avg_wall_sec_per_case,
  },
  v2_sql: {
    per_job_queries: stats(sqlQueries),
    span_recall_invocations: spanRecallCount,
    cache_hit_rate: cacheHitRate != null ? Number(cacheHitRate.toFixed(4)) : null,
    cache_hits_total: cacheHits.reduce((a, b) => a + b, 0),
    cache_misses_total: cacheMisses.reduce((a, b) => a + b, 0),
  },
  comparison: {
    phase2: phase2
      ? {
          avg_wall_sec_per_case: Number((1074 / 200).toFixed(2)),
          pipeline_ms_p95: phase2.perf?.pipeline_ms?.p95,
          fw_degraded: phase2.quality?.fw_degraded_cases,
          avg_cer_final: phase2.quality?.avg_cer_final,
        }
      : null,
    phase3_pre_hotfix: preHotfix
      ? {
          avg_wall_sec_per_case: preHotfix.perf?.avg_wall_sec_per_case,
          pipeline_ms_p95: preHotfix.perf?.pipeline_total_ms?.p95,
          fw_applied_total: preHotfix.contract?.fw_applied_total,
          avg_cer_final: preHotfix.quality?.avg_cer_final,
          fw_degraded: preHotfix.quality?.fw_degraded_cases,
          kenlm_ms_avg: preHotfix.perf?.kenlm_ms?.avg,
        }
      : null,
    phase3_plus4_partial: null,
    phase3_only: {
      completed: evaluated.length,
      avg_wall_sec_per_case: report.summary.avg_wall_sec_per_case,
      pipeline_ms_p95: stats(pipelineMs).p95,
      v2_recall_ms_p95: stats(v2RecallMs).p95,
    },
    recall_p95_vs_phase2_delta:
      phase2?.perf?.pipeline_ms?.p95 != null
        ? stats(pipelineMs).p95 - phase2.perf.pipeline_ms.p95
        : null,
  },
  bottleneck_notes: [],
};

if (out.comparison.recall_p95_vs_phase2_delta != null) {
  const threshold = (phase2?.perf?.pipeline_ms?.p95 ?? 0) * 0.1;
  out.recall_p95_within_phase2_plus_10pct =
    out.comparison.recall_p95_vs_phase2_delta <= threshold;
}

if (report.summary.avg_wall_sec_per_case <= 6) {
  out.bottleneck_notes.push('Phase 3 Only 墙钟接近 Phase 2，性能问题更可能来自 Phase 4 Industry Routing。');
} else if (report.summary.avg_wall_sec_per_case >= 10) {
  out.bottleneck_notes.push('Phase 3 Only 仍显著慢于 Phase 2，优先排查 V2 SQL/缓存/候选合并规模。');
}
if (routingLookupTotal === 0) {
  out.bottleneck_notes.push('industry-routing-domain-resolver 未参与本轮 Recall（符合 Phase 3 Only）。');
}
if (cacheHitRate != null && cacheHitRate < 0.5 && spanRecallCount > 0) {
  out.bottleneck_notes.push(`V2 LRU cache 命中率偏低 (${(cacheHitRate * 100).toFixed(1)}%)。`);
}

const outPath = path.join(__dirname, 'lexicon-v2-phase3-hotfix-audit-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
