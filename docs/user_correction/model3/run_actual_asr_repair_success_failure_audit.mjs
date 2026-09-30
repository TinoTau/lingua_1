#!/usr/bin/env node
/**
 * Offline targeted audit: Actual ASR Repair Success vs Failure (READ_ONLY).
 * Uses RUN_ID dump + normalized case results only. No production changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const RUN_ID = 'dialog200_full_pipeline_20260909_001141';

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let cur = '';
  let inQ = false;
  let row = [];
  const pushRow = () => {
    if (row.length || cur) {
      row.push(cur);
      if (row.some((x) => x !== '')) rows.push(row);
    }
    row = [];
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      continue;
    }
    if (ch === ',' && !inQ) {
      row.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur || row.length) pushRow();
  const h = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}

function writeCsv(file, rows) {
  if (!rows.length) {
    fs.writeFileSync(file, '', 'utf8');
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  fs.writeFileSync(
    file,
    '\ufeff' + [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') + '\n',
    'utf8'
  );
}

/** Simple SequenceMatcher-like: contiguous mismatch spans in raw vs ref (normalized). */
function mismatchSpans(rawN, refN) {
  const spans = [];
  let i = 0;
  let j = 0;
  // greedy LCS via DP for small strings
  const n = rawN.length;
  const m = refN.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--) {
    for (let b = m - 1; b >= 0; b--) {
      dp[a][b] = rawN[a] === refN[b] ? dp[a + 1][b + 1] + 1 : Math.max(dp[a + 1][b], dp[a][b + 1]);
    }
  }
  const rawParts = [];
  const refParts = [];
  i = 0;
  j = 0;
  while (i < n && j < m) {
    if (rawN[i] === refN[j]) {
      rawParts.push({ type: 'eq', text: rawN[i] });
      refParts.push({ type: 'eq', text: refN[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawParts.push({ type: 'del', text: rawN[i] });
      i++;
    } else {
      refParts.push({ type: 'ins', text: refN[j] });
      j++;
    }
  }
  while (i < n) {
    rawParts.push({ type: 'del', text: rawN[i++] });
  }
  while (j < m) {
    refParts.push({ type: 'ins', text: refN[j++] });
  }
  // collapse contiguous del/ins into spans
  let rawBuf = '';
  let refBuf = '';
  const flush = () => {
    if (rawBuf || refBuf) {
      spans.push({ rawErr: rawBuf, refFix: refBuf });
      rawBuf = '';
      refBuf = '';
    }
  };
  // walk in parallel by reconstructing from parts — simpler: extract non-eq runs
  // Rebuild by scanning rawN/refN with a second pass using opcodes from difflib style
  return extractMismatches(rawN, refN);
}

function extractMismatches(a, b) {
  // Myers-ish via LCS positions
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ t: 'eq', c: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ t: 'ins', c: b[j - 1] });
      j--;
    } else {
      ops.push({ t: 'del', c: a[i - 1] });
      i--;
    }
  }
  ops.reverse();
  const spans = [];
  let rawErr = '';
  let refFix = '';
  for (const op of ops) {
    if (op.t === 'eq') {
      if (rawErr || refFix) {
        spans.push({ rawErr, refFix });
        rawErr = '';
        refFix = '';
      }
    } else if (op.t === 'del') rawErr += op.c;
    else refFix += op.c;
  }
  if (rawErr || refFix) spans.push({ rawErr, refFix });
  return spans.filter((s) => s.rawErr || s.refFix);
}

function pickErrorRegion(spans) {
  if (!spans.length) return { region: '', refHint: '', confidence: 'NONE' };
  // Prefer short lexical-like mismatch (2–6 chars) with both sides non-empty
  const scored = spans
    .map((s) => ({
      ...s,
      score:
        (s.rawErr.length >= 1 && s.rawErr.length <= 6 ? 10 : 0) +
        (s.refFix.length >= 1 && s.refFix.length <= 6 ? 5 : 0) +
        (s.rawErr && s.refFix ? 3 : 0) -
        Math.abs(s.rawErr.length - s.refFix.length),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best.rawErr || best.rawErr.length > 12) {
    return {
      region: best.rawErr.slice(0, 20) || '(insert-only)',
      refHint: best.refFix.slice(0, 20),
      confidence: 'LOW',
    };
  }
  return {
    region: best.rawErr,
    refHint: best.refFix,
    confidence: best.rawErr.length <= 6 && best.refFix.length <= 6 ? 'HIGH' : 'MEDIUM',
  };
}

function collectPathEvidence(rec) {
  const paths = rec.paths || [];
  const base = new Set();
  const model2 = new Set();
  const decisionSurfaces = [];
  const retryHits = new Set();
  const assembly = new Set();
  let keep = 0;
  let retry = 0;
  let model2ChangedPaths = 0;
  let retryInvocations = 0;
  let retryWithHits = 0;
  for (const p of paths) {
    for (const s of p.base_candidates || []) base.add(s);
    for (const s of p.model2_union || []) model2.add(s);
    const bSet = new Set(p.base_candidates || []);
    const m2 = p.model2_union || [];
    if (m2.some((x) => !bSet.has(x))) model2ChangedPaths += 1;
    for (const s of p.assembly_sentences || []) assembly.add(s);
    const m3 = p.model3 || {};
    keep += m3.decisions_keep || 0;
    retry += m3.decisions_retry || 0;
    for (const d of m3.decisions || []) {
      if (d.surface) decisionSurfaces.push({ surface: d.surface, decision: d.decision });
    }
    for (const inv of m3.retry_recall_invocations || []) {
      retryInvocations += 1;
      const hits = inv.hits || [];
      if (hits.length) retryWithHits += 1;
      for (const h of hits) retryHits.add(h);
    }
  }
  return {
    pathCount: paths.length,
    fineSpanNonEmpty: paths.some((p) => (p.fine_span_surfaces || []).length > 0),
    fineSpanCountSum: paths.reduce((a, p) => a + (p.fine_span_count || 0), 0),
    baseCandidates: [...base],
    model2Union: [...model2],
    model2ChangedPaths,
    decisionSurfaces,
    keep,
    retry,
    retryInvocations,
    retryWithHits,
    retryHits: [...retryHits],
    assembly: [...assembly],
    kenlmInputs: rec.kenlm_input_texts || [],
    kenlmTop: rec.kenlm_top_texts || [],
    kenlmPool: rec.kenlm_pool_candidate_count,
  };
}

function containsUseful(cands, refHint, rawErr) {
  if (!refHint) return false;
  for (const c of cands) {
    if (!c) continue;
    if (c === refHint) return true;
    // Avoid single-char false positives against multi-char hints (e.g. 点 vs 几点).
    if (c.length >= 2 && refHint.length >= 2 && (c.includes(refHint) || refHint.includes(c))) {
      return true;
    }
  }
  return false;
}

function surfaceNearError(decisionSurfaces, rawErr) {
  if (!rawErr) return false;
  for (const d of decisionSurfaces) {
    const s = d.surface || '';
    if (!s) continue;
    if (s === rawErr) return true;
    if (rawErr.includes(s) && s.length >= 1) return true;
    if (s.includes(rawErr) && rawErr.length >= 2) return true;
  }
  return false;
}

function finalContentChange(rawN, finalN, rawD, finalD) {
  if (rawN === finalN) return 'NONE';
  if (rawD === finalD) return 'CHANGED_BUT_EQUAL_DISTANCE';
  return 'OTHER';
}

function levenshtein(a, b) {
  a = a || '';
  b = b || '';
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function analyzeCase(row, rec, role) {
  const rawN = row.raw_normalized;
  const finalN = row.final_normalized;
  const refN = row.reference_normalized;
  const spans = mismatchSpans(rawN, refN);
  const picked = pickErrorRegion(spans);
  const ev = collectPathEvidence(rec);
  const rawD = Number(row.raw_normalized_distance);
  const finalD = Number(row.final_normalized_distance);

  // FineSpan: dump has empty fine_span_surfaces; use decision.surface as OBSERVATIONAL proxy only
  let finespan_status = 'NOT_OBSERVABLE';
  if (ev.fineSpanNonEmpty) {
    finespan_status = surfaceNearError(
      (rec.paths || []).flatMap((p) => (p.fine_span_surfaces || []).map((s) => ({ surface: s }))),
      picked.region
    )
      ? 'YES'
      : 'NO';
  } else if (picked.confidence !== 'NONE' && surfaceNearError(ev.decisionSurfaces, picked.region)) {
    // decision surfaces prove FineSpan processed that surface (spanId fine:…)
    finespan_status = 'YES'; // OBSERVATIONAL via model3.decisions.surface
  } else if (picked.confidence === 'LOW' || !picked.region) {
    finespan_status = 'NOT_OBSERVABLE';
  } else {
    // region chosen but not seen on any decision surface — still may be unexposed OR multi-char span mismatch
    finespan_status = 'NOT_OBSERVABLE';
  }

  const usefulInBase = containsUseful(ev.baseCandidates, picked.refHint, picked.region);
  const usefulInM2 = containsUseful(ev.model2Union, picked.refHint, picked.region);
  const usefulInRetry = containsUseful(ev.retryHits, picked.refHint, picked.region);
  const usefulInAsm = ev.assembly.some(
    (s) => picked.refHint && picked.refHint.length >= 2 && s.replace(/\s/g, '').includes(picked.refHint)
  );
  // kenlm: better complete? if any input closer to ref than raw (norm strip light)
  const strip = (t) => String(t || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '');
  const rawStrip = strip(rec.rawMergedAsrText);
  const refStrip = strip(rec.reference);
  const rawKenD = levenshtein(rawStrip, refStrip);
  let betterKenlm = false;
  let selectedBetter = false;
  for (const t of ev.kenlmInputs) {
    const d = levenshtein(strip(t), refStrip);
    if (d < rawKenD) betterKenlm = true;
  }
  if (ev.kenlmTop[0] && levenshtein(strip(ev.kenlmTop[0]), refStrip) < rawKenD) selectedBetter = true;

  let recall_status = 'NOT_OBSERVABLE';
  if (finespan_status === 'NOT_OBSERVABLE' && picked.confidence !== 'HIGH') {
    recall_status = 'NOT_OBSERVABLE';
  } else if (usefulInBase) {
    recall_status = 'USEFUL_CANDIDATE_PRESENT';
  } else if (finespan_status === 'YES' || picked.confidence === 'HIGH') {
    recall_status = 'NO_USEFUL_CANDIDATE_OBSERVED';
  } else {
    recall_status = 'NOT_OBSERVABLE';
  }

  let model2_status = 'NOT_OBSERVABLE';
  if (ev.model2ChangedPaths === 0 && ev.model2Union.length === ev.baseCandidates.length) {
    // often identical lists
    model2_status = usefulInM2 && !usefulInBase ? 'YES' : 'NO';
  } else if (usefulInM2 && !usefulInBase) {
    model2_status = 'YES';
  } else {
    model2_status = ev.model2ChangedPaths > 0 ? 'NO' : 'NOT_APPLICABLE';
  }

  // Domain: only if useful upstream — dump lacks per-candidate domain survival; NOT_OBSERVABLE
  let domain_status = 'NOT_OBSERVABLE';
  if (usefulInBase || usefulInM2) {
    // if useful still in model2_union after domain stage dump field, observational survived into model2 union
    domain_status = usefulInM2 || usefulInBase ? 'SURVIVED' : 'NOT_OBSERVABLE';
    // Actually domain is between model2 and model3; we don't have post-domain candidate list separately
    domain_status = 'NOT_OBSERVABLE';
  }

  const model3_decision = ev.retry > 0 ? 'RETRY' : ev.keep > 0 ? 'KEEP' : 'NOT_APPLICABLE';

  let retry_status = 'NOT_APPLICABLE';
  if (model3_decision === 'RETRY') {
    if (usefulInRetry) retry_status = 'USEFUL_HIT_PRESENT';
    else if (ev.retryInvocations > 0) retry_status = 'INVOKED_NO_USEFUL_HIT_OBSERVED';
    else retry_status = 'NOT_OBSERVABLE';
  }

  let assembly_status = 'NOT_OBSERVABLE';
  if (usefulInBase || usefulInM2 || usefulInRetry) {
    assembly_status = usefulInAsm ? 'YES' : 'NO';
  }

  let candidate_selection_status = 'CAP16_NOT_CURRENT_ISSUE';
  if (betterKenlm) {
    candidate_selection_status = selectedBetter ? 'SELECTED' : 'NOT_SELECTED';
  } else if (usefulInAsm) {
    candidate_selection_status = 'NO_BETTER_COMPLETE_IN_KENLM_INPUT';
  } else {
    candidate_selection_status = 'N/A';
  }

  // EARLIEST_PROVEN_BREAKPOINT
  let earliest = 'NO_SINGLE_BREAKPOINT';
  let evidence_level = 'UNKNOWN';

  if (picked.confidence === 'NONE' || (!picked.region && spans.length > 3)) {
    earliest = 'ERROR_REGION_NOT_ISOLATED';
    evidence_level = 'OBSERVATIONAL';
  } else if (finespan_status === 'NOT_OBSERVABLE') {
    earliest = 'TRACE_INSUFFICIENT';
    evidence_level = 'DIRECT'; // dump lacks FineSpan window/surfaces list
  } else if (finespan_status === 'NO') {
    earliest = 'FINESPAN_NOT_EXPOSED';
    evidence_level = 'DIRECT';
  } else if (recall_status === 'NO_USEFUL_CANDIDATE_OBSERVED') {
    earliest = 'NO_USEFUL_RECALL_CANDIDATE';
    evidence_level = 'OBSERVATIONAL';
  } else if (recall_status === 'USEFUL_CANDIDATE_PRESENT') {
    // continue chain
    if (model2_status === 'YES') {
      // useful introduced by model2 — not a failure breakpoint at recall
    }
    if (domain_status === 'LOST') {
      earliest = 'DOMAIN_SURVIVAL_LOSS';
      evidence_level = 'DIRECT';
    } else if (assembly_status === 'NO') {
      earliest = 'ASSEMBLY_DID_NOT_FORM_USEFUL_SENTENCE';
      evidence_level = 'OBSERVATIONAL';
    } else if (candidate_selection_status === 'NOT_SELECTED') {
      earliest = 'CANDIDATE_SELECTION_OPPORTUNITY';
      evidence_level = 'DIRECT';
    } else if (usefulInAsm && !betterKenlm && rawN !== finalN === false) {
      earliest = 'NO_SINGLE_BREAKPOINT';
      evidence_level = 'OBSERVATIONAL';
    } else if (assembly_status === 'YES' && candidate_selection_status === 'SELECTED' && rawN === finalN) {
      earliest = 'FINAL_APPLY_MISMATCH';
      evidence_level = 'DIRECT';
    } else if (assembly_status === 'YES' && !betterKenlm) {
      // useful lexical present and assembled somehow but sentence still wrong distance
      earliest = 'NO_SINGLE_BREAKPOINT';
      evidence_level = 'OBSERVATIONAL';
    } else if (model3_decision === 'KEEP' && !usefulInRetry && recall_status === 'USEFUL_CANDIDATE_PRESENT') {
      // useful exists but maybe not on retried spans — weak
      earliest = 'NO_SINGLE_BREAKPOINT';
      evidence_level = 'UNKNOWN';
    } else {
      earliest = 'NO_SINGLE_BREAKPOINT';
      evidence_level = 'OBSERVATIONAL';
    }
  } else {
    earliest = 'TRACE_INSUFFICIENT';
    evidence_level = 'UNKNOWN';
  }

  return {
    role,
    caseId: row.caseId,
    raw_normalized: rawN,
    final_normalized: finalN,
    reference_normalized: refN,
    raw_distance: rawD,
    final_distance: finalD,
    final_content_change: finalContentChange(rawN, finalN, rawD, finalD),
    selected_error_region: picked.region ? `${picked.region}→${picked.refHint}` : '',
    error_region_confidence: picked.confidence,
    spans_count: spans.length,
    spans_preview: spans.slice(0, 5),
    finespan_status,
    recall_status,
    model2_status,
    domain_status,
    model3_decision,
    retry_status,
    assembly_status,
    candidate_selection_status,
    earliest_proven_breakpoint: earliest,
    evidence_level,
    usefulInBase,
    usefulInM2,
    usefulInRetry,
    usefulInAsm,
    betterKenlm,
    selectedBetter,
    kenlmPool: ev.kenlmPool,
    pathCount: ev.pathCount,
    fineSpanCountSum: ev.fineSpanCountSum,
    base_sample: ev.baseCandidates.slice(0, 30),
    m2_sample: ev.model2Union.slice(0, 30),
    retry_hits_sample: ev.retryHits.slice(0, 20),
    decision_surfaces_near: ev.decisionSurfaces
      .filter((d) => picked.region && (d.surface === picked.region || (picked.region.includes(d.surface) && d.surface.length >= 2)))
      .slice(0, 10),
    assembly_count: ev.assembly.length,
    kenlm_inputs: ev.kenlmInputs,
    kenlm_top0: ev.kenlmTop[0] || '',
    keep: ev.keep,
    retry: ev.retry,
  };
}

function main() {
  const normRows = parseCsv(fs.readFileSync(path.join(OUT, 'ASR_Repair_Normalized_Case_Results.csv'), 'utf8'));
  const byId = {};
  for (const line of fs.readFileSync(path.join(OUT, `fresh_dialog200_raw_cases_${RUN_ID}.jsonl`), 'utf8').split(/\r?\n/).filter(Boolean)) {
    const o = JSON.parse(line);
    byId[o.caseId] = o;
  }

  const success = normRows.filter((r) => r.normalized_repair_outcome === 'ASR_REPAIR_PARTIAL_IMPROVEMENT');
  const failPool = normRows
    .filter(
      (r) =>
        r.normalized_repair_outcome === 'ASR_REPAIR_UNCHANGED' &&
        r.raw_normalized !== r.reference_normalized
    )
    .sort((a, b) => a.caseId.localeCompare(b.caseId, 'en'));

  const n = 15;
  const sample = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(failPool.length - 1, Math.floor(i * (failPool.length / n) + failPool.length / n / 2));
    sample.push(failPool[idx]);
  }
  // unique preserve order
  const seen = new Set();
  const failureSample = [];
  for (const s of sample) {
    if (!seen.has(s.caseId)) {
      seen.add(s.caseId);
      failureSample.push(s);
    }
  }
  // if <15 due to dup, fill sequentially
  for (const f of failPool) {
    if (failureSample.length >= 15) break;
    if (!seen.has(f.caseId)) {
      seen.add(f.caseId);
      failureSample.push(f);
    }
  }

  const analyzed = [];
  for (const row of success) analyzed.push(analyzeCase(row, byId[row.caseId], 'SUCCESS'));
  for (const row of failureSample) analyzed.push(analyzeCase(row, byId[row.caseId], 'FAILURE'));

  fs.writeFileSync(path.join(OUT, '_actual_asr_repair_audit_dump.json'), JSON.stringify({
    successIds: success.map((r) => r.caseId),
    failureSampleIds: failureSample.map((r) => r.caseId),
    failPoolSize: failPool.length,
    analyzed,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    successIds: success.map((r) => r.caseId),
    failureSampleIds: failureSample.map((r) => r.caseId),
    failPoolSize: failPool.length,
    failure_breakpoints: analyzed.filter(a => a.role==='FAILURE').map(a => ({
      id: a.caseId,
      region: a.selected_error_region,
      conf: a.error_region_confidence,
      fs: a.finespan_status,
      recall: a.recall_status,
      bp: a.earliest_proven_breakpoint,
      el: a.evidence_level,
      usefulBase: a.usefulInBase,
      betterKenlm: a.betterKenlm,
      finalChange: a.final_content_change,
    })),
    success_summary: analyzed.filter(a => a.role==='SUCCESS').map(a => ({
      id: a.caseId,
      region: a.selected_error_region,
      fs: a.finespan_status,
      recall: a.recall_status,
      usefulBase: a.usefulInBase,
      usefulAsm: a.usefulInAsm,
      betterKenlm: a.betterKenlm,
      selectedBetter: a.selectedBetter,
      improvement: `${a.raw_distance}->${a.final_distance}`,
    })),
  }, null, 2));
}

main();
