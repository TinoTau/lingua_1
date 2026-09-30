import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const traces = [
  'LINGUA_QUERY_EVIDENCE_V1_PILOT200_REMEASURE_TRACE.jsonl',
  'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_TRACE.jsonl',
  'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE_TRACE.jsonl',
];

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
const cohortIds = new Set(cohort.map((c) => c.caseId));
console.log('cohort', cohortIds.size);

async function scan(name) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) {
    console.log(name, 'MISSING');
    return;
  }
  const st = fs.statSync(p);
  console.log('\n===', name, 'MB=', (st.size / 1e6).toFixed(2));
  const found = new Map();
  const conds = {};
  const rl = readline.createInterface({
    input: fs.createReadStream(p, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    n++;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const caseId = o.caseId || o.case_id || o.id;
    const cond = o.condition || o.runCondition || o.profile_condition || 'unknown';
    conds[cond] = (conds[cond] || 0) + 1;
    if (!cohortIds.has(caseId)) continue;
    if (cond !== 'CORRECT_PROFILE' && !String(cond).includes('CORRECT')) continue;
    if (!found.has(caseId)) found.set(caseId, o);
  }
  console.log('lines', n, 'conds', conds, 'cohortFound', found.size);
  const sample = found.get('p2_u001_014') || [...found.values()][0];
  if (!sample) return;
  console.log('sampleCase', sample.caseId || sample.case_id, 'topKeys', Object.keys(sample).slice(0, 30));
  const extra = sample.extra || sample.result?.extra || sample.payload?.extra || null;
  const t =
    sample.dialog200_path_trace ||
    extra?.dialog200_path_trace ||
    sample.path_trace ||
    sample.trace?.dialog200_path_trace;
  console.log('hasPathTrace', !!t, Array.isArray(t) ? 'array' : typeof t);
  if (t) {
    const paths = Array.isArray(t) ? t : t.paths || [];
    console.log('paths', paths.length);
    const p0 = paths[0];
    if (p0) {
      console.log('path0', Object.keys(p0));
      console.log('model2', p0.model2 ? Object.keys(p0.model2) : null);
      const wins = p0.model2?.windows || p0.model2?.path_trace?.windows || [];
      console.log('wins', wins.length, wins[0] ? Object.keys(wins[0]) : null);
      if (wins[0]) {
        console.log('win0.p_retrieval', wins[0].p_retrieval?.status, wins[0].p_retrieval?.reason);
        console.log('win0.window', wins[0].window || wins[0].window_id);
      }
      console.log('model3', p0.model3 ? Object.keys(p0.model3) : null);
      if (p0.model3) {
        console.log(
          'retry_regions',
          (p0.model3.retry_regions || p0.model3.retryRegions || []).length,
          'retry_recall',
          (p0.model3.retry_recall_invocations || []).length
        );
      }
    }
  } else {
    // dump nested key hints
    const walk = (obj, prefix, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 3) return;
      for (const k of Object.keys(obj)) {
        if (/trace|path|model2|retry|evidence|query/i.test(k)) console.log('hint', prefix + k, typeof obj[k]);
        if (typeof obj[k] === 'object' && obj[k] && !Array.isArray(obj[k])) walk(obj[k], prefix + k + '.', depth + 1);
      }
    };
    walk(sample, '', 0);
  }
}

for (const t of traces) await scan(t);
