/**
 * READ_ONLY diagnostic — Post-Path-Survival Final Correct First-Loss Trace Audit V1
 * DIAGNOSTIC ONLY higher caps — does NOT authorize production cap change.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const START = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const CACHE = JSON.parse(fs.readFileSync(path.join(OUT, '_path_budget_edge_cache.json'), 'utf8'));
const cases = JSON.parse(
  '[' + fs.readFileSync(path.join(DS, 'cases', 'cases.jsonl'), 'utf8').trim().split(/\r?\n/).join(',') + ']'
);
const caseById = Object.fromEntries(cases.map((c) => [c.caseId, c]));
const man = JSON.parse(
  fs.readFileSync(path.join(OUT, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json'), 'utf8')
);
const manById = Object.fromEntries(man.cases.map((c) => [c.caseId, c]));

/** Cohort: target path reaches Domain Vote under diagnostic cap; FINAL_CORRECT=false */
const COHORT = [
  { caseId: 'p2_u004_033', cap: [12, 12], target: '城门' },
  { caseId: 'p2_u005_015', cap: [12, 12], target: '提示符' },
  { caseId: 'p2_u005_004', cap: [16, 16], target: '水道' },
  { caseId: 'p2_u004_010', cap: [32, 32], target: '行程图' },
];

function asArr(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.items)) return x.items;
  return [];
}

function hasGeom(p, g) {
  return (p.finespans || []).some(
    (s) => s.syllable_start === g.sylStart && s.syllable_end === g.sylEnd
  );
}

function candOnGeom(c, g) {
  const s = c.syllableStart ?? c.syllable_start;
  const e = c.syllableEnd ?? c.syllable_end;
  return s === g.sylStart && e === g.sylEnd;
}

function surfacesOnSpan(p, g) {
  const out = [];
  for (const c of asArr(p.after_model2_candidates)) {
    if (!candOnGeom(c, g)) continue;
    out.push({
      surface: c.surface ?? c.replacement ?? c.text,
      source: c.source,
      domains: c.domains ?? c.domain_tags ?? null,
      termId: c.termId ?? c.term_id ?? null,
      hitKind: c.hitKind ?? c.hit_kind ?? null,
      from: 'after_model2_candidates',
    });
  }
  for (const c of asArr(p.base_candidates)) {
    if (!candOnGeom(c, g)) continue;
    out.push({
      surface: c.surface ?? c.replacement ?? c.text,
      source: c.source,
      domains: c.domains ?? null,
      termId: c.termId ?? c.term_id ?? null,
      from: 'base_candidates',
    });
  }
  for (const s of p.finespans || []) {
    if (s.syllable_start !== g.sylStart || s.syllable_end !== g.sylEnd) continue;
    for (const c of asArr(s.candidates || s.after_model2_candidates)) {
      out.push({
        surface: c.surface ?? c.replacement ?? c.text,
        source: c.source,
        domains: c.domains ?? null,
        termId: c.termId ?? c.term_id ?? null,
        from: 'finespan',
      });
    }
  }
  return out;
}

function model3OnGeom(p, g) {
  const decisions = p.model3?.decisions || [];
  return decisions.filter((d) => {
    const s = d.syllable_start ?? d.sylStart ?? d.span?.syllableStart ?? d.span?.syllable_start;
    const e = d.syllable_end ?? d.sylEnd ?? d.span?.syllableEnd ?? d.span?.syllable_end;
    if (s == null || e == null) return false;
    return !(e <= g.sylStart || s >= g.sylEnd);
  });
}

function anchorsOverlap(p, g) {
  return (p.model3?.anchors || [])
    .map((a) => ({
      start: a.syllable_start ?? a.syllableStart,
      end: a.syllable_end ?? a.syllableEnd,
      reason: a.reason || a.source || a.kind,
      surface: a.surface || a.text,
    }))
    .filter((a) => a.start != null && !(a.end <= g.sylStart || a.start >= g.sylEnd));
}

function textHas(t, surface) {
  return String(t || '').includes(surface);
}

async function start(a, c) {
  killPort(5020);
  await new Promise((r) => setTimeout(r, 2000));
  const child = spawn(process.execPath, [START], {
    cwd: __dirname,
    env: {
      ...process.env,
      PROJECT_ROOT: REPO,
      NODE_ENV: 'production',
      MODEL2_DIALOG200_TRACE: '1',
      LINGUA_EXPERIMENT_MAX_ACTIVE_PATHS: String(a),
      LINGUA_EXPERIMENT_MAX_COMPLETE_PATHS: String(c),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res) => child.on('exit', res));
  const ok = await waitTestServerHealth(5020, 180000);
  if (!ok) throw new Error('unhealthy');
}

async function runOne(caseId) {
  const caseRow = caseById[caseId];
  const m = manById[caseId];
  const cached = CACHE.cases[caseId];
  const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
  const profile = JSON.parse(
    fs.readFileSync(path.join(DS, 'profiles', caseRow.profileRef + '.userprofile.json'), 'utf8')
  );
  const sessionId = 'fl-' + caseId + '-' + Date.now();
  await fetch('http://127.0.0.1:5020/session-bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      user_profile: profile,
      user_id: caseRow.userId,
    }),
  });
  const res = await fetch('http://127.0.0.1:5020/run-lexicon-mock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asrText: evidence.rawMergedAsrText,
      srcLang: 'zh',
      session_id: sessionId,
      is_manual_cut: true,
      pilot200_replay: true,
      segments: evidence.segments,
      utterance_tone: evidence.utterance_tone,
    }),
  });
  const data = await res.json();
  return { data, cached, caseRow, evidence };
}

function analyze(caseId, targetSurface, cap, data, cached, caseRow, evidence) {
  const g = cached.targetGeom;
  const raw = data?.extra?.dialog200_path_trace;
  const paths = Array.isArray(raw) ? raw : raw?.paths || [];
  const kenlmInput = raw?.kenlm_input || null;
  const kenlmRerank = raw?.kenlm_rerank || null;
  const targetPaths = paths.filter((p) => hasGeom(p, g));
  const final =
    data.text_translated || data.extra?.fw_repair_normalized_text || data.text_asr || '';
  const expected = caseRow.expectedText || caseRow.gtText || '';
  const asr = evidence.rawMergedAsrText || data.text_asr || '';

  const spanV4 = data?.extra?.fw_detector?.spanAssemblyV4 || {};
  const sentenceRerank = data?.extra?.fw_detector?.sentenceRerank || null;

  const pathLedgers = [];
  for (const p of targetPaths.slice(0, 8)) {
    const vote = p.domain_vote || {};
    const retained = vote.retained_domains || vote.retainedDomains || [];
    const scores = vote.domain_scores || vote.domainScores || {};
    const cands = surfacesOnSpan(p, g);
    const targetCand = cands.filter(
      (c) => c.surface === targetSurface || String(c.surface || '').includes(targetSurface)
    );
    const assembly = p.assembly || {};
    const sentences = assembly.sentences || [];
    const sentWithTarget = sentences.filter((s) =>
      textHas(typeof s === 'string' ? s : s.text || s.sentence, targetSurface)
    );
    const m3 = model3OnGeom(p, g);
    pathLedgers.push({
      boundary_key: p.boundary_key,
      path_id: p.path_id ?? p.id ?? null,
      vote_retained: retained,
      vote_scores: scores,
      vote_insufficient: vote.insufficient_evidence ?? vote.insufficientEvidence ?? null,
      vote_utterance_domain: vote.utterance_domain ?? null,
      vote_winner_score: vote.winner_score ?? null,
      vote_runner_up: vote.runner_up_domain ?? null,
      vote_margin: vote.vote_margin ?? null,
      cand_count: cands.length,
      cand_surfaces: [...new Set(cands.map((c) => c.surface))].slice(0, 30),
      target_surface_in_candidates: targetCand.length > 0,
      target_cand_sample: targetCand.slice(0, 8),
      target_cand_sources: [...new Set(targetCand.map((c) => c.source))],
      target_cand_domains: targetCand.map((c) => c.domains),
      assembly_sentence_count: Array.isArray(sentences) ? sentences.length : null,
      assembly_has_target_surface: sentWithTarget.length > 0,
      assembly_target_sentences: sentWithTarget.slice(0, 8).map((s) => ({
        text: typeof s === 'string' ? s : s.text,
        score: s.score,
        replacements: s.replacements,
      })),
      assembly_all_sample: sentences.slice(0, 6).map((s) =>
        typeof s === 'string' ? s : { text: s.text, score: s.score, replacements: s.replacements }
      ),
      model3_decisions: m3.slice(0, 12).map((d) => ({
        action: d.action ?? d.decision ?? d.keep_or_retry ?? d.label,
        keys: Object.keys(d).slice(0, 20),
        syllable_start: d.syllable_start ?? d.sylStart ?? d.span?.syllableStart,
        syllable_end: d.syllable_end ?? d.sylEnd ?? d.span?.syllableEnd,
        surface: d.surface ?? d.text ?? d.current_surface,
        reason: d.reason ?? d.why,
      })),
      anchors_overlap_geom: anchorsOverlap(p, g).slice(0, 12),
      model3_retry_regions_sample: (p.model3?.retry_regions || []).slice(0, 4),
      finespan_keys: (p.finespans || [])[0] ? Object.keys(p.finespans[0]) : [],
      path_top_keys: Object.keys(p).slice(0, 40),
    });
  }

  // Aggregate evidence across target paths
  const anyTargetCand = pathLedgers.some((l) => l.target_surface_in_candidates);
  const anyAssemblyTarget = pathLedgers.some((l) => l.assembly_has_target_surface);
  const retainedUnion = [
    ...new Set(pathLedgers.flatMap((l) => l.vote_retained || [])),
  ];
  const voteInsufficientAny = pathLedgers.some((l) => l.vote_insufficient === true);

  // KenLM pool
  const kenlmCombos = kenlmInput?.combinations || [];
  const kenlmUnique = kenlmInput?.unique_before_cap || [];
  const kenlmPruned = kenlmInput?.pruned || [];
  const kenlmTargetInCombos = kenlmCombos
    .map((c, i) => ({
      rank: i + 1,
      text: typeof c === 'string' ? c : c.text,
      score: c.score,
      replacements: c.replacements,
    }))
    .filter((c) => textHas(c.text, targetSurface));
  const kenlmTargetInUnique = (Array.isArray(kenlmUnique) ? kenlmUnique : [])
    .map((c, i) => ({
      rank: i + 1,
      text: typeof c === 'string' ? c : c.text,
    }))
    .filter((c) => textHas(c.text, targetSurface));
  const kenlmTargetInPruned = (Array.isArray(kenlmPruned) ? kenlmPruned : []).filter((c) =>
    textHas(typeof c === 'string' ? c : c.text, targetSurface)
  );

  const picked = kenlmRerank?.picked_text ?? sentenceRerank?.picked?.text ?? null;
  const pickedIsRaw = kenlmRerank?.picked_is_raw ?? sentenceRerank?.pickedIsRaw ?? null;
  const topCands = kenlmRerank?.top_candidates || sentenceRerank?.topCandidates || [];

  // Evidence state machine (conservative; UNKNOWN when not observable)
  const E0 = cached.targetEdgePresent === false ? 'ABSENT' : 'PRESENT'; // cache already proven
  const E1 = targetPaths.length > 0 ? 'PRESENT' : 'ABSENT';
  let E2 = 'UNKNOWN';
  // E2 = required domain retained. For base-only targets, domain may be N/A if contract allows base path.
  const targetDomainHints = pathLedgers
    .flatMap((l) => l.target_cand_domains || [])
    .flat()
    .filter(Boolean);
  const targetHasDomainTag = targetDomainHints.some(
    (d) =>
      (Array.isArray(d) && d.some((x) => x && x !== 'general' && x !== 'base_term')) ||
      (typeof d === 'string' && d !== 'general' && d !== 'base_term')
  );
  if (E1 === 'ABSENT') {
    E2 = 'NOT_APPLICABLE';
  } else if (!targetHasDomainTag) {
    // Base-only target: Domain Vote retention of a specific domain is NOT required for surface survival.
    E2 = 'NOT_APPLICABLE';
  } else {
    const needed = new Set();
    for (const d of targetDomainHints) {
      if (Array.isArray(d)) d.forEach((x) => needed.add(x));
      else if (typeof d === 'string') needed.add(d);
    }
    const hit = [...needed].some((d) => retainedUnion.includes(d));
    E2 = hit ? 'PRESENT' : 'ABSENT';
  }

  // E3 SameDomain pool: infer from target candidate presence + (base OR domain∩retained)
  let E3 = 'UNKNOWN';
  if (E1 === 'ABSENT') E3 = 'NOT_APPLICABLE';
  else if (!anyTargetCand) E3 = 'ABSENT';
  else {
    const samples = pathLedgers.flatMap((l) => l.target_cand_sample || []);
    const asBase = samples.some(
      (c) =>
        c.source === 'base_term' ||
        c.source === 'canonical' ||
        c.source === 'raw' ||
        String(c.termId || '').startsWith('base-')
    );
    const asSameDomain = samples.some((c) => {
      const doms = Array.isArray(c.domains) ? c.domains : [];
      return doms.some((d) => retainedUnion.includes(d));
    });
    if (asBase || asSameDomain || !targetHasDomainTag) E3 = 'PRESENT';
    else E3 = 'ABSENT'; // domain-only candidate whose domain not retained
  }

  // E4 assembled sentence with target on a target path
  let E4 = 'UNKNOWN';
  if (E3 === 'ABSENT') E4 = 'NOT_APPLICABLE';
  else if (pathLedgers.every((l) => l.assembly_sentence_count == null)) E4 = 'UNKNOWN';
  else E4 = anyAssemblyTarget ? 'PRESENT' : 'ABSENT';

  // E5 KenLM input (global pool after cross-path merge + cap)
  let E5 = 'UNKNOWN';
  if (E4 === 'ABSENT') E5 = 'NOT_APPLICABLE';
  else if (!kenlmInput) E5 = 'UNKNOWN';
  else if (kenlmTargetInCombos.length > 0) E5 = 'PRESENT';
  else if (kenlmTargetInPruned.length > 0) E5 = 'ABSENT'; // lost at sentence budget
  else if (kenlmTargetInUnique.length > 0) E5 = 'ABSENT'; // somehow not in final combos
  else E5 = 'ABSENT';

  // E6 Post-KenLM: target still selected / competitive after rerank
  let E6 = 'UNKNOWN';
  if (E5 !== 'PRESENT') E6 = 'NOT_APPLICABLE';
  else if (picked != null || topCands.length) {
    const inTop = topCands.some((t) => textHas(typeof t === 'string' ? t : t.text, targetSurface));
    const pickedHas = textHas(picked, targetSurface);
    E6 = pickedHas || inTop ? 'PRESENT' : 'ABSENT';
  } else if (textHas(final, targetSurface)) {
    E6 = 'PRESENT';
  } else {
    E6 = 'UNKNOWN';
  }

  // E7 Post-Model3: harder — Model3 is per-path before assembly; if target assembled, Model3 didn't destroy it
  let E7 = 'UNKNOWN';
  if (E4 === 'PRESENT') E7 = 'PRESENT'; // survived into assembled sentence
  else if (E3 === 'PRESENT' && E4 === 'ABSENT') E7 = 'NOT_APPLICABLE'; // lost at assembly, not model3 output destroy
  else if (E3 === 'ABSENT') E7 = 'NOT_APPLICABLE';

  // E8 Final
  const E8 = textHas(final, targetSurface) ? 'PRESENT' : 'ABSENT';

  // FIRST LOSS = first PRESENT → ABSENT (or PRESENT → UNKNOWN stops as OBSERVABILITY)
  const chain = [
    ['E1_TARGET_PATH', E1],
    ['E2_TARGET_DOMAIN', E2],
    ['E3_TARGET_SAMEDOMAIN_POOL', E3],
    ['E4_TARGET_ASSEMBLED_SENTENCE', E4],
    ['E5_TARGET_KENLM_INPUT', E5],
    ['E6_TARGET_POST_KENLM', E6],
    ['E7_TARGET_POST_MODEL3', E7],
    ['E8_TARGET_FINAL', E8],
  ];
  let firstLoss = null;
  let observabilityGap = false;
  let prevPresent = false;
  for (const [name, st] of chain) {
    if (st === 'PRESENT') {
      prevPresent = true;
      continue;
    }
    if (st === 'NOT_APPLICABLE') continue;
    if (st === 'UNKNOWN' && prevPresent) {
      firstLoss = { stage: name, kind: 'OBSERVABILITY_GAP', from: 'PRESENT', to: 'UNKNOWN' };
      observabilityGap = true;
      break;
    }
    if (st === 'ABSENT' && prevPresent) {
      firstLoss = { stage: name, kind: 'LOSS', from: 'PRESENT', to: 'ABSENT' };
      break;
    }
    if (st === 'ABSENT' && !prevPresent && name === 'E1_TARGET_PATH') {
      firstLoss = { stage: name, kind: 'NOT_IN_COHORT', from: null, to: 'ABSENT' };
      break;
    }
  }
  if (!firstLoss && E8 === 'ABSENT') {
    firstLoss = { stage: 'E8_TARGET_FINAL', kind: 'LOSS_OR_GAP', from: '?', to: 'ABSENT' };
  }

  return {
    caseId,
    targetSurface,
    diagnostic_cap: `${cap[0]}/${cap[1]}`,
    diagnostic_cap_note: 'DIAGNOSTIC ONLY — THIS DOES NOT AUTHORIZE CAP CHANGE',
    asr: String(asr).slice(0, 160),
    expected: String(expected).slice(0, 160),
    final: String(final).slice(0, 160),
    final_contains_target: textHas(final, targetSurface),
    expected_contains_target: textHas(expected, targetSurface),
    path_count: paths.length,
    target_path_count: targetPaths.length,
    evidence_states: {
      E0_TARGET_EDGE: E0,
      E1_TARGET_PATH: E1,
      E2_TARGET_DOMAIN: E2,
      E3_TARGET_SAMEDOMAIN_POOL: E3,
      E4_TARGET_ASSEMBLED_SENTENCE: E4,
      E5_TARGET_KENLM_INPUT: E5,
      E6_TARGET_POST_KENLM: E6,
      E7_TARGET_POST_MODEL3: E7,
      E8_TARGET_FINAL: E8,
    },
    first_loss: firstLoss,
    observability_gap: observabilityGap,
    vote_retained_union: retainedUnion,
    vote_insufficient_any: voteInsufficientAny,
    target_has_domain_tag: targetHasDomainTag,
    kenlm: {
      global_cap: kenlmInput?.global_cap ?? null,
      truncated_count: kenlmInput?.truncated_count ?? null,
      combo_count: kenlmCombos.length,
      unique_before_cap_count: Array.isArray(kenlmUnique) ? kenlmUnique.length : null,
      target_in_combos: kenlmTargetInCombos,
      target_in_unique_before_cap: kenlmTargetInUnique.slice(0, 8),
      target_in_pruned: kenlmTargetInPruned.slice(0, 8),
      picked_text: picked,
      picked_is_raw: pickedIsRaw,
      top_candidates_sample: (topCands || []).slice(0, 8).map((t) =>
        typeof t === 'string' ? t : { text: t.text, score: t.score ?? t.delta }
      ),
    },
    spanV4_metrics_snip: {
      retainedDomains: spanV4.retainedDomains ?? null,
      insufficientEvidence: spanV4.insufficientEvidence ?? null,
      kenlmPoolCandidateCount: spanV4.kenlmPoolCandidateCount ?? null,
      sameDomainCandidateCount: spanV4.sameDomainCandidateCount ?? null,
      baseCandidateCount: spanV4.baseCandidateCount ?? null,
      crossPathTruncatedCount: spanV4.crossPathTruncatedCount ?? null,
      globalCandidateCap: spanV4.globalCandidateCap ?? null,
    },
    pathLedgers,
    schema_probe: {
      path_keys: paths[0] ? Object.keys(paths[0]) : [],
      raw_top_keys: raw && !Array.isArray(raw) ? Object.keys(raw) : [],
      kenlm_input_keys: kenlmInput ? Object.keys(kenlmInput) : [],
      kenlm_rerank_keys: kenlmRerank ? Object.keys(kenlmRerank) : [],
      after_m2_type: paths[0]
        ? {
            type: typeof paths[0].after_model2_candidates,
            isArray: Array.isArray(paths[0].after_model2_candidates),
            keys:
              paths[0].after_model2_candidates &&
              typeof paths[0].after_model2_candidates === 'object'
                ? Object.keys(paths[0].after_model2_candidates).slice(0, 12)
                : [],
            item0_keys: asArr(paths[0].after_model2_candidates)[0]
              ? Object.keys(asArr(paths[0].after_model2_candidates)[0]).slice(0, 20)
              : [],
          }
        : null,
    },
  };
}

const results = [];
const byCap = new Map();
for (const c of COHORT) {
  const key = c.cap.join('/');
  if (!byCap.has(key)) byCap.set(key, []);
  byCap.get(key).push(c);
}

for (const [capKey, group] of byCap) {
  const [a, c] = capKey.split('/').map(Number);
  console.log('START CAP', capKey);
  await start(a, c);
  for (const item of group) {
    try {
      const { data, cached, caseRow, evidence } = await runOne(item.caseId);
      const row = analyze(item.caseId, item.target, item.cap, data, cached, caseRow, evidence);
      results.push(row);
      console.log(
        JSON.stringify({
          caseId: item.caseId,
          E: row.evidence_states,
          first_loss: row.first_loss,
          final: row.final,
          retained: row.vote_retained_union,
          candHit: row.pathLedgers[0]?.target_surface_in_candidates,
          asmHit: row.pathLedgers[0]?.assembly_has_target_surface,
          kenlmHit: row.kenlm.target_in_combos.length,
          kenlmPruned: row.kenlm.target_in_pruned.length,
        })
      );
    } catch (e) {
      console.error('FAIL', item.caseId, e);
      results.push({ caseId: item.caseId, error: String(e?.stack || e) });
      await start(a, c);
    }
  }
  killPort(5020);
}

fs.writeFileSync(
  path.join(OUT, '_post_path_survival_first_loss_trace.json'),
  JSON.stringify(results, null, 2),
  'utf8'
);
console.log('DONE', results.length);
