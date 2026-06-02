#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const reportPath =
  process.argv[2] || path.join(__dirname, 'fw-detector-dialog-200-batch-result.json');
const outPath =
  process.argv[3] ||
  path.join(__dirname, '../../docs/Lexicon_V3_1_dialog200_测试抽样_2026_06_02.md');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
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

const rows = report.cases
  .filter((c) => !c.skip && !c.error)
  .map((c) => {
    const ref = refById[c.id]?.utterance || '';
    const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
    const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
    return {
      id: c.id,
      scenario: c.scenario || refById[c.id]?.scenario,
      pass: c.pass,
      pipeline_ms: c.pipeline_ms,
      lexicon_runtime_status: c.lexicon_runtime_status,
      fw_applied_count: c.fw_applied_count || 0,
      text_changed: c.text_changed,
      reference: ref,
      raw,
      final: fin,
      cer_raw: +(cer(ref, raw) * 100).toFixed(2),
      cer_final: +(cer(ref, fin) * 100).toFixed(2),
    };
  });

const applied = rows.filter((r) => r.fw_applied_count > 0);
const improved = rows.filter((r) => r.cer_final < r.cer_raw - 0.01);
const worst = [...rows].sort((a, b) => b.cer_final - a.cer_final).slice(0, 8);
const best = [...rows].sort((a, b) => a.cer_final - b.cer_final).slice(0, 5);

function block(title, list) {
  let s = `## ${title}\n\n`;
  for (const r of list) {
    s += `### ${r.id} (${r.scenario})\n\n`;
    s += `- 契约: ${r.pass ? 'PASS' : 'FAIL'} | pipeline: ${r.pipeline_ms}ms | lexicon: ${r.lexicon_runtime_status}\n`;
    s += `- CER raw→final: ${r.cer_raw}% → ${r.cer_final}% | FW applied: ${r.fw_applied_count}\n`;
    s += `- 参考: ${r.reference.slice(0, 80)}${r.reference.length > 80 ? '…' : ''}\n`;
    s += `- Raw: ${r.raw.slice(0, 80)}${r.raw.length > 80 ? '…' : ''}\n`;
    s += `- Final: ${r.final.slice(0, 80)}${r.final.length > 80 ? '…' : ''}\n\n`;
  }
  return s;
}

const md =
  `# Lexicon V3.1 dialog_200 测试抽样\n\n` +
  `> 生成时间: ${new Date().toISOString()}\n` +
  `> 批测条数: ${rows.length} | 停止原因: ${report.stoppedReason || 'n/a'}\n\n` +
  block('FW 已应用', applied.length ? applied : [{ id: '(无)', scenario: '-', pass: true, pipeline_ms: 0, lexicon_runtime_status: 'ok', fw_applied_count: 0, text_changed: false, reference: '', raw: '', final: '', cer_raw: 0, cer_final: 0 }]) +
  block('CER 改善（final < raw）', improved.length ? improved.slice(0, 6) : [{ id: '(无)', scenario: '-', pass: true, pipeline_ms: 0, lexicon_runtime_status: 'ok', fw_applied_count: 0, text_changed: false, reference: '', raw: '', final: '', cer_raw: 0, cer_final: 0 }]) +
  block('CER 最差 Top', worst) +
  block('CER 最佳 Top', best);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf8');
console.log('Wrote', outPath);
