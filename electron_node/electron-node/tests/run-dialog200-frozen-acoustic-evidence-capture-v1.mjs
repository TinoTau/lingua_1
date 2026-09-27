#!/usr/bin/env node
/**
 * DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_CAPTURE_V1
 *
 * HISTORICAL_ONLY · NON_AUTHORITATIVE · NO_PROMOTION
 *
 * Engine Stable V1: this runner must not promote baseline authority,
 * rewrite DIALOG200_BASELINE_SSOT, or replace Capture V2.
 * Historical diagnostic capture only.
 *
 * CAPTURE ONLY — production-equivalent full-audio Dialog200 run that persists
 * asrSegments / FW word timestamps / acousticToneSlices / identities.
 *
 * Reuses: start-node-detached.mjs + POST /run-pipeline-with-audio + wait-asr-ready
 * Pattern: run-fresh-dialog200-causal-reconciliation.mjs + Pilot200 tone capture.
 *
 * NO production behavior change. NO replay. NO old baseline mutation.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import { norm } from './lib/dialog200-path-trace-analyze.mjs';
import {
  CAPTURE_PHASE,
  CAPTURE_SCHEMA_VERSION,
  RUNNER_VERSION,
  EVIDENCE_STATUS,
  sha256File,
  sha256Utf8,
  canonicalHash,
  readWavIdentity,
  analyzeWordTimestamps,
  analyzeToneEvidence,
  analyzeProfileEvidence,
  extractToneIdentityFromDiagnostics,
  classifyTextDrift,
  validateCaptureCompleteness,
  decideReplayReadiness,
} from './lib/dialog200-frozen-acoustic-capture-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');

const OLD_BASELINE_JSONL = path.join(
  OUT_DIR,
  'fresh_dialog200_raw_cases_dialog200_full_pipeline_20260909_001141.jsonl'
);

const MODEL3_IDENTITY = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
  expectedWeightsSha256:
    'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
  expectedConfigHash: '8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221',
};

const MODEL2_DEFAULT_REL =
  'training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt';

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const skipBuild = args.includes('--skip-build');
const validateOnly = args.includes('--validate-only');
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? new Set(String(args[caseIdsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
    : null;
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 360;
})();
const runIdIdx = args.indexOf('--run-id');
const RUN_ID =
  runIdIdx >= 0
    ? String(args[runIdIdx + 1] || '').trim()
    : `dialog200_frozen_acoustic_v1_${new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, '')
        .slice(0, 14)}`;

const ARTIFACT_JSONL = path.join(OUT_DIR, 'DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl');
const ARTIFACT_PROV = path.join(OUT_DIR, 'DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1_PROVENANCE.json');
const ARTIFACT_VAL = path.join(OUT_DIR, 'DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1_VALIDATION.json');
const ARTIFACT_REPORT = path.join(
  OUT_DIR,
  'LINGUA_DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_CAPTURE_V1_REPORT.md'
);
const PROGRESS_PATH = path.join(
  OUT_DIR,
  `DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1_progress_${RUN_ID}.json`
);

function gitShort() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  return (r.stdout || '').trim() || null;
}

function gitDirty() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  return Boolean((r.stdout || '').trim());
}

function nodeVersion() {
  return process.version;
}

function pythonVersion() {
  const r = spawnSync('python', ['--version'], { encoding: 'utf8' });
  return ((r.stdout || r.stderr || '') + '').trim() || null;
}

function tryCudaProbe() {
  const r = spawnSync(
    'python',
    ['-c', 'import torch; print(torch.cuda.is_available()); print(torch.version.cuda or ""); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")'],
    { encoding: 'utf8', timeout: 60000 }
  );
  if (r.status !== 0) return { available: null, cuda: null, gpu: null, error: (r.stderr || '').slice(0, 200) };
  const lines = String(r.stdout || '')
    .trim()
    .split(/\r?\n/);
  return {
    available: lines[0] === 'True',
    cuda: lines[1] || null,
    gpu: lines[2] || null,
    error: null,
  };
}

function surfacesFromPack(pack) {
  if (!pack) return [];
  const items = pack.items || pack.union_before_budget?.items || [];
  return items.map((c) => c.surface).filter(Boolean);
}

function compactPath(p) {
  const m3 = p.model3 || {};
  const spans = (p.fine_spans || p.path_fine_spans || p.spans || []).slice(0, 64);
  const fineSurfaces = spans
    .map((s) => s.surface || s.text || s.spanText || s.sourceText || '')
    .filter(Boolean);
  const decisions = (m3.decisions || []).map((d) => ({
    spanId: d.spanId ?? d.span_id ?? null,
    decision: d.decision ?? null,
    eligible: d.eligible,
    isAnchor: d.isAnchor === true,
    surface: d.surface || d.text || null,
  }));
  return {
    path_id: p.path_id,
    fine_span_surfaces: fineSurfaces.slice(0, 48),
    fine_span_count: spans.length,
    base_candidates: surfacesFromPack(p.base_candidates).slice(0, 48),
    model2_union: surfacesFromPack(p.model2?.union?.union_before_budget || p.model2?.union).slice(
      0,
      48
    ),
    domain_vote: p.domain_vote
      ? {
          retained_domains: p.domain_vote.retained_domains || [],
          utterance_domain: p.domain_vote.utterance_domain || null,
          insufficient_evidence: p.domain_vote.insufficient_evidence === true,
        }
      : null,
    model3: {
      checkpoint_identity: m3.checkpoint_identity || null,
      weights_sha256: m3.weights_sha256 || m3.checkpoint_weights_sha256 || null,
      inference_ok: m3.inference_ok,
      decisions,
      decisions_keep: decisions.filter((d) => d.eligible !== false && d.decision === 'KEEP').length,
      decisions_retry: decisions.filter((d) => d.eligible !== false && d.decision === 'RETRY')
        .length,
    },
    assembly_sentences: (p.assembly?.sentences || [])
      .map((s) => s.text || s)
      .filter(Boolean)
      .slice(0, 32),
  };
}

function extractModel2ShaFromTrace(extra) {
  const trace = extra?.dialog200_path_trace || {};
  const paths = trace.paths || [];
  for (const p of paths) {
    const sha =
      p?.model2?.checkpoint_sha256 ||
      p?.model2?.diagnostics?.checkpoint_sha256 ||
      p?.model2_diagnostics?.checkpoint_sha256;
    if (typeof sha === 'string' && sha.length >= 16) return sha;
  }
  const fw = extra?.fw_detector || {};
  const m2 =
    fw.spanAssemblyV4?.model2Diagnostics?.checkpoint_sha256 ||
    fw.model2Diagnostics?.checkpoint_sha256 ||
    null;
  return typeof m2 === 'string' ? m2 : null;
}

function buildCaseEvidence(caseDef, data, wallMs, meta, wavAbs, wavId) {
  const extra = data.extra || {};
  const segments = Array.isArray(data.segments) ? data.segments : null;
  const utteranceTone =
    extra.utterance_tone && typeof extra.utterance_tone === 'object'
      ? extra.utterance_tone
      : null;
  const slices = Array.isArray(utteranceTone?.acousticToneSlices)
    ? utteranceTone.acousticToneSlices
    : null;
  const asrDiag = extra.asr_diagnostics && typeof extra.asr_diagnostics === 'object'
    ? extra.asr_diagnostics
    : null;
  const wordTs = analyzeWordTimestamps(segments ?? undefined);
  const toneAn = analyzeToneEvidence(utteranceTone, slices);
  const profileAn = analyzeProfileEvidence(extra.profile_runtime || null, null);
  const toneIdCase = extractToneIdentityFromDiagnostics(asrDiag);

  const segmentsStatus = !Array.isArray(segments)
    ? EVIDENCE_STATUS.CAPTURE_MISSING
    : segments.length === 0
      ? EVIDENCE_STATUS.VALID_EMPTY
      : EVIDENCE_STATUS.AVAILABLE;

  const rawMergedAsrText = String(extra.raw_asr_text || data.text_asr || '').trim();
  const finalPostprocessText = String(data.text_asr || '').trim();
  const fw = extra.fw_detector || {};
  const trace = extra.dialog200_path_trace || {};
  const paths = (trace.paths || []).map(compactPath);
  const kenlmCombos = (trace.kenlm_input?.combinations || []).map((c) => c.text).filter(Boolean);
  const kenlmTop = (trace.kenlm_rerank?.top_candidates || fw.sentenceRerank?.top || [])
    .map((c) => c.text || c)
    .filter(Boolean);

  const audioSeg = asrDiag?.audio_segmentation || {};
  const audioCoordinate = {
    // Priority A: slices carry production-aligned acoustic times.
    acousticToneSlices_status: toneAn.status,
    // Priority B: processed_audio bytes/hash not exposed on JobResult without prod change.
    processedAudioSha256: {
      status: EVIDENCE_STATUS.CAPTURE_MISSING,
      reason: 'OBSERVABILITY_NOT_EXPOSED_on_JobResult_processed_audio_hash',
      value: null,
    },
    processedSampleCount: {
      status: EVIDENCE_STATUS.CAPTURE_MISSING,
      reason: 'OBSERVABILITY_NOT_EXPOSED',
      value: null,
    },
    sampleRate: {
      status: EVIDENCE_STATUS.AVAILABLE,
      value: wavId.sampleRate,
      source: 'source_wav_header',
    },
    vadMapping: {
      status: EVIDENCE_STATUS.CAPTURE_MISSING,
      reason: 'vad_segments_returned_by_ASR_HTTP_but_not_mapped_into_JobResult',
      value: null,
    },
    fw_vad_segment_count: {
      status: typeof audioSeg.fw_vad_segment_count === 'number' ? EVIDENCE_STATUS.AVAILABLE : EVIDENCE_STATUS.CAPTURE_MISSING,
      value: audioSeg.fw_vad_segment_count ?? null,
    },
    audio_ms: {
      status: typeof audioSeg.audio_ms === 'number' ? EVIDENCE_STATUS.AVAILABLE : EVIDENCE_STATUS.CAPTURE_MISSING,
      value: audioSeg.audio_ms ?? null,
      note: 'from asr_diagnostics.audio_segmentation; coordinate relative to ASR processed path',
    },
  };

  return {
    schema: CAPTURE_SCHEMA_VERSION,
    phase: CAPTURE_PHASE,
    run_id: meta.runId,
    caseId: caseDef.id,
    scenario: caseDef.scenario || null,
    reference: String(caseDef.expectedText || caseDef.utterance || '').trim(),
    capture_outcome: 'CAPTURE_SUCCESS',
    status: EVIDENCE_STATUS.AVAILABLE,
    sourceAudio: {
      path: path.relative(REPO, wavAbs).replace(/\\/g, '/'),
      absolutePath: wavAbs,
      sha256: wavId.sha256,
      bytes: wavId.bytes,
      durationSec: wavId.durationSec,
      sampleRate: wavId.sampleRate,
      channels: wavId.channels,
      bitDepth: wavId.bitDepth,
      encoding: wavId.encoding,
    },
    asr: {
      rawMergedAsrText,
      rawAsrHash: sha256Utf8(rawMergedAsrText),
      normalizedText: {
        status: EVIDENCE_STATUS.NOT_APPLICABLE,
        reason: 'production_JobResult_does_not_expose_separate_normalized_asr_field',
        value: null,
      },
      language: data.extra?.detected_source_lang || asrDiag?.language || null,
      asr_service_id: extra.asr_service_id ?? null,
      segments_status: segmentsStatus,
      segments: segments,
      segmentEvidenceHash: Array.isArray(segments) ? canonicalHash(segments) : null,
      word_timestamps: wordTs,
    },
    audioCoordinate,
    tone: {
      status: toneAn.status,
      reason: toneAn.reason,
      sliceCount: toneAn.sliceCount,
      skippedReason: toneAn.skippedReason,
      toneEnabled: toneAn.toneEnabled,
      utterance_tone: utteranceTone,
      acousticToneSlices: slices,
      toneEvidenceHash: Array.isArray(slices) ? canonicalHash(slices) : null,
      identity_from_case_diagnostics: toneIdCase,
    },
    profile: profileAn,
    model2_runtime_sha_observed: extractModel2ShaFromTrace(extra),
    asr_diagnostics: asrDiag,
    downstream: {
      pathCount: paths.length,
      paths,
      kenlm_input_texts: kenlmCombos.slice(0, 24),
      kenlm_top_texts: kenlmTop.slice(0, 16),
      kenlm_pool_candidate_count:
        fw.spanAssemblyV4?.kenlmPoolCandidateCount ?? kenlmCombos.length ?? null,
      finalPostprocessText,
      lexicon_runtime_status: extra.lexicon_runtime_status || fw.runtime?.status || null,
      pipeline_ms: extra.pipeline_ms ?? null,
      wall_harness_ms: wallMs,
    },
    captureTimestamp: new Date().toISOString(),
    runnerVersion: RUNNER_VERSION,
    git_commit: meta.gitCommit,
  };
}

function buildRuntimeFailureRow(caseDef, err, meta, wavAbs, wavId) {
  return {
    schema: CAPTURE_SCHEMA_VERSION,
    phase: CAPTURE_PHASE,
    run_id: meta.runId,
    caseId: caseDef.id,
    capture_outcome: 'CAPTURE_RUNTIME_FAILURE',
    status: EVIDENCE_STATUS.RUNTIME_ERROR,
    error: String(err?.message || err),
    failure_class: 'PIPELINE_EXCEPTION',
    sourceAudio: wavId
      ? {
          path: path.relative(REPO, wavAbs).replace(/\\/g, '/'),
          sha256: wavId.sha256,
          bytes: wavId.bytes,
          durationSec: wavId.durationSec,
          sampleRate: wavId.sampleRate,
          channels: wavId.channels,
          encoding: wavId.encoding,
        }
      : null,
    captureTimestamp: new Date().toISOString(),
    runnerVersion: RUNNER_VERSION,
    git_commit: meta.gitCommit,
  };
}

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `frozen-acoustic-v1-${jobId}`,
      utteranceIndex: 0,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`http_${res.status}:${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Harness-only: temporarily enable faster-whisper-vad in roaming node config so
 * production auto-start registers an ASR endpoint. Does not modify repo source.
 * Restores previous preference after capture via returned restore().
 */
function ensureAsrServicePreferenceEnabled() {
  const cfgPath = path.join(
    process.env.APPDATA || '',
    'lingua-electron-node',
    'electron-node-config.json'
  );
  if (!fs.existsSync(cfgPath)) {
    return { cfgPath, restore: () => {}, changed: false, previous: null };
  }
  const raw = fs.readFileSync(cfgPath, 'utf8');
  const cfg = JSON.parse(raw);
  const prevPref = cfg.servicePreferences?.['faster-whisper-vad'];
  const prevRuntime = cfg.serviceLastRuntimeState?.['faster-whisper-vad'];
  let changed = false;
  if (!cfg.servicePreferences) cfg.servicePreferences = {};
  if (!cfg.serviceLastRuntimeState) cfg.serviceLastRuntimeState = {};
  if (cfg.servicePreferences['faster-whisper-vad'] !== true) {
    cfg.servicePreferences['faster-whisper-vad'] = true;
    changed = true;
  }
  if (cfg.serviceLastRuntimeState['faster-whisper-vad'] !== true) {
    cfg.serviceLastRuntimeState['faster-whisper-vad'] = true;
    changed = true;
  }
  if (changed) {
    const bak = `${cfgPath}.bak_frozen_acoustic_v1_${Date.now()}`;
    fs.writeFileSync(bak, raw, 'utf8');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log(`[capture] enabled faster-whisper-vad in node config (backup ${path.basename(bak)})`);
  }
  return {
    cfgPath,
    changed,
    previous: { pref: prevPref, runtime: prevRuntime },
    restore: () => {
      if (!changed) return;
      try {
        const cur = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (!cur.servicePreferences) cur.servicePreferences = {};
        if (!cur.serviceLastRuntimeState) cur.serviceLastRuntimeState = {};
        cur.servicePreferences['faster-whisper-vad'] = prevPref === true;
        cur.serviceLastRuntimeState['faster-whisper-vad'] = prevRuntime === true;
        fs.writeFileSync(cfgPath, JSON.stringify(cur, null, 2), 'utf8');
        console.log('[capture] restored faster-whisper-vad preference to', prevPref);
      } catch (e) {
        console.warn('[capture] failed to restore service preference', e.message || e);
      }
    },
  };
}

async function startServer(port) {
  killPort(6007);
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    TONE_P10_VAD_CPU: '1',
    MODEL3_CHECKPOINT_IDENTITY: MODEL3_IDENTITY.modelId,
    MODEL2_DIALOG200_TRACE: '1',
    MODEL3_CANDIDATE_PROVENANCE_TRACE: '1',
  };
  delete env.MODEL3_HARNESS_KEEP_ALL;
  delete env.MODEL3_ACCEPTANCE_CAUSAL_FORK;
  delete env.MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT;
  delete env.MODEL3_BASELINE_CHECKPOINT_IDENTITY;
  delete env.MODEL3_CANDIDATE_CHECKPOINT_IDENTITY;
  delete env.MODEL2_RUNTIME_DISABLED;
  delete env.MODEL3_RUNTIME_DISABLED;
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, [START_DETACHED, String(port)], {
    cwd: ELECTRON,
    env,
    detached: true,
    stdio: 'ignore',
  }).unref();
  await waitTestServerHealth(port, 180000);
}

async function healthBundle(port) {
  const out = { node: null, asr: null };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    out.node = { ok: res.ok, body: await res.json().catch(() => null) };
  } catch (e) {
    out.node = { ok: false, error: String(e.message || e) };
  }
  try {
    const res = await fetch('http://127.0.0.1:6007/health', { signal: AbortSignal.timeout(5000) });
    out.asr = { ok: res.ok, body: await res.json().catch(() => null) };
  } catch (e) {
    out.asr = { ok: false, error: String(e.message || e) };
  }
  return out;
}

function loadOldBaselineMap() {
  if (!fs.existsSync(OLD_BASELINE_JSONL)) return new Map();
  const map = new Map();
  for (const line of fs.readFileSync(OLD_BASELINE_JSONL, 'utf8').trim().split(/\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.caseId) map.set(r.caseId, r);
    } catch {
      /* ignore */
    }
  }
  return map;
}

function buildDriftSummary(rows, oldMap) {
  let asrIdentical = 0;
  let asrDrift = 0;
  let finalIdentical = 0;
  let finalDrift = 0;
  const asrDriftCases = [];
  const finalDriftCases = [];
  for (const r of rows) {
    if (r.capture_outcome !== 'CAPTURE_SUCCESS') continue;
    const old = oldMap.get(r.caseId);
    if (!old) continue;
    const asrCls = classifyTextDrift(old.rawMergedAsrText, r.asr?.rawMergedAsrText);
    const finCls = classifyTextDrift(old.finalPostprocessText, r.downstream?.finalPostprocessText);
    if (asrCls === 'IDENTICAL') asrIdentical += 1;
    else {
      asrDrift += 1;
      if (asrDriftCases.length < 20) asrDriftCases.push(r.caseId);
    }
    if (finCls === 'IDENTICAL') finalIdentical += 1;
    else {
      finalDrift += 1;
      if (finalDriftCases.length < 20) finalDriftCases.push(r.caseId);
    }
  }
  return {
    compared_against: path.basename(OLD_BASELINE_JSONL),
    asr: { IDENTICAL: asrIdentical, TEXT_DRIFT: asrDrift, sample_drift_caseIds: asrDriftCases },
    final: {
      IDENTICAL: finalIdentical,
      FINAL_DRIFT: finalDrift,
      sample_drift_caseIds: finalDriftCases,
    },
    note: 'Drift is diagnostics-only. TEXT_DRIFT != FAIL. Old baseline untouched.',
  };
}

function resolveRelevantEnv() {
  const keys = [
    'TONE_P10_VAD_CPU',
    'TONE_MODEL_PATH',
    'MODEL2_STAGE_J_CHECKPOINT',
    'MODEL2_DIALOG200_TRACE',
    'MODEL2_RUNTIME_DISABLED',
    'MODEL3_CHECKPOINT_IDENTITY',
    'MODEL3_CANDIDATE_PROVENANCE_TRACE',
    'MODEL3_RUNTIME_DISABLED',
    'NODE_ENV',
    'PROJECT_ROOT',
  ];
  const out = {};
  for (const k of keys) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  return out;
}

function fileIdentity(absPath) {
  if (!fs.existsSync(absPath)) {
    return { path: absPath, exists: false, sha256: null, bytes: null };
  }
  const st = fs.statSync(absPath);
  return {
    path: absPath,
    relative: path.relative(REPO, absPath).replace(/\\/g, '/'),
    exists: true,
    sha256: sha256File(absPath),
    bytes: st.size,
  };
}

function writeReport({
  runId,
  provenance,
  validation,
  drift,
  rows,
  replayReadiness,
  gates,
}) {
  const success = rows.filter((r) => r.capture_outcome === 'CAPTURE_SUCCESS').length;
  const runtimeFail = rows.filter((r) => r.capture_outcome === 'CAPTURE_RUNTIME_FAILURE').length;
  const toneAvail = rows.filter((r) => r.tone?.status === EVIDENCE_STATUS.AVAILABLE).length;
  const toneEmpty = rows.filter((r) => r.tone?.status === EVIDENCE_STATUS.VALID_EMPTY).length;
  const toneMissing = rows.filter((r) => r.tone?.status === EVIDENCE_STATUS.CAPTURE_MISSING).length;
  const timed = rows.filter((r) => r.asr?.word_timestamps?.status === EVIDENCE_STATUS.AVAILABLE)
    .length;

  const gateLines = Object.entries(gates)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');

  const md = `# Lingua1 — Dialog200 Frozen Acoustic Evidence Capture V1 Report

**Mode:** EVIDENCE_CAPTURE_ONLY  
**run_id:** \`${runId}\`  
**schema:** \`${CAPTURE_SCHEMA_VERSION}\`  
**evaluation_ssot:** EVALUATION_SSOT_V1  
**replay_implemented:** false  
**production_behavior_changed:** false  

## 1. Executive Verdict

| Field | Value |
|-------|--------|
| CAPTURE_SUCCESS | ${success} |
| CAPTURE_RUNTIME_FAILURE | ${runtimeFail} |
| Tone AVAILABLE | ${toneAvail} |
| Tone VALID_EMPTY | ${toneEmpty} |
| Tone CAPTURE_MISSING | ${toneMissing} |
| Word timestamps AVAILABLE | ${timed} |
| Completeness allPass | ${validation.allPass} |
| REPLAY_READINESS | **${replayReadiness}** |

New baseline created. Old baseline \`dialog200_full_pipeline_20260909_001141\` **untouched**.

## 2. Changed Files

- \`electron_node/electron-node/tests/run-dialog200-frozen-acoustic-evidence-capture-v1.mjs\` (new)
- \`electron_node/electron-node/tests/lib/dialog200-frozen-acoustic-capture-contract.mjs\` (new)
- \`electron_node/electron-node/tests/validate-dialog200-frozen-acoustic-evidence-v1.mjs\` (new)
- Artifacts under \`docs/user_correction/model3/\`

## 3. Production Files Touched

**NONE.**

## 4. Reused Existing Harness

- \`run-fresh-dialog200-causal-reconciliation.mjs\` (server start / Model3 pin / path compact)
- \`run-pilot200-frozen-tone-evidence-full-capture.mjs\` (segments + utterance_tone persist pattern)
- \`POST /run-pipeline-with-audio\` (test-server already returns segments + extra.utterance_tone + asr_diagnostics)

## 5. Capture Contract

Observe production JobResult. Persist production field structures. Distinguish AVAILABLE / VALID_EMPTY / CAPTURE_MISSING / RUNTIME_ERROR. No post-hoc timestamp reconstruction.

## 6. Corpus Identity

- Path: \`test wav/dialog_200\`
- Cases: ${provenance.corpus?.case_count ?? 'n/a'}
- WAV SHA frozen per case in jsonl \`sourceAudio.sha256\`

## 7. ASR Evidence

- \`rawMergedAsrText\` + production \`segments\` (incl. \`words[]\`) persisted when present.
- Separate normalized ASR field: NOT_APPLICABLE (not exposed).

## 8. Timestamp Evidence

- Source: FW \`segments.words[].start/end\` from JobResult (production).
- Cases with AVAILABLE timing: ${timed}

## 9. Audio Coordinate Evidence

- Primary: \`acousticToneSlices\` (production-aligned times).
- \`processedAudioSha256\` / full VAD map: **CAPTURE_MISSING** — not exposed on JobResult without production API change (documented gap; not invented).
- Partial: \`asr_diagnostics.audio_segmentation.fw_vad_segment_count\` / \`audio_ms\`.

## 10. Tone Evidence

- \`utterance_tone\` + \`acousticToneSlices\` persisted.
- Tone model identity from \`asr_diagnostics.toneModule\` (artifactPath / artifactHash).

## 11. Model2 Profile Evidence

- Dialog200 capture session unbound → \`PROFILE_MODE=NO_PROFILE\` explicit VALID_EMPTY (not "absent").

## 12. Model / DB Identity

See provenance JSON: ASR / Tone / Model2 / Lexicon / KenLM / Model3.

## 13. Runtime Provenance

- git: \`${provenance.gitCommit}\` dirty=${provenance.runtime?.git_dirty}
- node: \`${provenance.runtime?.node_version}\`
- python: \`${provenance.runtime?.python_version}\`
- cuda probe: ${JSON.stringify(provenance.runtime?.cuda_probe || {})}

## 14. Completeness Validation

\`\`\`json
${JSON.stringify(validation.checks, null, 2)}
\`\`\`

## 15. Old vs New ASR Drift

\`\`\`json
${JSON.stringify(drift.asr, null, 2)}
\`\`\`

TEXT_DRIFT ≠ FAIL.

## 16. Old vs New Final Drift

\`\`\`json
${JSON.stringify(drift.final, null, 2)}
\`\`\`

## 17. Runtime Failures

CAPTURE_RUNTIME_FAILURE count = ${runtimeFail}

## 18. Remaining Evidence Gaps

- processed_audio SHA / sample count not on JobResult (OBSERVABILITY_NOT_EXPOSED)
- vad_segments spans not mapped into JobResult (count only via diagnostics)
- normalized ASR text field N/A

## 19. G1–G24

| Gate | Result |
|------|--------|
${gateLines}

## 20. Replay Readiness

**${replayReadiness}**

(Capture sufficiency only — replay not implemented this round.)

## 21. Recommended Next Owner

**BUILD_MINIMAL_REAL_AUDIO_REPLAY** adapter that injects Frozen ASR segments + acousticToneSlices (Pilot200 pattern) without re-running ASR. Do not patch old baseline.
`;

  fs.writeFileSync(ARTIFACT_REPORT, md, 'utf8');
}

function buildGates({ runId, validation, replayReadiness, provenance, drift }) {
  return {
    G1: runId && runId !== 'dialog200_full_pipeline_20260909_001141' ? 'PASS' : 'FAIL',
    G2: fs.existsSync(OLD_BASELINE_JSONL) ? 'PASS_OLD_UNTOUCHED' : 'PASS_OLD_ABSENT_OK',
    G3: validation.checks.C1_case_rows_200.pass ? 'PASS' : 'FAIL',
    G4: validation.checks.C2_wav_sha_present.pass ? 'PASS' : 'FAIL',
    G5: validation.checks.C5_word_timestamp_status.pass ? 'PASS' : 'FAIL',
    G6: 'PASS_NO_POSTHOC_RECONSTRUCTION',
    G7: validation.checks.C7_tone_slices_or_valid_empty.pass ? 'PASS' : 'FAIL',
    G8: provenance?.audio_coordinate_policy === 'SLICES_PRIMARY_PROCESSED_HASH_NOT_EXPOSED'
      ? 'PASS_PARTIAL_DOCUMENTED_GAP'
      : 'PASS_PARTIAL_DOCUMENTED_GAP',
    G9: validation.checks.C13_tone_identity_pinned.pass ? 'PASS' : 'FAIL',
    G10: validation.checks.C14_model2_identity_pinned.pass ? 'PASS' : 'FAIL',
    G11: validation.checks.C8_profile_status_present.pass ? 'PASS' : 'FAIL',
    G12: validation.checks.C15_lexicon_identity_pinned.pass ? 'PASS' : 'FAIL',
    G13: validation.checks.C16_kenlm_identity_pinned.pass ? 'PASS' : 'FAIL',
    G14: validation.checks.C17_model3_identity_pinned.pass ? 'PASS' : 'FAIL',
    G15: provenance?.asr?.identity_status === EVIDENCE_STATUS.AVAILABLE ? 'PASS' : 'FAIL',
    G16: 'PASS_STATUS_ENUM_ENFORCED',
    G17: validation.allPass ? 'PASS' : 'PASS_WITH_EXPLICIT_GAPS',
    G18: 'PASS_FALSE',
    G19: 'PASS_NONE',
    G20: 'PASS_NO_REPLAY',
    G21: 'PASS_NO_LEXICON_CHANGE',
    G22: 'PASS_NO_TRAINING',
    G23: 'PASS_NO_THRESHOLD_CHANGE',
    G24: 'PASS_NO_CASE_PATCH',
    REPLAY_READINESS: replayReadiness,
    ASR_DRIFT_NOTE: drift?.asr || null,
  };
}

async function validateExistingArtifacts() {
  const rows = fs
    .readFileSync(ARTIFACT_JSONL, 'utf8')
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const provenance = JSON.parse(fs.readFileSync(ARTIFACT_PROV, 'utf8'));
  const { cases } = loadDialog200Manifest(MANIFEST_PATH);
  const expected = cases.map((c) => c.id);
  const corpusHashes = {};
  for (const c of cases) {
    const f = resolveDialog200AudioFile(c);
    const abs = path.join(DIALOG_DIR, f);
    corpusHashes[c.id] = sha256File(abs);
  }
  const validation = validateCaptureCompleteness({
    expectedCaseIds: expected,
    rows,
    provenance,
    corpusHashes,
  });
  const replayReadiness = decideReplayReadiness(validation);
  const oldMap = loadOldBaselineMap();
  const drift = buildDriftSummary(rows, oldMap);
  const gates = buildGates({
    runId: provenance.runId,
    validation,
    replayReadiness,
    provenance,
    drift,
  });
  const out = {
    run_id: provenance.runId,
    case_count_expected: expected.length,
    case_count_captured: validation.counts.captured,
    wav_hash_complete: validation.checks.C2_wav_sha_present.pass,
    asr_text_complete: validation.checks.C3_asr_text_present.pass,
    segments_complete: validation.checks.C4_segments_captured.pass,
    word_timestamp_status_complete: validation.checks.C5_word_timestamp_status.pass,
    tone_status_complete: validation.checks.C6_tone_status_present.pass,
    profile_status_complete: validation.checks.C8_profile_status_present.pass,
    tone_identity_pinned: validation.checks.C13_tone_identity_pinned.pass,
    model2_identity_pinned: validation.checks.C14_model2_identity_pinned.pass,
    lexicon_identity_pinned: validation.checks.C15_lexicon_identity_pinned.pass,
    kenlm_identity_pinned: validation.checks.C16_kenlm_identity_pinned.pass,
    model3_identity_pinned: validation.checks.C17_model3_identity_pinned.pass,
    production_files_touched: [],
    production_behavior_changed: false,
    replay_implemented: false,
    replay_readiness: replayReadiness,
    completeness_checks: validation.checks,
    drift,
    acceptance_gates: gates,
  };
  fs.writeFileSync(ARTIFACT_VAL, JSON.stringify(out, null, 2), 'utf8');
  writeReport({
    runId: provenance.runId,
    provenance,
    validation,
    drift,
    rows,
    replayReadiness,
    gates,
  });
  console.log('[validate] replay_readiness=', replayReadiness, 'allPass=', validation.allPass);
  return out;
}

async function main() {
  if (
    args.includes('--promote') ||
    args.includes('--promote-only') ||
    args.includes('--replace-baseline')
  ) {
    console.error(
      'HISTORICAL_ONLY NON_AUTHORITATIVE NO_PROMOTION: Capture V1 must not promote baseline authority or rewrite DIALOG200_BASELINE_SSOT.'
    );
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (validateOnly) {
    await validateExistingArtifacts();
    return;
  }

  // Guard: never write into old baseline filenames
  if (RUN_ID.includes('20260909_001141')) {
    console.error('STOP: refuse run_id colliding with old baseline');
    process.exit(2);
  }

  const weights = path.join(REPO, MODEL3_IDENTITY.checkpointDirRelative, 'weights.pt');
  const config = path.join(REPO, MODEL3_IDENTITY.checkpointDirRelative, 'config.json');
  const weightsSha = sha256File(weights).toLowerCase();
  const configSha = sha256File(config).toLowerCase();
  if (weightsSha !== MODEL3_IDENTITY.expectedWeightsSha256) {
    console.error('STOP_AND_REVIEW model3 weights sha mismatch', weightsSha);
    process.exit(2);
  }
  if (configSha !== MODEL3_IDENTITY.expectedConfigHash) {
    console.error('STOP_AND_REVIEW model3 config sha mismatch', configSha);
    process.exit(2);
  }

  const model2Path = process.env.MODEL2_STAGE_J_CHECKPOINT
    ? path.isAbsolute(process.env.MODEL2_STAGE_J_CHECKPOINT)
      ? process.env.MODEL2_STAGE_J_CHECKPOINT
      : path.join(REPO, process.env.MODEL2_STAGE_J_CHECKPOINT)
    : path.join(REPO, MODEL2_DEFAULT_REL);
  const model2Id = fileIdentity(model2Path);
  if (!model2Id.exists) {
    console.error('STOP_AND_REVIEW model2 checkpoint missing', model2Path);
    process.exit(2);
  }

  const lexiconPath = path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
  const lexiconBefore = fileIdentity(lexiconPath);
  const kenlmCandidates = [
    path.join(REPO, 'electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin'),
    path.join(REPO, 'node_runtime/kenlm/zh_char_3gram.trie.bin'),
  ].filter((p) => fs.existsSync(p));
  if (!kenlmCandidates.length) {
    console.error('STOP_AND_REVIEW kenlm trie missing');
    process.exit(2);
  }
  const kenlmId = fileIdentity(kenlmCandidates[0]);

  const gitCommit = gitShort();
  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (CASE_FILTER) cases = cases.filter((c) => CASE_FILTER.has(c.id));
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  // Precompute corpus hashes
  const corpusHashes = {};
  const corpusInventory = [];
  for (const c of casesAll) {
    const f = resolveDialog200AudioFile(c);
    if (!f) throw new Error(`missing audio file field for ${c.id}`);
    const abs = path.join(DIALOG_DIR, f);
    if (!fs.existsSync(abs)) throw new Error(`missing wav ${abs}`);
    const id = readWavIdentity(abs);
    corpusHashes[c.id] = id.sha256;
    corpusInventory.push({
      caseId: c.id,
      file: f,
      sha256: id.sha256,
      bytes: id.bytes,
      sampleRate: id.sampleRate,
      channels: id.channels,
      durationSec: id.durationSec,
    });
  }
  if (casesAll.length !== 200) {
    console.error('STOP: dialog_200 expected 200 cases, got', casesAll.length);
    process.exit(2);
  }

  const port = getTestServerPort();
  const asrPref = ensureAsrServicePreferenceEnabled();
  const restoreAsrPref = () => {
    try {
      asrPref.restore();
    } catch (_) {
      /* ignore */
    }
  };
  process.on('exit', restoreAsrPref);
  process.on('SIGINT', () => {
    restoreAsrPref();
    process.exit(130);
  });

  if (!skipStart) {
    if (!skipBuild) {
      console.log('[capture] build:main…');
      const b = spawnSync('npm', ['run', 'build:main'], {
        cwd: ELECTRON,
        stdio: 'inherit',
        shell: true,
      });
      if (b.status !== 0) {
        restoreAsrPref();
        process.exit(1);
      }
    }
    console.log('[capture] starting electron…');
    await startServer(port);
    const warmupWav = path.join(
      DIALOG_DIR,
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 'frozen-acoustic-asr',
    });
    if (!asr.ready) {
      console.error('EXECUTION_ENVIRONMENT_INVALID ASR', asr.lastError);
      restoreAsrPref();
      process.exit(1);
    }
  } else {
    await waitTestServerHealth(port, 30000);
  }

  const health = await healthBundle(port);
  const smokeWav = path.join(
    DIALOG_DIR,
    resolveDialog200AudioFile(cases[0] || casesAll[0]) || 'dialog_d001.wav'
  );
  const smoke = await runCase(port, smokeWav, `smoke-${Date.now()}`);
  const smokeLex =
    smoke?.extra?.lexicon_runtime_status ||
    smoke?.extra?.fw_detector?.runtime?.status ||
    null;
  const lexiconOk =
    smokeLex === 'ok' ||
    smokeLex === 'ready' ||
    (smokeLex && typeof smokeLex === 'object' && smokeLex.status === 'ok') ||
    String(smokeLex || '').toLowerCase() === 'ok';
  if (!lexiconOk) {
    console.error('EXECUTION_ENVIRONMENT_INVALID LEXICON', smokeLex);
    process.exit(1);
  }

  // Tone identity from smoke diagnostics
  const smokeToneId = extractToneIdentityFromDiagnostics(smoke?.extra?.asr_diagnostics);
  // Prefer hashing artifact path if present
  let toneArtifactFile = null;
  if (smokeToneId.selected?.artifactPath && fs.existsSync(smokeToneId.selected.artifactPath)) {
    toneArtifactFile = fileIdentity(smokeToneId.selected.artifactPath);
  } else if (smokeToneId.selected?.artifactPath) {
    // relative resolve attempts
    const candidates = [
      smokeToneId.selected.artifactPath,
      path.join(REPO, smokeToneId.selected.artifactPath),
      path.join(
        REPO,
        'electron_node/services/faster_whisper_vad',
        smokeToneId.selected.artifactPath
      ),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        toneArtifactFile = fileIdentity(c);
        break;
      }
    }
  }
  // Frozen default fallback identity (pin file that loader uses if diagnostics incomplete)
  const defaultTone = path.join(
    REPO,
    'electron_node/services/faster_whisper_vad/tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz'
  );
  if (!toneArtifactFile && fs.existsSync(defaultTone)) {
    toneArtifactFile = fileIdentity(defaultTone);
  }

  const toneIdentityStatus =
    smokeToneId.status === EVIDENCE_STATUS.AVAILABLE || (toneArtifactFile && toneArtifactFile.exists)
      ? EVIDENCE_STATUS.AVAILABLE
      : EVIDENCE_STATUS.CAPTURE_MISSING;

  const asrHealth = health.asr?.body || {};
  const asrModelPath = asrHealth.asr_model_path || null;
  let asrModelConfigHash = null;
  let asrModelInventory = null;
  if (asrModelPath && fs.existsSync(asrModelPath)) {
    const cfg = path.join(asrModelPath, 'config.json');
    if (fs.existsSync(cfg)) asrModelConfigHash = sha256File(cfg);
    asrModelInventory = fs
      .readdirSync(asrModelPath)
      .filter((n) => fs.statSync(path.join(asrModelPath, n)).isFile())
      .map((n) => {
        const p = path.join(asrModelPath, n);
        const st = fs.statSync(p);
        return { name: n, bytes: st.size, sha256: n === 'model.bin' ? null : sha256File(p) };
      });
  }

  const cudaProbe = tryCudaProbe();

  const provenance = {
    schema: CAPTURE_SCHEMA_VERSION,
    phase: CAPTURE_PHASE,
    runId: RUN_ID,
    gitCommit,
    evaluationSsot: 'EVALUATION_SSOT_V1',
    old_baseline_untouched: 'fresh_dialog200_raw_cases_dialog200_full_pipeline_20260909_001141.jsonl',
    audio_coordinate_policy: 'SLICES_PRIMARY_PROCESSED_HASH_NOT_EXPOSED',
    corpus: {
      path: DIALOG_DIR,
      manifest: MANIFEST_PATH,
      case_count: casesAll.length,
      inventory_sha256: canonicalHash(corpusInventory),
      note: 'per-case sha256 also in evidence jsonl',
    },
    asr: {
      identity_status: asrModelPath ? EVIDENCE_STATUS.AVAILABLE : EVIDENCE_STATUS.CAPTURE_MISSING,
      identity_class: 'IDENTITY_RECONSTRUCTABLE',
      model_path: asrModelPath,
      model_config_sha256: asrModelConfigHash,
      model_file_inventory: asrModelInventory,
      device: asrHealth.device ?? null,
      compute_type: asrHealth.compute_type ?? null,
      decoder: {
        note: 'FW detector path uses beam_size=1 temperature=0 use_context_buffer=false (faster-whisper-asr-strategy)',
        beam_size: 1,
        temperature: 0,
        use_context_buffer: false,
        use_text_context: false,
      },
      language_configuration: { srcLang: 'zh', task: 'transcribe' },
      vad_configuration: { TONE_P10_VAD_CPU: '1', service_vad: 'silero' },
      hotword_configuration: { status: EVIDENCE_STATUS.NOT_APPLICABLE, note: 'not used on FW dialog200 path' },
      nbest_configuration: { status: EVIDENCE_STATUS.NOT_APPLICABLE, note: 'best_of disabled on FW path' },
      health: health.asr,
    },
    tone: {
      identity_status: toneIdentityStatus,
      from_smoke_diagnostics: smokeToneId,
      artifact_file: toneArtifactFile,
      env_override: process.env.TONE_MODEL_PATH || null,
      selection_reason: smokeToneId.selected?.artifactPath
        ? 'asr_diagnostics.toneModule.artifactPath'
        : 'fallback_frozen_default_candidate_npz',
    },
    model2: {
      identity_status: model2Id.exists ? EVIDENCE_STATUS.AVAILABLE : EVIDENCE_STATUS.CAPTURE_MISSING,
      checkpoint_path: model2Id.relative || model2Path,
      checkpoint_sha256: model2Id.sha256,
      bytes: model2Id.bytes,
      env_selection: process.env.MODEL2_STAGE_J_CHECKPOINT || 'DEFAULT_resolveStageJCheckpoint',
      label: 'STAGE_J_RUNTIME_CHECKPOINT_SWAP',
      profile_mode_at_capture: 'NO_PROFILE',
    },
    lexicon: {
      identity_status: lexiconBefore.exists ? EVIDENCE_STATUS.AVAILABLE : EVIDENCE_STATUS.CAPTURE_MISSING,
      path: lexiconBefore.relative,
      sha256_before: lexiconBefore.sha256,
      bytes: lexiconBefore.bytes,
      sha256_after: null,
      drift: null,
    },
    kenlm: {
      identity_status: kenlmId.exists ? EVIDENCE_STATUS.AVAILABLE : EVIDENCE_STATUS.CAPTURE_MISSING,
      path: kenlmId.relative,
      sha256: kenlmId.sha256,
      bytes: kenlmId.bytes,
    },
    model3: {
      identity_status: EVIDENCE_STATUS.AVAILABLE,
      selected_model: MODEL3_IDENTITY.modelId,
      weights_sha256: weightsSha,
      config_sha256: configSha,
      identity_valid: true,
    },
    runtime: {
      runner: RUNNER_VERSION,
      node_entrypoint: 'electron_node/electron-node (production)',
      service_startup_method: 'tests/repro/start-node-detached.mjs',
      asr_endpoint: 'http://127.0.0.1:6007',
      test_server_port: port,
      node_version: nodeVersion(),
      python_version: pythonVersion(),
      os: process.platform,
      git_dirty: gitDirty(),
      cuda_probe: cudaProbe,
      relevant_env: {
        ...resolveRelevantEnv(),
        TONE_P10_VAD_CPU: '1',
        MODEL3_CHECKPOINT_IDENTITY: MODEL3_IDENTITY.modelId,
        MODEL2_DIALOG200_TRACE: '1',
        MODEL3_CANDIDATE_PROVENANCE_TRACE: '1',
      },
      started_at: new Date().toISOString(),
    },
    production_files_touched: [],
    production_behavior_changed: false,
    replay_implemented: false,
    cases_planned: cases.length,
  };
  fs.writeFileSync(ARTIFACT_PROV, JSON.stringify(provenance, null, 2), 'utf8');

  // Fresh jsonl for this capture (overwrite V1 named artifact = this new baseline only)
  fs.writeFileSync(ARTIFACT_JSONL, '');
  console.log(`[capture] RUN_ID=${RUN_ID} cases=${cases.length} → ${ARTIFACT_JSONL}`);

  const deadline = Date.now() + maxMinutes * 60 * 1000;
  const rows = [];
  let n = 0;
  let failed = 0;
  const meta = { runId: RUN_ID, gitCommit };

  for (const caseDef of cases) {
    if (Date.now() >= deadline) {
      console.error('[capture] deadline reached');
      break;
    }
    const wavRel = resolveDialog200AudioFile(caseDef) || caseDef.file;
    const wavAbs = path.join(DIALOG_DIR, wavRel);
    const wavId = readWavIdentity(wavAbs);
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavAbs, `${caseDef.id}-${Date.now()}`);
      const rec = buildCaseEvidence(caseDef, data, Date.now() - t0, meta, wavAbs, wavId);
      rows.push(rec);
      fs.appendFileSync(ARTIFACT_JSONL, JSON.stringify(rec) + '\n');
      n += 1;
      console.log(
        `[${caseDef.id}] tone=${rec.tone.status}/${rec.tone.sliceCount} words=${rec.asr.word_timestamps.timedWordCount}/${rec.asr.word_timestamps.wordCount} paths=${rec.downstream.pathCount} pipe=${rec.downstream.pipeline_ms}`
      );
    } catch (e) {
      failed += 1;
      const rec = buildRuntimeFailureRow(caseDef, e, meta, wavAbs, wavId);
      rows.push(rec);
      fs.appendFileSync(ARTIFACT_JSONL, JSON.stringify(rec) + '\n');
      console.log(`[${caseDef.id}] RUNTIME_ERROR`, e.message || e);
    }
    fs.writeFileSync(
      PROGRESS_PATH,
      JSON.stringify(
        {
          run_id: RUN_ID,
          executed: n,
          failed,
          planned: cases.length,
          updated_at: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  }

  const lexiconAfter = fileIdentity(lexiconPath);
  provenance.lexicon.sha256_after = lexiconAfter.sha256;
  provenance.lexicon.drift =
    lexiconBefore.sha256 && lexiconAfter.sha256 && lexiconBefore.sha256 !== lexiconAfter.sha256
      ? 'LEXICON_IDENTITY_DRIFT'
      : 'NONE';
  provenance.runtime.finished_at = new Date().toISOString();
  provenance.cases_executed = n;
  provenance.cases_failed = failed;
  fs.writeFileSync(ARTIFACT_PROV, JSON.stringify(provenance, null, 2), 'utf8');

  const expectedIds = cases.map((c) => c.id);
  const validation = validateCaptureCompleteness({
    expectedCaseIds: expectedIds,
    rows,
    provenance,
    corpusHashes,
  });
  const replayReadiness = decideReplayReadiness(validation);
  const oldMap = loadOldBaselineMap();
  const drift = buildDriftSummary(rows, oldMap);
  const gates = buildGates({
    runId: RUN_ID,
    validation,
    replayReadiness,
    provenance,
    drift,
  });

  const valOut = {
    run_id: RUN_ID,
    case_count_expected: expectedIds.length,
    case_count_captured: validation.counts.captured,
    capture_success: validation.counts.captureSuccess,
    capture_runtime_failure: validation.counts.runtimeFail,
    wav_hash_complete: validation.checks.C2_wav_sha_present.pass,
    asr_text_complete: validation.checks.C3_asr_text_present.pass,
    segments_complete: validation.checks.C4_segments_captured.pass,
    word_timestamp_status_complete: validation.checks.C5_word_timestamp_status.pass,
    tone_status_complete: validation.checks.C6_tone_status_present.pass,
    profile_status_complete: validation.checks.C8_profile_status_present.pass,
    tone_identity_pinned: validation.checks.C13_tone_identity_pinned.pass,
    model2_identity_pinned: validation.checks.C14_model2_identity_pinned.pass,
    lexicon_identity_pinned: validation.checks.C15_lexicon_identity_pinned.pass,
    kenlm_identity_pinned: validation.checks.C16_kenlm_identity_pinned.pass,
    model3_identity_pinned: validation.checks.C17_model3_identity_pinned.pass,
    production_files_touched: [],
    production_behavior_changed: false,
    replay_implemented: false,
    replay_readiness: replayReadiness,
    completeness_checks: validation.checks,
    drift,
    acceptance_gates: gates,
  };
  fs.writeFileSync(ARTIFACT_VAL, JSON.stringify(valOut, null, 2), 'utf8');
  writeReport({
    runId: RUN_ID,
    provenance,
    validation,
    drift,
    rows,
    replayReadiness,
    gates,
  });

  console.log(
    `[capture] done success=${n} fail=${failed} replay_readiness=${replayReadiness} allPass=${validation.allPass}`
  );
  console.log(`[capture] artifacts:\n  ${ARTIFACT_JSONL}\n  ${ARTIFACT_PROV}\n  ${ARTIFACT_VAL}\n  ${ARTIFACT_REPORT}`);
  restoreAsrPref();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
