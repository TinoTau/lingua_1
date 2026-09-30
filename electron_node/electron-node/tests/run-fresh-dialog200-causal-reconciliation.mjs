#!/usr/bin/env node
/**
 * FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_RECONCILIATION_AUDIT
 *
 * Production-equivalent single-path dialog_200 runner (NO acceptance causal fork).
 * Audit-only capture: raw merged ASR / final / reference + path diagnostics.
 * Does NOT change production semantics.
 *
 * Reuses: start-node-detached.mjs + POST /run-pipeline-with-audio + wait-asr-ready.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import { norm } from './lib/dialog200-path-trace-analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');
const PHASE = 'FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_RECONCILIATION_AUDIT';

const IDENTITY = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
  expectedWeightsSha256:
    'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
  expectedConfigHash: '8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221',
};

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const skipBuild = args.includes('--skip-build');
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
    : `dialog200_full_pipeline_20260909_${Date.now()}`;

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function gitShort() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return (r.stdout || '').trim() || null;
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
  const retryRegions = (m3.retry_regions || []).map((r) => ({
    regionId: r.regionId || r.id || null,
    start: r.start ?? r.charStart ?? null,
    end: r.end ?? r.charEnd ?? null,
    surface: r.surface || r.text || null,
    sourceSpanIds: r.sourceSpanIds || r.spanIds || null,
  }));
  // Production Model3RetryRecallInvocationTrace uses windowText/spanSurface/candidates.
  // Do NOT map only legacy query/window keys — that drops geometry (FRESH_TRACE_EVIDENCE_GAP).
  const recallInv = (m3.retry_recall_invocations || []).map((inv) => ({
    query: inv.query || inv.queryText || inv.text || null,
    window: inv.window || inv.queryWindow || null,
    windowText: inv.windowText || null,
    spanSurface: inv.spanSurface || null,
    windowPinyinKey: inv.windowPinyinKey || null,
    pinyin: inv.windowPinyinKey || inv.pinyin || null,
    tone: inv.tone || null,
    ownerSpanId: inv.ownerSpanId || null,
    spanStart: inv.spanStart ?? null,
    spanEnd: inv.spanEnd ?? null,
    hits: (inv.hits || inv.candidates || [])
      .slice(0, 24)
      .map((h) => h.surface || h.word || h.text || h)
      .filter(Boolean),
    candidates: (inv.candidates || []).slice(0, 24).map((h) => ({
      surface: h.surface || h.word || h.text || null,
      source: h.source || null,
      domains: h.domains || null,
    })),
    hitCount: (inv.hits || inv.candidates || []).length,
  }));
  const assembly = (p.assembly?.sentences || []).map((s) => s.text || s).filter(Boolean);
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
      retry_regions: retryRegions,
      retry_recall_invocations: recallInv,
      retry_attempts: (m3.retry_attempts || []).map((r) => ({
        attempted: r.attempted === true,
        returnedCandidateCount: r.returnedCandidateCount ?? null,
        rejectedAsAnchor: r.rejectedAsAnchor === true,
      })),
      model3_latency_ms: m3.model3_latency_ms ?? null,
      retry_path_latency_ms: m3.retry_path_latency_ms ?? null,
      candidate_provenance: m3.candidate_provenance
        ? {
            total_sentence_candidates:
              m3.candidate_provenance.total_sentence_candidates ??
              m3.candidate_provenance.sentence_candidate_count ??
              null,
            cap: m3.candidate_provenance.cap ?? 16,
          }
        : null,
    },
    assembly_sentences: assembly.slice(0, 32),
  };
}

function extractRecord(caseDef, data, wallMs, meta) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const trace = extra.dialog200_path_trace || {};
  const paths = (trace.paths || []).map(compactPath);
  const kenlmCombos = (trace.kenlm_input?.combinations || []).map((c) => c.text).filter(Boolean);
  const kenlmTop = (trace.kenlm_rerank?.top_candidates || fw.sentenceRerank?.top || [])
    .map((c) => c.text || c)
    .filter(Boolean);
  const pool =
    fw.spanAssemblyV4?.kenlmPoolCandidateCount ??
    kenlmCombos.length ??
    null;
  return {
    phase: PHASE,
    run_id: meta.runId,
    caseId: caseDef.id,
    scenario: caseDef.scenario || null,
    reference: String(caseDef.expectedText || caseDef.utterance || '').trim(),
    rawMergedAsrText: String(extra.raw_asr_text || '').trim(),
    finalPostprocessText: String(data.text_asr || '').trim(),
    wall_harness_ms: wallMs,
    pipeline_ms: extra.pipeline_ms ?? null,
    fw_detector_step_ms: extra.fw_detector_step_ms ?? null,
    asr_service_id: extra.asr_service_id ?? null,
    lexicon_runtime_status: extra.lexicon_runtime_status || fw.runtime?.status || null,
    kenlm_pool_candidate_count: pool,
    kenlm_ms: typeof fw.kenlmVetoMs === 'number' ? fw.kenlmVetoMs : fw.kenlmTiming?.batchMs ?? null,
    kenlm_input_texts: kenlmCombos.slice(0, 24),
    kenlm_top_texts: kenlmTop.slice(0, 16),
    path_count: paths.length,
    paths,
    snapshot_ok: paths.length > 0,
    git_commit: meta.gitCommit,
    model3_identity_expected: IDENTITY.modelId,
  };
}

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `fresh-causal-${jobId}`,
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

async function startServer(port) {
  killPort(6007);
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    TONE_P10_VAD_CPU: '1',
    MODEL3_CHECKPOINT_IDENTITY: IDENTITY.modelId,
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const weights = path.join(REPO, IDENTITY.checkpointDirRelative, 'weights.pt');
  const config = path.join(REPO, IDENTITY.checkpointDirRelative, 'config.json');
  const weightsSha = sha256File(weights).toLowerCase();
  const configSha = sha256File(config).toLowerCase();
  if (weightsSha !== IDENTITY.expectedWeightsSha256) {
    console.error('STOP_AND_REVIEW weights sha mismatch', weightsSha);
    process.exit(2);
  }
  if (configSha !== IDENTITY.expectedConfigHash) {
    console.error('STOP_AND_REVIEW config sha mismatch', configSha);
    process.exit(2);
  }

  const gitCommit = gitShort();
  const provenancePath = path.join(OUT_DIR, `fresh_dialog200_runtime_provenance_${RUN_ID}.json`);
  const rawJsonl = path.join(OUT_DIR, `fresh_dialog200_raw_cases_${RUN_ID}.jsonl`);
  const progressPath = path.join(OUT_DIR, `fresh_dialog200_progress_${RUN_ID}.json`);

  const port = getTestServerPort();
  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (CASE_FILTER) cases = cases.filter((c) => CASE_FILTER.has(c.id));
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  if (!skipStart) {
    if (!skipBuild) {
      console.log('[fresh] build:main…');
      const b = spawnSync('npm', ['run', 'build:main'], {
        cwd: ELECTRON,
        stdio: 'inherit',
        shell: true,
      });
      if (b.status !== 0) process.exit(1);
    }
    console.log('[fresh] starting electron…');
    await startServer(port);
    const warmupWav = path.join(
      DIALOG_DIR,
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 'fresh-causal-asr',
    });
    if (!asr.ready) {
      console.error('EXECUTION_ENVIRONMENT_INVALID ASR', asr.lastError);
      process.exit(1);
    }
  }

  const health = await healthBundle(port);
  const smoke = cases[0]
    ? await runCase(
        port,
        path.join(DIALOG_DIR, resolveDialog200AudioFile(cases[0]) || cases[0].file),
        `smoke-${cases[0].id}-${Date.now()}`
      )
    : null;
  const smokeLex =
    smoke?.extra?.lexicon_runtime_status ||
    smoke?.extra?.fw_detector?.runtime?.status ||
    null;
  const lexiconOk =
    smokeLex === 'ok' ||
    smokeLex === 'ready' ||
    (smokeLex && typeof smokeLex === 'object' && smokeLex.status === 'ok') ||
    String(smokeLex || '').toLowerCase() === 'ok';

  const provenance = {
    phase: PHASE,
    run_id: RUN_ID,
    git_commit: gitCommit,
    node_build: 'build:main',
    model3: {
      runtime_default: IDENTITY.modelId,
      selected_model: IDENTITY.modelId,
      weights_sha: weightsSha,
      config_sha: configSha,
      identity_valid: true,
    },
    lexicon_db_path: path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite'),
    kenlm_candidates: [
      path.join(REPO, 'electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin'),
      path.join(REPO, 'node_runtime/kenlm/zh_char_3gram.trie.bin'),
    ].filter((p) => fs.existsSync(p)),
    health,
    lexicon_runtime_status_smoke: smokeLex,
    lexicon_runtime_ready: lexiconOk,
    corpus_path: DIALOG_DIR,
    manifest_path: MANIFEST_PATH,
    node_entrypoint: 'electron_node/electron-node (production)',
    dialog200_runner: 'tests/run-fresh-dialog200-causal-reconciliation.mjs',
    service_startup_method: 'tests/repro/start-node-detached.mjs',
    asr_endpoint: 'http://127.0.0.1:6007',
    model3_endpoint: 'model3_inference_host (spawned by Electron)',
    oracle_leak: 'NONE',
    production_semantic_diff: false,
    dual_fork_active: false,
    cases_planned: cases.length,
    started_at: new Date().toISOString(),
  };
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2), 'utf8');

  if (!lexiconOk) {
    console.error('EXECUTION_ENVIRONMENT_INVALID LEXICON_RUNTIME_READY=NO', smokeLex);
    process.exit(1);
  }

  fs.writeFileSync(rawJsonl, '');
  console.log(`[fresh] RUN_ID=${RUN_ID} cases=${cases.length} → ${rawJsonl}`);
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  let n = 0;
  let failed = 0;
  for (const caseDef of cases) {
    if (Date.now() >= deadline) {
      console.error('[fresh] deadline reached');
      break;
    }
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavPath, `${caseDef.id}-${Date.now()}`);
      const rec = extractRecord(caseDef, data, Date.now() - t0, { runId: RUN_ID, gitCommit });
      fs.appendFileSync(rawJsonl, JSON.stringify(rec) + '\n');
      n += 1;
      const rawOk = norm(rec.rawMergedAsrText) === norm(rec.reference);
      const finOk = norm(rec.finalPostprocessText) === norm(rec.reference);
      console.log(
        `[${caseDef.id}] raw=${rawOk ? 'Y' : 'N'} final=${finOk ? 'Y' : 'N'} pipe=${rec.pipeline_ms} paths=${rec.path_count} lex=${rec.lexicon_runtime_status}`
      );
    } catch (e) {
      failed += 1;
      fs.appendFileSync(
        rawJsonl,
        JSON.stringify({
          phase: PHASE,
          run_id: RUN_ID,
          caseId: caseDef.id,
          error: String(e.message || e),
          snapshot_ok: false,
        }) + '\n'
      );
      console.log(`[${caseDef.id}] ERROR`, e.message || e);
    }
    fs.writeFileSync(
      progressPath,
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

  provenance.finished_at = new Date().toISOString();
  provenance.cases_executed = n;
  provenance.cases_failed = failed;
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2), 'utf8');
  console.log(`[fresh] done executed=${n} failed=${failed} RUN_ID=${RUN_ID}`);
  if (n < cases.length) process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
