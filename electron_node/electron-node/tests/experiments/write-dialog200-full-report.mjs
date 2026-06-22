#!/usr/bin/env node
/**
 * Generate Dialog200 full test report markdown from batch JSON.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.resolve(
  process.argv[2] || path.join(__dirname, 'schema-v2-dialog200-full-batch-result.json')
);
const outPath = path.resolve(
  process.argv[3] ||
    path.join(__dirname, 'output', 'schema-v2-dialog200-full-test-report.md')
);

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

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

if (!fs.existsSync(batchPath)) {
  console.error('[dialog200-report] missing batch:', batchPath);
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const manifestPath = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

const cases = batch.cases.filter((c) => !c.skip);
const manifestVersions = {};
let infraFailures = [];

for (const c of cases) {
  const v = c.extra?.lexicon_manifest_version ?? c.lexicon_manifest_version ?? 'unknown';
  manifestVersions[v] = (manifestVersions[v] || 0) + 1;
  if (String(c.error || '').includes('504') || String(c.error || '').includes('HTTP 504')) {
    infraFailures.push(c.id);
  }
}

const rawCers = [];
const finalCers = [];
const pipelineMs = [];
const sceneStats = {};

for (const c of cases) {
  const ref = refById[c.id] || '';
  rawCers.push(cer(ref, c.raw_asr_preview || ''));
  finalCers.push(cer(ref, c.text_asr_preview || ''));
  pipelineMs.push(c.pipeline_ms || 0);
  const scene = c.scenario || 'unknown';
  if (!sceneStats[scene]) {
    sceneStats[scene] = { count: 0, raw: [], final: [], ms: [] };
  }
  sceneStats[scene].count += 1;
  sceneStats[scene].raw.push(cer(ref, c.raw_asr_preview || ''));
  sceneStats[scene].final.push(cer(ref, c.text_asr_preview || ''));
  sceneStats[scene].ms.push(c.pipeline_ms || 0);
}

const v2Rate =
  cases.length > 0
    ? (manifestVersions['lexicon-v3-five-table-v2'] || 0) / cases.length
    : 0;

const lines = [];
lines.push('# FW Repair V4 — Schema V2 Only dialog_200 全量测试报告');
lines.push('');
lines.push('Date: 2026-06-21');
lines.push(`Batch: \`${path.basename(batchPath)}\``);
lines.push(`Stopped: ${batch.stoppedReason ?? 'unknown'}`);
lines.push('');
lines.push('## 1. 执行摘要');
lines.push('');
lines.push('| 指标 | 值 |');
lines.push('|------|-----|');
lines.push(`| Manifest 总句数 | ${batch.totalManifestCases ?? 200} |`);
lines.push(`| 实际评测 | **${batch.summary?.evaluated ?? cases.length}** |`);
lines.push(`| PASS | **${batch.summary?.pass ?? cases.filter((c) => c.pass).length}** |`);
lines.push(`| FAIL | ${batch.summary?.fail ?? cases.filter((c) => !c.pass).length} |`);
lines.push(`| v2 manifest 占比 | **${(v2Rate * 100).toFixed(1)}%** |`);
lines.push(`| lexicon_runtime ok | ${batch.summary?.lexicon_runtime_ok_count ?? cases.filter((c) => c.lexicon_runtime_status === 'ok').length} |`);
lines.push(`| FW applied 句数 | ${batch.summary?.fw_applied_case_count ?? cases.filter((c) => (c.fw_applied_count || 0) > 0).length} |`);
lines.push(`| Wall-clock | ${batch.summary?.wall_clock_sec ?? '?'}s |`);
lines.push('');
lines.push('## 2. CER（归一化字符级）');
lines.push('');
lines.push(`| 指标 | Raw | Final |`);
lines.push(`|------|-----|-------|`);
lines.push(`| 均值 | ${avg(rawCers).toFixed(4)} | ${avg(finalCers).toFixed(4)} |`);
lines.push(`| P50 | ${pct(rawCers, 50).toFixed(4)} | ${pct(finalCers, 50).toFixed(4)} |`);
lines.push(`| P95 | ${pct(rawCers, 95).toFixed(4)} | ${pct(finalCers, 95).toFixed(4)} |`);
lines.push('');
lines.push('## 3. 性能');
lines.push('');
lines.push(`| Pipeline P50 | ${pct(pipelineMs, 50).toFixed(0)} ms |`);
lines.push(`| Pipeline P95 | ${pct(pipelineMs, 95).toFixed(0)} ms |`);
lines.push(`| Pipeline 均值 | ${avg(pipelineMs).toFixed(0)} ms |`);
lines.push('');
lines.push('## 4. manifestVersion 分布');
lines.push('');
for (const [k, v] of Object.entries(manifestVersions).sort()) {
  lines.push(`- \`${k}\`: ${v}`);
}
lines.push('');
lines.push('## 5. 分场景 CER（final）');
lines.push('');
lines.push('| 场景 | 条数 | Raw CER | Final CER | Pipeline 均值(ms) |');
lines.push('|------|------|---------|-----------|-------------------|');
for (const [scene, st] of Object.entries(sceneStats).sort()) {
  lines.push(
    `| ${scene} | ${st.count} | ${avg(st.raw).toFixed(4)} | ${avg(st.final).toFixed(4)} | ${avg(st.ms).toFixed(0)} |`
  );
}
lines.push('');
lines.push('## 6. 失败与基础设施');
lines.push('');
const failures = cases.filter((c) => !c.pass);
if (failures.length === 0) {
  lines.push('无合约 FAIL。');
} else {
  for (const f of failures.slice(0, 20)) {
    lines.push(`- **${f.id}**: ${(f.contract_failures || [f.error]).join('; ')}`);
  }
}
if (infraFailures.length) {
  lines.push('');
  lines.push('**Infrastructure (ASR 504):**');
  for (const id of infraFailures) lines.push(`- ${id}`);
}
lines.push('');
lines.push('## 7. 结论');
lines.push('');
if ((batch.summary?.evaluated ?? 0) >= 200 && failures.length === 0 && v2Rate === 1) {
  lines.push('**200/200 合约 PASS，100% v2 manifest — 满足 Final Freeze dialog_200 验收。**');
} else if (batch.stoppedReason === 'deadline') {
  lines.push(`**未完成全量（deadline 停止于 ${batch.summary?.evaluated ?? cases.length}/200）。** 需续跑。`);
} else {
  lines.push('见上表；需人工复核 FAIL 项。');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log('[dialog200-report] wrote', outPath);
