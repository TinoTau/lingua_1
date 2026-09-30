/**
 * Bootstrap: list 43 CORRECT_PROFILE QEV7 residuals and E5 coverage.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');

function parseCsv(text) {
  const rows = [];
  let i = 0,
    cur = '',
    row = [],
    q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        q = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      q = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const h = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(h.map((k, idx) => [k, r[idx] ?? ''])));
}

const qev7 = parseCsv(fs.readFileSync(path.join(OUT, 'LINGUA_QEV7_CASE_ATTRIBUTION.csv'), 'utf8'));
const cohort = qev7.filter(
  (r) =>
    r.condition === 'CORRECT_PROFILE' &&
    (r.firstOwner === 'A1_QUERY_NOT_TARGET_REACHABLE' ||
      r.firstOwner === 'A2_TARGET_GEOMETRY_NOT_COMPATIBLE')
);
console.log('cohort', cohort.length);
const e5 = JSON.parse(fs.readFileSync(path.join(OUT, 'LINGUA_E5_EXACT_QUERY_ATTRIBUTION_35.json'), 'utf8'));
const e5ids = new Set(e5.cases.map((c) => c.caseId));
const inE5 = cohort.filter((c) => e5ids.has(c.caseId));
const notE5 = cohort.filter((c) => !e5ids.has(c.caseId));
console.log('inE5', inE5.length, inE5.map((c) => c.caseId).join(','));
console.log('notE5', notE5.length, notE5.map((c) => c.caseId).join(','));

// Inspect one E5 case reachable queries vs target
const sample = e5.cases.find((c) => c.caseId === inE5[0]?.caseId);
if (sample) {
  const exact = (sample.reachableQueries || []).filter((q) => q.transformedPinyinKey === sample.targetPinyin);
  const contain = (sample.reachableQueries || []).filter((q) => {
    const p = q.transformedPinyinKey.split('|');
    const t = sample.targetPinyin.split('|');
    for (let i = 0; i <= p.length - t.length; i++) if (p.slice(i, i + t.length).join('|') === sample.targetPinyin) return true;
    return false;
  });
  console.log('sample', sample.caseId, sample.targetPinyin, 'rq', sample.reachableQueries?.length, 'exact', exact.length, 'contain', contain.length);
  if (exact[0]) console.log('exact geom', exact[0].sylStart, exact[0].sylEnd, exact[0].rawStart, exact[0].rawEnd);
  if (contain[0] && !exact[0]) console.log('contain geom', contain[0].sylStart, contain[0].sylEnd, contain[0].transformedPinyinKey);
}
