#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batch = JSON.parse(fs.readFileSync(path.join(__dirname, '../schema-v2-dialog200-batch-result.json'), 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  const m = r.length;
  const n = h.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        r[i - 1] === h[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n] / r.length;
}

const cases = batch.cases.filter((c) => !c.skip);
const rows = cases.map((c) => {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_preview || c.extra?.raw_asr_text || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
  return {
    id: c.id,
    scenario: c.scenario,
    ref,
    raw,
    final: fin,
    raw_cer: cer(ref, raw),
    final_cer: cer(ref, fin),
    applied: c.fw_applied_count || 0,
    pipeline_ms: c.pipeline_ms,
    fw_step_ms: c.extra?.fw_detector_step_ms,
    assembly_ms: c.extra?.fw_detector?.spanAssemblyV4?.assemblyMs,
    ngram_queries: c.extra?.fw_detector?.spanAssemblyV4?.ngramQueryCount,
    lexicon: c.extra?.lexicon_manifest_version,
  };
});

const byScenario = {};
for (const r of rows) {
  const s = r.scenario || 'unknown';
  if (!byScenario[s]) byScenario[s] = { count: 0, raw: [], final: [], pipeline: [] };
  byScenario[s].count += 1;
  byScenario[s].raw.push(r.raw_cer);
  byScenario[s].final.push(r.final_cer);
  byScenario[s].pipeline.push(r.pipeline_ms || 0);
}

const scenarioStats = Object.fromEntries(
  Object.entries(byScenario).map(([k, v]) => [
    k,
    {
      count: v.count,
      raw_cer_avg: +(v.raw.reduce((a, b) => a + b, 0) / v.count).toFixed(4),
      final_cer_avg: +(v.final.reduce((a, b) => a + b, 0) / v.count).toFixed(4),
      pipeline_ms_avg: Math.round(v.pipeline.reduce((a, b) => a + b, 0) / v.count),
    },
  ])
);

const out = {
  evaluated: rows.length,
  manifest_v2_rate: rows.filter((r) => r.lexicon === 'lexicon-v3-five-table-v2').length / rows.length,
  applied_count: rows.filter((r) => r.applied > 0).length,
  improved: rows.filter((r) => r.final_cer < r.raw_cer - 1e-9).length,
  degraded: rows.filter((r) => r.final_cer > r.raw_cer + 1e-9).length,
  scenarioStats,
  best_final: [...rows].sort((a, b) => a.final_cer - b.final_cer).slice(0, 5),
  fw_improved: [...rows]
    .filter((r) => r.applied > 0 && r.final_cer < r.raw_cer - 1e-9)
    .sort((a, b) => b.raw_cer - b.final_cer - (a.raw_cer - a.final_cer))
    .slice(0, 5),
  applied_samples: rows.filter((r) => r.applied > 0).slice(0, 6),
  worst_final: [...rows].sort((a, b) => b.final_cer - a.final_cer).slice(0, 5),
};

const outPath = path.join(__dirname, 'schema-v2-dialog200-summary.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
