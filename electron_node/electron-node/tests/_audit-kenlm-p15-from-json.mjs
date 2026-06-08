#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const perf = JSON.parse(fs.readFileSync(path.join(__dirname, 'fw-detector-dialog-200-phase4e-quality-perf.json'), 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
const rawById = {};
for (const lst of [perf.samples?.diffZeroBoundaryPositive, perf.samples?.approvedSpan]) {
  for (const r of lst || []) {
    if (r.raw) rawById[r.id] = r.raw;
  }
}

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
function perSpanLimit(n) {
  return n <= 1 ? 8 : n === 2 ? 4 : 2;
}

const cases = (perf.samples?.approvedSpan || []).filter((c) => (c.approvedSpanCount || 0) > 0);
let totalSpans = 0;
let totalCand = 0;
const byCount = {};
let truncCases = 0;
let preCapSum = 0;
let replayed = 0;
let oracleRefReachable = 0;
let oracleRefInTop16Proxy = 0;
const samples = [];

for (const c of cases) {
  const raw = rawById[c.id];
  const ref = refById[c.id] || '';
  if (!raw) continue;
  const spans = [];
  for (const s of c.spans || []) {
    const i = raw.indexOf(s.text);
    if (i < 0) continue;
    spans.push({ text: s.text, start: i, end: i + s.text.length, cand: s.candidateCount || 0 });
  }
  if (!spans.length) continue;
  replayed += 1;
  totalSpans += spans.length;
  let pre = 1;
  for (const sp of spans) {
    totalCand += sp.cand;
    byCount[sp.cand] = (byCount[sp.cand] || 0) + 1;
    pre *= Math.max(1, sp.cand);
  }
  preCapSum += pre;
  const truncated = pre > 16;
  if (truncated) truncCases += 1;

  const rN = norm(ref);
  const rawN = norm(raw);
  let reachable = false;
  if (rN !== rawN) {
    let ok = true;
    for (const sp of spans) {
      const segR = rN.slice(norm(raw.slice(0, sp.start)).length, norm(raw.slice(0, sp.end)).length);
      if (!segR || segR === norm(sp.text)) {
        const rawSeg = norm(raw.slice(sp.start, sp.end));
        if (rawSeg !== rN.substring(rN.indexOf(rawSeg), rN.indexOf(rawSeg) + rawSeg.length)) {
          ok = false;
        }
      }
    }
    reachable = spans.every((sp) => {
      const a = norm(sp.text);
      const idx = rN.indexOf(a);
      return idx < 0 || rN.includes(a) === false || norm(ref.slice(sp.start, sp.end)) !== a;
    });
    if (spans.length === 1) {
      const sp = spans[0];
      const refSlice = ref.slice(
        Math.max(0, sp.start - 2),
        Math.min(ref.length, sp.end + 2)
      );
      reachable = norm(refSlice) !== norm(sp.text) && cer(ref, raw) > 0.02;
    } else {
      reachable = cer(ref, raw) > 0.02;
    }
  }
  if (reachable) oracleRefReachable += 1;
  if (reachable && !truncated && pre <= 16) oracleRefInTop16Proxy += 1;

  samples.push({
    id: c.id,
    scenario: c.scenario,
    raw,
    ref,
    spans: spans.map((s) => ({ text: s.text, cand: s.cand })),
    preCap: pre,
    truncated,
    rawCer: +cer(ref, raw).toFixed(4),
    refReachableHeuristic: reachable,
  });
}

const out = {
  funnel: perf.funnel,
  metrics: { totalSpans, totalCand, byCount, truncCases, replayed, avgPreCap: replayed ? preCapSum / replayed : 0 },
  oracle: { refReachableHeuristic: oracleRefReachable, refInTop16IfNotTruncated: oracleRefInTop16Proxy },
  samples,
};
const outPath = path.join(__dirname, 'audit-kenlm-p15-from-json.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.metrics, null, 2));
console.log('oracle', out.oracle);
