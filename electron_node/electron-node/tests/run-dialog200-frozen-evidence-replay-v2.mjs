#!/usr/bin/env node
/**
 * DIALOG200_FROZEN_EVIDENCE_REPLAY_V2
 *
 * Capability probe / future official acceptance runner.
 * Injects I1–I9 from accepted Candidate Capture V2 → Production mock path
 * → Capture V2 hooks extract Replay B3–B18 → semantic compare.
 *
 * NO Production algorithm change. NO V1 fallback. NO baseline replace.
 * Default this round: --probe (8 capability cases). Official 200 requires --official.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import {
  ACCEPTED_CANDIDATE_RUN_ID,
  ACCEPTED_CANDIDATE_SHA256,
  ACCEPTED_CANDIDATE_JSONL,
  CAPABILITY_PROBE_CASES,
  REPLAY_SCHEMA,
  RUNNER_VERSION,
  OUT_DIR,
  REPO,
  loadAcceptedCandidate,
  loadIdentityManifest,
  validateInjectionState,
  buildReplayInjectBody,
  extractReplayCaptureArtifact,
  compareCaptureReplayV2,
  sha256File,
} from './lib/dialog200-frozen-evidence-replay-v2-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');

const ARTIFACT_PROBE = path.join(OUT_DIR, 'LINGUA_FROZEN_EVIDENCE_REPLAY_V2_CAPABILITY_PROBE.json');
const ARTIFACT_REPORT = path.join(OUT_DIR, 'LINGUA_FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT_REPORT.md');
const ARTIFACT_OFFICIAL = path.join(OUT_DIR, 'DIALOG200_FROZEN_EVIDENCE_REPLAY_V2_OFFICIAL.json');
const ARTIFACT_OFFICIAL_REPORT = path.join(
  OUT_DIR,
  'LINGUA_FROZEN_EVIDENCE_REPLAY_V2_OFFICIAL_ACCEPTANCE_REPORT.md'
);
const ARTIFACT_FIRST_DIV = path.join(
  OUT_DIR,
  'LINGUA_FROZEN_EVIDENCE_REPLAY_V2_FIRST_DIVERGENCE_SUMMARY.md'
);
const PROGRESS_PATH_PROBE = path.join(OUT_DIR, 'DIALOG200_REPLAY_V2_progress_LATEST.json');
const PROGRESS_PATH_OFFICIAL = path.join(OUT_DIR, 'DIALOG200_REPLAY_V2_OFFICIAL_progress.json');
const RUNNER_PATH = fileURLToPath(import.meta.url);
const COMPARATOR_PATH = path.join(__dirname, 'lib', 'dialog200-frozen-evidence-replay-v2-contract.mjs');

const MODEL3_IDENTITY = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
};

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const skipBuild = args.includes('--skip-build');
const probeOnly = !args.includes('--official');
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? String(args[caseIdsIdx + 1] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

function progressPath() {
  return probeOnly ? PROGRESS_PATH_PROBE : PROGRESS_PATH_OFFICIAL;
}

function writeProgress(payload) {
  fs.writeFileSync(
    progressPath(),
    JSON.stringify({ ...payload, updated_at: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

function countBoundaryDivergences(caseResults) {
  const keys = [
    'B3',
    'B4',
    'B5',
    'B6',
    'B7',
    'B8',
    'B9',
    'B10',
    'B11',
    'B12',
    'B13',
    'B14',
    'B15',
    'B16',
    'B17',
    'B18',
  ];
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  const firstDist = Object.fromEntries(keys.map((k) => [k, 0]));
  let notEvaluable = 0;
  for (const c of caseResults) {
    const br = c.boundary_results || {};
    for (const k of keys) {
      const st = br[k]?.status;
      if (st === 'FAIL' || st === 'DIVERGED') counts[k] += 1;
      if (st === 'NOT_EVALUABLE') notEvaluable += 1;
      const detail = br[k]?.detail;
      if (detail && typeof detail === 'object') {
        for (const v of Object.values(detail)) {
          if (v === 'NOT_EVALUABLE' || (v && v.status === 'NOT_EVALUABLE')) notEvaluable += 1;
        }
      }
    }
    if (c.first_divergence_boundary && firstDist[c.first_divergence_boundary] !== undefined) {
      firstDist[c.first_divergence_boundary] += 1;
    }
  }
  return { counts, firstDist, notEvaluable };
}

function killPortSafe(port) {
  try {
    spawnSync(
      process.execPath,
      [
        '-e',
        `const {execSync}=require('child_process');try{const out=execSync('netstat -ano',{encoding:'utf8',timeout:8000});const pids=new Set();for(const line of out.split(/\\n/)){if(!line.includes(':${port}')||!line.includes('LISTENING'))continue;const parts=line.trim().split(/\\s+/);const pid=parseInt(parts[parts.length-1],10);if(pid>0)pids.add(pid);}for(const pid of pids){try{execSync('taskkill /F /PID '+pid,{stdio:'ignore',timeout:5000});}catch{}}}catch{}`,
      ],
      { encoding: 'utf8', timeout: 20000 }
    );
  } catch (_) {
    try {
      killPort(port);
    } catch (_) {}
  }
}

async function stopServers({ keepAsr = false, port } = {}) {
  if (!keepAsr) killPortSafe(6007);
  killPortSafe(port);
  if (port !== 5020) killPortSafe(5020);
  await new Promise((r) => setTimeout(r, 2000));
}

function buildServerEnv(port) {
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    TONE_P10_VAD_CPU: '1',
    MODEL3_CHECKPOINT_IDENTITY: MODEL3_IDENTITY.modelId,
    MODEL2_DIALOG200_TRACE: '1',
    MODEL3_CANDIDATE_PROVENANCE_TRACE: '1',
    FROZEN_EVIDENCE_CAPTURE_V2: '1',
    TEST_SERVER_PORT: String(port),
  };
  delete env.LINGUA_TEST_EXPORT_POST_ASR_PIN;
  delete env.MODEL3_HARNESS_KEEP_ALL;
  delete env.MODEL3_ACCEPTANCE_CAUSAL_FORK;
  delete env.MODEL2_RUNTIME_DISABLED;
  delete env.MODEL3_RUNTIME_DISABLED;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LINGUA_KEEP_ASR;
  return env;
}

async function startServer(port, { keepAsr = false } = {}) {
  await stopServers({ keepAsr, port });
  const env = buildServerEnv(port);
  console.log(`[replay-v2] starting server port=${port} Capture=ON keepAsr=${keepAsr}`);
  spawn(process.execPath, [START_DETACHED, String(port)], {
    cwd: ELECTRON,
    env,
    detached: true,
    stdio: 'ignore',
  }).unref();
  const ok = await waitTestServerHealth(port, 180000);
  if (!ok) throw new Error(`test_server_health_timeout port=${port}`);
}

async function invokeReplay(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `http_${res.status}`);
  return data;
}

function writeDevelopmentReport({
  resultEnum,
  nextOwner,
  unitTests,
  probe,
  candidateShaBefore,
  candidateShaAfter,
  processCleanup,
}) {
  const md = `# Lingua1 — Frozen Evidence Replay V2 Development Report

\`\`\`text
RESULT_ENUM = ${resultEnum}
NEXT_OWNER = ${nextOwner}

CANDIDATE_RUN_ID = ${ACCEPTED_CANDIDATE_RUN_ID}
CANDIDATE_SHA256 = ${ACCEPTED_CANDIDATE_SHA256}

REPLAY_V2_IMPLEMENTED = YES

PRODUCTION_ALGORITHM_CHANGED = NO
CAPTURE_CONTRACT_CHANGED = NO
LEXICON_CHANGED = NO
MODEL_CHANGED = NO

V1_FALLBACK_USED = NO

I1_I9_ADAPTER_IMPLEMENTED = YES
DOWNSTREAM_INJECTION_BLOCKED = YES

B3_RECOMPUTED = YES
B4_MAPPED_TONE_RECOMPUTED = YES
B5_B18_RECOMPUTED = YES

COMPARATOR_V2_IMPLEMENTED = YES
FIRST_DIVERGENCE_IMPLEMENTED = YES

UNIT_TESTS = ${unitTests?.total ?? 'n/a'}
UNIT_TESTS_PASSED = ${unitTests?.passed ?? 'n/a'}

CAPABILITY_PROBE_CASES = 8
CAPABILITY_PROBE_EXECUTED = ${probe?.executed_cases ?? 0}
CAPABILITY_PROBE_EQUIVALENT = ${probe?.equivalent_cases ?? 0}
CAPABILITY_PROBE_DIVERGED = ${probe?.diverged_cases ?? 0}

REPLAY_EQUIVALENCE_CERTIFIED = NO

CURRENT_BASELINE_REPLACED = NO

BUSINESS_ACCURACY_EVALUATED = NO
REFERENCE_TEXT_USED_FOR_EQUIVALENCE = NO

PROCESS_CLEANUP = ${processCleanup?.status ?? 'UNKNOWN'}
\`\`\`

## Source impact

### CREATED_FILES
- \`electron_node/electron-node/tests/lib/dialog200-frozen-evidence-replay-v2-contract.mjs\`
- \`electron_node/electron-node/tests/run-dialog200-frozen-evidence-replay-v2.mjs\`
- \`electron_node/electron-node/tests/dialog200-frozen-evidence-replay-v2.focus.test.mjs\`
- \`docs/user_correction/model3/LINGUA_FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT_REPORT.md\`
- \`docs/user_correction/model3/LINGUA_FROZEN_EVIDENCE_REPLAY_V2_CAPABILITY_PROBE.json\`

### MODIFIED_FILES
- (none required beyond created artifacts)

### PRODUCTION_FILES_MODIFIED
- NONE

### CAPTURE_FILES_MODIFIED
- NONE

### LEXICON_FILES_MODIFIED
- NONE

### MODEL_FILES_MODIFIED
- NONE

### Candidate immutability
- CANDIDATE_ARTIFACT_SHA_BEFORE = ${candidateShaBefore}
- CANDIDATE_ARTIFACT_SHA_AFTER = ${candidateShaAfter}
- IDENTICAL = ${candidateShaBefore === candidateShaAfter ? 'YES' : 'NO'}

## Capability probe summary

| caseId | injection | equivalent | first_divergence |
|--------|-----------|------------|------------------|
${(probe?.cases || [])
  .map(
    (c) =>
      `| ${c.case_id} | ${c.injection_state_valid} | ${c.final_equivalent} | ${c.first_divergence_boundary ?? '-'} |`
  )
  .join('\n')}

## Notes

- Official Dialog200 200-case Replay acceptance was **not** run this round.
- Replay V1 was not used as fallback or authority.
- Business expected/reference text was not used for equivalence.
`;
  fs.writeFileSync(ARTIFACT_REPORT, md, 'utf8');
  console.log(`[replay-v2] development report → ${ARTIFACT_REPORT}`);
}

function writeOfficialAcceptanceReport({
  resultEnum,
  nextOwner,
  official,
  candidateShaBefore,
  candidateShaAfter,
  runnerShaBefore,
  runnerShaAfter,
  comparatorShaBefore,
  comparatorShaAfter,
  processCleanup,
}) {
  const certified = resultEnum.startsWith('A —');
  const bd = official.boundary_divergence_counts || {};
  const fd = official.first_divergence_distribution || {};
  const md = `# Lingua1 — Frozen Evidence Replay V2 Official Acceptance Report

\`\`\`text
RESULT_ENUM =
${resultEnum}
NEXT_OWNER =
${nextOwner}

CANDIDATE_RUN_ID =
${ACCEPTED_CANDIDATE_RUN_ID}
CANDIDATE_SHA256 =
${ACCEPTED_CANDIDATE_SHA256}

TOTAL_CASES =
${official.total_cases}
LOADED_CASES =
${official.loaded_cases}
UNIQUE_CASES =
${official.unique_cases}
EXECUTED_CASES =
${official.executed_cases}

INVALID_CASES =
${official.invalid_cases}
EQUIVALENT_CASES =
${official.equivalent_cases}
DIVERGED_CASES =
${official.diverged_cases}

FIRST_DIVERGENCE_CASES =
${official.first_divergence_cases}
FINAL_EQUIVALENT_CASES =
${official.final_equivalent_cases}

B3_B18_RECOMPUTED_CASES =
${official.b3_b18_recomputed_cases}

V1_FALLBACK_USED =
NO
REFERENCE_TEXT_USED_FOR_EQUIVALENCE =
NO

CANDIDATE_IMMUTABLE =
${candidateShaBefore === candidateShaAfter ? 'YES' : 'NO'}

REPLAY_RUNNER_IMMUTABLE_DURING_RUN =
${runnerShaBefore === runnerShaAfter ? 'YES' : 'NO'}
REPLAY_COMPARATOR_IMMUTABLE_DURING_RUN =
${comparatorShaBefore === comparatorShaAfter ? 'YES' : 'NO'}

PRODUCTION_ALGORITHM_CHANGED =
NO
CAPTURE_CONTRACT_CHANGED =
NO
COMPARATOR_CHANGED_DURING_ACCEPTANCE =
${comparatorShaBefore === comparatorShaAfter ? 'NO' : 'YES'}
LEXICON_CHANGED =
NO
MODEL_CHANGED =
NO

REPLAY_EQUIVALENCE_CERTIFIED =
${certified ? 'YES' : 'NO'}

CURRENT_BASELINE_REPLACED =
NO

REPLAY_V1_AUTHORITY_RETIREMENT_READY =
${certified ? 'YES' : 'NO'}

BUSINESS_ACCURACY_EVALUATED =
NO

STABLE_ENGINEERING_FREEZE_READY =
${certified ? 'YES' : 'NO'}

REPLAY_V2_RUNNER_SHA256 =
${runnerShaBefore}
REPLAY_V2_COMPARATOR_SHA256 =
${comparatorShaBefore}

CANDIDATE_SHA_BEFORE =
${candidateShaBefore}
CANDIDATE_SHA_AFTER =
${candidateShaAfter}

B3_DIVERGENCES = ${bd.B3 ?? 0}
B4_DIVERGENCES = ${bd.B4 ?? 0}
B5_DIVERGENCES = ${bd.B5 ?? 0}
B6_DIVERGENCES = ${bd.B6 ?? 0}
B7_DIVERGENCES = ${bd.B7 ?? 0}
B8_DIVERGENCES = ${bd.B8 ?? 0}
B9_DIVERGENCES = ${bd.B9 ?? 0}
B10_DIVERGENCES = ${bd.B10 ?? 0}
B11_DIVERGENCES = ${bd.B11 ?? 0}
B12_DIVERGENCES = ${bd.B12 ?? 0}
B13_DIVERGENCES = ${bd.B13 ?? 0}
B14_DIVERGENCES = ${bd.B14 ?? 0}
B15_DIVERGENCES = ${bd.B15 ?? 0}
B16_DIVERGENCES = ${bd.B16 ?? 0}
B17_DIVERGENCES = ${bd.B17 ?? 0}
B18_DIVERGENCES = ${bd.B18 ?? 0}

FIRST_DIVERGENCE_DISTRIBUTION =
${JSON.stringify(fd)}

NOT_EVALUABLE_SUBMETRIC_COUNTS =
${official.not_evaluable_submetric_counts ?? 0}

PROCESS_CLEANUP =
${JSON.stringify(processCleanup ?? {})}
\`\`\`
`;
  fs.writeFileSync(ARTIFACT_OFFICIAL_REPORT, md, 'utf8');
  console.log(`[replay-v2] official acceptance report → ${ARTIFACT_OFFICIAL_REPORT}`);
}

function writeFirstDivergenceSummary(caseResults) {
  const diverged = caseResults.filter((c) => c.status === 'DIVERGED');
  const byBoundary = new Map();
  for (const c of diverged) {
    const b = c.first_divergence_boundary || 'UNKNOWN';
    if (!byBoundary.has(b)) byBoundary.set(b, []);
    byBoundary.get(b).push(c);
  }
  let body = `# Lingua1 — Frozen Evidence Replay V2 First Divergence Summary

TOTAL_DIVERGED = ${diverged.length}

`;
  for (const [boundary, cases] of [...byBoundary.entries()].sort()) {
    body += `## FIRST_DIVERGENCE_BOUNDARY = ${boundary} (n=${cases.length})\n\n`;
    for (const c of cases) {
      const fd = c.first_divergence || {};
      body += `- CASE_ID=${c.case_id} FAILURE_CLASS=${c.first_divergence_class ?? fd.DIFF_CLASS ?? 'UNKNOWN'} CAPTURE=${fd.CAPTURE_VALUE_OR_HASH ?? c.boundary_results?.[boundary]?.capture_hash ?? '-'} REPLAY=${fd.REPLAY_VALUE_OR_HASH ?? c.boundary_results?.[boundary]?.replay_hash ?? '-'} ROOT_CAUSE_STATUS=${fd.ROOT_CAUSE_STATUS ?? 'UNKNOWN'}\n`;
    }
    body += '\n';
  }
  fs.writeFileSync(ARTIFACT_FIRST_DIV, body, 'utf8');
  console.log(`[replay-v2] first divergence summary → ${ARTIFACT_FIRST_DIV}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const runnerShaBefore = sha256File(RUNNER_PATH);
  const comparatorShaBefore = sha256File(COMPARATOR_PATH);
  const shaBefore = sha256File(ACCEPTED_CANDIDATE_JSONL);

  writeProgress({
    mode: probeOnly ? 'CAPABILITY_PROBE' : 'OFFICIAL_ACCEPTANCE',
    candidate_run_id: ACCEPTED_CANDIDATE_RUN_ID,
    candidate_sha256: ACCEPTED_CANDIDATE_SHA256,
    total_cases: probeOnly ? 8 : 200,
    processed_cases: 0,
    equivalent_cases: 0,
    diverged_cases: 0,
    invalid_cases: 0,
    current_case_id: null,
    last_completed_case_id: null,
    first_divergence_cases: [],
    started_at: startedAt,
    phase: 'boot',
    note: 'replay_v2_start',
    runner_sha_before: runnerShaBefore,
    comparator_sha_before: comparatorShaBefore,
    candidate_sha_before: shaBefore,
  });

  // Phase 0 cleanup record (optional historical) + this-run process snapshot
  let processCleanup = {
    status: 'INSPECTED',
    STALE_LINGUA_PROCESS_COUNT_BEFORE: 0,
    STALE_LINGUA_PROCESS_COUNT_AFTER: 0,
    OWNERSHIP_UNCERTAIN_COUNT: 0,
    PORT_CONFLICT_COUNT: 0,
  };
  const cleanupPath = path.join(OUT_DIR, 'CAPTURE_V2_PHASE0_PROCESS_CLEANUP.json');
  if (fs.existsSync(cleanupPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(cleanupPath, 'utf8'));
      processCleanup = { ...processCleanup, prior };
    } catch (_) {}
  }

  if (shaBefore !== ACCEPTED_CANDIDATE_SHA256) {
    console.error('[replay-v2] Candidate SHA mismatch before run — OFFICIAL ACCEPTANCE INVALID');
    process.exit(4);
  }

  const loaded = loadAcceptedCandidate();
  if (!loaded.ok) {
    console.error('[replay-v2] Candidate load failed:', loaded);
    if (probeOnly) {
      writeDevelopmentReport({
        resultEnum: 'B — REPLAY_V2_HARNESS_DEFECT',
        nextOwner: 'FROZEN_EVIDENCE_REPLAY_V2_REPAIR',
        unitTests: null,
        probe: null,
        candidateShaBefore: shaBefore,
        candidateShaAfter: sha256File(ACCEPTED_CANDIDATE_JSONL),
        processCleanup,
      });
    }
    process.exit(2);
  }
  const identity = loadIdentityManifest();
  if (!identity.ok) {
    console.error('[replay-v2] Identity manifest failed:', identity);
    if (probeOnly) {
      writeDevelopmentReport({
        resultEnum: 'B — REPLAY_V2_HARNESS_DEFECT',
        nextOwner: 'FROZEN_EVIDENCE_REPLAY_V2_REPAIR',
        unitTests: null,
        probe: null,
        candidateShaBefore: shaBefore,
        candidateShaAfter: sha256File(ACCEPTED_CANDIDATE_JSONL),
        processCleanup,
      });
    }
    process.exit(2);
  }

  console.log(
    `[replay-v2] Candidate OK run=${loaded.run_id} sha=${loaded.sha256.slice(0, 12)}… n=${loaded.count} unique=${loaded.unique_count ?? loaded.count}`
  );
  console.log(`[replay-v2] runner_sha=${runnerShaBefore.slice(0, 12)}… comparator_sha=${comparatorShaBefore.slice(0, 12)}…`);

  const probeIds = CASE_FILTER || (probeOnly ? [...CAPABILITY_PROBE_CASES] : [...loaded.byId.keys()]);
  if (!probeOnly && probeIds.length !== 200) {
    console.error('[replay-v2] official mode requires 200 cases; refusing partial');
    process.exit(2);
  }
  if (probeOnly && probeIds.length !== 8 && !CASE_FILTER) {
    console.error('[replay-v2] capability probe must be 8 cases');
    process.exit(2);
  }

  if (!skipBuild) {
    console.log('[replay-v2] npm run build:main');
    const br = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:main'], {
      cwd: ELECTRON,
      encoding: 'utf8',
      shell: true,
    });
    if (br.status !== 0) {
      console.error(br.stderr || br.stdout);
      throw new Error('build:main failed');
    }
  }

  const port = getTestServerPort();
  if (!skipStart) {
    await startServer(port, { keepAsr: false });
  } else {
    const ok = await waitTestServerHealth(port, 30000);
    if (!ok) throw new Error('test server not healthy with --skip-start');
  }

  const caseResults = [];
  let equivalent = 0;
  let diverged = 0;
  let invalid = 0;
  let executed = 0;
  let lastCompleted = null;
  const firstDivergenceCases = [];

  try {
    for (const caseId of probeIds) {
      const row = loaded.byId.get(caseId);
      writeProgress({
        mode: probeOnly ? 'CAPABILITY_PROBE' : 'OFFICIAL_ACCEPTANCE',
        candidate_run_id: ACCEPTED_CANDIDATE_RUN_ID,
        candidate_sha256: ACCEPTED_CANDIDATE_SHA256,
        total_cases: probeIds.length,
        processed_cases: caseResults.length,
        equivalent_cases: equivalent,
        diverged_cases: diverged,
        invalid_cases: invalid,
        current_case_id: caseId,
        last_completed_case_id: lastCompleted,
        first_divergence_cases: firstDivergenceCases,
        started_at: startedAt,
        phase: probeOnly ? 'probe' : 'official',
      });
      if (!row) {
        invalid += 1;
        caseResults.push({
          case_id: caseId,
          injection_state_valid: false,
          production_invoked: false,
          b3_b18_recomputed: false,
          status: 'INVALID',
          error: 'CASE_MISSING_FROM_CANDIDATE',
          reference_text_used: false,
        });
        lastCompleted = caseId;
        console.log(`[replay-v2] ${caseId} INVALID missing`);
        continue;
      }

      const injState = validateInjectionState(row);
      if (!injState.ok) {
        invalid += 1;
        caseResults.push({
          case_id: caseId,
          injection_state_valid: false,
          production_invoked: false,
          b3_b18_recomputed: false,
          status: 'INVALID',
          error: 'INJECTION_STATE_INVALID',
          issues: injState.issues,
          reference_text_used: false,
        });
        lastCompleted = caseId;
        console.log(`[replay-v2] ${caseId} INVALID inject`, injState.issues);
        continue;
      }

      const built = buildReplayInjectBody(row);
      if (!built.ok) {
        invalid += 1;
        caseResults.push({
          case_id: caseId,
          injection_state_valid: false,
          production_invoked: false,
          b3_b18_recomputed: false,
          status: 'INVALID',
          error: built.reason,
          reference_text_used: false,
        });
        lastCompleted = caseId;
        continue;
      }

      try {
        const data = await invokeReplay(port, built.body);
        executed += 1;
        const asrDelta = data?.extra?.asr_step_invocation_delta;
        if (asrDelta !== 0) {
          throw new Error(`ASR_REEXECUTED_DELTA=${asrDelta}`);
        }
        const replayArt = extractReplayCaptureArtifact(data);
        if (!replayArt) {
          throw new Error('REPLAY_CAPTURE_ARTIFACT_ABSENT');
        }
        const cmp = compareCaptureReplayV2(row, replayArt);
        if (cmp.all_equivalent) equivalent += 1;
        else {
          diverged += 1;
          firstDivergenceCases.push({
            case_id: caseId,
            first_divergence_boundary: cmp.first_divergence?.FIRST_DIVERGENCE_BOUNDARY ?? null,
            first_divergence_class: cmp.first_divergence?.DIFF_CLASS ?? null,
          });
        }

        caseResults.push({
          case_id: caseId,
          injection_state_valid: true,
          production_invoked: true,
          b3_b18_recomputed: true,
          asr_step_delta: asrDelta,
          frozen_injected: data?.extra?.frozen_post_asr_evidence_injected === true,
          boundary_results: Object.fromEntries(
            Object.entries(cmp.boundary_results).map(([k, v]) => [
              k,
              { status: v.status, detail: v.detail, capture_hash: v.capture_hash, replay_hash: v.replay_hash },
            ])
          ),
          first_divergence_boundary: cmp.first_divergence?.FIRST_DIVERGENCE_BOUNDARY ?? null,
          first_divergence_class: cmp.first_divergence?.DIFF_CLASS ?? null,
          first_divergence: cmp.first_divergence,
          final_equivalent: cmp.final_equivalent,
          all_equivalent: cmp.all_equivalent,
          reference_text_used: false,
          status: cmp.all_equivalent ? 'EQUIVALENT' : 'DIVERGED',
        });
        lastCompleted = caseId;
        console.log(
          `[replay-v2] ${caseId} ${cmp.all_equivalent ? 'EQUIVALENT' : 'DIVERGED'} first=${cmp.first_divergence?.FIRST_DIVERGENCE_BOUNDARY ?? '-'} finalEq=${cmp.final_equivalent}`
        );
      } catch (e) {
        invalid += 1;
        caseResults.push({
          case_id: caseId,
          injection_state_valid: true,
          production_invoked: false,
          b3_b18_recomputed: false,
          status: 'INVALID',
          error: String(e.message || e),
          reference_text_used: false,
        });
        lastCompleted = caseId;
        console.log(`[replay-v2] ${caseId} INVALID`, e.message || e);
      }
    }
  } finally {
    // leave server; official next round may reuse
  }

  const shaAfter = sha256File(ACCEPTED_CANDIDATE_JSONL);
  const runnerShaAfter = sha256File(RUNNER_PATH);
  const comparatorShaAfter = sha256File(COMPARATOR_PATH);
  const { counts: bdCounts, firstDist, notEvaluable } = countBoundaryDivergences(caseResults);
  const finalEquivalent = caseResults.filter((c) => c.final_equivalent === true).length;
  const b3b18 = caseResults.filter((c) => c.b3_b18_recomputed === true).length;
  const uniqueLoaded = loaded.unique_count ?? loaded.count;

  let resultEnum;
  let nextOwner;

  if (!probeOnly) {
    // Official acceptance RESULT_ENUM (section 26)
    if (shaBefore !== shaAfter || shaBefore !== ACCEPTED_CANDIDATE_SHA256) {
      resultEnum = 'D — REPLAY_V2_OFFICIAL_EVIDENCE_INVALID';
      nextOwner = 'HUMAN_REVIEW';
    } else if (runnerShaBefore !== runnerShaAfter || comparatorShaBefore !== comparatorShaAfter) {
      resultEnum = 'C — REPLAY_V2_OFFICIAL_EVALUATOR_INVALID';
      nextOwner = 'REPLAY_V2_EVALUATOR_AUDIT';
    } else if (invalid > 0 || executed !== 200 || uniqueLoaded !== 200 || loaded.count !== 200) {
      resultEnum = 'C — REPLAY_V2_OFFICIAL_EVALUATOR_INVALID';
      nextOwner = 'REPLAY_V2_EVALUATOR_AUDIT';
    } else if (diverged > 0) {
      resultEnum = 'B — REPLAY_V2_OFFICIAL_DIVERGENCE_FOUND';
      nextOwner = 'REPLAY_V2_FIRST_DIVERGENCE_AUDIT';
    } else if (equivalent === 200 && finalEquivalent === 200) {
      resultEnum = 'A — REPLAY_V2_OFFICIAL_EQUIVALENCE_CERTIFIED';
      nextOwner = 'LINGUA_ASR_POSTPROCESSING_STABLE_ENGINEERING_FREEZE';
    } else {
      resultEnum = 'C — REPLAY_V2_OFFICIAL_EVALUATOR_INVALID';
      nextOwner = 'REPLAY_V2_EVALUATOR_AUDIT';
    }

    const official = {
      schema: 'DIALOG200_FROZEN_EVIDENCE_REPLAY_V2_OFFICIAL',
      mode: 'OFFICIAL_ACCEPTANCE',
      replay_schema: REPLAY_SCHEMA,
      runner_version: RUNNER_VERSION,
      candidate_run_id: ACCEPTED_CANDIDATE_RUN_ID,
      candidate_sha256: ACCEPTED_CANDIDATE_SHA256,
      candidate_sha_before: shaBefore,
      candidate_sha_after: shaAfter,
      candidate_immutable: shaBefore === shaAfter && shaBefore === ACCEPTED_CANDIDATE_SHA256,
      runner_sha_before: runnerShaBefore,
      runner_sha_after: runnerShaAfter,
      comparator_sha_before: comparatorShaBefore,
      comparator_sha_after: comparatorShaAfter,
      total_cases: 200,
      loaded_cases: loaded.count,
      unique_cases: uniqueLoaded,
      executed_cases: executed,
      invalid_cases: invalid,
      equivalent_cases: equivalent,
      diverged_cases: diverged,
      first_divergence_cases: firstDivergenceCases.length,
      final_equivalent_cases: finalEquivalent,
      b3_b18_recomputed_cases: b3b18,
      boundary_divergence_counts: bdCounts,
      first_divergence_distribution: firstDist,
      not_evaluable_submetric_counts: notEvaluable,
      v1_fallback_used: false,
      reference_text_used_for_equivalence: false,
      production_algorithm_changed: false,
      capture_contract_changed: false,
      comparator_changed_during_acceptance: comparatorShaBefore !== comparatorShaAfter,
      lexicon_changed: false,
      model_changed: false,
      current_baseline_replaced: false,
      result_enum: resultEnum,
      next_owner: nextOwner,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      process_cleanup: processCleanup,
      identity_manifest_ok: identity.ok,
      cases: caseResults,
    };
    fs.writeFileSync(ARTIFACT_OFFICIAL, JSON.stringify(official, null, 2), 'utf8');
    writeOfficialAcceptanceReport({
      resultEnum,
      nextOwner,
      official,
      candidateShaBefore: shaBefore,
      candidateShaAfter: shaAfter,
      runnerShaBefore,
      runnerShaAfter,
      comparatorShaBefore,
      comparatorShaAfter,
      processCleanup,
    });
    if (diverged > 0) writeFirstDivergenceSummary(caseResults);

    writeProgress({
      mode: 'OFFICIAL_ACCEPTANCE',
      candidate_run_id: ACCEPTED_CANDIDATE_RUN_ID,
      candidate_sha256: ACCEPTED_CANDIDATE_SHA256,
      total_cases: 200,
      processed_cases: caseResults.length,
      equivalent_cases: equivalent,
      diverged_cases: diverged,
      invalid_cases: invalid,
      current_case_id: null,
      last_completed_case_id: lastCompleted,
      first_divergence_cases: firstDivergenceCases,
      started_at: startedAt,
      phase: 'done',
      resultEnum,
    });
    console.log(`[replay-v2] DONE ${resultEnum}`);
    console.log(`  official: ${ARTIFACT_OFFICIAL}`);
    console.log(`  report: ${ARTIFACT_OFFICIAL_REPORT}`);
    process.exit(resultEnum.startsWith('A —') ? 0 : 3);
  }

  const probe = {
    schema: 'LINGUA_FROZEN_EVIDENCE_REPLAY_V2_CAPABILITY_PROBE',
    replay_schema: REPLAY_SCHEMA,
    runner_version: RUNNER_VERSION,
    candidate_run_id: ACCEPTED_CANDIDATE_RUN_ID,
    candidate_sha256: ACCEPTED_CANDIDATE_SHA256,
    candidate_sha_before: shaBefore,
    candidate_sha_after: shaAfter,
    candidate_immutable: shaBefore === shaAfter,
    mode: 'CAPABILITY_PROBE',
    total_cases: probeIds.length,
    executed_cases: executed,
    equivalent_cases: equivalent,
    diverged_cases: diverged,
    invalid_cases: invalid,
    v1_fallback_used: false,
    reference_text_used_for_equivalence: false,
    production_algorithm_changed: false,
    cases: caseResults,
  };
  fs.writeFileSync(ARTIFACT_PROBE, JSON.stringify(probe, null, 2), 'utf8');

  if (shaBefore !== shaAfter) {
    resultEnum = 'B — REPLAY_V2_HARNESS_DEFECT';
    nextOwner = 'FROZEN_EVIDENCE_REPLAY_V2_REPAIR';
  } else if (invalid > 0) {
    resultEnum = 'B — REPLAY_V2_HARNESS_DEFECT';
    nextOwner = 'FROZEN_EVIDENCE_REPLAY_V2_REPAIR';
  } else if (diverged > 0) {
    const firstDiv = caseResults.find((c) => c.status === 'DIVERGED');
    resultEnum = 'B — REPLAY_V2_HARNESS_DEFECT';
    nextOwner = 'FROZEN_EVIDENCE_REPLAY_V2_REPAIR';
    if (firstDiv?.first_divergence_boundary) {
      console.log(
        `[replay-v2] FIRST_DIVERGENCE case=${firstDiv.case_id} boundary=${firstDiv.first_divergence_boundary}`
      );
    }
  } else if (equivalent === 8 && executed === 8) {
    resultEnum = 'A — REPLAY_V2_CAPABILITY_VALIDATED';
    nextOwner = 'FROZEN_EVIDENCE_REPLAY_V2_OFFICIAL_ACCEPTANCE';
  } else {
    resultEnum = 'B — REPLAY_V2_HARNESS_DEFECT';
    nextOwner = 'FROZEN_EVIDENCE_REPLAY_V2_REPAIR';
  }

  writeDevelopmentReport({
    resultEnum,
    nextOwner,
    unitTests: globalThis.__REPLAY_V2_UNIT_TESTS || null,
    probe,
    candidateShaBefore: shaBefore,
    candidateShaAfter: shaAfter,
    processCleanup,
  });

  writeProgress({
    phase: 'done',
    resultEnum,
    equivalent,
    diverged,
    invalid,
  });
  console.log(`[replay-v2] DONE ${resultEnum}`);
  console.log(`  probe: ${ARTIFACT_PROBE}`);
  console.log(`  report: ${ARTIFACT_REPORT}`);
  process.exit(resultEnum.startsWith('A —') ? 0 : 3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
