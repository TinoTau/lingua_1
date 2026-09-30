#!/usr/bin/env node
/**
 * READ_ONLY ??Dialog200 End-to-End Correct-Candidate Funnel Audit V1
 * PRIMARY = production default path caps 8/8 (NO LINGUA_EXPERIMENT_MAX_*)
 * DIAGNOSTIC higher-cap = optional secondary only for PATH_CAP counterfactual.
 *
 * Usage:
 *   node tests/audit-dialog200-e2e-correct-candidate-funnel.mjs
 *   node tests/audit-dialog200-e2e-correct-candidate-funnel.mjs --skip-build
 *   node tests/audit-dialog200-e2e-correct-candidate-funnel.mjs --analyze-only --run-id <id>
 *   node tests/audit-dialog200-e2e-correct-candidate-funnel.mjs --limit 5
 *   node tests/audit-dialog200-e2e-correct-candidate-funnel.mjs --path-cap-diagnostic
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { resolveDialog200BaselineSsot } from './lib/dialog200-baseline-ssot.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import {
  norm,
  deriveCorrectionUnits,
  collectTraceCandidates,
  collectAssemblyTexts,
  collectKenlmTexts,
  candidateLexicalMatchesUnit,
} from './lib/materializable-target-v1.mjs';
import {
  resolveLexicalTargetAuthority,
  asReferenceDiffRegions,
  hasAcousticToneEvidence,
  measureBaseToneExactRecall,
  measureModel2PCapability,
  classifyRecallInvocation,
  isFailState,
  isSkipState,
  ReplayMode,
  MeasurementStatus,
} from './lib/evaluation-ssot-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');
const PHASE = 'LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_AUDIT_V1';
const MIN_DELTA = 3.0;

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const skipBuild = args.includes('--skip-build');
const analyzeOnly = args.includes('--analyze-only');
const pathCapDiagnostic = args.includes('--path-cap-diagnostic');
const useLexiconMockReplay = args.includes('--lexicon-mock-replay') || !args.includes('--live-asr');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
const FRESH_ASR_DUMP = resolveDialog200BaselineSsot().evidencePath; // SSOT — retired incomplete dump
const runIdIdx = args.indexOf('--run-id');
const RUN_ID =
  runIdIdx >= 0
    ? String(args[runIdIdx + 1] || '').trim()
    : `dialog200_e2e_funnel_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 480;
})();

const TRACE_JSONL = path.join(OUT_DIR, 'LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_TRACE_V1.jsonl');
const SUMMARY_JSON = path.join(OUT_DIR, 'LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_SUMMARY_V1.json');
const REPORT_MD = path.join(OUT_DIR, 'LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_AUDIT_V1.md');
const RAW_DUMP = path.join(OUT_DIR, `_e2e_funnel_raw_${RUN_ID}.jsonl`);

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function gitShort() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  return (r.stdout || '').trim() || null;
}
function asArr(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.items)) return x.items;
  return [];
}
function pct(n, d) {
  if (!d) return null;
  return Number(((100 * n) / d).toFixed(2));
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function fullSentenceMatch(text, expected) {
  return norm(text) === norm(expected);
}
function sentenceHasAllUnits(text, units, expNorm) {
  const t = norm(text);
  if (!t) return false;
  for (const u of units) {
    if (!u.is_reference_diff_hunk) continue;
    const e = norm(u.expected_text);
    if (e.length >= 2 && !t.includes(e)) return false;
  }
  // Prefer full equality when expected known
  if (expNorm && t === expNorm) return true;
  // If every required lexical unit present and length close ??still not full sentence PRESENT
  return false;
}

function candidateSourceBucket(c) {
  const src = String(c.source || c.provenance || '');
  const id = String(c.candidateId || c.termId || '');
  if (src === 'base_term' || id.startsWith('base-') || src === 'canonical') return 'BASE';
  if (src.includes('model2') || id.startsWith('m2') || src === 'passive_domain_weak') return 'MODEL2';
  if (src === 'domain_term') return 'DOMAIN';
  return 'OTHER';
}

function extractRichRecord(caseDef, data, wallMs, meta) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const spanV4 = fw.spanAssemblyV4 || {};
  const trace = extra.dialog200_path_trace || null;
  const paths = Array.isArray(trace) ? trace : trace?.paths || [];
  const kenlmInput = (!Array.isArray(trace) && trace?.kenlm_input) || null;
  const kenlmRerank = (!Array.isArray(trace) && trace?.kenlm_rerank) || null;
  const sr = fw.sentenceRerank || {};
  const asr = String(extra.raw_asr_text || '').trim();
  // Post-repair Chinese text (NOT NMT text_translated)
  const finalText = String(
    extra.fw_repair_normalized_text || data.text_asr || data.segmentForJobResult || ''
  ).trim();
  const expected = String(caseDef.expectedText || caseDef.utterance || '').trim();

  // Compact paths but keep fields needed for funnel
  const compactPaths = paths.map((p) => ({
    path_id: p.path_id,
    boundary_key: p.boundary_key,
    finespan_count: (p.finespans || []).length,
    finespans: (p.finespans || []).slice(0, 48).map((s) => ({
      span_id: s.span_id,
      syllable_start: s.syllable_start,
      syllable_end: s.syllable_end,
      start: s.start,
      end: s.end,
      source_text: s.source_text || s.text,
    })),
    base_candidates: asArr(p.base_candidates).slice(0, 80).map((c) => ({
      surface: c.surface,
      source: c.source,
      termId: c.termId || c.term_id,
      candidateId: c.candidateId,
      domains: c.domains || [],
      syllableStart: c.syllableStart ?? c.syllable_start,
      syllableEnd: c.syllableEnd ?? c.syllable_end,
      rawStart: c.rawStart ?? c.start,
      rawEnd: c.rawEnd ?? c.end,
    })),
    after_model2_candidates: asArr(p.after_model2_candidates).slice(0, 120).map((c) => ({
      surface: c.surface,
      source: c.source,
      termId: c.termId || c.term_id,
      candidateId: c.candidateId,
      domains: c.domains || [],
      syllableStart: c.syllableStart ?? c.syllable_start,
      syllableEnd: c.syllableEnd ?? c.syllable_end,
      rawStart: c.rawStart ?? c.start,
      rawEnd: c.rawEnd ?? c.end,
      provenance: c.provenance || null,
    })),
    model2: p.model2
      ? {
          status: p.model2.model2_status || p.model2.status || null,
          union_surfaces: asArr(p.model2?.union?.union_before_budget || p.model2?.union)
            .slice(0, 80)
            .map((c) => ({ surface: c.surface, source: c.source, termId: c.termId })),
          spans: (p.model2.spans || []).slice(0, 24).map((s) => ({
            span_id: s.span_id,
            p_hit_surfaces: (s.p_retrieval?.queries || [])
              .flatMap((q) => q.hits || [])
              .slice(0, 32)
              .map((h) => h.surface)
              .filter(Boolean),
            d_hit_surfaces: (s.d_retrieval?.hits || []).slice(0, 32).map((h) => h.surface).filter(Boolean),
          })),
        }
      : null,
    domain_vote: p.domain_vote || null,
    assembly: {
      sentence_count: p.assembly?.sentence_count ?? (p.assembly?.sentences || []).length,
      sentences: (p.assembly?.sentences || []).slice(0, 24).map((s) => ({
        text: s.text,
        score: s.score,
        replacements: s.replacements,
      })),
    },
    model3: p.model3
      ? {
          decisions_keep: (p.model3.decisions || []).filter((d) => d.decision === 'KEEP').length,
          decisions_retry: (p.model3.decisions || []).filter((d) => d.decision === 'RETRY').length,
          inference_ok: p.model3.inference_ok,
        }
      : null,
  }));

  return {
    phase: PHASE,
    run_id: meta.runId,
    caseId: caseDef.id,
    scenario: caseDef.scenario || null,
    diagnostic_cap: meta.capLabel || '8/8',
    primary_funnel: meta.primary !== false,
    reference: expected,
    rawMergedAsrText: asr,
    finalPostprocessText: finalText,
    wall_harness_ms: wallMs,
    pipeline_ms: extra.pipeline_ms ?? null,
    fw_detector_step_ms: extra.fw_detector_step_ms ?? null,
    lexicon_runtime_status: extra.lexicon_runtime_status || fw.runtime?.status || null,
    path_count: compactPaths.length,
    paths: compactPaths,
    kenlm_input: kenlmInput
      ? {
          combinations: (kenlmInput.combinations || []).slice(0, 24).map((c) => ({
            text: c.text,
            score: c.score,
            replacements: c.replacements,
          })),
          unique_before_cap: (kenlmInput.unique_before_cap || []).slice(0, 48).map((c) =>
            typeof c === 'string' ? c : c.text
          ),
          pruned: (kenlmInput.pruned || []).slice(0, 24).map((c) => ({
            text: typeof c === 'string' ? c : c.text,
            rank: c.rank,
            score: c.score,
          })),
          truncated_count: kenlmInput.truncated_count ?? null,
          global_cap: kenlmInput.global_cap ?? 16,
        }
      : null,
    kenlm_rerank: {
      picked_is_raw: kenlmRerank?.picked_is_raw ?? sr.pickedIsRaw ?? null,
      picked_text: kenlmRerank?.picked_text ?? sr.picked?.text ?? null,
      max_delta: kenlmRerank?.max_delta ?? sr.maxDelta ?? null,
      min_delta_to_replace: kenlmRerank?.min_delta_to_replace ?? sr.minDeltaToReplace ?? MIN_DELTA,
      kenlm_query_count: kenlmRerank?.kenlm_query_count ?? sr.kenlmQueryCount ?? null,
      kenlm_subprocess_ms: kenlmRerank?.kenlm_subprocess_ms ?? sr.kenlmSubprocessMs ?? fw.kenlmVetoMs ?? null,
      baseline_raw_score: sr.baselineRawScore ?? null,
      score_mode: sr.scoreMode ?? null,
      top_candidates: (kenlmRerank?.top_candidates || sr.topCandidates || []).slice(0, 8),
      all_combination_deltas: sr.allCombinationDeltas || null,
    },
    spanV4_metrics: {
      retainedDomains: spanV4.retainedDomains ?? null,
      insufficientEvidence: spanV4.insufficientEvidence ?? null,
      kenlmPoolCandidateCount: spanV4.kenlmPoolCandidateCount ?? null,
      sameDomainCandidateCount: spanV4.sameDomainCandidateCount ?? null,
      baseCandidateCount: spanV4.baseCandidateCount ?? null,
      crossPathTruncatedCount: spanV4.crossPathTruncatedCount ?? null,
      globalCandidateCap: spanV4.globalCandidateCap ?? null,
      crossPathUniqueCandidateCount: spanV4.crossPathUniqueCandidateCount ?? null,
      completePathCountBeforePrune: spanV4.latticeTrace?.completePathCountBeforePrune ?? spanV4.completePathCountBeforePrune ?? null,
      retainedCompletePathCount:
        spanV4.latticeTrace?.retainedCompletePathCount ?? spanV4.retainedCompletePathCount ?? compactPaths.length,
      prunedPathCount: spanV4.latticeTrace?.prunedPathCount ?? spanV4.prunedPathCount ?? null,
    },
    snapshot_ok: compactPaths.length > 0 || Boolean(asr),
    git_commit: meta.gitCommit,
  };
}

async function startServer(envExtra = {}, { needAsr = false } = {}) {
  killPort(5020);
  killPort(6007);
  await new Promise((r) => setTimeout(r, 2000));
  const child = spawn(process.execPath, [START_DETACHED], {
    cwd: ELECTRON,
    env: {
      ...process.env,
      PROJECT_ROOT: REPO,
      NODE_ENV: 'production',
      MODEL2_DIALOG200_TRACE: '1',
      ...envExtra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res) => child.on('exit', res));
  const port = getTestServerPort();
  const ok = await waitTestServerHealth(port, 180000);
  if (!ok) throw new Error('server unhealthy');
  if (needAsr) {
    const warmupWav = path.join(DIALOG_DIR, 'dialog_d001.wav');
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 300000,
      label: 'e2e-funnel-asr',
    });
    if (!asr?.ready) throw new Error('asr not ready');
  }
  return port;
}

async function runCaseLive(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `e2e-funnel-${jobId}`,
      utteranceIndex: 0,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

async function runCaseMock(port, asrText, jobId) {
  const sessionId = `e2e-mock-${jobId}`;
  await fetch(`http://127.0.0.1:${port}/session-bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, user_id: 'dialog200-e2e' }),
  });
  const res = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asrText,
      srcLang: 'zh',
      session_id: sessionId,
      is_manual_cut: true,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const data = await res.json();
  // Ensure raw ASR visible for accounting
  data.extra = data.extra || {};
  if (!data.extra.raw_asr_text) data.extra.raw_asr_text = asrText;
  return data;
}

function loadFrozenAsrByCaseId() {
  if (!fs.existsSync(FRESH_ASR_DUMP)) {
    throw new Error(`frozen ASR dump missing: ${FRESH_ASR_DUMP}`);
  }
  const map = {};
  for (const line of fs.readFileSync(FRESH_ASR_DUMP, 'utf8').trim().split(/\n/)) {
    if (!line) continue;
    const r = JSON.parse(line);
    const raw = r.asr?.rawMergedAsrText ?? r.rawMergedAsrText;
    if (r.caseId && raw) map[r.caseId] = raw;
  }
  return map;
}

function analyzeCase(rec) {
  const expected = rec.reference || '';
  const asr = rec.rawMergedAsrText || '';
  const finalText = rec.finalPostprocessText || '';
  const expNorm = norm(expected);
  const asrNorm = norm(asr);
  const finalNorm = norm(finalText);

  if (!expected || !expNorm) {
    return {
      caseId: rec.caseId,
      dataset_class: 'UNEVALUABLE',
      root_class: 'TEST_EVALUATOR_DEFECT',
      first_loss: 'TEST_EVALUATOR_DEFECT',
      note: 'missing expectedText',
    };
  }

  const asrAlreadyCorrect = asrNorm === expNorm;
  const finalCorrect = finalNorm === expNorm;
  const repairRequired = !asrAlreadyCorrect;

  const derived = deriveCorrectionUnits(asr, expected);
  const requiredUnits = derived.required_units.filter((u) => u.is_reference_diff_hunk);
  const referenceDiffRegions = asReferenceDiffRegions(requiredUnits);
  const lexicalAuth = resolveLexicalTargetAuthority({
    authoritativeLexicalTargets: rec.authoritativeLexicalTargets || rec.lexical_targets || null,
  });
  const toneAvailable = hasAcousticToneEvidence({
    hasAcousticTone: rec.hasAcousticTone,
    acousticToneSlices: rec.acousticToneSlices,
    tone: rec.paths?.[0]?.tone,
    pilot200_replay: rec.pilot200_replay === true,
  });
  const replayMode =
    rec.replayMode ||
    (rec.lexiconMockReplay === true || rec.mode === 'LEXICON_MOCK_REPLAY' || useLexiconMockReplay
      ? ReplayMode.LEXICON_MOCK_REPLAY
      : toneAvailable
        ? ReplayMode.AUDIO_REPLAY
        : ReplayMode.LEXICON_MOCK_REPLAY);

  // Build fake path_trace shape for collectTraceCandidates
  const path_trace = {
    paths: (rec.paths || []).map((p) => ({
      ...p,
      base_candidates: { items: p.base_candidates || [] },
      after_model2_candidates: { items: p.after_model2_candidates || [] },
      model2: p.model2
        ? {
            union: { items: (p.model2.union_surfaces || []).map((s) => ({ ...s })) },
            spans: (p.model2.spans || []).map((s) => ({
              span_id: s.span_id,
              p_retrieval: {
                queries: [{ hits: (s.p_hit_surfaces || []).map((surface) => ({ surface })) }],
              },
              d_retrieval: { hits: (s.d_hit_surfaces || []).map((surface) => ({ surface })) },
            })),
          }
        : null,
      assembly: p.assembly,
      domain_vote: p.domain_vote,
      finespans: p.finespans,
    })),
    kenlm_input: rec.kenlm_input,
  };

  const candPack = collectTraceCandidates(path_trace);
  const assemblyTexts = [
    ...collectAssemblyTexts(path_trace),
    ...(rec.paths || []).flatMap((p) => (p.assembly?.sentences || []).map((s) => s.text).filter(Boolean)),
  ];
  const kenlmCombos = (rec.kenlm_input?.combinations || []).map((c) => c.text).filter(Boolean);
  const uniqueBefore = (rec.kenlm_input?.unique_before_cap || []).filter(Boolean);
  const pruned = (rec.kenlm_input?.pruned || []).map((c) => c.text).filter(Boolean);

  // --- Target recall (term-level) ---
  let baseTarget = false;
  let model2Target = false;
  const matchedTargets = [];
  for (const unit of requiredUnits) {
    const hits = [];
    for (const c of candPack.all) {
      if (!candidateLexicalMatchesUnit(c, unit, asrNorm, expNorm)) continue;
      const bucket = candidateSourceBucket(c);
      hits.push({ surface: c.surface, bucket, source: c.source });
      if (bucket === 'BASE') baseTarget = true;
      if (bucket === 'MODEL2' || bucket === 'DOMAIN' || bucket === 'OTHER') model2Target = true;
    }
    // also scan union/p/d surfaces loosely
    for (const p of rec.paths || []) {
      for (const s of p.base_candidates || []) {
        if (norm(s.surface) === norm(unit.expected_text) || (unit.expected_text.length >= 2 && norm(s.surface).includes(norm(unit.expected_text)))) {
          baseTarget = true;
          hits.push({ surface: s.surface, bucket: 'BASE', source: s.source });
        }
      }
      for (const s of p.after_model2_candidates || []) {
        if (norm(s.surface) === norm(unit.expected_text) || (unit.expected_text.length >= 2 && norm(s.surface).includes(norm(unit.expected_text)))) {
          const b = candidateSourceBucket(s);
          if (b === 'BASE') baseTarget = true;
          else model2Target = true;
          hits.push({ surface: s.surface, bucket: b, source: s.source });
        }
      }
      for (const u of p.model2?.union_surfaces || []) {
        if (norm(u.surface) === norm(unit.expected_text)) {
          model2Target = true;
          hits.push({ surface: u.surface, bucket: 'MODEL2', source: u.source });
        }
      }
    }
    matchedTargets.push({ unit: unit.expected_text, hitCount: hits.length, hits: hits.slice(0, 8) });
  }

  const anyTargetHit = matchedTargets.some((t) => t.hitCount > 0) || requiredUnits.length === 0;
  let model2_target_source = 'NONE';
  if (baseTarget && model2Target) model2_target_source = 'BASE_AND_MODEL2';
  else if (baseTarget) model2_target_source = 'BASE_ONLY';
  else if (model2Target) model2_target_source = 'MODEL2_ONLY';
  else if (!repairRequired) model2_target_source = 'NOT_APPLICABLE';
  else model2_target_source = 'NONE';

  // Edge / path post-cap: any retained path with candidate matching a required unit
  let edgePresent = false;
  let pathPostCap = false;
  for (const p of rec.paths || []) {
    const cands = [...(p.base_candidates || []), ...(p.after_model2_candidates || [])];
    for (const unit of requiredUnits) {
      for (const c of cands) {
        if (!candidateLexicalMatchesUnit(c, unit, asrNorm, expNorm) && norm(c.surface) !== norm(unit.expected_text)) {
          continue;
        }
        edgePresent = true;
        pathPostCap = true;
      }
    }
    // finespan covering expected unit text in source_text
    for (const fs of p.finespans || []) {
      const st = norm(fs.source_text || '');
      for (const unit of requiredUnits) {
        if (unit.expected_text.length >= 2 && st.includes(norm(unit.expected_text))) {
          pathPostCap = true;
        }
      }
    }
  }
  if (!requiredUnits.length && repairRequired) {
    // non-lexical-only repair (script/punct) ??edge/path N/A
  }

  // Path pre-cap: only knowable if post-cap present OR lattice proves prune with diagnostic
  let pathPreCap = 'UNKNOWN';
  if (pathPostCap) pathPreCap = 'PRESENT';
  else if (!anyTargetHit) pathPreCap = 'NOT_APPLICABLE';
  else if ((rec.spanV4_metrics?.prunedPathCount || 0) === 0 && (rec.path_count || 0) > 0) {
    // no prune observed; target path never generated among completes
    pathPreCap = 'ABSENT';
  }

  // Domain
  let domainState = 'NOT_APPLICABLE';
  const retainedUnion = [
    ...new Set((rec.paths || []).flatMap((p) => p.domain_vote?.retained_domains || p.domain_vote?.retainedDomains || [])),
  ];
  const domainTaggedHits = matchedTargets.flatMap((t) => t.hits).filter((h) => h.bucket === 'DOMAIN');
  if (domainTaggedHits.length) {
    domainState = retainedUnion.length ? 'PRESENT' : 'ABSENT';
  }

  // SameDomain evidence: if target candidates present on a retained path ??PRESENT
  let sameDomain = 'UNKNOWN';
  if (!anyTargetHit) sameDomain = 'ABSENT';
  else if (pathPostCap || model2_target_source !== 'NONE') sameDomain = 'PRESENT';

  // Full sentence assembly
  const assembledFull = assemblyTexts.some((t) => fullSentenceMatch(t, expected));
  const preGlobalFull =
    assembledFull ||
    uniqueBefore.some((t) => fullSentenceMatch(t, expected)) ||
    pruned.some((t) => fullSentenceMatch(t, expected));
  const kenlmInputFull = kenlmCombos.some((t) => fullSentenceMatch(t, expected));
  const prunedFull = pruned.filter((t) => fullSentenceMatch(t, expected));
  const uniqueFullRank = uniqueBefore.findIndex((t) => fullSentenceMatch(t, expected));

  // KenLM ranking / gate
  const top = rec.kenlm_rerank?.top_candidates || [];
  const deltas = rec.kenlm_rerank?.all_combination_deltas || [];
  let kenlmRank = null;
  let kenlmDelta = null;
  let top1IsCorrect = false;
  let kenlmRuntimeZero = false;
  let kenlmFailOpen = false;

  if (kenlmInputFull) {
    // Find among combinations
    const idx = kenlmCombos.findIndex((t) => fullSentenceMatch(t, expected));
    if (idx >= 0 && Array.isArray(deltas) && deltas.length === kenlmCombos.length) {
      kenlmDelta = deltas[idx];
      // rank by delta desc among candidates (+ raw as competitor for display)
      const scored = kenlmCombos.map((t, i) => ({ t, d: deltas[i], i }));
      scored.sort((a, b) => b.d - a.d);
      kenlmRank = scored.findIndex((x) => x.i === idx) + 1;
    }
    // topCandidates include raw
    const topHit = top.find((c) => fullSentenceMatch(c.text, expected));
    if (topHit) {
      kenlmDelta = topHit.deltaVsRaw ?? kenlmDelta;
      kenlmRank = topHit.rank ?? kenlmRank;
    }
    const top1 = top[0];
    if (top1 && fullSentenceMatch(top1.text, expected) && top1.isRaw !== true) top1IsCorrect = true;
    // If raw is top1 and equals expected ??already correct ASR case
    if (top1 && top1.isRaw && fullSentenceMatch(top1.text, expected)) top1IsCorrect = true;

    const scores = top.map((c) => c.kenlmScore).filter((x) => typeof x === 'number');
    const allZero = scores.length > 0 && scores.every((s) => s === 0);
    const subMs = rec.kenlm_rerank?.kenlm_subprocess_ms;
    const qn = rec.kenlm_rerank?.kenlm_query_count;
    if (allZero && (subMs === 0 || subMs == null) && qn > 0) {
      kenlmRuntimeZero = true;
      kenlmFailOpen = true;
    }
    if ((rec.kenlm_rerank?.max_delta === 0 || rec.kenlm_rerank?.max_delta == null) && allZero) {
      kenlmRuntimeZero = true;
    }
  }

  // If correct is KenLM #1 among candidates by maxDelta pointing at it
  const maxDelta = rec.kenlm_rerank?.max_delta;
  const pickedIsRaw = rec.kenlm_rerank?.picked_is_raw;
  const minDelta = rec.kenlm_rerank?.min_delta_to_replace ?? MIN_DELTA;
  if (!top1IsCorrect && kenlmInputFull && typeof maxDelta === 'number' && Array.isArray(deltas)) {
    const idx = kenlmCombos.findIndex((t) => fullSentenceMatch(t, expected));
    if (idx >= 0 && Math.abs((deltas[idx] ?? -999) - maxDelta) < 1e-9 && maxDelta === Math.max(...deltas)) {
      top1IsCorrect = true;
      kenlmRank = 1;
      kenlmDelta = deltas[idx];
    }
  }

  let gateAccepted = null;
  if (top1IsCorrect) {
    gateAccepted = pickedIsRaw === false;
  }

  // Evidence states ? EVALUATION_SSOT_V1: E1 is LEXICAL_TARGET recall, not REFERENCE_DIFF presence.
  // Without authoritative lexical annotation and/or acoustic tone (lexicon-mock), E1 = NOT_EVALUABLE.
  const recallUnitsForHit =
    lexicalAuth.status === 'RESOLVED'
      ? requiredUnits.filter((u) => lexicalAuth.surfaces.some((s) => norm(s) === norm(u.expected_text)))
      : [];
  let E1_TARGET_RECALL;
  if (!repairRequired) {
    E1_TARGET_RECALL = 'NOT_APPLICABLE';
  } else if (lexicalAuth.status !== 'RESOLVED') {
    E1_TARGET_RECALL = 'NOT_EVALUABLE';
  } else if (replayMode === ReplayMode.LEXICON_MOCK_REPLAY && !toneAvailable) {
    E1_TARGET_RECALL = 'NOT_EVALUABLE';
  } else if (recallUnitsForHit.length === 0 && lexicalAuth.surfaces.length > 0) {
    // Authority exists but no matching diff unit ? still evaluate by surface hit on candidates
    E1_TARGET_RECALL = anyTargetHit ? 'PRESENT' : 'ABSENT';
  } else {
    E1_TARGET_RECALL = anyTargetHit ? 'PRESENT' : 'ABSENT';
  }

  const baseToneMeasure = measureBaseToneExactRecall({
    replayMode,
    hasAcousticTone: toneAvailable,
    authoritativeLexicalTargets: lexicalAuth.surfaces,
    recallFunctionCalled: true,
    validToneExactQueryExecuted: toneAvailable === true,
    baseTargetPresent: baseTarget,
    lexiconMockReplay: replayMode === ReplayMode.LEXICON_MOCK_REPLAY,
  });
  const model2PMeasure = measureModel2PCapability({
    replayMode,
    p_feature_presence: rec.model2_p_feature_presence === true,
    p_feature_presence_windows: rec.model2_p_feature_windows || 0,
    authoritativeLexicalTargets: lexicalAuth.surfaces,
    model2PTargetGenerated: model2Target,
    lexiconMockReplay: replayMode === ReplayMode.LEXICON_MOCK_REPLAY,
  });
  const recallInvocation = classifyRecallInvocation({
    recallFunctionCalled: true,
    hasAcousticTone: toneAvailable,
    validToneExactQueryExecuted: toneAvailable === true,
    baseTargetPresent: baseTarget,
  });

  const E = {
    E0_RAW_ASR: asrAlreadyCorrect ? 'ALREADY_CORRECT' : 'NEEDS_REPAIR',
    E1_TARGET_RECALL,
    E2_TARGET_EDGE: !repairRequired
      ? 'NOT_APPLICABLE'
      : referenceDiffRegions.length === 0
        ? 'NOT_APPLICABLE'
        : E1_TARGET_RECALL === 'NOT_EVALUABLE'
          ? 'NOT_EVALUABLE'
          : edgePresent
            ? 'PRESENT'
            : anyTargetHit
              ? 'UNKNOWN'
              : 'ABSENT',
    E3_TARGET_PATH_PRE_CAP: !repairRequired
      ? 'NOT_APPLICABLE'
      : E1_TARGET_RECALL === 'NOT_EVALUABLE'
        ? 'NOT_EVALUABLE'
        : pathPreCap === 'PRESENT'
          ? 'PRESENT'
          : pathPreCap === 'ABSENT'
            ? 'ABSENT'
            : anyTargetHit
              ? 'UNKNOWN'
              : 'NOT_APPLICABLE',
    E4_TARGET_PATH_POST_CAP: !repairRequired
      ? 'NOT_APPLICABLE'
      : E1_TARGET_RECALL === 'NOT_EVALUABLE'
        ? 'NOT_EVALUABLE'
        : referenceDiffRegions.length === 0
          ? 'NOT_APPLICABLE'
          : pathPostCap
            ? 'PRESENT'
            : anyTargetHit
              ? 'ABSENT'
              : 'NOT_APPLICABLE',
    E5_TARGET_DOMAIN: domainState,
    E6_TARGET_SAMEDOMAIN_EVIDENCE: !repairRequired ? 'NOT_APPLICABLE' : sameDomain,
    E7_CORRECT_FULL_SENTENCE_ASSEMBLED: !repairRequired ? 'NOT_APPLICABLE' : assembledFull ? 'PRESENT' : 'ABSENT',
    E8_CORRECT_FULL_SENTENCE_PRE_GLOBAL_CAP: !repairRequired
      ? 'NOT_APPLICABLE'
      : preGlobalFull
        ? 'PRESENT'
        : assembledFull
          ? 'PRESENT'
          : 'ABSENT',
    E9_CORRECT_FULL_SENTENCE_KENLM_INPUT: !repairRequired
      ? 'NOT_APPLICABLE'
      : kenlmInputFull
        ? 'PRESENT'
        : 'ABSENT',
    E10_KENLM_RANK: !kenlmInputFull
      ? 'NOT_APPLICABLE'
      : kenlmRuntimeZero
        ? 'RUNTIME_ZERO'
        : top1IsCorrect
          ? 'RANK1'
          : kenlmRank != null
            ? kenlmRank <= 3
              ? 'RANK2_3'
              : 'RANK_GT3'
            : 'UNKNOWN',
    E11_KENLM_APPLY_GATE: !top1IsCorrect
      ? 'NOT_APPLICABLE'
      : gateAccepted
        ? 'ACCEPTED'
        : 'REJECTED',
    E12_POST_MODEL3: 'NOT_APPLICABLE', // Model3 does not own final sentence pick in this chain
    E13_FINAL: finalCorrect ? 'PRESENT' : 'ABSENT',
  };

  // FIRST LOSS
  let first_loss = null;
  let root_class = null;
  let observability_gap = false;

  if (!repairRequired) {
    first_loss = finalCorrect ? 'NONE_ASR_ALREADY_CORRECT' : 'FINAL_SELECTION';
    root_class = finalCorrect ? 'EXPECTED_FAILURE' : 'OBSERVABILITY_GAP';
  } else if (finalCorrect) {
    first_loss = 'NONE_FINAL_CORRECT';
    root_class = 'EXPECTED_FAILURE';
  } else {
    const chain = [
      ['E1_TARGET_RECALL', E.E1_TARGET_RECALL, 'BASE_RECALL_OR_MODEL2'],
      ['E2_TARGET_EDGE', E.E2_TARGET_EDGE, 'LEXICAL_EDGE'],
      ['E3_TARGET_PATH_PRE_CAP', E.E3_TARGET_PATH_PRE_CAP, 'PATH_GENERATION'],
      ['E4_TARGET_PATH_POST_CAP', E.E4_TARGET_PATH_POST_CAP, 'PATH_CAP'],
      ['E5_TARGET_DOMAIN', E.E5_TARGET_DOMAIN, 'DOMAIN_VOTE'],
      ['E6_TARGET_SAMEDOMAIN_EVIDENCE', E.E6_TARGET_SAMEDOMAIN_EVIDENCE, 'SAMEDOMAIN'],
      ['E7_CORRECT_FULL_SENTENCE_ASSEMBLED', E.E7_CORRECT_FULL_SENTENCE_ASSEMBLED, 'ASSEMBLY'],
      ['E8_CORRECT_FULL_SENTENCE_PRE_GLOBAL_CAP', E.E8_CORRECT_FULL_SENTENCE_PRE_GLOBAL_CAP, 'ASSEMBLY'],
      ['E9_CORRECT_FULL_SENTENCE_KENLM_INPUT', E.E9_CORRECT_FULL_SENTENCE_KENLM_INPUT, 'SENTENCE_CANDIDATE_BUDGET'],
      ['E10_KENLM_RANK', E.E10_KENLM_RANK, 'KENLM_RANKING'],
      ['E11_KENLM_APPLY_GATE', E.E11_KENLM_APPLY_GATE, 'KENLM_APPLY_GATE'],
      ['E13_FINAL', E.E13_FINAL, 'FINAL_SELECTION'],
    ];

    // Special: E8 PRESENT E9 ABSENT ??budget (even if E7 ABSENT but pre-global from unique/pruned)
    if (E.E8_CORRECT_FULL_SENTENCE_PRE_GLOBAL_CAP === 'PRESENT' && E.E9_CORRECT_FULL_SENTENCE_KENLM_INPUT === 'ABSENT') {
      first_loss = 'SENTENCE_CANDIDATE_BUDGET';
      root_class = 'EXPECTED_FAILURE';
    } else if (E.E10_KENLM_RANK === 'RUNTIME_ZERO') {
      first_loss = 'KENLM_RUNTIME';
      root_class = 'OBSERVABILITY_GAP'; // fail-open contracted; scorer unavailability root unknown
      observability_gap = true;
    } else if (E.E10_KENLM_RANK === 'RANK1' && E.E11_KENLM_APPLY_GATE === 'REJECTED') {
      first_loss = 'KENLM_APPLY_GATE';
      root_class = 'EXPECTED_FAILURE'; // gate contract; secondary DATA_MODEL margin
    } else if (['RANK2_3', 'RANK_GT3'].includes(E.E10_KENLM_RANK)) {
      first_loss = 'KENLM_RANKING';
      root_class = 'DATA_TRAINING_FAILURE';
    } else {
      let prevPresent = false;
      for (const [name, st, lossName] of chain) {
        if (st === 'NOT_APPLICABLE' || st === 'ALREADY_CORRECT' || st === 'NOT_EVALUABLE') continue;
        if (st === 'PRESENT' || st === 'RANK1' || st === 'ACCEPTED') {
          prevPresent = true;
          continue;
        }
        if (st === 'UNKNOWN' && (prevPresent || name === 'E2_TARGET_EDGE' || name === 'E3_TARGET_PATH_PRE_CAP')) {
          // E2/E3 unknown with recall present ? observability, don't claim PATH_CAP
          if (name === 'E3_TARGET_PATH_PRE_CAP' && E.E4_TARGET_PATH_POST_CAP === 'ABSENT') {
            first_loss = 'PATH_CAP';
            root_class = 'OBSERVABILITY_GAP'; // cannot prove pre-cap without diagnostic
            observability_gap = true;
            break;
          }
          first_loss = 'OBSERVABILITY_GAP';
          root_class = 'OBSERVABILITY_GAP';
          observability_gap = true;
          break;
        }
        if (st === 'ABSENT' || st === 'REJECTED' || st === 'RUNTIME_ZERO') {
          if (name === 'E4_TARGET_PATH_POST_CAP' && E.E3_TARGET_PATH_PRE_CAP === 'UNKNOWN') {
            first_loss = 'PATH_CAP';
            root_class = 'OBSERVABILITY_GAP';
            observability_gap = true;
          } else if (name === 'E9_CORRECT_FULL_SENTENCE_KENLM_INPUT' && E.E8_CORRECT_FULL_SENTENCE_PRE_GLOBAL_CAP !== 'PRESENT') {
            first_loss = 'ASSEMBLY';
            root_class = 'EXPECTED_FAILURE';
          } else if (lossName === 'BASE_RECALL_OR_MODEL2') {
            // Must not emit DATA_TRAINING Base/Model2 FAIL under NOT_EVALUABLE upstream;
            // only reached when E1 was ABSENT with full measurement authority.
            first_loss = 'BASE_RECALL_OR_MODEL2';
            root_class = 'DATA_TRAINING_FAILURE';
          } else {
            first_loss = lossName;
            root_class =
              lossName === 'KENLM_RANKING'
                ? 'DATA_TRAINING_FAILURE'
                : 'EXPECTED_FAILURE';
          }
          break;
        }
      }
      if (!first_loss) {
        if (E.E1_TARGET_RECALL === 'NOT_EVALUABLE') {
          first_loss = 'NOT_EVALUABLE_UPSTREAM_RECALL';
          root_class = 'OBSERVABILITY_GAP';
          observability_gap = true;
        } else {
          first_loss = 'OTHER';
          root_class = 'OBSERVABILITY_GAP';
          observability_gap = true;
        }
      }
    }
  }

  return {
    caseId: rec.caseId,
    scenario: rec.scenario,
    diagnostic_cap: rec.diagnostic_cap,
    primary_funnel: rec.primary_funnel !== false,
    asr,
    expected,
    final: finalText,
    asr_already_correct: asrAlreadyCorrect,
    repair_required: repairRequired,
    final_correct: finalCorrect,
    required_lexical_units: [], // retired: was INVALID_LEXICAL_AUTHORITY_USE of REFERENCE_DIFF
    reference_diff_regions: referenceDiffRegions.map((r) => r.expected_text),
    lexical_target_authority: lexicalAuth.status,
    authoritative_lexical_targets: lexicalAuth.surfaces,
    measurement: {
      base_tone_exact: baseToneMeasure,
      model2_p: model2PMeasure,
      recall_invocation: recallInvocation,
      replay_mode: replayMode,
      tone_available: toneAvailable,
    },
    model2_target_source,
    base_target: baseTarget,
    model2_target: model2Target,
    evidence: E,
    kenlm_rank: kenlmRank,
    kenlm_delta: kenlmDelta,
    kenlm_max_delta: maxDelta,
    kenlm_min_delta: minDelta,
    kenlm_top1_correct: top1IsCorrect,
    kenlm_gate_accepted: gateAccepted,
    kenlm_picked_is_raw: pickedIsRaw,
    kenlm_runtime_zero: kenlmRuntimeZero,
    kenlm_fail_open: kenlmFailOpen,
    assembled_full: assembledFull,
    pre_global_full: preGlobalFull,
    kenlm_input_full: kenlmInputFull,
    unique_before_cap_count: uniqueBefore.length || null,
    truncated_count: rec.kenlm_input?.truncated_count ?? rec.spanV4_metrics?.crossPathTruncatedCount ?? null,
    global_cap: rec.kenlm_input?.global_cap ?? 16,
    target_pre_cap_rank: uniqueFullRank >= 0 ? uniqueFullRank + 1 : null,
    pruned_full_count: prunedFull.length,
    path_count: rec.path_count,
    retained_domains: retainedUnion,
    complete_before_prune: rec.spanV4_metrics?.completePathCountBeforePrune ?? null,
    retained_complete: rec.spanV4_metrics?.retainedCompletePathCount ?? null,
    pruned_path_count: rec.spanV4_metrics?.prunedPathCount ?? null,
    first_loss,
    root_class,
    observability_gap,
    matched_targets: matchedTargets.slice(0, 8),
  };
}

function buildSummary(ledgers, diagnosticLedgers = []) {
  const total = ledgers.length;
  const asrCorrect = ledgers.filter((r) => r.asr_already_correct).length;
  const unevaluable = ledgers.filter((r) => r.dataset_class === 'UNEVALUABLE').length;
  const repair = ledgers.filter((r) => r.repair_required && r.dataset_class !== 'UNEVALUABLE');
  const n0 = repair.length;
  const finalCorrectAll = ledgers.filter((r) => r.final_correct).length;
  const finalIncorrectAll = total - finalCorrectAll - unevaluable;

  const stageDefs = [
    ['N1_TARGET_RECALL', (r) => r.evidence.E1_TARGET_RECALL === 'PRESENT'],
    ['N2_TARGET_EDGE', (r) => r.evidence.E2_TARGET_EDGE === 'PRESENT'],
    ['N3_PATH_PRE_CAP', (r) => r.evidence.E3_TARGET_PATH_PRE_CAP === 'PRESENT'],
    ['N4_PATH_POST_CAP', (r) => r.evidence.E4_TARGET_PATH_POST_CAP === 'PRESENT'],
    ['N5_DOMAIN', (r) => r.evidence.E5_TARGET_DOMAIN === 'PRESENT' || r.evidence.E5_TARGET_DOMAIN === 'NOT_APPLICABLE'],
    ['N6_SAMEDOMAIN', (r) => r.evidence.E6_TARGET_SAMEDOMAIN_EVIDENCE === 'PRESENT'],
    ['N7_ASSEMBLED_FULL', (r) => r.evidence.E7_CORRECT_FULL_SENTENCE_ASSEMBLED === 'PRESENT'],
    ['N8_PRE_GLOBAL_CAP', (r) => r.evidence.E8_CORRECT_FULL_SENTENCE_PRE_GLOBAL_CAP === 'PRESENT'],
    ['N9_KENLM_INPUT', (r) => r.evidence.E9_CORRECT_FULL_SENTENCE_KENLM_INPUT === 'PRESENT'],
    ['N10_KENLM_RANK1', (r) => r.evidence.E10_KENLM_RANK === 'RANK1'],
    ['N11_GATE_PASSED', (r) => r.evidence.E11_KENLM_APPLY_GATE === 'ACCEPTED'],
    ['N13_FINAL_CORRECT', (r) => r.final_correct === true],
  ];

  const funnel = { N0_REPAIR_REQUIRED: { count: n0, pct_of_n0: 100 } };
  let prevCount = n0;
  for (const [name, pred] of stageDefs) {
    const applicable = repair.filter((r) => {
      // skip N/A stages from conversion denom where appropriate
      if (name === 'N5_DOMAIN') return true;
      return true;
    });
    const count = applicable.filter(pred).length;
    funnel[name] = {
      count,
      pct_of_n0: pct(count, n0),
      loss_from_prev: prevCount - count,
      conversion_from_prev_pct: pct(count, prevCount),
    };
    prevCount = count;
  }

  const failed = repair.filter((r) => !r.final_correct);
  const firstLossDist = {};
  for (const r of failed) {
    const k = r.first_loss || 'OTHER';
    if (!firstLossDist[k]) firstLossDist[k] = { count: 0, root_classes: {} };
    firstLossDist[k].count += 1;
    firstLossDist[k].root_classes[r.root_class || 'UNKNOWN'] =
      (firstLossDist[k].root_classes[r.root_class || 'UNKNOWN'] || 0) + 1;
  }
  const firstLossTable = Object.entries(firstLossDist)
    .map(([k, v]) => ({
      first_loss: k,
      count: v.count,
      pct_failed: pct(v.count, failed.length),
      root_classes: v.root_classes,
    }))
    .sort((a, b) => b.count - a.count);

  const model2Only = repair.filter((r) => r.model2_target_source === 'MODEL2_ONLY');
  const model2Table = {
    base_target_recall: repair.filter((r) => r.base_target).length,
    model2_target_recall: repair.filter((r) => r.model2_target).length,
    model2_only_recovery: model2Only.length,
    base_and_model2: repair.filter((r) => r.model2_target_source === 'BASE_AND_MODEL2').length,
    no_target_after_model2: repair.filter((r) => r.model2_target_source === 'NONE').length,
    model2_only_to_edge: model2Only.filter((r) => r.evidence.E2_TARGET_EDGE === 'PRESENT').length,
    model2_only_to_path_post: model2Only.filter((r) => r.evidence.E4_TARGET_PATH_POST_CAP === 'PRESENT').length,
    model2_only_to_assembly: model2Only.filter((r) => r.assembled_full).length,
    model2_only_to_kenlm: model2Only.filter((r) => r.kenlm_input_full).length,
    model2_only_to_final: model2Only.filter((r) => r.final_correct).length,
    model2_as_first_loss: failed.filter((r) => r.first_loss === 'BASE_RECALL_OR_MODEL2').length,
    failures_after_model2_present: failed.filter(
      (r) => r.evidence.E1_TARGET_RECALL === 'PRESENT' && r.first_loss !== 'BASE_RECALL_OR_MODEL2'
    ).length,
  };

  const kenlmReach = {
    assembled_full: repair.filter((r) => r.assembled_full).length,
    pre_global_full: repair.filter((r) => r.pre_global_full).length,
    entered_kenlm: repair.filter((r) => r.kenlm_input_full).length,
    lost_by_global_16: repair.filter(
      (r) => r.pre_global_full && !r.kenlm_input_full
    ).length,
    kenlm_rank1: repair.filter((r) => r.kenlm_top1_correct).length,
    kenlm_non_rank1: repair.filter(
      (r) => r.kenlm_input_full && !r.kenlm_top1_correct && !r.kenlm_runtime_zero
    ).length,
    rank1_accepted: repair.filter((r) => r.kenlm_top1_correct && r.kenlm_gate_accepted === true).length,
    rank1_rejected_gate: repair.filter((r) => r.kenlm_top1_correct && r.kenlm_gate_accepted === false)
      .length,
    runtime_zero: repair.filter((r) => r.kenlm_runtime_zero).length,
  };

  const rank1Deltas = repair
    .filter((r) => r.kenlm_top1_correct && typeof r.kenlm_delta === 'number')
    .map((r) => r.kenlm_delta)
    .sort((a, b) => a - b);
  const gateDeltaDist = {
    n: rank1Deltas.length,
    min: rank1Deltas[0] ?? null,
    p25: percentile(rank1Deltas, 25),
    median: percentile(rank1Deltas, 50),
    p75: percentile(rank1Deltas, 75),
    max: rank1Deltas[rank1Deltas.length - 1] ?? null,
    note: 'KENLM_GATE_CALIBRATION_NOT_AUTHORIZED_FROM_THIS_AUDIT',
  };

  const topLoss = firstLossTable[0]?.first_loss || null;
  let resultEnum = 'RESULT F ??MULTIPLE COMPARABLE BLOCKERS';
  if (firstLossTable.length === 0) resultEnum = 'RESULT F ??MULTIPLE COMPARABLE BLOCKERS';
  else if (unevaluable > n0 * 0.3) resultEnum = 'RESULT H ??TEST / EVALUATOR QUALITY PREVENTS RELIABLE FUNNEL';
  else if (failed.filter((r) => r.observability_gap).length > failed.length * 0.4) {
    resultEnum = 'RESULT G ??OBSERVABILITY INSUFFICIENT FOR SYSTEM-LEVEL CONCLUSION';
  } else {
    const c0 = firstLossTable[0]?.count || 0;
    const c1 = firstLossTable[1]?.count || 0;
    if (c0 >= (c1 || 0) * 1.5) {
      if (topLoss === 'BASE_RECALL_OR_MODEL2') resultEnum = 'RESULT A ??UPSTREAM RECALL / MODEL2 REMAINS PRIMARY BLOCKER';
      else if (topLoss === 'PATH_CAP' || topLoss === 'PATH_GENERATION' || topLoss === 'LEXICAL_EDGE')
        resultEnum = 'RESULT B ??PATH GENERATION / PATH CAP REMAINS PRIMARY BLOCKER';
      else if (['DOMAIN_VOTE', 'SAMEDOMAIN', 'ASSEMBLY'].includes(topLoss))
        resultEnum = 'RESULT C ??DOMAIN / SAMEDOMAIN / ASSEMBLY REMAINS PRIMARY BLOCKER';
      else if (topLoss === 'SENTENCE_CANDIDATE_BUDGET')
        resultEnum = 'RESULT D ??SENTENCE CANDIDATE BUDGET IS PRIMARY BLOCKER';
      else if (['KENLM_RANKING', 'KENLM_APPLY_GATE', 'KENLM_RUNTIME'].includes(topLoss))
        resultEnum = 'RESULT E ??KENLM RANKING / GATE IS PRIMARY BLOCKER';
      else resultEnum = 'RESULT F ??MULTIPLE COMPARABLE BLOCKERS';
    } else resultEnum = 'RESULT F ??MULTIPLE COMPARABLE BLOCKERS';
  }

  const kenlmBlockerShare =
    pct(
      failed.filter((r) =>
        ['KENLM_RANKING', 'KENLM_APPLY_GATE', 'KENLM_RUNTIME'].includes(r.first_loss)
      ).length,
      failed.length
    ) || 0;
  const kenlmIsPrimary =
    kenlmBlockerShare >= 40 && ['KENLM_RANKING', 'KENLM_APPLY_GATE', 'KENLM_RUNTIME'].includes(topLoss)
      ? 'YES'
      : kenlmBlockerShare >= 20
        ? 'PARTIALLY'
        : 'NO';

  return {
    phase: PHASE,
    run_id: RUN_ID,
    primary_path_cap: '8/8',
    path_cap_note: 'PRIMARY FUNNEL = production default 8/8; higher-cap is DIAGNOSTIC ONLY',
    dataset: {
      TOTAL_CASES: total,
      ASR_ALREADY_CORRECT: asrCorrect,
      ASR_NEEDS_REPAIR: n0,
      REPAIR_REQUIRED_EVALUABLE: n0,
      FINAL_CORRECT: finalCorrectAll,
      FINAL_INCORRECT: finalIncorrectAll,
      UNEVALUABLE: unevaluable,
      pct_asr_correct: pct(asrCorrect, total),
      pct_repair_required: pct(n0, total),
      pct_final_correct: pct(finalCorrectAll, total),
    },
    funnel,
    first_loss_table: firstLossTable,
    model2: model2Table,
    kenlm_reachability: kenlmReach,
    kenlm_gate_delta_distribution: gateDeltaDist,
    diagnostic_path_cap: diagnosticLedgers,
    result_enum: resultEnum,
    answers: {
      Q1_repair_required: n0,
      Q2_target_recall_present: funnel.N1_TARGET_RECALL.count,
      Q2_pct: `${funnel.N1_TARGET_RECALL.count} / ${n0} = ${funnel.N1_TARGET_RECALL.pct_of_n0}%`,
      Q3_path_pre_cap: funnel.N3_PATH_PRE_CAP.count,
      Q3_path_post_cap: funnel.N4_PATH_POST_CAP.count,
      Q4_assembled_full: funnel.N7_ASSEMBLED_FULL.count,
      Q4_pct: `${funnel.N7_ASSEMBLED_FULL.count} / ${n0} = ${funnel.N7_ASSEMBLED_FULL.pct_of_n0}%`,
      Q5_kenlm_input: funnel.N9_KENLM_INPUT.count,
      Q5_pct: `${funnel.N9_KENLM_INPUT.count} / ${n0} = ${funnel.N9_KENLM_INPUT.pct_of_n0}%`,
      Q6_rank1: kenlmReach.kenlm_rank1,
      Q6_non_rank1: kenlmReach.kenlm_non_rank1,
      Q6_runtime_zero: kenlmReach.runtime_zero,
      Q7_gate_accepted: kenlmReach.rank1_accepted,
      Q7_gate_rejected: kenlmReach.rank1_rejected_gate,
      Q8_largest_first_loss: topLoss,
      Q9_model2_first_loss_pct: pct(model2Table.model2_as_first_loss, failed.length),
      Q10_failures_after_model2_present: model2Table.failures_after_model2_present,
      Q11_kenlm_is_primary_blocker: kenlmIsPrimary,
      Q12_next_owner: firstLossTable[0]
        ? {
            owner: firstLossTable[0].first_loss,
            count: firstLossTable[0].count,
            rationale: 'largest first-loss count among REPAIR_REQUIRED failures; no production change authorized',
          }
        : null,
    },
  };
}

function renderReport(summary, ledgers) {
  const d = summary.dataset;
  const f = summary.funnel;
  const lines = [];
  lines.push('# Lingua1 ??Dialog200 End-to-End Correct-Candidate Funnel Audit V1');
  lines.push('');
  lines.push('```text');
  lines.push(`MODE = READ_ONLY / TRACE_FIRST / FULL_DATASET / NO_IMPLEMENTATION`);
  lines.push(`PHASE = ${PHASE}`);
  lines.push(`RUN_ID = ${summary.run_id}`);
  lines.push(`PRIMARY_PATH_CAP = 8/8 (production default)`);
  lines.push(`${summary.result_enum}`);
  lines.push('```');
  lines.push('');
  lines.push('## Table A ??Dataset Accounting');
  lines.push('');
  lines.push('| Metric | Count | % |');
  lines.push('|--------|------:|--:|');
  lines.push(`| TOTAL_CASES | ${d.TOTAL_CASES} | 100 |`);
  lines.push(`| ASR_ALREADY_CORRECT | ${d.ASR_ALREADY_CORRECT} | ${d.pct_asr_correct} |`);
  lines.push(`| REPAIR_REQUIRED_EVALUABLE | ${d.REPAIR_REQUIRED_EVALUABLE} | ${d.pct_repair_required} |`);
  lines.push(`| FINAL_CORRECT | ${d.FINAL_CORRECT} | ${d.pct_final_correct} |`);
  lines.push(`| FINAL_INCORRECT | ${d.FINAL_INCORRECT} | ${pct(d.FINAL_INCORRECT, d.TOTAL_CASES)} |`);
  lines.push(`| UNEVALUABLE | ${d.UNEVALUABLE} | ${pct(d.UNEVALUABLE, d.TOTAL_CASES)} |`);
  lines.push('');
  lines.push('## Table B ??Full Funnel (denominator = REPAIR_REQUIRED_EVALUABLE)');
  lines.push('');
  lines.push('| Stage | Present | % of N0 | Loss from prev |');
  lines.push('|-------|--------:|--------:|---------------:|');
  lines.push(`| N0 Repair Required | ${f.N0_REPAIR_REQUIRED.count} | 100 | ??|`);
  for (const k of Object.keys(f)) {
    if (k === 'N0_REPAIR_REQUIRED') continue;
    const row = f[k];
    lines.push(`| ${k} | ${row.count} | ${row.pct_of_n0} | ${row.loss_from_prev} |`);
  }
  lines.push('');
  lines.push('## Table C ??First Loss Distribution (failed repair cases)');
  lines.push('');
  lines.push('| First Loss | Count | % Failed | Root classes |');
  lines.push('|------------|------:|---------:|--------------|');
  for (const row of summary.first_loss_table) {
    lines.push(
      `| ${row.first_loss} | ${row.count} | ${row.pct_failed} | ${JSON.stringify(row.root_classes)} |`
    );
  }
  lines.push('');
  lines.push('## Table D ??Model2 Contribution');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|------:|');
  for (const [k, v] of Object.entries(summary.model2)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push('## Table E ??KenLM Reachability');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|------:|');
  for (const [k, v] of Object.entries(summary.kenlm_reachability)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push('### KenLM Rank1 delta vs raw (gate calibration NOT authorized)');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(summary.kenlm_gate_delta_distribution, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Required Answers Q1?Q12');
  lines.push('');
  for (const [k, v] of Object.entries(summary.answers)) {
    lines.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  lines.push('');
  lines.push('## Final Result');
  lines.push('');
  lines.push('```text');
  lines.push(summary.result_enum);
  lines.push('NO PRODUCTION CHANGE');
  lines.push('PATH_CAP / SENTENCE_CAP / minDeltaToReplace UNCHANGED');
  lines.push('```');
  lines.push('');
  lines.push('## Table F ??Case Ledger');
  lines.push('');
  lines.push('See `LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_TRACE_V1.jsonl` (one row per case).');
  lines.push('');
  lines.push('## Freeze');
  lines.push('');
  lines.push('```text');
  lines.push('Cases are evidence. Contracts define behavior.');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = loadDialog200Manifest(MANIFEST_PATH);
  let cases = manifest.cases || manifest;
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  if (!analyzeOnly) {
    if (!skipBuild) {
      console.log('[e2e] build:main');
      const b = spawnSync('npm', ['run', 'build:main'], { cwd: ELECTRON, encoding: 'utf8', shell: true });
      if (b.status !== 0) {
        console.error(b.stderr || b.stdout);
        process.exit(1);
      }
    }
    const gitCommit = gitShort();
    fs.writeFileSync(RAW_DUMP, '');
    const frozenAsr = useLexiconMockReplay ? loadFrozenAsrByCaseId() : null;
    let port;
    if (!skipStart) {
      port = await startServer({}, { needAsr: !useLexiconMockReplay });
    } else {
      port = getTestServerPort();
      await waitTestServerHealth(port, 60000);
    }
    console.log(
      `[e2e] PRIMARY 8/8 RUN_ID=${RUN_ID} cases=${cases.length} mode=${useLexiconMockReplay ? 'LEXICON_MOCK_REPLAY_FROZEN_ASR' : 'LIVE_ASR'}`
    );
    const deadline = Date.now() + maxMinutes * 60 * 1000;
    let n = 0;
    let failed = 0;
    for (const caseDef of cases) {
      if (Date.now() >= deadline) {
        console.error('[e2e] deadline');
        break;
      }
      const t0 = Date.now();
      try {
        let data;
        if (useLexiconMockReplay) {
          const asrText = frozenAsr[caseDef.id];
          if (!asrText) throw new Error(`no frozen ASR for ${caseDef.id}`);
          data = await runCaseMock(port, asrText, `${caseDef.id}-${Date.now()}`);
        } else {
          const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
          data = await runCaseLive(port, wavPath, `${caseDef.id}-${Date.now()}`);
        }
        const rec = extractRichRecord(caseDef, data, Date.now() - t0, {
          runId: RUN_ID,
          gitCommit,
          capLabel: '8/8',
          primary: true,
          inputMode: useLexiconMockReplay ? 'LEXICON_MOCK_REPLAY_FROZEN_ASR' : 'LIVE_ASR',
        });
        if (useLexiconMockReplay && !rec.rawMergedAsrText) {
          rec.rawMergedAsrText = frozenAsr[caseDef.id];
        }
        fs.appendFileSync(RAW_DUMP, JSON.stringify(rec) + '\n');
        n += 1;
        const rawOk = norm(rec.rawMergedAsrText) === norm(rec.reference);
        const finOk = norm(rec.finalPostprocessText) === norm(rec.reference);
        console.log(
          `[${caseDef.id}] raw=${rawOk ? 'Y' : 'N'} final=${finOk ? 'Y' : 'N'} paths=${rec.path_count} kenlm=${rec.kenlm_input?.combinations?.length ?? 0}`
        );
      } catch (e) {
        failed += 1;
        fs.appendFileSync(
          RAW_DUMP,
          JSON.stringify({ phase: PHASE, run_id: RUN_ID, caseId: caseDef.id, error: String(e.message || e), primary_funnel: true }) +
            '\n'
        );
        console.log(`[${caseDef.id}] ERROR`, e.message || e);
      }
    }
    console.log(`[e2e] primary done n=${n} failed=${failed}`);
    killPort(5020);
  }

  // Load raw dump (analyze-only may point at existing)
  const rawPath = analyzeOnly
    ? args.includes('--raw')
      ? args[args.indexOf('--raw') + 1]
      : RAW_DUMP
    : RAW_DUMP;
  if (!fs.existsSync(rawPath)) {
    // fallback: latest _e2e_funnel_raw_*.jsonl
    const cands = fs
      .readdirSync(OUT_DIR)
      .filter((f) => f.startsWith('_e2e_funnel_raw_') && f.endsWith('.jsonl'))
      .map((f) => ({ f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (!cands.length) throw new Error(`raw dump missing: ${rawPath}`);
    console.log('[e2e] using latest raw', cands[0].f);
  }
  const dumpFile = fs.existsSync(rawPath)
    ? rawPath
    : path.join(
        OUT_DIR,
        fs
          .readdirSync(OUT_DIR)
          .filter((f) => f.startsWith('_e2e_funnel_raw_') && f.endsWith('.jsonl'))
          .map((f) => ({ f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)[0].f
      );

  const rawRows = fs
    .readFileSync(dumpFile, 'utf8')
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.primary_funnel !== false && !r.error);

  const ledgers = rawRows.map(analyzeCase);
  fs.writeFileSync(TRACE_JSONL, ledgers.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // Optional PATH_CAP diagnostic for suspects
  let diagnostic = [];
  if (pathCapDiagnostic) {
    const suspects = ledgers.filter(
      (r) =>
        r.repair_required &&
        !r.final_correct &&
        r.evidence.E1_TARGET_RECALL === 'PRESENT' &&
        r.evidence.E4_TARGET_PATH_POST_CAP === 'ABSENT'
    );
    console.log(`[e2e] PATH_CAP diagnostic suspects=${suspects.length} @32/32 DIAGNOSTIC ONLY`);
    if (suspects.length) {
      const frozenAsr = useLexiconMockReplay ? loadFrozenAsrByCaseId() : null;
      const port = await startServer(
        {
          LINGUA_EXPERIMENT_MAX_ACTIVE_PATHS: '32',
          LINGUA_EXPERIMENT_MAX_COMPLETE_PATHS: '32',
        },
        { needAsr: !useLexiconMockReplay }
      );
      const byId = Object.fromEntries((manifest.cases || manifest).map((c) => [c.id, c]));
      for (const s of suspects.slice(0, 40)) {
        const caseDef = byId[s.caseId];
        if (!caseDef) continue;
        try {
          let data;
          if (useLexiconMockReplay) {
            data = await runCaseMock(port, frozenAsr[s.caseId], `diag-${caseDef.id}-${Date.now()}`);
          } else {
            const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
            data = await runCaseLive(port, wavPath, `diag-${caseDef.id}-${Date.now()}`);
          }
          const rec = extractRichRecord(caseDef, data, 0, {
            runId: RUN_ID,
            gitCommit: gitShort(),
            capLabel: '32/32',
            primary: false,
          });
          if (useLexiconMockReplay) rec.rawMergedAsrText = frozenAsr[s.caseId];
          const a = analyzeCase(rec);
          diagnostic.push({
            caseId: s.caseId,
            primary_8_8_path_post: s.evidence.E4_TARGET_PATH_POST_CAP,
            diag_32_path_post: a.evidence.E4_TARGET_PATH_POST_CAP,
            restored: a.evidence.E4_TARGET_PATH_POST_CAP === 'PRESENT',
            note: 'DIAGNOSTIC ONLY ??DOES NOT AUTHORIZE CAP CHANGE',
          });
          console.log(`[diag ${s.caseId}] path_post=${a.evidence.E4_TARGET_PATH_POST_CAP}`);
        } catch (e) {
          diagnostic.push({ caseId: s.caseId, error: String(e.message || e) });
        }
      }
      killPort(5020);
    }
  }

  const summary = buildSummary(ledgers, diagnostic);
  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2));
  fs.writeFileSync(REPORT_MD, renderReport(summary, ledgers));
  console.log('[e2e] wrote', REPORT_MD);
  console.log('[e2e] RESULT', summary.result_enum);
  console.log('[e2e] Q5', summary.answers.Q5_pct);
  console.log('[e2e] Q8', summary.answers.Q8_largest_first_loss);
  console.log('[e2e] Q11', summary.answers.Q11_kenlm_is_primary_blocker);
  console.log('[e2e] Q12', JSON.stringify(summary.answers.Q12_next_owner));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
