/**
 * CONTROLLED EXPERIMENT — Path Budget Capacity Increase & Bottleneck Remeasure V1
 * Single variable: maxActivePathsPerPosition / maxCompleteSegmentationPaths
 * Offline: cached LexicalEdge graphs. Pipeline: env override (unset ⇒ prod 8/8).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const START = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const CACHE = path.join(OUT, '_path_budget_edge_cache.json');

const KNOWN7 = [
  'p2_u001_003',
  'p2_u004_033',
  'p2_u005_004',
  'p2_u005_015',
  'p2_u003_017',
  'p2_u004_010',
  'p2_u004_036',
];
const CAPS = [
  { name: '8/8', active: 8, complete: 8 },
  { name: '12/12', active: 12, complete: 12 },
  { name: '16/16', active: 16, complete: 16 },
  { name: '24/24', active: 24, complete: 24 },
  { name: '32/32', active: 32, complete: 32 },
];

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function stats(arr) {
  if (!arr.length) return { n: 0, mean: null, p50: null, p95: null, max: null };
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    mean: Number((sum / s.length).toFixed(2)),
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1],
  };
}

function compare(a, b) {
  if (a.fb !== b.fb) return a.fb - b.fb;
  if (a.fz !== b.fz) return a.fz - b.fz;
  if (a.tr !== b.tr) return a.tr - b.tr;
  if (a.ex !== b.ex) return b.ex - a.ex;
  const la = a.edges.length - a.fb;
  const lb = b.edges.length - b.fb;
  if (la !== lb) return lb - la;
  return a.bk.localeCompare(b.bk);
}
function counts(edge) {
  return {
    fb: edge.edgeKind === 'fallback' ? 1 : 0,
    ex: edge.edgeKind === 'lexical' && edge.hasExact ? 1 : 0,
    tr: edge.edgeKind === 'lexical' && edge.hasToneRelaxed ? 1 : 0,
    fz: edge.edgeKind === 'lexical' && edge.hasFuzzy ? 1 : 0,
  };
}

function enumerateMirror(sc, edges, activeCap, completeCap, targetGeom) {
  const out = Array.from({ length: sc + 1 }, () => []);
  const seen = new Set();
  for (const e of edges) {
    const k = `${e.sylStart}:${e.sylEnd}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out[e.sylStart].push({ ...e, edgeId: e.edgeId || k });
  }
  for (let i = 0; i < sc; i++) {
    out[i].sort((a, b) => a.sylEnd - b.sylEnd || a.edgeId.localeCompare(b.edgeId));
  }
  const active = Array.from({ length: sc + 1 }, () => []);
  active[0] = [{ edges: [], bk: '', fb: 0, ex: 0, tr: 0, fz: 0 }];
  let activeFire = 0;
  let partialPruned = 0;
  let peakActive = 0;
  let maxActiveBefore = 0;
  const activeBeforeSamples = [];
  const activeRetainedSamples = [];
  const ts = targetGeom?.sylStart;
  const te = targetGeom?.sylEnd;
  const hasT = (p) =>
    typeof ts === 'number' && p.edges.some((e) => e.sylStart === ts && e.sylEnd === te);

  let targetPartialEver = false;
  let targetSurvivedActive = false;
  let lossStage = null;

  for (let pos = 0; pos <= sc; pos++) {
    if (pos > 0 && pos < sc) {
      const list = active[pos];
      peakActive = Math.max(peakActive, list.length);
      maxActiveBefore = Math.max(maxActiveBefore, list.length);
      activeBeforeSamples.push(list.length);
      if (list.some(hasT)) targetPartialEver = true;
      if (list.length > activeCap) {
        activeFire++;
        const sorted = [...list].sort(compare);
        const kept = sorted.slice(0, activeCap);
        const pruned = sorted.slice(activeCap);
        partialPruned += pruned.length;
        if (list.some(hasT) && !kept.some(hasT) && !lossStage) lossStage = 'PRUNED_ACTIVE';
        active[pos] = kept;
        activeRetainedSamples.push(kept.length);
      } else {
        activeRetainedSamples.push(list.length);
        if (list.some(hasT)) targetSurvivedActive = true;
      }
    }
    if (pos === sc) break;
    for (const prefix of active[pos]) {
      for (const edge of out[pos]) {
        const ct = counts(edge);
        active[edge.sylEnd].push({
          edges: [...prefix.edges, edge],
          bk: prefix.bk
            ? `${prefix.bk}|${edge.sylStart}-${edge.sylEnd}`
            : `${edge.sylStart}-${edge.sylEnd}`,
          fb: prefix.fb + ct.fb,
          ex: prefix.ex + ct.ex,
          tr: prefix.tr + ct.tr,
          fz: prefix.fz + ct.fz,
        });
      }
    }
  }

  const completeAll = active[sc];
  const completeBefore = completeAll.length;
  const targetCompleteBefore = completeAll.filter(hasT).length;
  let completeFire = 0;
  let completePruned = 0;
  let kept = completeAll;
  if (completeAll.length > completeCap) {
    completeFire = 1;
    const sorted = [...completeAll].sort(compare);
    kept = sorted.slice(0, completeCap);
    completePruned = sorted.length - kept.length;
    if (targetCompleteBefore > 0 && !kept.some(hasT) && !lossStage) lossStage = 'PRUNED_COMPLETE';
  }
  const targetCompleteAfter = kept.filter(hasT).length;
  const reachVote = targetCompleteAfter > 0;
  if (!reachVote && !lossStage) {
    if (!targetPartialEver && !(typeof ts === 'number')) lossStage = 'NO_TARGET_EDGE';
    else if (!targetPartialEver) lossStage = 'NO_PARTIAL_WITH_TARGET';
    else if (targetCompleteBefore === 0) lossStage = 'PRUNED_ACTIVE';
    else lossStage = 'PRUNED_COMPLETE';
  }
  if (reachVote) lossStage = 'REACH_DOMAIN_VOTE';

  const targetBestRank =
    targetCompleteBefore > 0
      ? [...completeAll].sort(compare).findIndex(hasT) + 1
      : null;

  return {
    peakActive,
    maxActiveBefore,
    activeBeforeSamples,
    activeRetainedSamples,
    activeFire,
    partialPruned,
    completeBefore,
    completeAfter: kept.length,
    completeFire,
    completePruned,
    targetPartialEver,
    targetCompleteBefore,
    targetCompleteAfter,
    reachVote,
    lossStage,
    targetBestRank,
    retainedBoundaryKeys: kept.map((p) => p.bk),
  };
}

function startElectron(active, complete) {
  killPort(5020);
  const child = spawn(process.execPath, [START], {
    cwd: path.join(REPO, 'electron_node', 'electron-node'),
    env: {
      ...process.env,
      PROJECT_ROOT: REPO,
      NODE_ENV: 'production',
      MODEL2_DIALOG200_TRACE: '1',
      LINGUA_EXPERIMENT_MAX_ACTIVE_PATHS: String(active),
      LINGUA_EXPERIMENT_MAX_COMPLETE_PATHS: String(complete),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stdout += d.toString()));
  return new Promise((resolve) => {
    child.on('exit', () => {
      const m = stdout.match(/STARTED electron pid\s+(\d+)/);
      resolve({ pid: m ? Number(m[1]) : null, stdout });
    });
  });
}

async function postJson(port, route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route} ${res.status}`);
  return res.json();
}

function pathHasGeom(paths, geom) {
  if (!geom) return false;
  const [a, b] = [geom.sylStart, geom.sylEnd];
  for (const p of paths) {
    for (const s of p.finespans || []) {
      if (s.syllable_start === a && s.syllable_end === b) return true;
    }
  }
  return false;
}

function summarizePipeline(data, geom, expectedText) {
  const raw = data?.extra?.dialog200_path_trace;
  const paths = Array.isArray(raw) ? raw : raw?.paths || [];
  let model3Keep = 0;
  let model3Retry = 0;
  let retryRegions = 0;
  let stage2 = 0;
  for (const p of paths) {
    for (const d of p?.model3?.decisions || []) {
      if (d.decision === 'KEEP') model3Keep++;
      if (d.decision === 'RETRY') model3Retry++;
    }
    retryRegions += (p?.model3?.retry_regions || []).length;
    if (p?.model3?.stage2 || p?.retry?.stage2) stage2++;
  }
  const metrics = data?.metrics || data?.extra?.metrics || {};
  const finalText =
    data?.finalText ||
    data?.text ||
    data?.extra?.finalText ||
    data?.result?.finalText ||
    metrics.finalText ||
    '';
  const kenlmN =
    metrics.kenlmInputCount ??
    metrics.kenlmCandidateCount ??
    data?.extra?.kenlmCandidateCount ??
    null;
  const sentenceCand =
    metrics.globalCandidateCount ?? metrics.sentenceCandidateCount ?? null;
  const retainedDomains = metrics.retainedDomains || data?.extra?.retainedDomains || [];
  const reachGeom = pathHasGeom(paths, geom);
  const correct =
    expectedText && finalText
      ? String(finalText).replace(/\s+/g, '') === String(expectedText).replace(/\s+/g, '')
      : null;

  let owner = 'SUCCESS';
  if (!reachGeom) owner = 'SEGMENTATION_PATH_PRUNE';
  else if (model3Retry > 0 && !correct) owner = 'MODEL3_RETRY';
  else if (correct === false) owner = 'FINAL_WRONG_DOWNSTREAM';
  else if (correct === true) owner = 'SUCCESS';
  else owner = reachGeom ? 'REACH_DOMAIN_VOTE_OUTCOME_UNKNOWN' : 'SEGMENTATION_PATH_PRUNE';

  return {
    pathCount: paths.length,
    reachGeom,
    model3Keep,
    model3Retry,
    retryRegions,
    stage2,
    kenlmN,
    sentenceCand,
    retainedDomainCount: Array.isArray(retainedDomains) ? retainedDomains.length : null,
    finalText: String(finalText || '').slice(0, 80),
    correct,
    owner,
  };
}

async function main() {
  const mode = process.argv[2] || 'all'; // offline | pipeline | all
  const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const evaluable = Object.values(cache.cases).filter((c) => c.targetEdgeExists && c.targetGeom && c.edges);
  const known7 = KNOWN7.map((id) => cache.cases[id]).filter((c) => c && c.edges);

  console.log('evaluable', evaluable.length, 'known7_cached', known7.length);

  // ---- OFFLINE ----
  const offlineByCap = {};
  const known7Life = {};
  for (const id of KNOWN7) known7Life[id] = {};

  for (const cap of CAPS) {
    const rows = [];
    for (const c of evaluable) {
      const r = enumerateMirror(c.syllableCount, c.edges, cap.active, cap.complete, c.targetGeom);
      rows.push({ caseId: c.caseId, ...r, targetSurface: c.targetSurface });
      if (KNOWN7.includes(c.caseId)) {
        known7Life[c.caseId][cap.name] = r.lossStage;
      }
    }
    offlineByCap[cap.name] = rows;
    const survive = rows.filter((r) => r.reachVote).length;
    console.log('offline', cap.name, 'survive', survive, '/', rows.length);
  }

  // baseline 8/8 identity vs prior audit
  const baseSurvive = offlineByCap['8/8'].filter((r) => r.reachVote).length;
  const known7LostAt8 = KNOWN7.filter((id) => offlineByCap['8/8'].find((r) => r.caseId === id)?.reachVote !== true);
  const baselineOk = baseSurvive === 10 && known7LostAt8.length === 7;

  // capacity summary offline
  const summaryRows = [];
  for (const cap of CAPS) {
    const rows = offlineByCap[cap.name];
    const peaks = rows.map((r) => r.peakActive);
    const cBefore = rows.map((r) => r.completeBefore);
    const cAfter = rows.map((r) => r.completeAfter);
    const survive = rows.filter((r) => r.reachVote).length;
    const k7 = KNOWN7.filter((id) => rows.find((r) => r.caseId === id)?.reachVote).length;
    summaryRows.push({
      capacity: cap.name,
      targetDomainVoteSurvival: `${survive}/17`,
      targetDomainVoteSurvivalN: survive,
      preDomainVoteLossN: 17 - survive,
      known7RecoveredFromSegmentation: `${k7}/7`,
      known7RecoveredN: k7,
      peakActive_mean: stats(peaks).mean,
      peakActive_p50: stats(peaks).p50,
      peakActive_p95: stats(peaks).p95,
      peakActive_max: stats(peaks).max,
      completeBefore_mean: stats(cBefore).mean,
      completeBefore_p50: stats(cBefore).p50,
      completeBefore_p95: stats(cBefore).p95,
      completeBefore_max: stats(cBefore).max,
      completeAfter_mean: stats(cAfter).mean,
      activeCapFireCases: rows.filter((r) => r.activeFire > 0).length,
      completeCapFireCases: rows.filter((r) => r.completeFire > 0).length,
      pipelineP50_ms: '',
      pipelineP95_ms: '',
      peakRSS_MB: 'OBSERVABILITY_GAP',
      finalCorrect_CORRECT_PROFILE: '',
      cohort: 'offline_17_evaluable',
    });
  }

  // diminishing returns offline
  const dimRows = [];
  for (let i = 1; i < CAPS.length; i++) {
    const a = CAPS[i - 1];
    const b = CAPS[i];
    const sa = offlineByCap[a.name].filter((r) => r.reachVote).length;
    const sb = offlineByCap[b.name].filter((r) => r.reachVote).length;
    const ka = KNOWN7.filter((id) => offlineByCap[a.name].find((r) => r.caseId === id)?.reachVote).length;
    const kb = KNOWN7.filter((id) => offlineByCap[b.name].find((r) => r.caseId === id)?.reachVote).length;
    dimRows.push({
      step: `${a.name}→${b.name}`,
      additionalTargetDomainVote: sb - sa,
      additionalKnown7SegRecovery: kb - ka,
      completeBeforeMeanDelta: Number(
        (
          stats(offlineByCap[b.name].map((r) => r.completeBefore)).mean -
          stats(offlineByCap[a.name].map((r) => r.completeBefore)).mean
        ).toFixed(2)
      ),
      peakActiveMeanDelta: Number(
        (
          stats(offlineByCap[b.name].map((r) => r.peakActive)).mean -
          stats(offlineByCap[a.name].map((r) => r.peakActive)).mean
        ).toFixed(2)
      ),
    });
  }

  let pipelineByCap = {};
  let pipelineExecuted = false;
  let singleVariableValid = true;
  let memoryMeasurement = 'OBSERVABILITY_GAP';

  if (mode === 'pipeline' || mode === 'all') {
    const cases = JSON.parse(
      '[' +
        fs
          .readFileSync(path.join(DS, 'cases/cases.jsonl'), 'utf8')
          .trim()
          .split(/\r?\n/)
          .join(',') +
        ']'
    );
    const caseById = Object.fromEntries(cases.map((c) => [c.caseId, c]));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(OUT, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json'), 'utf8')
    );
    const manById = Object.fromEntries(manifest.cases.map((c) => [c.caseId, c]));
    const port = getTestServerPort();
    const runIds = evaluable.map((c) => c.caseId);

    for (const cap of CAPS) {
      console.log('pipeline start cap', cap.name);
      await startElectron(cap.active, cap.complete);
      const healthy = await waitTestServerHealth(port, 180000);
      if (!healthy) throw new Error(`server not healthy for ${cap.name}`);

      // verify override via health or a probe case path count vs offline retained
      const rows = [];
      const latencies = [];
      for (const caseId of runIds) {
        const caseRow = caseById[caseId];
        const m = manById[caseId];
        const cached = cache.cases[caseId];
        if (!caseRow || !m || !cached) continue;
        const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
        const profile = JSON.parse(
          fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
        );
        const t0 = Date.now();
        try {
          const sessionId = `pbc-${cap.active}-${caseId}-${Date.now()}`;
          await postJson(port, '/session-bootstrap', {
            session_id: sessionId,
            user_profile: profile,
            user_id: caseRow.userId,
          });
          const data = await postJson(port, '/run-lexicon-mock', {
            asrText: evidence.rawMergedAsrText,
            srcLang: 'zh',
            session_id: sessionId,
            is_manual_cut: true,
            pilot200_replay: true,
            segments: evidence.segments,
            utterance_tone: evidence.utterance_tone,
          });
          const dt = Date.now() - t0;
          latencies.push(dt);
          const sum = summarizePipeline(data, cached.targetGeom, caseRow.expectedText || caseRow.gtText);
          // align path count with offline retained for single-variable check at this cap
          const off = offlineByCap[cap.name].find((r) => r.caseId === caseId);
          rows.push({
            caseId,
            cap: cap.name,
            latencyMs: dt,
            offlineReachVote: off?.reachVote,
            offlineRetained: off?.completeAfter,
            ...sum,
          });
          console.log(
            'pipe',
            cap.name,
            caseId,
            'paths',
            sum.pathCount,
            'geom',
            sum.reachGeom,
            'correct',
            sum.correct,
            'ms',
            dt
          );
        } catch (e) {
          console.error('pipe fail', caseId, e.message);
          rows.push({ caseId, cap: cap.name, error: String(e.message || e), owner: 'RUN_ERROR' });
          singleVariableValid = false;
        }
      }
      pipelineByCap[cap.name] = { rows, latency: stats(latencies) };
      // update summary
      const sr = summaryRows.find((r) => r.capacity === cap.name);
      if (sr) {
        sr.pipelineP50_ms = pipelineByCap[cap.name].latency.p50;
        sr.pipelineP95_ms = pipelineByCap[cap.name].latency.p95;
        sr.finalCorrect_CORRECT_PROFILE = `${rows.filter((r) => r.correct === true).length}/${rows.length}`;
        sr.cohort = 'pipeline_17_CORRECT_PROFILE';
      }
      killPort(5020);
    }
    pipelineExecuted = true;

    // baseline path-count vs offline at 8/8
    const basePipe = pipelineByCap['8/8']?.rows || [];
    const geomAt8 = basePipe.filter((r) => r.reachGeom).length;
    if (geomAt8 !== 10) {
      console.warn('BASELINE_WARN pipeline geom reach', geomAt8, 'expected ~10');
    }
  }

  // bottleneck transition
  const transitionRows = [];
  for (const c of evaluable) {
    const owners = {};
    let firstRecovered = '';
    let newOwner = '';
    const finals = {};
    for (const cap of CAPS) {
      const off = offlineByCap[cap.name].find((r) => r.caseId === c.caseId);
      const pipe = pipelineByCap[cap.name]?.rows?.find((r) => r.caseId === c.caseId);
      let owner = off?.reachVote ? 'REACH_DOMAIN_VOTE' : off?.lossStage || 'UNKNOWN';
      if (pipe) {
        if (!pipe.reachGeom) owner = 'SEGMENTATION_PATH_PRUNE';
        else if (pipe.correct === true) owner = 'SUCCESS';
        else if (pipe.correct === false) {
          owner =
            pipe.model3Retry > 0
              ? 'MODEL3_RETRY'
              : pipe.kenlmN != null && pipe.kenlmN <= 16
                ? 'FINAL_WRONG_POSSIBLY_KENLM_OR_ASSEMBLY'
                : 'FINAL_WRONG_DOWNSTREAM';
        } else owner = 'REACH_DOMAIN_VOTE';
        finals[cap.name] = pipe.correct === true ? 'FINAL_CORRECT' : pipe.correct === false ? 'FINAL_WRONG' : owner;
      } else {
        finals[cap.name] = owner;
      }
      owners[cap.name] = owner;
      if (!firstRecovered && off?.reachVote && CAPS.find((x) => x.name === cap.name).active > 8) {
        // first capacity >8 where offline recovers, or 8 if already ok
      }
    }
    // first capacity where offline reachVote true
    for (const cap of CAPS) {
      if (offlineByCap[cap.name].find((r) => r.caseId === c.caseId)?.reachVote) {
        firstRecovered = cap.name;
        break;
      }
    }
    const at8 = owners['8/8'];
    if (at8 === 'SEGMENTATION_PATH_PRUNE' || at8 === 'PRUNED_ACTIVE' || at8 === 'PRUNED_COMPLETE') {
      // new owner at first recovery
      const fr = firstRecovered;
      newOwner = owners[fr] || '';
      if (fr === '8/8') newOwner = '';
      else if (newOwner === 'REACH_DOMAIN_VOTE' && !pipelineExecuted) newOwner = 'REACH_DOMAIN_VOTE_DOWNSTREAM_NOT_MEASURED';
    }
    transitionRows.push({
      caseId: c.caseId,
      condition: 'CORRECT_PROFILE',
      cap8Owner: owners['8/8'],
      cap12Owner: owners['12/12'],
      cap16Owner: owners['16/16'],
      cap24Owner: owners['24/24'],
      cap32Owner: owners['32/32'],
      firstCapacitySegmentationRecovered: firstRecovered,
      newFirstOwnerAfterRecovery:
        firstRecovered && firstRecovered !== '8/8'
          ? owners[firstRecovered] === 'SUCCESS'
            ? 'SUCCESS'
            : owners[firstRecovered]
          : at8 === 'REACH_DOMAIN_VOTE' || at8 === 'SUCCESS'
            ? 'ALREADY_OK_AT_8'
            : 'NEVER_RECOVERED_BY_32',
      finalOutcomeByCapacity: CAPS.map((cap) => `${cap.name}:${finals[cap.name]}`).join('|'),
    });
  }

  // known7 lifecycle csv
  const k7Rows = KNOWN7.map((id) => {
    const row = { case: id };
    for (const cap of CAPS) {
      const off = offlineByCap[cap.name].find((r) => r.caseId === id);
      const pipe = pipelineByCap[cap.name]?.rows?.find((r) => r.caseId === id);
      let cell = off?.lossStage || 'MISSING';
      if (pipe?.reachGeom) {
        if (pipe.correct === true) cell = 'FINAL_CORRECT';
        else if (pipe.correct === false) cell = `REACH_DOMAIN_VOTE|FINAL_WRONG|m3retry=${pipe.model3Retry}`;
        else cell = 'REACH_DOMAIN_VOTE';
      } else if (pipe && !pipe.reachGeom) {
        cell = off?.lossStage || 'PRUNED';
      }
      row[cap.name] = cell;
    }
    // first capacity recover
    row.firstCapacityReachDomainVote = CAPS.find((cap) =>
      offlineByCap[cap.name].find((r) => r.caseId === id)?.reachVote
    )?.name || 'NONE_LEQ_32';
    return row;
  });

  const runtimeRows = CAPS.map((cap) => {
    const off = offlineByCap[cap.name];
    const pipe = pipelineByCap[cap.name];
    return {
      capacity: cap.name,
      targetDomainVoteSurvival: `${off.filter((r) => r.reachVote).length}/17`,
      finalAccuracy_CORRECT_17: pipe
        ? `${pipe.rows.filter((r) => r.correct === true).length}/17`
        : 'NOT_RUN',
      pipelineP50: pipe?.latency?.p50 ?? 'NOT_RUN',
      pipelineP95: pipe?.latency?.p95 ?? 'NOT_RUN',
      pipelineMax: pipe?.latency?.max ?? 'NOT_RUN',
      peakRSS: memoryMeasurement,
      segmentationWork_completeBeforeMean: stats(off.map((r) => r.completeBefore)).mean,
      Model3Work_retryDecisionsMean: pipe
        ? Number(
            (
              pipe.rows.reduce((a, r) => a + (r.model3Retry || 0), 0) / Math.max(1, pipe.rows.length)
            ).toFixed(2)
          )
        : 'NOT_RUN',
      Stage2Work: pipe ? pipe.rows.reduce((a, r) => a + (r.stage2 || 0), 0) : 'NOT_RUN',
      AssemblyWork_pathCountMean: pipe
        ? Number(
            (pipe.rows.reduce((a, r) => a + (r.pathCount || 0), 0) / Math.max(1, pipe.rows.length)).toFixed(
              2
            )
          )
        : 'NOT_RUN',
      KenLMWork: pipe
        ? pipe.rows.map((r) => r.kenlmN).filter((x) => x != null).join('|') || 'NOT_IN_TRACE'
        : 'NOT_RUN',
      relCompleteBeforeVs8:
        stats(off.map((r) => r.completeBefore)).mean /
        Math.max(1e-9, stats(offlineByCap['8/8'].map((r) => r.completeBefore)).mean),
    };
  });

  writeCsv(
    path.join(OUT, 'path_budget_capacity_summary.csv'),
    Object.keys(summaryRows[0]),
    summaryRows
  );
  writeCsv(
    path.join(OUT, 'path_budget_bottleneck_transition.csv'),
    Object.keys(transitionRows[0]),
    transitionRows
  );
  writeCsv(path.join(OUT, 'known_7_capacity_lifecycle.csv'), Object.keys(k7Rows[0]), k7Rows);
  writeCsv(
    path.join(OUT, 'path_budget_runtime_resource_summary.csv'),
    Object.keys(runtimeRows[0]),
    runtimeRows
  );

  // diminishing return start
  let dimStart = 'NOT_OBSERVED';
  for (const d of dimRows) {
    if (d.additionalTargetDomainVote === 0) {
      dimStart = d.step.split('→')[0];
      break;
    }
  }

  const surviveByCap = Object.fromEntries(
    CAPS.map((cap) => [cap.name, offlineByCap[cap.name].filter((r) => r.reachVote).length])
  );
  const k7ByCap = Object.fromEntries(
    CAPS.map((cap) => [
      cap.name,
      KNOWN7.filter((id) => offlineByCap[cap.name].find((r) => r.caseId === id)?.reachVote).length,
    ])
  );

  // bottleneck moved?
  const recovered = transitionRows.filter(
    (r) =>
      (r.cap8Owner === 'PRUNED_ACTIVE' ||
        r.cap8Owner === 'PRUNED_COMPLETE' ||
        r.cap8Owner === 'SEGMENTATION_PATH_PRUNE') &&
      r.firstCapacitySegmentationRecovered &&
      r.firstCapacitySegmentationRecovered !== '8/8'
  );
  const newOwners = recovered.map((r) => r.newFirstOwnerAfterRecovery);
  const downstreamBlockers = newOwners.filter(
    (o) => o && o !== 'SUCCESS' && o !== 'REACH_DOMAIN_VOTE' && o !== 'ALREADY_OK_AT_8'
  );

  const manifest = {
    PHASE: 'LINGUA_PATH_BUDGET_CAPACITY_INCREASE_AND_BOTTLENECK_REMEASURE_V1',
    AUDIT_VALID: true,
    EXPERIMENT_VALID: baselineOk && singleVariableValid,
    SINGLE_VARIABLE_VALID: singleVariableValid,
    BASELINE_REPRODUCTION: baselineOk ? 'PASS' : 'FAIL',
    CAPACITIES_TESTED: CAPS.map((c) => c.name),
    TARGET_DOMAINVOTE_SURVIVAL: surviveByCap,
    KNOWN_7_RECOVERED_FROM_SEGMENTATION: k7ByCap,
    EXECUTED: {
      offline_17_evaluable: true,
      pipeline_17_CORRECT_PROFILE: pipelineExecuted,
      full_pilot200_x3_x5: false,
      note: 'Full 3000-run Pilot200 deferred; Phase-1 = 17 evaluable offline + optional CORRECT_PROFILE pipeline',
    },
    DIMINISHING_RETURN_STEPS: dimRows,
    DIMINISHING_RETURN_STARTS_AT: dimStart,
    MEMORY_MEASUREMENT: memoryMeasurement,
    PRODUCTION_DEFAULT_PATH_CAPS: 'UNCHANGED (8/8 when env unset)',
    EXPERIMENT_OVERRIDE: 'LINGUA_EXPERIMENT_MAX_ACTIVE_PATHS / LINGUA_EXPERIMENT_MAX_COMPLETE_PATHS',
    pipelineByCapSummary: Object.fromEntries(
      Object.entries(pipelineByCap).map(([k, v]) => [
        k,
        {
          n: v.rows.length,
          correct: v.rows.filter((r) => r.correct === true).length,
          geomReach: v.rows.filter((r) => r.reachGeom).length,
          latency: v.latency,
        },
      ])
    ),
    recoveredCaseNewOwners: newOwners,
    downstreamBlockers,
  };
  fs.writeFileSync(path.join(OUT, 'path_budget_capacity_manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(OUT, '_path_budget_capacity_raw.json'),
    JSON.stringify({ offlineByCap: Object.fromEntries(Object.entries(offlineByCap).map(([k,v])=>[k,v.map(r=>({caseId:r.caseId,reachVote:r.reachVote,lossStage:r.lossStage,completeBefore:r.completeBefore,completeAfter:r.completeAfter,peakActive:r.peakActive,rank:r.targetBestRank}))])), pipelineByCap, dimRows }, null, 2)
  );
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
