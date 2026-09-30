/**
 * Read-only Model3 zero-RETRY audit probes. No production changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
const docs = path.join(root, 'docs', 'user_correction', 'model3');
const casesPath = path.join(docs, 'model3_v1_feature_contract_dialog200_anchored.jsonl');
const auditCsv = path.join(docs, 'model3_v1_retry_region_case_audit.csv');
const outInv = path.join(docs, 'model3_real_retry_target_inventory.csv');
const outSummary = path.join(docs, '_probe_model3_zero_retry.json');

function norm(s) {
  return String(s || '').replace(/[\s，。？！、,.!?;；：:"'\-]/g, '');
}
function cjkOnly(s) {
  return (String(s).match(/[\u4e00-\u9fff]/g) || []).join('');
}
function cjkLen(s) {
  return cjkOnly(s).length || String(s || '').length;
}
function levenshtein(a, b) {
  a = norm(a);
  b = norm(b);
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
    }
  }
  return dp[m][n];
}
function pct(arr, p) {
  if (!arr.length) return null;
  const i = Math.min(arr.length - 1, Math.floor((p / 100) * (arr.length - 1)));
  return arr[i];
}
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

const rows = fs
  .readFileSync(casesPath, 'utf8')
  .trim()
  .split(/\n/)
  .map((l) => JSON.parse(l));

const auditRows = fs.existsSync(auditCsv) ? parseCsv(fs.readFileSync(auditCsv, 'utf8')) : [];
const auditById = new Map();
for (const a of auditRows) {
  if (!auditById.has(a.caseId)) auditById.set(a.caseId, []);
  auditById.get(a.caseId).push(a);
}

const inventory = [];
const margins = [];
const lenHist = { '1': 0, '2': 0, '3': 0, '4': 0, '5plus': 0 };
let mismatch = 0;
let exact = 0;
let keepStrong = 0;
let keepNear = 0;
let positiveMargin = 0;
let nearZero = 0;

const classCounts = {
  NO_ERROR: 0,
  ERROR_ALREADY_COVERED_BY_ANCHOR: 0,
  ERROR_INSIDE_NON_ANCHOR_FINESPAN: 0,
  ERROR_REQUIRES_LOCAL_RESEGMENTATION: 0,
  ERROR_OUTSIDE_MODEL3_SCOPE: 0,
  DELETION_NO_REPAIRABLE_TARGET: 0,
  LEXICON_ONLY_LIMITATION: 0,
  TONE_ONLY_LIMITATION: 0,
  REFERENCE_AMBIGUOUS: 0,
  UNKNOWN: 0,
};

let realRetryEligibleCases = 0;
let realRetryEligibleSpans = 0;
let errorSpansTotal = 0;
let errorSpansInsideAnchor = 0;
let errorSpansNonAnchor = 0;
let errorSpansNoFineSpan = 0;

const eligibleLenHist = { '1': 0, '2': 0, '3': 0, '4': 0, '5plus': 0 };

for (const r of rows) {
  const d = levenshtein(r.raw_asr, r.expected);
  const changed = norm(r.raw_asr) !== norm(r.expected);
  if (changed) mismatch++;
  else exact++;

  const audits = auditById.get(r.id) || [];
  const families = [...new Set(audits.map((a) => a.family).filter(Boolean))];
  const modes = [...new Set(audits.map((a) => a.failure_mode_under_current_retry).filter(Boolean))];

  for (const s of r.span_margins || []) {
    if (s.isAnchor) continue;
    const m = Number(s.margin);
    if (Number.isFinite(m)) {
      margins.push(m);
      if (m > 0) positiveMargin++;
      if (Math.abs(m) < 1) nearZero++;
      if (m < -5) keepStrong++;
      else keepNear++;
    }
    const L = cjkLen(s.surface || '');
    if (L <= 1) lenHist['1']++;
    else if (L === 2) lenHist['2']++;
    else if (L === 3) lenHist['3']++;
    else if (L === 4) lenHist['4']++;
    else lenHist['5plus']++;
  }

  let cls = 'UNKNOWN';
  let conf = 'LOW';
  let eligibleSpans = 0;

  if (!changed) {
    cls = 'NO_ERROR';
    conf = 'HIGH';
  } else if (modes.includes('NO_REPAIRABLE_TARGET') || families.includes('DELETION')) {
    cls = 'DELETION_NO_REPAIRABLE_TARGET';
    conf = 'HIGH';
    errorSpansNoFineSpan += 1;
    errorSpansTotal += 1;
  } else if (modes.includes('SEGMENTATION_LOCKED') || families.includes('MULTI_CHAR_REPLACEMENT')) {
    cls = 'ERROR_REQUIRES_LOCAL_RESEGMENTATION';
    conf = 'HIGH';
    eligibleSpans = Math.max(1, audits.filter((a) => a.family === 'MULTI_CHAR_REPLACEMENT').length);
    realRetryEligibleCases += 1;
    realRetryEligibleSpans += eligibleSpans;
    errorSpansNonAnchor += eligibleSpans;
    errorSpansTotal += eligibleSpans;
    for (const a of audits.filter((x) => x.family === 'MULTI_CHAR_REPLACEMENT')) {
      const L = Number(a.retry_target_len || a.proxy_len || cjkLen(a.proxy_surface || ''));
      if (L <= 1) eligibleLenHist['1']++;
      else if (L === 2) eligibleLenHist['2']++;
      else if (L === 3) eligibleLenHist['3']++;
      else if (L === 4) eligibleLenHist['4']++;
      else eligibleLenHist['5plus']++;
    }
  } else if (families.includes('PHONETIC_SUBSTITUTION') || modes.includes('SUFFICIENT')) {
    cls = 'ERROR_INSIDE_NON_ANCHOR_FINESPAN';
    conf = 'HIGH';
    eligibleSpans = Math.max(1, audits.filter((a) => a.family === 'PHONETIC_SUBSTITUTION').length);
    realRetryEligibleCases += 1;
    realRetryEligibleSpans += eligibleSpans;
    errorSpansNonAnchor += eligibleSpans;
    errorSpansTotal += eligibleSpans;
    eligibleLenHist['1'] += eligibleSpans;
  } else if (families.includes('INSERTION') || modes.includes('PARTIALLY_SUFFICIENT')) {
    cls = 'ERROR_INSIDE_NON_ANCHOR_FINESPAN';
    conf = 'MEDIUM';
    eligibleSpans = 1;
    realRetryEligibleCases += 1;
    realRetryEligibleSpans += 1;
    errorSpansNonAnchor += 1;
    errorSpansTotal += 1;
    eligibleLenHist['1'] += 1;
  } else if (changed) {
    cls = 'UNKNOWN';
    conf = 'LOW';
    errorSpansTotal += 1;
  }

  classCounts[cls] = (classCounts[cls] || 0) + 1;

  let probeMargin = '';
  let probeSurface = '';
  let probeDecision = 'KEEP';
  for (const a of audits) {
    const surf = a.retry_target_surface || a.proxy_surface;
    if (!surf) continue;
    const ch = cjkOnly(surf).slice(0, 1);
    const hit = (r.span_margins || []).find((s) => s.surface === ch || s.surface === surf);
    if (hit) {
      probeSurface = hit.surface;
      probeMargin = hit.margin;
      probeDecision = hit.decision || 'KEEP';
      break;
    }
  }

  inventory.push({
    caseId: r.id,
    dist: d,
    mismatch: changed ? 1 : 0,
    final_class: r.final_class,
    audit_class: cls,
    confidence: conf,
    families: families.join('|'),
    failure_modes: modes.join('|'),
    decisions_retry: r.decisions_retry || 0,
    decisions_keep: r.decisions_keep || 0,
    non_anchor_spans: r.non_anchor_spans || 0,
    model2_anchors: r.model2_anchor_count || 0,
    eligible_span_estimate: eligibleSpans,
    probe_surface: probeSurface,
    probe_margin: probeMargin,
    probe_decision: probeDecision,
    raw: norm(r.raw_asr).slice(0, 48),
    expected: norm(r.expected).slice(0, 48),
  });
}

margins.sort((a, b) => a - b);

const summary = {
  cases: rows.length,
  exactMatch: exact,
  mismatch,
  classCounts,
  realRetryEligibleCases,
  realRetryEligibleSpans,
  errorSpansTotal,
  errorSpansInsideAnchor,
  errorSpansNonAnchor,
  errorSpansNoFineSpan,
  anchorExclusionRate: errorSpansTotal > 0 ? errorSpansInsideAnchor / errorSpansTotal : null,
  margin: {
    count: margins.length,
    min: margins[0] ?? null,
    p50: pct(margins, 50),
    p95: pct(margins, 95),
    max: margins[margins.length - 1] ?? null,
    positiveFavorRetry: positiveMargin,
    absLt1: nearZero,
    keepStrongLtNeg5: keepStrong,
    keepNear: keepNear,
  },
  runtimeNonAnchorLenHist: lenHist,
  retryEligibleTargetLenHist: eligibleLenHist,
  decisionsRetryTotal: rows.reduce((s, r) => s + (r.decisions_retry || 0), 0),
};

const headers = Object.keys(inventory[0] || {});
const csv = [headers.join(',')].concat(
  inventory.map((row) =>
    headers
      .map((h) => {
        const v = String(row[h] ?? '');
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      })
      .join(',')
  )
);
fs.writeFileSync(outInv, csv.join('\n') + '\n', 'utf8');
fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log('wrote', outInv);
