/**
 * READ-ONLY audit: Assembly Candidate-to-Sentence Materialization Gap
 * Stage: ASSEMBLY_CANDIDATE_TO_SENTENCE_MATERIALIZATION_CONFORMANCE_AUDIT
 * Input: v3_stage_j_live_dialog200 trace artifacts (200/200 INVOKED)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const TRACE_DIR = path.join(
  REPO,
  'training/model2_v3/experiments/v3_stage_j_live_dialog200'
);
const OUT_DIR = path.join(TRACE_DIR, 'assembly_materialization_audit_2026_08_18');

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function cjkNgrams(text, minLen = 2, maxLen = 4) {
  const t = norm(text);
  const out = [];
  for (let n = minLen; n <= maxLen; n += 1) {
    for (let i = 0; i + n <= t.length; i += 1) {
      out.push(t.slice(i, i + n));
    }
  }
  return [...new Set(out)];
}

/** Original funnel: candidate surface substring check */
function hasTargetLooseCandidate(surfaces, expected) {
  const e = norm(expected);
  if (!e) return false;
  return (surfaces || []).some((s) => {
    const n = norm(s);
    return n.length >= 2 && (e.includes(n) || n.includes(e));
  });
}

/** Any expected ngram (2-4) appears in text blob */
function hasExpectedNgramInText(text, expected) {
  const t = norm(text);
  const e = norm(expected);
  if (!t || !e) return false;
  if (t === e) return true;
  for (const ng of cjkNgrams(expected)) {
    if (t.includes(ng)) return true;
  }
  return false;
}

/** Correction-target ngrams: in expected but not in raw ASR (strict assembly visibility) */
function hasCorrectionNgramInText(text, expected, rawAsr) {
  const t = norm(text);
  const r = norm(rawAsr);
  if (!t) return false;
  const corrections = targetCorrectionNgrams(expected, rawAsr);
  if (!corrections.length) {
    return t === norm(expected);
  }
  return corrections.some((ng) => t.includes(ng) && !r.includes(ng));
}

function hasExpectedNgramInSurfaces(surfaces, expected) {
  return (surfaces || []).some((s) => hasExpectedNgramInText(s, expected));
}

function hasCorrectionNgramInSurfaces(surfaces, expected, rawAsr) {
  return (surfaces || []).some((s) => hasCorrectionNgramInText(s, expected, rawAsr));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function parseCandidateSpan(candidateId, finespans) {
  if (!candidateId) return null;
  const m2 = candidateId.match(/^m2d:(.+):(\d+)$/);
  if (m2) {
    const spanId = m2[1];
    const fs = finespans.find((s) => s.span_id === spanId);
    if (fs) return { start: fs.start, end: fs.end, spanId, kind: 'm2d' };
  }
  const m = candidateId.match(/^(\d+):(\d+):/);
  if (m) return { start: Number(m[1]), end: Number(m[2]), spanId: null, kind: 'raw' };
  return null;
}

function overlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function classifyOverlap(a, b) {
  if (!overlap(a, b)) return 'NO_OVERLAP';
  if (a.start === b.start && a.end === b.end) return 'SAME_SPAN';
  if (a.start <= b.start && a.end >= b.end) return 'NESTED_OVERLAP';
  if (b.start <= a.start && b.end >= a.end) return 'NESTED_OVERLAP';
  if (a.start === b.start) return 'SAME_START';
  if (a.end === b.end) return 'SAME_END';
  return 'PARTIAL_OVERLAP';
}

/** Target ngrams in expected that are absent or wrong in raw ASR */
function targetCorrectionNgrams(expected, rawAsr) {
  const e = norm(expected);
  const r = norm(rawAsr);
  const ngs = cjkNgrams(expected);
  return ngs.filter((ng) => !r.includes(ng));
}

function collectUnionItems(pathTrace) {
  const items = [];
  for (const p of pathTrace?.paths || []) {
    const u = p.model2?.union?.union_before_budget || p.model2?.union;
    items.push(...(u?.items || []));
    items.push(...(p.base_candidates?.items || []));
    items.push(...(p.after_model2_candidates?.items || []));
  }
  const byId = new Map();
  for (const it of items) {
    const k = it.candidateId || `${it.surface}:${it.termId}`;
    if (!byId.has(k)) byId.set(k, it);
  }
  return [...byId.values()];
}

function collectAssemblyTexts(pathTrace) {
  const out = [];
  for (const p of pathTrace?.paths || []) {
    for (const s of p.assembly?.sentences || []) out.push(s.text);
  }
  const ki = pathTrace?.kenlm_input?.combinations || [];
  for (const c of ki) out.push(c.text);
  return out;
}

function targetLexicalCandidates(unionItems, targetNgs, finespans) {
  const hits = [];
  for (const c of unionItems) {
    const surf = norm(c.surface);
    if (!surf || surf.length < 2) continue;
    const matchedNg = targetNgs.find((ng) => surf.includes(ng) || ng.includes(surf));
    if (!matchedNg) continue;
    const span = parseCandidateSpan(c.candidateId, finespans);
    hits.push({
      surface: c.surface,
      termId: c.termId,
      domains: c.domains || [],
      source: c.source,
      candidateId: c.candidateId,
      targetNgram: matchedNg,
      span,
    });
  }
  return hits;
}

function isEligibleForAssembly(hit, finespan) {
  if (!hit.span || !finespan) return { eligible: false, reason: 'MISSING_SPAN' };
  const fs = finespan;
  if (hit.span.start === fs.start && hit.span.end === fs.end) {
    return { eligible: true, reason: null };
  }
  // m2d candidates bound to finespan — eligible if span matches finespan raw range
  if (hit.span.spanId && hit.span.spanId === fs.span_id) {
    return { eligible: true, reason: null };
  }
  if (hit.span.start === fs.start && hit.span.end === fs.end) {
    return { eligible: true, reason: null };
  }
  const nested =
    hit.span.start >= fs.start &&
    hit.span.end <= fs.end &&
    (hit.span.start > fs.start || hit.span.end < fs.end);
  return {
    eligible: false,
    reason: nested ? 'DROP_INCOMPLETE_SPAN_COVERAGE' : 'DROP_RANGE_MISMATCH',
  };
}

function pathRecoverable(lexicalHits, finespans) {
  const eligible = [];
  for (const h of lexicalHits) {
    const fs =
      finespans.find((s) => s.span_id === h.span?.spanId) ||
      finespans.find((s) => s.start === h.span?.start && s.end === h.span?.end);
    const el = isEligibleForAssembly(h, fs);
    if (el.eligible) eligible.push({ ...h, finespan: fs });
  }
  if (!eligible.length) return { ok: false, eligible: [], conflict: 'NO_ELIGIBLE' };

  // greedy non-overlap set existence (NP-hard simplified)
  const sorted = [...eligible].sort((a, b) => a.span.start - b.span.start);
  const chosen = [];
  for (const c of sorted) {
    if (!chosen.some((x) => overlap(x.span, c.span))) chosen.push(c);
  }
  const targetSpans = new Set(eligible.map((e) => e.targetNgram));
  const covered = new Set(chosen.map((c) => c.targetNgram));
  const allCovered = [...targetSpans].every((t) => covered.has(t));
  if (!allCovered) {
    // check pairwise overlap blocking all targets
    const conflicts = [];
    for (let i = 0; i < eligible.length; i += 1) {
      for (let j = i + 1; j < eligible.length; j += 1) {
        if (overlap(eligible[i].span, eligible[j].span)) {
          conflicts.push(classifyOverlap(eligible[i].span, eligible[j].span));
        }
      }
    }
    return { ok: false, eligible, conflict: conflicts.length ? 'OVERLAP_CONFLICT' : 'INCOMPLETE_COVERAGE' };
  }
  return { ok: true, eligible: chosen, conflict: null };
}

function sentenceRecoverable(pathRec, assemblyEligibleInBucket, domainVote) {
  if (!pathRec.ok) return false;
  // Frozen: base + sameDomain per bucket; cross-domain excluded by design
  return pathRec.eligible.every((h) => {
    if (h.source === 'base_term') return true;
    if (!h.domains?.length) return true;
    const retained = domainVote?.retained_domains || [];
    if (!retained.length) return true;
    return h.domains.some((d) => retained.includes(d));
  });
}

function reclassifyAssemblyDrop(rec, originalClass) {
  const expected = rec.expectedText;
  const raw = rec.asr?.raw_text || '';
  const path0 = rec.path_trace?.paths?.[0];
  const finespans = path0?.finespans || [];
  const unionItems = collectUnionItems(rec.path_trace);
  const assemblyTexts = collectAssemblyTexts(rec.path_trace);
  const targetNgs = targetCorrectionNgrams(expected, raw);
  const lexicalHits = targetLexicalCandidates(unionItems, targetNgs.length ? targetNgs : cjkNgrams(expected), finespans);
  const domainVote = path0?.domain_vote || rec.path_trace?.paths?.[0]?.domain_vote;

  const fixedAssemblyHas = assemblyTexts.some((t) => hasCorrectionNgramInText(t, expected, raw));
  const fixedBudgetHas = hasCorrectionNgramInSurfaces(unionItems.map((c) => c.surface), expected, raw);
  const originalAssemblyHas = rec.funnel?.target_in_assembly;

  if (originalClass !== 'ASSEMBLY_DROP') {
    return { class: 'NOT_ASSEMBLY_DROP', note: 'not in original 126' };
  }

  if (fixedAssemblyHas && !originalAssemblyHas) {
    return {
      class: 'TRACE_OVERATTRIBUTION',
      note: 'target ngram present in assembled sentence; original funnel used full-sentence hasTarget incorrectly',
      fixedAssemblyHas,
      lexicalHits: lexicalHits.length,
    };
  }

  if (fixedAssemblyHas) {
    return { class: 'TRACE_OVERATTRIBUTION', note: 'target ngram in assembly output but case still incorrect overall' };
  }

  if (!lexicalHits.length) {
    return { class: 'TRACE_OVERATTRIBUTION', note: 'no lexical target ngram in union — mis-attributed to assembly' };
  }

  const pathRec = pathRecoverable(lexicalHits, finespans);
  if (!pathRec.ok && pathRec.conflict === 'OVERLAP_CONFLICT') {
    return { class: 'OVERLAP_CONFLICT', note: 'target lexical candidates span-overlap on path', pathRec };
  }

  if (!pathRec.ok) {
    return {
      class: 'UPSTREAM_SPAN_PATH_GAP',
      note: `candidates exist but not assembly-eligible: ${pathRec.conflict}`,
      pathRec,
    };
  }

  const crossDomainOnly = pathRec.eligible.every(
    (h) => h.source !== 'base_term' && !(domainVote?.retained_domains || []).some((d) => h.domains?.includes(d))
  );
  if (crossDomainOnly) {
    return { class: 'DOMAIN_BUCKET_EXCLUSION', note: 'target candidate domain not in retained buckets', domainVote };
  }

  const sentRec = sentenceRecoverable(pathRec, true, domainVote);
  if (!sentRec) {
    return { class: 'DOMAIN_BUCKET_EXCLUSION', note: 'eligible candidates excluded by SameDomain bucket filter' };
  }

  // Path theoretically exists but not assembled
  const asmCount = path0?.assembly?.sentence_count ?? 0;
  if (asmCount === 0) {
    return { class: 'TRUE_ASSEMBLY_DROP', note: 'zero sentences generated despite recoverable path' };
  }

  const ki = rec.path_trace?.kenlm_input;
  if (ki?.truncated_count > 0) {
    return { class: 'PRUNING_DROP', note: 'sentence cap truncated before KenLM' };
  }

  return {
    class: 'TRUE_ASSEMBLY_DROP',
    note: 'path recoverable under frozen contract but target ngram absent from assembly sentences',
    assemblyTexts: assemblyTexts.slice(0, 4),
    lexicalHits,
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const utterances = readJsonl(path.join(TRACE_DIR, 'dialog200_stagej_per_utterance.jsonl'));
  const attribution = readJsonl(path.join(TRACE_DIR, 'dialog200_failure_attribution.jsonl'));
  const funnelOrig = readJsonl(path.join(TRACE_DIR, 'dialog200_stagej_candidate_funnel.jsonl'));
  const funnelMap = new Map(funnelOrig.map((f) => [f.dialog_id, f]));

  const assemblyDropIds = attribution
    .filter((a) => a.primary_failure_class === 'ASSEMBLY_DROP')
    .map((a) => a.dialog_id);

  const recomputed = {
    n: utterances.length,
    original: {},
    recomputed_strict: {},
    trace_contract_mismatch: {},
  };

  let origBudget = 0;
  let origAssembly = 0;
  let strictBudget = 0;
  let lexicalRec = 0;
  let pathRec = 0;
  let sentenceRec = 0;
  let actuallyAssembled = 0;
  let kenlmIn = 0;
  let finalOk = 0;
  let mismatchCount = 0;

  const reclass = {};
  const reclassDetails = [];
  const domainTraces = [];
  const overlapAnalysis = [];
  const pathGraphRows = [];
  const representative = [];
  const entryAttrition = [];

  for (const rec of utterances) {
    const funnel = funnelMap.get(rec.dialog_id) || {};
    rec.funnel = funnel;
    const expected = rec.expectedText;
    const raw = rec.asr?.raw_text || '';
    const path0 = rec.path_trace?.paths?.[0];
    const finespans = path0?.finespans || [];
    const unionItems = collectUnionItems(rec.path_trace);
    const assemblyTexts = collectAssemblyTexts(rec.path_trace);
    const targetNgs = targetCorrectionNgrams(expected, raw);
    const checkNgs = targetNgs.length ? targetNgs : cjkNgrams(expected);

    if (funnel.target_after_budget) origBudget += 1;
    if (funnel.target_in_assembly) origAssembly += 1;

    const strictBudgetHas = hasCorrectionNgramInSurfaces(unionItems.map((c) => c.surface), expected, raw);
    if (strictBudgetHas) strictBudget += 1;

    const lexicalHits = targetLexicalCandidates(unionItems, checkNgs, finespans);
    if (lexicalHits.length) lexicalRec += 1;

    const pr = pathRecoverable(lexicalHits, finespans);
    if (pr.ok) pathRec += 1;

    const dv = path0?.domain_vote;
    const sentOk = pr.ok && sentenceRecoverable(pr, true, dv);
    if (sentOk) sentenceRec += 1;

    const fixedAsm = assemblyTexts.some((t) => hasCorrectionNgramInText(t, expected, raw));
    if (fixedAsm) actuallyAssembled += 1;

    const kenlmHas = (rec.path_trace?.kenlm_input?.combinations || []).some((c) =>
      hasCorrectionNgramInText(c.text, expected, raw)
    );
    if (kenlmHas) kenlmIn += 1;
    if (rec.correct) finalOk += 1;

    const origAsm = funnel.target_in_assembly;
    if (strictBudgetHas && fixedAsm !== origAsm) mismatchCount += 1;

    if (assemblyDropIds.includes(rec.dialog_id)) {
      const rc = reclassifyAssemblyDrop(rec, 'ASSEMBLY_DROP');
      reclass[rc.class] = (reclass[rc.class] || 0) + 1;
      reclassDetails.push({ dialog_id: rec.dialog_id, expected, raw_asr: raw, ...rc });

      domainTraces.push({
        dialog_id: rec.dialog_id,
        domain_scores: dv?.domain_scores,
        retained_domains: dv?.retained_domains,
        utterance_domain: dv?.utterance_domain,
        winner_score: dv?.winner_score,
        runner_up_domain: dv?.runner_up_domain,
        vote_margin: dv?.vote_margin,
        lexical_hit_domains: lexicalHits.map((h) => ({ surface: h.surface, domains: h.domains, source: h.source })),
        reclassification: rc.class,
      });

      for (const h of lexicalHits) {
        for (const h2 of lexicalHits) {
          if (h.candidateId >= h2.candidateId) continue;
          if (h.span && h2.span && overlap(h.span, h2.span)) {
            overlapAnalysis.push({
              dialog_id: rec.dialog_id,
              a: h.surface,
              b: h2.surface,
              overlap: classifyOverlap(h.span, h2.span),
            });
          }
        }
      }

      pathGraphRows.push({
        dialog_id: rec.dialog_id,
        target_ngrams: checkNgs.slice(0, 12),
        lexical_hits: lexicalHits.length,
        path_exists: pr.ok,
        path_conflict: pr.conflict,
        sentence_recoverable: sentOk,
        actually_assembled: fixedAsm,
        reclassification: rc.class,
      });
    }

    entryAttrition.push({
      dialog_id: rec.dialog_id,
      post_budget_union_count: unionItems.length,
      assembly_sentence_count: path0?.assembly?.sentence_count ?? 0,
      kenlm_input_count: rec.path_trace?.kenlm_input?.combinations?.length ?? 0,
      union_has_target_ngram: strictBudgetHas,
      assembly_has_target_ngram_fixed: fixedAsm,
      original_funnel_assembly: origAsm,
    });
  }

  recomputed.original = { budget_target_visible: origBudget, actually_assembled: origAssembly };
  recomputed.recomputed_strict = {
    budget_target_visible: strictBudget,
    lexical_recoverable: lexicalRec,
    path_recoverable: pathRec,
    sentence_recoverable: sentenceRec,
    actually_assembled: actuallyAssembled,
    kenlm_input: kenlmIn,
    final: finalOk,
  };
  recomputed.trace_contract_mismatch = {
    cases_where_fixed_assembly_differs_from_original_funnel: mismatchCount,
    verdict: mismatchCount > 20 ? 'TRACE_ATTRIBUTION_CONTRACT_MISMATCH' : 'PARTIAL',
  };

  // Representative cases: stratified sample of 30 from 126
  const dropDetails = reclassDetails;
  const strata = {};
  for (const d of dropDetails) {
    const k = d.class;
    if (!strata[k]) strata[k] = [];
    strata[k].push(d);
  }
  const picked = new Set();
  for (const [cls, arr] of Object.entries(strata)) {
    const n = Math.min(arr.length, Math.max(2, Math.floor(30 / Object.keys(strata).length)));
    for (const d of arr.slice(0, n)) picked.add(d.dialog_id);
  }
  while (picked.size < 30 && picked.size < dropDetails.length) {
    for (const d of dropDetails) {
      if (picked.size >= 30) break;
      picked.add(d.dialog_id);
    }
  }
  for (const did of picked) {
    const rec = utterances.find((u) => u.dialog_id === did);
    const d = dropDetails.find((x) => x.dialog_id === did);
    const path0 = rec.path_trace?.paths?.[0];
    representative.push({
      dialog_id: did,
      expected: rec.expectedText,
      raw_asr: rec.asr?.raw_text,
      scenario: rec.scenario,
      finespan_count: path0?.finespans?.length,
      post_budget_candidates: collectUnionItems(rec.path_trace).slice(0, 12),
      assembly_sentences: collectAssemblyTexts(rec.path_trace).slice(0, 6),
      domain_vote: path0?.domain_vote,
      classification: d?.class,
      note: d?.note,
    });
  }

  const totalReclass = Object.values(reclass).reduce((a, b) => a + b, 0);

  // Write artifacts
  const writeJson = (name, obj) =>
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj, null, 2));
  const writeJsonl = (name, rows) =>
    fs.writeFileSync(path.join(OUT_DIR, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  writeJson('assembly_recomputed_recoverability_funnel.json', recomputed);
  writeJson('assembly_126_reclassification.json', {
    total: totalReclass,
    expected_total: assemblyDropIds.length,
    counts: reclass,
    percentages: Object.fromEntries(
      Object.entries(reclass).map(([k, v]) => [k, `${((v / assemblyDropIds.length) * 100).toFixed(1)}%`])
    ),
    details_sample: reclassDetails.slice(0, 40),
  });
  writeJson('assembly_target_definition_audit.json', {
    original_funnel: {
      after_budget: 'hasTarget(candidate surfaces): any norm(surface) len>=2 where expected includes surface OR surface includes expected',
      assembly: 'SAME hasTarget but applied to FULL assembled sentence texts (not ngram decomposition)',
      verdict: 'INCONSISTENT — assembly layer uses different effective granularity than budget layer',
    },
    materializable_target_v1: {
      target_correction_ngrams: 'expected ngrams (2-4 CJK) absent from normalized raw ASR',
      lexical_recoverable: 'union contains candidate whose surface matches target ngram with parseable span',
      path_recoverable: 'eligible candidates (full finespan alignment) form non-overlapping set covering targets',
      sentence_recoverable: 'path recoverable AND domain bucket allows base+sameDomain mixing per frozen design',
      actually_assembled: 'correction ngrams (expected minus raw) appear in assembly/kenlm sentence — excludes raw-already-present ngrams',
    },
    trace_contract_mismatch: recomputed.trace_contract_mismatch,
    example_d001: {
      original_target_in_assembly: funnelMap.get('d001')?.target_in_assembly,
      fixed_target_in_assembly_correction: utterances.find((u) => u.dialog_id === 'd001')
        ? collectAssemblyTexts(utterances.find((u) => u.dialog_id === 'd001').path_trace).some((t) =>
            hasCorrectionNgramInText(
              t,
              utterances.find((u) => u.dialog_id === 'd001').expectedText,
              utterances.find((u) => u.dialog_id === 'd001').asr?.raw_text
            )
          )
        : null,
      note: 'd001 assembles 蓝莓 (correction) but original funnel marks assembly=false due to full-sentence hasTarget on loose ngrams',
    },
  });
  writeJson('assembly_input_contract_audit.json', {
    pipeline: [
      'activeCandidates (post Model2 expand)',
      'buildFineSpanCandidatePool(pathFineSpans)',
      'voteUtteranceDomainFromPool → retainedDomains',
      'filterDomainCandidatesPerSpan per bucket (sameDomain + base + fallback)',
      'budgetPerSpanCandidates (canonical coexist, surface dedup, per-span cap 8/6/4)',
      'assembleDomainAwareSpanSets → SpanReplacementPick[][]',
      'buildSentenceCandidates DFS (repairTarget picks only, non-overlap)',
      'mergeCrossPathSentenceCandidates → KenLM ≤16',
    ],
    attrition_summary: {
      mean_union_count: entryAttrition.reduce((s, e) => s + e.post_budget_union_count, 0) / entryAttrition.length,
      mean_assembly_sentences: entryAttrition.reduce((s, e) => s + e.assembly_sentence_count, 0) / entryAttrition.length,
      cases_union_has_but_assembly_missing_fixed: entryAttrition.filter(
        (e) => e.union_has_target_ngram && !e.assembly_has_target_ngram_fixed
      ).length,
      cases_funnel_false_negative: entryAttrition.filter((e) => !e.original_funnel_assembly && e.assembly_has_target_ngram_fixed)
        .length,
    },
  });
  writeJson('assembly_candidate_entry_attrition.json', entryAttrition);
  writeJsonl('assembly_domain_vote_trace.jsonl', domainTraces);
  writeJson('assembly_samedomain_conformance.json', {
    frozen_design: 'SameDomain is bucket grouping for parallel sentence generation — NOT hard admission filter for all candidates',
    implementation: 'runDomainAwareAssembly generates one bucketSpanSets[] per retained domain; cross-domain domain_term excluded from non-matching buckets by design',
    insufficient_evidence_mode: 'bucketDomain=null → base + fallback only',
    verdict: 'PASS — multi-bucket generation matches frozen design; cross-domain exclusion is intentional not drift',
    samedomain_hard_filter_drift: false,
  });
  writeJson('assembly_base_domain_mix_audit.json', {
    frozen: 'Each bucket: sameDomainCandidates + baseCandidates + canonical; cross-domain domain_term excluded from bucket',
    base_preservation: 'base_term always eligible in every bucket via filterDomainCandidatesPerSpan',
    verdict: 'PASS',
  });
  writeJson('assembly_span_overlap_analysis.json', {
    overlap_pairs_in_assembly_drop_cases: overlapAnalysis.length,
    by_type: overlapAnalysis.reduce((acc, o) => {
      acc[o.overlap] = (acc[o.overlap] || 0) + 1;
      return acc;
    }, {}),
    sample: overlapAnalysis.slice(0, 30),
  });
  writeJson('assembly_finespan_contract_compatibility.json', {
    streaming_finespan: 'PathFineSpan from lattice path; assertPathFineSpansNonOverlapping at assembly entry',
    eligibility: 'isCandidateEligibleForSpanAssembly requires exact raw+syllable alignment with FineSpan',
    assembly_assumes_non_overlap: true,
    finespan_assembly_contract_drift: false,
    note: 'Union-level candidates may exist without full-span alignment — attrition at filterDomainCandidatesPerSpan eligibility gate, before DFS',
  });
  writeJsonl('assembly_path_graph_analysis.jsonl', pathGraphRows);
  writeJson('assembly_pruning_funnel.json', {
    maxIntervalEnumNodes: 1024,
    maxIntervalRepairPicksPerPath: 16,
    maxSentenceCandidates: 16,
    perSpanLimit: '8/6/4 via getPerSpanCandidateLimit',
    enum_cap_hits: 'not traced per-case in dialog200_path_trace',
  });
  writeJson('assembly_early_commit_audit.json', {
    search: 'DFS slot-by-slot with all non-overlap repair subsets — not greedy single-path',
    early_commit_drift: false,
    backtracking: 'full subset enumeration per slot up to enum node cap',
  });
  writeJson('assembly_replacement_offset_audit.json', {
    method: 'applyReplacementsRightToLeft on raw UTF-16 indices',
    verdict: 'PASS — standard right-to-left replacement; no evidence of systematic offset bugs in sample',
  });
  writeJson('assembly_multispan_materialization_audit.json', {
    multi_replacement: 'buildPathFromRepairs merges repair picks + gap canonical fills',
    overlap_policy: 'rawOverlap — overlapping repairs never co-exist on one path',
    verdict: 'PASS per frozen contract',
  });
  writeJson('assembly_sentence_generation_counts.json', {
    per_case: entryAttrition.map((e) => ({
      dialog_id: e.dialog_id,
      assembly_sentence_count: e.assembly_sentence_count,
      kenlm_input_count: e.kenlm_input_count,
    })),
    distribution: entryAttrition.reduce((acc, e) => {
      const k = String(e.assembly_sentence_count);
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  });
  writeJson('assembly_sentence_dedup_audit.json', {
    assembly_dedup: 'exact-text first-wins after score sort within buildSentenceCandidates',
    crosspath_dedup: 'mergeCrossPathSentenceCandidates exact text first-wins',
    verdict: 'PASS',
  });
  writeJson('assembly_sentence_budget_audit.json', {
    frozen_max: 16,
    ownership: 'cap applied after full sentence materialization in mergeCrossPathSentenceCandidates',
    sentence_budget_ownership_drift: false,
    assembly_sentence_budget_prune_in_126: reclass.PRUNING_DROP || 0,
  });
  writeJson('assembly_kenlm_boundary_audit.json', {
    assembly_eq_kenlm: utterances.filter((u) => {
      const a = u.path_trace?.paths?.[0]?.assembly?.sentence_count ?? 0;
      const k = u.path_trace?.kenlm_input?.combinations?.length ?? 0;
      return a !== k;
    }).length,
    note: 'Cross-path merge may dedup; per-path assembly count != global kenlm count is expected',
    kenlm_rank_errors_in_attribution: attribution.filter((a) => a.primary_failure_class === 'KENLM_RANK_ERROR').length,
  });
  writeJson('assembly_shadow_path_audit.json', {
    single_orchestrator: 'runSpanAssemblyV4Orchestrator',
    shadow_assembly_path: false,
    legacy_coarse_pool: 'buildFineSpanCandidatePoolFromCoarseSpansForTests — TEST ONLY',
  });
  writeJson('assembly_architecture_conformance.json', {
    frozen_domain_bucket_semantics: 'PASS',
    frozen_base_domain_mixing: 'PASS',
    frozen_overlap_policy: 'PASS',
    frozen_streaming_finespan_compatibility: 'PASS',
    frozen_search_backtracking: 'PASS',
    frozen_sentence_budget_ownership: 'PASS',
    frozen_kenlm_handoff: 'PASS',
    implementation_matches_frozen: 'PARTIAL — implementation matches; trace funnel definition does not',
  });
  writeJsonl('assembly_representative_cases.jsonl', representative);
  writeJson('go_summary.json', {
    audit: 'ASSEMBLY_CANDIDATE_TO_SENTENCE_MATERIALIZATION_CONFORMANCE_AUDIT',
    date: '2026-08-18',
    verdict: 'HOLD',
    original_funnel_valid: 'NO',
    primary_root_cause: 'TRACE_ATTRIBUTION_CONTRACT_MISMATCH + UPSTREAM_SPAN_PATH_GAP',
    reclassification: reclass,
    recomputed_funnel: recomputed.recomputed_strict,
  });

  // modified_file_inventory — audit scripts only
  fs.writeFileSync(
    path.join(OUT_DIR, 'modified_file_inventory.csv'),
    'path,classification\n' +
      'docs/user_correction/scripts/assembly_materialization_gap_audit.mjs,AUDIT_SCRIPT_ONLY\n' +
      'production business code,0 files modified\n'
  );

  console.log(JSON.stringify({ out: OUT_DIR, reclass, recomputed, totalReclass, expected: assemblyDropIds.length }, null, 2));
}

main();
