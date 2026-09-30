import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '../../../docs/user_correction/model3');
const lines = fs.readFileSync(path.join(DOCS, 'model3_v2_retry_recall_query_trace.jsonl'), 'utf8').trim().split('\n');
const rows = ['caseId,baseline_final,s3_final,kenlm_fp_match,text_unchanged'];
let ok = 0;
for (const l of lines) {
  const r = JSON.parse(l);
  const tm = (r.baseline_final || '') === (r.s3_final || '');
  const fm = (r.baseline_kenlm_fp || '') === (r.s3_kenlm_fp || '');
  if (tm && fm) ok += 1;
  rows.push(`${r.caseId},${tm && fm ? 'PASS' : 'FAIL'},${tm ? 'YES' : 'NO'},${fm ? 'YES' : 'NO'}`);
}
fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_recall_trace_non_interference.csv'), rows.join('\n'));
console.log(JSON.stringify({ cases: lines.length, causalParityPass: ok }));
