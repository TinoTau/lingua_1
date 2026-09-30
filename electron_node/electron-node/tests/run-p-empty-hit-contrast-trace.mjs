#!/usr/bin/env node
/**
 * READ-ONLY TRACE capture for P empty-hit contrast audit.
 * Reuses frozen tone evidence; dumps dialog200_path_trace p_retrieval queries.
 * Does not mutate lexicon / Model2 / old batches.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const CAP = path.join(DS, 'tone_evidence_captures', 'tonecap_2026-09-12T0001');
const PROFILES = path.join(DS, 'profiles');
const START = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT = path.join(
  REPO,
  'docs/user_correction/model3/LINGUA_MODEL2_FINESPAN_LOCAL_TONE_BINDING_SINGLE_DELTA_TRACE.jsonl'
);

const CASE_IDS = [
  'p2_u001_016',
  'p2_u001_002',
  'p2_u002_016',
  'p2_u003_001',
  'p2_u004_001',
  'p2_u003_016',
  'p2_u001_004',
];

function emptyProfile() {
  return {
    schema_version: 2,
    profile_version: 0,
    phonetic_bias: {},
    tone_bias: {},
    personal_terms: [],
    personal_term_evidence: {},
    resolved_lexical_terms: {},
    unresolved_lexical_observations: [],
    legacy_free_text_personal_terms: [],
    confusion_bias: {},
    domain_bias: {},
    long_term_domain_evidence: {},
  };
}

function loadCases() {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(DS, 'cases', 'cases.jsonl'), 'utf8')
      .trim()
      .split(/\n/)
      .map((l) => JSON.parse(l))
      .map((c) => [c.caseId, c])
  );
}

function loadProfile(ref) {
  const p = path.join(PROFILES, `${ref}.userprofile.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function startElectron() {
  killPort(5020);
  // Do NOT kill 6007 if present; Replay doesn't need ASR.
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    MODEL2_DIALOG200_TRACE: '1',
    LEXICON_RECALL_V2_DIAGNOSTICS: '1',
  };
  const child = spawn(process.execPath, [START], {
    cwd: path.join(REPO, 'electron_node', 'electron-node'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stdout += d.toString();
  });
  return new Promise((resolve) => {
    child.on('exit', () => {
      const m = stdout.match(/STARTED electron pid\s+(\d+)/);
      resolve({ pid: m ? Number(m[1]) : null, stdout });
    });
  });
}

async function postJson(port, route, body, timeoutMs = 300000) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function extractPTraces(extra) {
  const trace = extra?.dialog200_path_trace;
  if (!trace) return { paths: [], summary: null };
  const paths = Array.isArray(trace) ? trace : trace.paths || [];
  const out = [];
  for (const p of paths) {
    const spans = p?.model2?.spans || [];
    for (const s of spans) {
      const pr = s?.p_retrieval;
      if (!pr) continue;
      out.push({
        path_id: p.path_id,
        finespan: s.finespan || null,
        profile: s.profile || null,
        feature_pack: s.feature_pack || null,
        model2_raw: {
          p_selected_actions: s.model2_raw?.p_selected_actions || null,
          p_top1: s.model2_raw?.p_top1 || null,
        },
        p_retrieval: pr,
        tone_pattern_source: pr?.tone_pattern_source || null,
        fineSpan_local_tone_pattern: pr?.fineSpan_local_tone_pattern || null,
      });
    }
  }
  return {
    paths: out,
    summaries: paths.map((p) => p.model2_summary || null),
  };
}

async function main() {
  const skipStart = process.argv.includes('--skip-start');
  const cases = loadCases();
  const port = getTestServerPort();
  if (!skipStart) {
    console.log('[start]');
    const st = await startElectron();
    console.log('[start]', st.pid);
  }
  const healthy = await waitTestServerHealth(port, skipStart ? 30000 : 180000);
  if (!healthy) {
    console.error('health failed');
    process.exit(3);
  }

  const lines = [];
  for (const caseId of CASE_IDS) {
    const c = cases[caseId];
    const evidence = JSON.parse(fs.readFileSync(path.join(CAP, `${caseId}.evidence.json`), 'utf8'));
    const profile = loadProfile(c.profileRef);
    const sessionId = `pilot200-p-empty-audit::${caseId}::CORRECT`;
    console.log('[replay]', caseId);

    const boot = await postJson(port, '/session-bootstrap', {
      type: 'session_bootstrap',
      session_id: sessionId,
      user_id: c.userId,
      profile_version: profile.profile_version ?? 0,
      user_profile: profile,
      trace_id: `p_empty_audit_${caseId}`,
    });
    if (!(boot.ok && boot.data?.ok)) {
      lines.push({ caseId, status: 'BOOT_FAIL', error: boot.data });
      continue;
    }

    const pipe = await postJson(port, '/run-lexicon-mock', {
      asrText: evidence.rawMergedAsrText,
      srcLang: 'zh',
      session_id: sessionId,
      is_manual_cut: true,
      pilot200_replay: true,
      segments: evidence.segments,
      utterance_tone: evidence.utterance_tone,
    });
    if (!pipe.ok) {
      lines.push({ caseId, status: 'PIPE_FAIL', error: pipe.data });
      continue;
    }

    const extra = pipe.data.extra || {};
    const extracted = extractPTraces(extra);
    const sum = (extracted.summaries || []).filter(Boolean);
    // pick best summary by p_hit
    let best = sum[0] || null;
    for (const s of sum) {
      if ((s?.p_retrieval_hit_count || 0) > (best?.p_retrieval_hit_count || 0)) best = s;
    }

    lines.push({
      kind: 'CORRECT_TRACE',
      caseId,
      referenceText: c.referenceText,
      evaluationTargetSurface: c.evaluationTargetSurface,
      evaluationTargetTermIds: c.evaluationTargetTermIds,
      targetInLexicon: c.targetInLexicon,
      relationFamily: c.relationFamily,
      relationDirection: c.relationDirection,
      frozenRawText: evidence.rawMergedAsrText,
      profileRef: c.profileRef,
      phonetic_bias: profile.phonetic_bias || {},
      asr_step_skipped: extra.asr_step_skipped === true,
      tone_inference_skipped: extra.tone_inference_skipped === true,
      frozen_tone_slice_count: extra.frozen_tone_slice_count,
      model2_summary_best: best,
      model2_summaries: sum,
      p_span_traces: extracted.paths,
      recall_v2_diag: extra.lexicon_recall_v2_diagnostics || extra.recall_v2_diagnostics || null,
    });
  }

  fs.writeFileSync(OUT, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  console.log('WROTE', OUT, 'rows', lines.length);
  for (const l of lines) {
    if (l.status) {
      console.log(l.caseId, l.status);
      continue;
    }
    const queries = (l.p_span_traces || []).flatMap((t) => t.p_retrieval?.queries || []);
    console.log(
      JSON.stringify({
        caseId: l.caseId,
        summary: l.model2_summary_best,
        queryCount: queries.length,
        queries: queries.map((q) => ({
          action: q.action_id,
          pinyin_key: q.pinyin_key,
          query: q.query,
          ready: q.toneRecallReadinessState,
          hits: (q.hits || []).map((h) => h.surface),
        })),
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
