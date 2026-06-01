#!/usr/bin/env node
/**
 * Build a readable sample from lexicon-v2-p4-batch-result.json (quality + perf).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const report = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'lexicon-v2-p4-batch-result.json'), 'utf8')
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c]));

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

const rows = report.cases
  .filter((c) => !c.skip && !c.error)
  .map((c) => {
    const ref = refById[c.id]?.utterance || '';
    const raw = (c.raw_asr_text || '').trim();
    const fin = (c.text_asr || '').trim();
    const cerRaw = cer(ref, raw) * 100;
    const cerFinal = cer(ref, fin) * 100;
    return {
      ...c,
      reference: ref,
      scenario: refById[c.id]?.scenario,
      cer_raw_pct: +cerRaw.toFixed(2),
      cer_final_pct: +cerFinal.toFixed(2),
      cer_delta_pct: +(cerFinal - cerRaw).toFixed(2),
    };
  });

function slim(c) {
  return {
    id: c.id,
    scenario: c.scenario,
    reference: c.reference,
    raw_asr_text: c.raw_asr_text,
    text_asr: c.text_asr,
    cer_raw_pct: c.cer_raw_pct,
    cer_final_pct: c.cer_final_pct,
    cer_delta_pct: c.cer_delta_pct,
    fw_applied_count: c.fw_applied_count || 0,
    span_count: c.span_count || 0,
    sentence_rerank: c.sentence_rerank
      ? {
          pickedIsRaw: c.sentence_rerank.pickedIsRaw,
          maxDelta: c.sentence_rerank.maxDelta,
          kenlmQueryCount: c.sentence_rerank.kenlmQueryCount,
        }
      : null,
    pipeline_ms: c.pipeline_ms,
    fw_detector_step_ms: c.fw_detector_step_ms,
    kenlm_veto_ms: c.kenlm_veto_ms,
    fw_metadata_gate_ms: c.fw_metadata_gate_ms,
    pass: c.pass,
  };
}

const byCerDesc = [...rows].sort((a, b) => b.cer_final_pct - a.cer_final_pct);
const byCerAsc = [...rows].sort((a, b) => a.cer_final_pct - b.cer_final_pct);
const byPipelineDesc = [...rows].sort((a, b) => (b.pipeline_ms || 0) - (a.pipeline_ms || 0));
const byPipelineAsc = [...rows].sort((a, b) => (a.pipeline_ms || 0) - (b.pipeline_ms || 0));
const medianRow = byPipelineAsc[Math.floor(byPipelineAsc.length / 2)];

const pickIds = new Set([
  'd043', // only FW apply
  'd001',
  'd004',
  'd067', // pipeline outlier
  'd119', // 2 spans
  'd188',
  'd200',
  'd033', // fast + no span
  'd159',
  byCerDesc[0].id,
  byCerAsc[0].id,
  medianRow.id,
]);

const sampleCases = [...pickIds]
  .map((id) => rows.find((r) => r.id === id))
  .filter(Boolean)
  .map(slim);

const pipelineMs = rows.map((r) => r.pipeline_ms).filter((n) => typeof n === 'number');

const jsonOut = {
  generated_at: new Date().toISOString(),
  source: 'tests/lexicon-v2-p4-batch-result.json',
  batch_summary: report.summary,
  aggregate_quality: {
    evaluated_count: rows.length,
    avg_cer_raw_pct: +(rows.reduce((s, r) => s + r.cer_raw_pct, 0) / rows.length).toFixed(2),
    avg_cer_final_pct: +(rows.reduce((s, r) => s + r.cer_final_pct, 0) / rows.length).toFixed(2),
    median_cer_final_pct: +pct(
      rows.map((r) => r.cer_final_pct),
      50
    ).toFixed(2),
    improved_count: rows.filter((r) => r.cer_final_pct < r.cer_raw_pct - 1e-9).length,
    degraded_count: rows.filter((r) => r.cer_final_pct > r.cer_raw_pct + 1e-9).length,
    fw_apply_count: rows.filter((r) => (r.fw_applied_count || 0) > 0).length,
  },
  aggregate_perf: {
    pipeline_ms: {
      min: Math.min(...pipelineMs),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      max: Math.max(...pipelineMs),
      avg: Math.round(rows.reduce((s, r) => s + (r.pipeline_ms || 0), 0) / rows.length),
    },
    fw_detector_step_ms_p95: pct(
      rows.map((r) => r.fw_detector_step_ms).filter((n) => typeof n === 'number'),
      95
    ),
    batch_elapsed_sec: report.batch_elapsed_sec,
    avg_wall_sec_per_case: report.summary?.avg_wall_sec_per_case,
  },
  sample_selection: [
    'd043: 唯一 FW apply',
    '最高/最低 CER 各 1 条',
    'P50 pipeline 耗时代表',
    'd067: pipeline 最慢 outlier',
    'd119: 双 span + rerank',
    '多场景 cafe/meeting/lexicon_homophone 代表',
  ],
  sample_cases: sampleCases,
};

const jsonPath = path.join(__dirname, 'lexicon-v2-p4-batch-sample.json');
fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2), 'utf8');

const mdLines = [
  '# dialog_200 批测结果抽样（PostCleanup）',
  '',
  `生成时间：${jsonOut.generated_at}`,
  '',
  '## 全量聚合',
  '',
  '| 指标 | 值 |',
  '|------|-----|',
  `| 评测条数 | ${jsonOut.aggregate_quality.evaluated_count} |`,
  `| 平均 CER (raw → final) | ${jsonOut.aggregate_quality.avg_cer_raw_pct}% → ${jsonOut.aggregate_quality.avg_cer_final_pct}% |`,
  `| 中位 CER (final) | ${jsonOut.aggregate_quality.median_cer_final_pct}% |`,
  `| improved / degraded | ${jsonOut.aggregate_quality.improved_count} / ${jsonOut.aggregate_quality.degraded_count} |`,
  `| FW apply | ${jsonOut.aggregate_quality.fw_apply_count} |`,
  `| pipeline P50 / P95 | ${jsonOut.aggregate_perf.pipeline_ms.p50} / ${jsonOut.aggregate_perf.pipeline_ms.p95} ms |`,
  `| pipeline avg / max | ${jsonOut.aggregate_perf.pipeline_ms.avg} / ${jsonOut.aggregate_perf.pipeline_ms.max} ms |`,
  `| FW 步 P95 | ${jsonOut.aggregate_perf.fw_detector_step_ms_p95} ms |`,
  `| 批测墙钟 | ${jsonOut.aggregate_perf.batch_elapsed_sec} s（${jsonOut.aggregate_perf.avg_wall_sec_per_case} s/条） |`,
  '',
  '## 抽样用例（共 ' + sampleCases.length + ' 条）',
  '',
];

for (const c of sampleCases) {
  mdLines.push(`### ${c.id}（${c.scenario}）`);
  mdLines.push('');
  mdLines.push(`- **参考**：${c.reference}`);
  mdLines.push(`- **Raw ASR**：${c.raw_asr_text || '（空）'}`);
  mdLines.push(`- **Final**：${c.text_asr || '（空）'}`);
  mdLines.push(
    `- **CER**：raw ${c.cer_raw_pct}% → final ${c.cer_final_pct}%（Δ ${c.cer_delta_pct}%）`
  );
  mdLines.push(
    `- **FW**：apply=${c.fw_applied_count} spans=${c.span_count}` +
      (c.sentence_rerank
        ? ` rerank pickedRaw=${c.sentence_rerank.pickedIsRaw} maxDelta=${c.sentence_rerank.maxDelta?.toFixed?.(4) ?? c.sentence_rerank.maxDelta}`
        : '')
  );
  mdLines.push(
    `- **性能**：pipeline=${c.pipeline_ms} ms | fw_step=${c.fw_detector_step_ms ?? 0} ms | kenlm=${c.kenlm_veto_ms ?? 0} ms | meta_gate=${c.fw_metadata_gate_ms ?? 0} ms`
  );
  mdLines.push('');
}

const mdPath = path.join(__dirname, '../docs/P1_P4_PostCleanup_测试抽样_dialog200_2026_06_01.md');
fs.writeFileSync(mdPath, mdLines.join('\n'), 'utf8');

console.log('Wrote', jsonPath);
console.log('Wrote', mdPath);
