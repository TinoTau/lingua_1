#!/usr/bin/env node
/**
 * Lexicon Coverage & Candidate Quality Audit — Gate 3.0 dialog200 batch
 * Read-only analysis; no code changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');

const BATCH = path.resolve(__dirname, '../raw-log-delta-gate3-dialog200-batch-result.json');
const MANIFEST = path.resolve(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json');
const SQLITE = path.resolve(PROJECT_ROOT, 'node_runtime/lexicon/v3/lexicon.sqlite');
const SEED_JSONL = path.resolve(__dirname, '../../data/lexicon/zh_asr_confusions_seed_high_quality.jsonl');
const OUT = path.resolve(__dirname, 'lexicon-coverage-candidate-quality-audit-data.json');

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

function loadLexiconTermSet() {
  const terms = new Set();
  if (fs.existsSync(SQLITE)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(SQLITE, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      for (const table of tables) {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        const termCol = cols.find((c) => /^(term|word|surface|text)$/i.test(c));
        if (!termCol) continue;
        const rows = db.prepare(`SELECT DISTINCT ${termCol} AS t FROM ${table} WHERE ${termCol} IS NOT NULL`).all();
        for (const row of rows) {
          if (row.t && typeof row.t === 'string') terms.add(row.t);
        }
      }
      db.close();
    } catch (e) {
      console.warn('[audit] sqlite load failed:', e.message);
    }
  }
  if (fs.existsSync(SEED_JSONL)) {
    for (const line of fs.readFileSync(SEED_JSONL, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.term) terms.add(o.term);
        if (o.replacement) terms.add(o.replacement);
      } catch (_) {}
    }
  }
  return terms;
}

function inferSource(word, domains) {
  if (domains?.length) return 'domain';
  return 'base';
}

function extractRepairs(raw, fin, ref) {
  const repairs = [];
  const r = raw;
  const f = fin;
  if (r === f) return repairs;
  let i = 0;
  let j = 0;
  while (i < r.length && j < f.length) {
    if (r[i] === f[j]) {
      i += 1;
      j += 1;
      continue;
    }
    let best = null;
    for (let len = 1; len <= 8; len++) {
      const rb = r.slice(i, i + len);
      for (let fl = 1; fl <= 8; fl++) {
        const fb = f.slice(j, j + fl);
        if (rb === fb) continue;
        if (r.slice(i + len, i + len + 2) === f.slice(j + fl, j + fl + 2)) {
          if (!best || rb.length + fb.length > best.before.length + best.after.length) {
            best = { before: rb, after: fb };
          }
        }
      }
    }
    if (best) {
      repairs.push(best);
      i += best.before.length;
      j += best.after.length;
    } else {
      i += 1;
      j += 1;
    }
  }
  return repairs;
}

function collectSpanRepairs(fw) {
  const rows = [];
  for (const span of fw.spans || []) {
    const selected = span.candidates?.find((c) => c.selected);
    if (!selected || selected.word === span.text) continue;
    rows.push({
      spanText: span.text,
      before: span.text,
      after: selected.word,
      source: selected.source,
      domains: selected.domains || [],
      repairTarget: selected.repairTarget,
    });
  }
  for (const repl of fw.replacements || []) {
    if (repl.before === repl.after) continue;
    rows.push({
      spanText: repl.before,
      before: repl.before,
      after: repl.after,
      source: repl.source,
      applied: repl.applied,
    });
  }
  const picked = fw.sentenceRerank?.picked;
  if (picked?.replacements) {
    for (const r of picked.replacements) {
      if (r.word === r.span?.text) continue;
      rows.push({
        spanText: r.span?.text,
        before: r.span?.text,
        after: r.word,
        source: r.source,
        fromSentencePick: true,
      });
    }
  }
  return rows;
}

function classifyNoChange(c, ref, lexiconTerms) {
  const fw = c.extra?.fw_detector || {};
  const sr = fw.sentenceRerank || {};
  const raw = (c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);

  if ((fw.summary?.spanCount ?? fw.spans?.length ?? 0) === 0) return 'D_no_span';
  if ((fw.summary?.candidateCount ?? 0) === 0) return 'E_no_recall';

  const refNorm = norm(ref);
  const rawNorm = norm(raw);
  const missingInLex = [];
  for (let len = 2; len <= 6; len++) {
    for (let i = 0; i + len <= refNorm.length; i++) {
      const seg = ref.slice(i, i + len);
      if (seg.length < 2) continue;
      const segNorm = norm(seg);
      if (!rawNorm.includes(segNorm) && !lexiconTerms.has(seg)) {
        missingInLex.push(seg);
      }
    }
  }

  if (sr.pickedIsRaw === false) return 'C_kenlm_picked_but_no_cer_gain';

  const hasCorrectInCandidates = (fw.spans || []).some((span) =>
    (span.candidates || []).some((cand) => ref.includes(cand.word) && cand.word !== span.text)
  );
  if (hasCorrectInCandidates && sr.pickedIsRaw) return 'C_kenlm_rejected';

  if (missingInLex.length > 0) return 'A_lexicon_missing';

  return 'B_not_in_topk_or_assembly';
}

const SCENARIO_DOMAIN = {
  cafe: 'coffee_tea',
  meeting: 'tech_ai',
  tech_deploy: 'tech_ai',
  taxi: 'transport',
  hospital: 'general',
  shopping: 'general',
  friend_chat: 'general',
  ecommerce: 'general',
  interview: 'general',
  education: 'general',
  hotel: 'travel',
  bank: 'general',
  restaurant: 'restaurant',
  gym: 'general',
};

function scenarioBucket(scenario) {
  return SCENARIO_DOMAIN[scenario] || scenario || 'general';
}

const report = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
const scenarioById = Object.fromEntries(manifest.map((c) => [c.id, c.scenario]));
const lexiconTerms = loadLexiconTermSet();

const improvedCases = [];
const degradedCases = [];
const unchangedCases = [];
const termImprovedCount = new Map();
const termDegradedCount = new Map();
const badCandidateStats = new Map();
const missingRefTerms = new Map();
const noChangeReasons = { A: 0, B: 0, C: 0, D: 0, E: 0, other: 0 };
const domainStats = new Map();

for (const c of report.cases.filter((x) => !x.skip)) {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  const fw = c.extra?.fw_detector || {};
  const sr = fw.sentenceRerank || {};
  const repairs = collectSpanRepairs(fw);
  const bucket = scenarioBucket(c.scenario);

  if (!domainStats.has(bucket)) {
    domainStats.set(bucket, { total: 0, improved: 0, degraded: 0, unchanged: 0 });
  }
  const ds = domainStats.get(bucket);
  ds.total += 1;

  for (const span of fw.spans || []) {
    for (const cand of span.candidates || []) {
      if (cand.word === span.text) continue;
      const key = cand.word;
      if (!badCandidateStats.has(key)) {
        badCandidateStats.set(key, { word: key, topK: 0, top1: 0, picked: 0, apply: 0, inFinal: 0 });
      }
      const st = badCandidateStats.get(key);
      st.topK += 1;
      if (cand.candidateIndex === 0) st.top1 += 1;
      if (cand.selected) st.picked += 1;
      if (fin.includes(cand.word) && !ref.includes(cand.word)) st.inFinal += 1;
    }
  }

  const refChars = [...ref];
  for (const ch of refChars) {
    if (/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/.test(ch)) continue;
  }
  for (let len = 2; len <= 8; len++) {
    for (let i = 0; i + len <= ref.length; i++) {
      const term = ref.slice(i, i + len);
      if (/^[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]+$/.test(term)) continue;
      if (!lexiconTerms.has(term)) {
        missingRefTerms.set(term, (missingRefTerms.get(term) || 0) + 1);
      }
    }
  }

  if (fc < rc - 1e-9) {
    ds.improved += 1;
    const row = {
      id: c.id,
      scenario: c.scenario,
      raw_cer: Number(rc.toFixed(4)),
      final_cer: Number(fc.toFixed(4)),
      raw: raw.slice(0, 100),
      final: fin.slice(0, 100),
      ref: ref.slice(0, 100),
      repairs,
      pickedIsRaw: sr.pickedIsRaw,
      maxDelta: sr.maxDelta,
      fw_applied_count: c.fw_applied_count || 0,
    };
    improvedCases.push(row);
    for (const r of repairs) {
      if (ref.includes(r.after)) {
        const k = r.after;
        termImprovedCount.set(k, (termImprovedCount.get(k) || 0) + 1);
      }
    }
  } else if (fc > rc + 1e-9) {
    ds.degraded += 1;
    let root = 'B_candidate_quality';
    for (const r of repairs) {
      if (!ref.includes(r.after)) {
        if (r.after === '烧饼' || r.after.includes('烧饼')) root = 'A_candidate_quality';
        else if (!lexiconTerms.has(r.after)) root = 'B_lexicon_missing';
      }
    }
    if (fin !== raw && repairs.length === 0) root = 'A_candidate_quality';
    const row = {
      id: c.id,
      scenario: c.scenario,
      raw_cer: Number(rc.toFixed(4)),
      final_cer: Number(fc.toFixed(4)),
      raw: raw.slice(0, 100),
      final: fin.slice(0, 100),
      ref: ref.slice(0, 100),
      repairs,
      rootCause: root,
      pickedIsRaw: sr.pickedIsRaw,
      maxDelta: sr.maxDelta,
      fw_applied_count: c.fw_applied_count || 0,
    };
    degradedCases.push(row);
    for (const r of repairs) {
      termDegradedCount.set(r.after, (termDegradedCount.get(r.after) || 0) + 1);
    }
  } else {
    ds.unchanged += 1;
    const reason = classifyNoChange(c, ref, lexiconTerms);
    if (reason.startsWith('A')) noChangeReasons.A += 1;
    else if (reason.startsWith('B')) noChangeReasons.B += 1;
    else if (reason.startsWith('C')) noChangeReasons.C += 1;
    else if (reason.startsWith('D')) noChangeReasons.D += 1;
    else if (reason.startsWith('E')) noChangeReasons.E += 1;
    else noChangeReasons.other += 1;

    if (rc > 0 && (c.fw_applied_count || 0) === 0) {
      unchangedCases.push({
        id: c.id,
        scenario: c.scenario,
        raw_cer: Number(rc.toFixed(4)),
        reason,
        pickedIsRaw: sr.pickedIsRaw,
        maxDelta: sr.maxDelta,
        spanCount: fw.summary?.spanCount ?? 0,
        candidateCount: fw.summary?.candidateCount ?? 0,
      });
    }
  }
}

const topImprovedTerms = [...termImprovedCount.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .map(([term, count]) => ({ term, count, inLexicon: lexiconTerms.has(term) }));

const topMissing = [...missingRefTerms.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 50)
  .map(([term, refCount]) => ({ term, refCount, inLexicon: lexiconTerms.has(term) }));

const badCandidates = [...badCandidateStats.values()]
  .filter((b) => b.inFinal > 0 || b.picked > 0)
  .sort((a, b) => b.inFinal - a.inFinal || b.picked - a.picked)
  .slice(0, 40);

const domainCoverage = [...domainStats.entries()].map(([domain, s]) => ({
  domain,
  total: s.total,
  improvedRate: s.total ? Number((s.improved / s.total).toFixed(3)) : 0,
  degradedRate: s.total ? Number((s.degraded / s.total).toFixed(3)) : 0,
  improved: s.improved,
  degraded: s.degraded,
}));

const output = {
  timestamp: new Date().toISOString(),
  batchFile: BATCH,
  lexiconTermCount: lexiconTerms.size,
  sqlitePath: SQLITE,
  summary: {
    evaluated: report.cases.filter((x) => !x.skip).length,
    improved: improvedCases.length,
    degraded: degradedCases.length,
    unchanged: report.cases.length - improvedCases.length - degradedCases.length,
    netCer: improvedCases.length - degradedCases.length,
  },
  improvedCases,
  degradedCases,
  topImprovedTerms,
  topMissingRefTerms: topMissing,
  badCandidates,
  noChangeHighCer: unchangedCases.filter((u) => u.raw_cer > 0).length,
  noChangeReasons,
  noChangeSample: unchangedCases.filter((u) => u.raw_cer > 0).slice(0, 20),
  domainCoverage,
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8');
console.log('[audit] wrote', OUT);
console.log(
  JSON.stringify(
    {
      improved: output.summary.improved,
      degraded: output.summary.degraded,
      topImproved: topImprovedTerms.slice(0, 10),
      topMissing: topMissing.slice(0, 10),
      badCandidates: badCandidates.slice(0, 8),
      noChangeReasons,
    },
    null,
    2
  )
);
