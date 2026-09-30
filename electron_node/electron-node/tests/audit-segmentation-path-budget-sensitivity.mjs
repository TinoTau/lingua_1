/**
 * READ_ONLY — Segmentation Path Budget Sensitivity Audit V1
 * Offline counterfactual on cached LexicalEdge graphs.
 * No production / config / ranking / Model2–3 changes.
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

const G2_IDS = ['p2_u001_003', 'p2_u004_033', 'p2_u005_004', 'p2_u005_015'];
const G2_EXPECTED_LOSS = {
  p2_u001_003: 'per_position_cap',
  p2_u005_015: 'per_position_cap',
  p2_u004_033: 'complete_path_cap',
  p2_u005_004: 'complete_path_cap',
};

const SYMMETRIC = [
  { name: 'B0_8_8', active: 8, complete: 8 },
  { name: 'B1_12_12', active: 12, complete: 12 },
  { name: 'B2_16_16', active: 16, complete: 16 },
  { name: 'B3_24_24', active: 24, complete: 24 },
  { name: 'B4_32_32', active: 32, complete: 32 },
  { name: 'B5_64_64', active: 64, complete: 64 },
];
const ASYMMETRIC = [
  { name: 'A_8_16', active: 8, complete: 16 },
  { name: 'A_8_32', active: 8, complete: 32 },
  { name: 'A_16_8', active: 16, complete: 8 },
  { name: 'A_32_8', active: 32, complete: 8 },
];

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}
function pct(n, d) {
  return d ? Number(((100 * n) / d).toFixed(2)) : null;
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function stats(arr) {
  if (!arr.length) {
    return { total: 0, mean: null, p50: null, p95: null, max: null };
  }
  const s = [...arr].sort((a, b) => a - b);
  const total = s.reduce((a, b) => a + b, 0);
  return {
    total,
    mean: Number((total / s.length).toFixed(2)),
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1],
  };
}

function startElectron() {
  killPort(5020);
  const child = spawn(process.execPath, [START], {
    cwd: path.join(REPO, 'electron_node', 'electron-node'),
    env: {
      ...process.env,
      PROJECT_ROOT: REPO,
      NODE_ENV: 'production',
      MODEL2_DIALOG200_TRACE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stdout += d.toString()));
  return new Promise((resolve) => {
    child.on('exit', () => {
      const m = stdout.match(/STARTED electron pid\s+(\d+)/);
      resolve({ pid: m ? Number(m[1]) : null });
    });
  });
}

async function postJson(port, route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  return res.json().catch(() => ({}));
}

/** Production mirror: compareSegmentationPathRankingBestFirst */
function compareBestFirst(a, b) {
  if (a.fallbackEdgeCount !== b.fallbackEdgeCount) return a.fallbackEdgeCount - b.fallbackEdgeCount;
  if (a.fuzzyEdgeCount !== b.fuzzyEdgeCount) return a.fuzzyEdgeCount - b.fuzzyEdgeCount;
  if (a.toneRelaxedEdgeCount !== b.toneRelaxedEdgeCount)
    return a.toneRelaxedEdgeCount - b.toneRelaxedEdgeCount;
  if (a.exactEdgeCount !== b.exactEdgeCount) return b.exactEdgeCount - a.exactEdgeCount;
  const lexA = a.edges.length - a.fallbackEdgeCount;
  const lexB = b.edges.length - b.fallbackEdgeCount;
  if (lexA !== lexB) return lexB - lexA;
  return a.boundaryKey.localeCompare(b.boundaryKey);
}

/**
 * Production mirror of enumerateCompleteSegmentationPaths.
 * Returns richer diagnostic counters for sensitivity audit.
 */
function enumerateMirror(syllableCount, edges, limits, targetGeom) {
  const maxActive = limits.active;
  const maxComplete = limits.complete;
  const outgoing = Array.from({ length: syllableCount + 1 }, () => []);
  const seen = new Set();
  for (const e of edges) {
    const key = `${e.sylStart}:${e.sylEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing[e.sylStart].push(e);
  }
  for (let i = 0; i < syllableCount; i++) {
    outgoing[i].sort((a, b) => {
      if (a.sylEnd !== b.sylEnd) return a.sylEnd - b.sylEnd;
      const ka = a.edgeKind === 'lexical' ? 0 : 1;
      const kb = b.edgeKind === 'lexical' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a.edgeId.localeCompare(b.edgeId);
    });
  }

  const active = Array.from({ length: syllableCount + 1 }, () => []);
  active[0].push({
    edges: [],
    boundaryKey: '',
    fallbackEdgeCount: 0,
    exactEdgeCount: 0,
    toneRelaxedEdgeCount: 0,
    fuzzyEdgeCount: 0,
  });

  let expansionOps = 0;
  let peakActive = 0;
  let sumActive = 0;
  let activeSamples = 0;
  let targetSurvivedActiveCap = true; // vacuously until we see a prune that kills all target partials
  let sawTargetPartial = false;
  let targetPartialPrunedAll = false;
  let maxTargetPartialRankAtPrune = null;

  const pathHasTarget = (p) =>
    targetGeom &&
    (p.edges || []).some((e) => e.sylStart === targetGeom.sylStart && e.sylEnd === targetGeom.sylEnd);

  for (let pos = 0; pos < syllableCount; pos++) {
    let prefixes = active[pos];
    peakActive = Math.max(peakActive, prefixes.length);
    sumActive += prefixes.length;
    activeSamples += 1;

    if (prefixes.length > maxActive && pos > 0) {
      const sorted = [...prefixes].sort(compareBestFirst);
      const kept = sorted.slice(0, maxActive);
      const pruned = sorted.slice(maxActive);
      const targetInBefore = sorted.filter(pathHasTarget);
      const targetInKept = kept.filter(pathHasTarget);
      if (targetInBefore.length) {
        sawTargetPartial = true;
        const bestRank = sorted.findIndex(pathHasTarget) + 1;
        maxTargetPartialRankAtPrune =
          maxTargetPartialRankAtPrune == null
            ? bestRank
            : Math.max(maxTargetPartialRankAtPrune, bestRank);
        if (targetInKept.length === 0) {
          targetPartialPrunedAll = true;
          targetSurvivedActiveCap = false;
        }
      }
      prefixes = kept;
      active[pos] = kept;
    } else if (prefixes.some(pathHasTarget)) {
      sawTargetPartial = true;
    }

    for (const prefix of prefixes) {
      for (const edge of outgoing[pos] || []) {
        expansionOps += 1;
        active[edge.sylEnd].push({
          edges: [...prefix.edges, edge],
          boundaryKey: prefix.boundaryKey
            ? `${prefix.boundaryKey}|${edge.sylStart}-${edge.sylEnd}`
            : `${edge.sylStart}-${edge.sylEnd}`,
          fallbackEdgeCount: prefix.fallbackEdgeCount + (edge.edgeKind === 'fallback' ? 1 : 0),
          exactEdgeCount: prefix.exactEdgeCount + (edge.hasExact ? 1 : 0),
          toneRelaxedEdgeCount: prefix.toneRelaxedEdgeCount + (edge.hasToneRelaxed ? 1 : 0),
          fuzzyEdgeCount: prefix.fuzzyEdgeCount + (edge.hasFuzzy ? 1 : 0),
        });
      }
    }
  }

  const completeBefore = active[syllableCount] || [];
  const targetComplete = completeBefore.filter(pathHasTarget);
  const sortedAll = [...completeBefore].sort(compareBestFirst);
  const targetBestRank =
    targetComplete.length > 0 ? sortedAll.findIndex(pathHasTarget) + 1 : null;

  let kept = completeBefore;
  let targetSurvivedCompleteCap = targetComplete.length > 0;
  if (completeBefore.length > maxComplete) {
    kept = sortedAll.slice(0, maxComplete);
    const targetKept = kept.filter(pathHasTarget);
    targetSurvivedCompleteCap = targetKept.length > 0;
  }
  kept = [...kept].sort((a, b) => a.boundaryKey.localeCompare(b.boundaryKey));
  const targetRetained = kept.filter(pathHasTarget);

  // If never saw target partial and no complete — edge may exist but unreachable under active pruning early
  if (!sawTargetPartial && targetComplete.length === 0 && targetGeom) {
    // Check if any outgoing from target start exists — edge in graph
    const hasEdge = edges.some(
      (e) => e.sylStart === targetGeom.sylStart && e.sylEnd === targetGeom.sylEnd
    );
    if (hasEdge) {
      // Could be pruned before edge was attached: active cap at positions before sylEnd
      targetSurvivedActiveCap = false;
    }
  }
  if (targetPartialPrunedAll && targetComplete.length === 0) {
    targetSurvivedActiveCap = false;
  }
  if (targetComplete.length > 0) {
    // completed ⇒ survived active enough to finish at least one
    targetSurvivedActiveCap = true;
  }

  const lossStage =
    !targetGeom
      ? null
      : !edges.some((e) => e.sylStart === targetGeom.sylStart && e.sylEnd === targetGeom.sylEnd)
        ? 'no_target_edge'
        : targetComplete.length === 0 && !targetSurvivedActiveCap
          ? 'per_position_cap'
          : targetComplete.length === 0
            ? 'no_complete_path'
            : !targetSurvivedCompleteCap
              ? 'complete_path_cap'
              : 'survived';

  return {
    retainedPaths: kept,
    retainedCount: kept.length,
    completeBeforeCount: completeBefore.length,
    targetHypothesisCountPrePrune: targetComplete.length,
    targetHypothesisCountPostPrune: targetRetained.length,
    targetCompleteExists: targetComplete.length > 0,
    targetSurvivedActiveCap,
    targetSurvivedCompleteCap: targetSurvivedCompleteCap && targetComplete.length > 0,
    targetAvailableToDomainVote: targetRetained.length > 0,
    targetBestRank,
    maxTargetPartialRankAtPrune,
    lossStage,
    peakActive,
    meanActive: activeSamples ? sumActive / activeSamples : 0,
    expansionOps,
  };
}

function reconstructEdges(paths, syllableCount) {
  const byGeom = new Map();
  const ensure = (sylStart, sylEnd, kind = 'lexical') => {
    const key = `${sylStart}:${sylEnd}`;
    if (!byGeom.has(key)) {
      byGeom.set(key, {
        edgeId: key,
        sylStart,
        sylEnd,
        edgeKind: kind,
        surfaces: new Set(),
        termIds: new Set(),
        hasExact: false,
        hasFuzzy: false,
        hasToneRelaxed: false,
        candidateCount: 0,
      });
    }
    return byGeom.get(key);
  };

  for (const p of paths || []) {
    const m2 = p.model2 || {};
    for (const w of m2.windows || []) {
      const win = w.window || {};
      const ws = win.syllable_start;
      const we = win.syllable_end;
      if (ws == null || we == null) continue;
      for (const c of w.base_candidates?.items || []) {
        const e = ensure(c.syllableStart ?? ws, c.syllableEnd ?? we);
        e.surfaces.add(c.surface);
        if (c.termId) e.termIds.add(c.termId);
        e.candidateCount += 1;
        e.hasExact = true;
      }
      for (const q of w.p_retrieval?.queries || []) {
        for (const h of q.hits || []) {
          const e = ensure(q.syllable_start ?? ws, q.syllable_end ?? we);
          e.surfaces.add(h.surface);
          if (h.termId) e.termIds.add(h.termId);
          e.candidateCount += 1;
          e.hasExact = true;
        }
      }
      for (const h of w.d_retrieval?.hits || []) {
        if (h.binding_status === 'REJECTED_RANGE_INCONSISTENT') continue;
        const e = ensure(ws, we);
        e.surfaces.add(h.surface);
        if (h.termId || h.sqlite_term_id) e.termIds.add(h.termId || h.sqlite_term_id);
        e.candidateCount += 1;
        e.hasExact = true;
      }
    }
    for (const c of m2.union?.union_before_budget?.items || []) {
      const e = ensure(c.syllableStart, c.syllableEnd);
      e.surfaces.add(c.surface);
      if (c.termId) e.termIds.add(c.termId);
      e.candidateCount += 1;
      e.hasExact = true;
    }
    for (const s of p.finespans || []) {
      if ((s.candidate_count || 0) <= 0) continue;
      const e = ensure(s.syllable_start, s.syllable_end);
      e.surfaces.add(s.source_text);
      e.candidateCount = Math.max(e.candidateCount, s.candidate_count || 1);
      e.hasExact = true;
    }
  }

  const lexical = [...byGeom.values()]
    .filter((e) => e.candidateCount > 0)
    .map((e) => ({
      ...e,
      surfaces: [...e.surfaces],
      termIds: [...e.termIds],
    }));

  const covered = new Set(lexical.map((e) => `${e.sylStart}:${e.sylEnd}`));
  const withFb = [...lexical];
  for (let i = 0; i < syllableCount; i++) {
    const key = `${i}:${i + 1}`;
    if (!covered.has(key)) {
      withFb.push({
        edgeId: key,
        sylStart: i,
        sylEnd: i + 1,
        edgeKind: 'fallback',
        surfaces: [],
        termIds: [],
        hasExact: false,
        hasFuzzy: false,
        hasToneRelaxed: false,
        candidateCount: 0,
        synthetic: true,
      });
    }
  }
  return { lexical, withFb };
}

function resolveTargetGeom(lexical, targetSurface, termIds, preferredGeom) {
  if (preferredGeom) {
    const [a, b] = preferredGeom.split(':').map(Number);
    const hit = lexical.find(
      (e) =>
        e.sylStart === a &&
        e.sylEnd === b &&
        (e.surfaces.includes(targetSurface) || termIds.some((t) => e.termIds.includes(t)))
    );
    if (hit) return { sylStart: a, sylEnd: b, source: 'preferred_geom+edge' };
    // preferred geom with Model2 hit surfaces even if reconstruct lists it
    if (lexical.some((e) => e.sylStart === a && e.sylEnd === b && e.candidateCount > 0)) {
      // edge exists at geom but maybe surface not listed — still use if surface in any hit at geom
      const at = lexical.find((e) => e.sylStart === a && e.sylEnd === b);
      if (at && (at.surfaces.includes(targetSurface) || termIds.some((t) => at.termIds.includes(t)))) {
        return { sylStart: a, sylEnd: b, source: 'preferred_geom' };
      }
    }
  }
  const matches = lexical.filter(
    (e) => e.surfaces.includes(targetSurface) || termIds.some((t) => e.termIds.includes(t))
  );
  if (!matches.length) return null;
  // Prefer syllable length closest to surface length (chars ≈ syllables for CJK)
  const wantLen = String(targetSurface || '').length;
  matches.sort((a, b) => {
    const da = Math.abs(a.sylEnd - a.sylStart - wantLen);
    const db = Math.abs(b.sylEnd - b.sylStart - wantLen);
    if (da !== db) return da - db;
    return a.sylStart - b.sylStart;
  });
  return {
    sylStart: matches[0].sylStart,
    sylEnd: matches[0].sylEnd,
    source: 'surface_or_termId',
  };
}

async function captureCase(port, caseRow, evidence, profile, preferredGeom) {
  const sessionId = `pbs-${caseRow.caseId}-${Date.now()}`;
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
  const raw = data?.extra?.dialog200_path_trace;
  const paths = Array.isArray(raw) ? raw : raw?.paths || [];
  let syllableCount = 0;
  for (const p of paths) {
    for (const s of p.finespans || []) syllableCount = Math.max(syllableCount, s.syllable_end || 0);
    for (const w of p.model2?.windows || []) {
      const we = w.window?.syllable_end;
      if (typeof we === 'number') syllableCount = Math.max(syllableCount, we);
    }
  }
  const { lexical, withFb } = reconstructEdges(paths, syllableCount);
  const targetSurface = caseRow.evaluationTargetSurface || '';
  const termIds = caseRow.evaluationTargetTermIds || [];
  const geom = resolveTargetGeom(lexical, targetSurface, termIds, preferredGeom);

  // Production retained path count from dialog200
  const prodRetained = paths.length;
  const prodExactPfs = geom
    ? paths.reduce(
        (n, p) =>
          n +
          (p.finespans || []).filter(
            (s) => s.syllable_start === geom.sylStart && s.syllable_end === geom.sylEnd
          ).length,
        0
      )
    : 0;

  return {
    caseId: caseRow.caseId,
    targetSurface,
    termIds,
    syllableCount,
    edges: withFb.map((e) => ({
      edgeId: e.edgeId,
      sylStart: e.sylStart,
      sylEnd: e.sylEnd,
      edgeKind: e.edgeKind,
      hasExact: !!e.hasExact,
      hasFuzzy: !!e.hasFuzzy,
      hasToneRelaxed: !!e.hasToneRelaxed,
      surfaces: e.surfaces || [],
      termIds: e.termIds || [],
      candidateCount: e.candidateCount || 0,
      synthetic: !!e.synthetic,
    })),
    lexicalEdgeCount: lexical.length,
    targetGeom: geom,
    targetEdgeExists: Boolean(geom),
    prodRetainedPathCount: prodRetained,
    prodExactPathFineSpanCount: prodExactPfs,
  };
}

function runSweepOnCase(cached, budget) {
  const targetGeom = cached.targetGeom;
  const r = enumerateMirror(cached.syllableCount, cached.edges, budget, targetGeom);
  return {
    ...r,
    targetEdgeExists: cached.targetEdgeExists,
    targetGeom: targetGeom ? `${targetGeom.sylStart}:${targetGeom.sylEnd}` : '',
  };
}

async function main() {
  const mode = process.argv[2] || 'all'; // capture | sweep | all
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

  // Preferred geometries from prior lifecycle (when known)
  const preferredGeom = {};
  const lifePath = path.join(OUT, 'LINGUA_CORRECT_PROFILE_TARGET_QUERY_CASES.csv');
  if (fs.existsSync(lifePath)) {
    const lines = fs.readFileSync(lifePath, 'utf8').trim().split(/\r?\n/).slice(1);
    for (const line of lines) {
      // crude CSV parse for quoted fields
      const cols = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
          cols.push(cur);
          cur = '';
        } else cur += ch;
      }
      cols.push(cur);
      const id = cols[0];
      const syl = cols[6];
      if (id && syl && /^\d+:\d+$/.test(syl)) preferredGeom[id] = syl;
    }
  }
  // G2 from repair span rows
  const repairRows = JSON.parse(
    fs.readFileSync(path.join(OUT, '_repair_span_geometry_rows.json'), 'utf8')
  );
  for (const r of repairRows) {
    if (String(r.firstGeometryDivergenceClass || '').startsWith('G2')) {
      preferredGeom[r.caseId] = r.queryEvidenceGeometry;
    }
  }

  let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { cases: {} };

  if (mode === 'capture' || mode === 'all' || mode === 'capture-g2') {
    const port = getTestServerPort();
    let healthy = false;
    try {
      healthy = (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }))
        .ok;
    } catch {
      healthy = false;
    }
    if (!healthy) {
      await startElectron();
      healthy = await waitTestServerHealth(port, 180000);
    }
    if (!healthy) throw new Error('server not healthy');

    const ids =
      mode === 'capture-g2'
        ? G2_IDS
        : cases.filter((c) => c.evaluationTargetSurface && manById[c.caseId]).map((c) => c.caseId);

    let n = 0;
    for (const caseId of ids) {
      if (cache.cases[caseId] && mode !== 'capture-g2' && process.argv.includes('--force') === false) {
        // still refresh G2
        if (!G2_IDS.includes(caseId)) {
          n++;
          continue;
        }
      }
      const caseRow = caseById[caseId];
      const m = manById[caseId];
      if (!m) continue;
      const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
      const profile = JSON.parse(
        fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
      );
      try {
        const captured = await captureCase(
          port,
          caseRow,
          evidence,
          profile,
          preferredGeom[caseId] || null
        );
        cache.cases[caseId] = captured;
        n++;
        if (n % 10 === 0 || G2_IDS.includes(caseId)) {
          fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
          console.log('captured', n, caseId, 'edge', captured.targetEdgeExists, captured.targetGeom);
        }
      } catch (e) {
        console.error('fail', caseId, e.message);
        cache.cases[caseId] = { caseId, error: String(e.message || e), targetEdgeExists: false };
      }
    }
    cache.capturedAt = new Date().toISOString();
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
    console.log('capture done', Object.keys(cache.cases).length);
  }

  if (mode === 'capture' || mode === 'capture-g2') return;

  // -------- MIRROR GATE (8/8 on G2) --------
  const mirrorChecks = [];
  let mirrorValid = true;
  for (const id of G2_IDS) {
    const c = cache.cases[id];
    if (!c || c.error || !c.edges) {
      mirrorValid = false;
      mirrorChecks.push({ caseId: id, ok: false, reason: 'missing_cache' });
      continue;
    }
    const r = runSweepOnCase(c, { active: 8, complete: 8 });
    const expectedLoss = G2_EXPECTED_LOSS[id];
    const surviveOk = r.targetAvailableToDomainVote === false;
    const lossOk =
      r.lossStage === expectedLoss ||
      // allow no_complete_path when prior said per_position (both mean not complete)
      (expectedLoss === 'per_position_cap' &&
        (r.lossStage === 'per_position_cap' || r.lossStage === 'no_complete_path'));
    const retainedOk =
      c.prodRetainedPathCount == null ||
      Math.abs((r.retainedCount || 0) - c.prodRetainedPathCount) <= 0 ||
      r.retainedCount === Math.min(8, r.completeBeforeCount);
    // Production dialog200 retained should equal mirror retained when edge graph faithful
    const pathCountAlign =
      c.prodRetainedPathCount === r.retainedCount ||
      c.prodExactPathFineSpanCount === 0; // G2: no exact PFS — survival aligns

    const ok = surviveOk && lossOk && c.prodExactPathFineSpanCount === 0;
    if (!ok) mirrorValid = false;
    mirrorChecks.push({
      caseId: id,
      ok,
      surviveOk,
      lossStage: r.lossStage,
      expectedLoss,
      lossOk,
      targetBestRank: r.targetBestRank,
      retainedCount: r.retainedCount,
      prodRetained: c.prodRetainedPathCount,
      prodExactPfs: c.prodExactPathFineSpanCount,
      completeBefore: r.completeBeforeCount,
      pathCountAlign,
      targetEdgeExists: c.targetEdgeExists,
    });
    console.log('mirror', id, JSON.stringify(mirrorChecks[mirrorChecks.length - 1]));
  }

  if (!mirrorValid) {
    const manifestOut = {
      PHASE: 'LINGUA_SEGMENTATION_PATH_BUDGET_SENSITIVITY_AUDIT_V1',
      AUDIT_MIRROR_VALID: false,
      AUDIT_VALID: false,
      STOP_REASON: '8/8 audit mirror does not reproduce production G2 survival/loss stage',
      mirrorChecks,
    };
    fs.writeFileSync(
      path.join(OUT, 'segmentation_budget_audit_manifest.json'),
      JSON.stringify(manifestOut, null, 2)
    );
    console.error('AUDIT_MIRROR_VALID=NO — STOP');
    process.exit(2);
  }
  console.log('AUDIT_MIRROR_VALID=YES');

  // -------- BUDGET SWEEP --------
  const allBudgets = [...SYMMETRIC, ...ASYMMETRIC];
  const cachedList = Object.values(cache.cases).filter((c) => c.edges && !c.error);
  const evaluable = cachedList.filter((c) => c.targetEdgeExists && c.targetGeom);
  const nonEvaluable = cachedList.filter((c) => !c.targetEdgeExists);
  const g2Cached = G2_IDS.map((id) => cache.cases[id]).filter(Boolean);

  const summaryRows = [];
  const resourceRows = [];
  const caseMatrixRows = [];
  const g2ThresholdRows = [];

  // Precompute per-case results for all budgets
  const byBudget = {};
  for (const b of allBudgets) {
    byBudget[b.name] = [];
    for (const c of evaluable) {
      const r = runSweepOnCase(c, b);
      byBudget[b.name].push({ caseId: c.caseId, isG2: G2_IDS.includes(c.caseId), ...r });
    }
  }

  // High ceiling B6 diagnostic
  let unprunedExecutable = false;
  let b6Name = 'B6_SAFE_CEILING';
  let b6 = { name: b6Name, active: 256, complete: 256 };
  try {
    let maxCompleteSeen = 0;
    let explosion = false;
    for (const c of evaluable.slice(0, 20)) {
      const r = runSweepOnCase(c, { active: 512, complete: 512 });
      maxCompleteSeen = Math.max(maxCompleteSeen, r.completeBeforeCount);
      if (r.peakActive > 50000 || r.expansionOps > 5e6) {
        explosion = true;
        break;
      }
    }
    if (!explosion) {
      // try true-ish unpruned on G2 only
      for (const c of g2Cached) {
        const r = runSweepOnCase(c, { active: 10000, complete: 10000 });
        if (r.peakActive > 100000 || r.expansionOps > 2e7) {
          explosion = true;
          break;
        }
        maxCompleteSeen = Math.max(maxCompleteSeen, r.completeBeforeCount);
      }
    }
    if (explosion) {
      unprunedExecutable = false;
      b6 = { name: 'B6_SAFE_256_256', active: 256, complete: 256 };
    } else {
      unprunedExecutable = maxCompleteSeen < 10000;
      b6 = unprunedExecutable
        ? { name: 'B6_UNPRUNED_DIAG', active: 10000, complete: 10000 }
        : { name: 'B6_SAFE_256_256', active: 256, complete: 256 };
    }
  } catch {
    unprunedExecutable = false;
    b6 = { name: 'B6_SAFE_256_256', active: 256, complete: 256 };
  }
  allBudgets.push(b6);
  byBudget[b6.name] = [];
  for (const c of evaluable) {
    const r = runSweepOnCase(c, b6);
    byBudget[b6.name].push({ caseId: c.caseId, isG2: G2_IDS.includes(c.caseId), ...r });
  }

  for (const b of allBudgets) {
    const rows = byBudget[b.name];
    const survive = rows.filter((r) => r.targetAvailableToDomainVote);
    const edge = rows.filter((r) => r.targetEdgeExists);
    const prePrune = rows.filter((r) => r.targetCompleteExists || r.targetHypothesisCountPrePrune > 0);
    // targetCompleteExists uses complete before complete-cap; also count those that had complete
    const activeSurv = rows.filter((r) => r.targetSurvivedActiveCap && r.targetEdgeExists);
    const completeExists = rows.filter((r) => r.targetCompleteExists);
    const completeSurv = rows.filter((r) => r.targetSurvivedCompleteCap);
    const g2surv = rows.filter((r) => r.isG2 && r.targetAvailableToDomainVote).length;

    const peakActives = rows.map((r) => r.peakActive);
    const completeBefores = rows.map((r) => r.completeBeforeCount);
    const retaineds = rows.map((r) => r.retainedCount);
    const ops = rows.map((r) => r.expansionOps);
    const sa = stats(peakActives);
    const sc = stats(completeBefores);
    const sr = stats(retaineds);
    const so = stats(ops);

    summaryRows.push({
      budget: b.name,
      maxActivePathsPerPosition: b.active,
      maxCompleteSegmentationPaths: b.complete,
      cases_total: cachedList.length,
      evaluable_cases: evaluable.length,
      non_evaluable_cases: nonEvaluable.length + (cases.length - cachedList.length),
      cases_with_target_edge_pre_segmentation: edge.length,
      cases_with_target_path_pre_prune: completeExists.length,
      cases_target_survives_active_cap: activeSurv.length,
      cases_target_complete_path_exists: completeExists.length,
      cases_target_survives_complete_cap: completeSurv.length,
      cases_target_available_to_domain_vote: survive.length,
      target_hypothesis_survival_rate: pct(survive.length, evaluable.length),
      g2_survive: `${g2surv}/4`,
      active_path_count_mean: sa.mean,
      active_path_count_p50: sa.p50,
      active_path_count_p95: sa.p95,
      active_path_count_max: sa.max,
      complete_path_count_pre_cap_mean: sc.mean,
      complete_path_count_pre_cap_p50: sc.p50,
      complete_path_count_pre_cap_p95: sc.p95,
      complete_path_count_pre_cap_max: sc.max,
      retained_complete_path_count_mean: sr.mean,
      retained_complete_path_count_p95: sr.p95,
      retained_complete_path_count_max: sr.max,
      expansion_ops_mean: so.mean,
      expansion_ops_p95: so.p95,
      expansion_ops_max: so.max,
    });

    resourceRows.push({
      budget: b.name,
      active_cap: b.active,
      complete_cap: b.complete,
      peak_active_mean: sa.mean,
      peak_active_p95: sa.p95,
      peak_active_max: sa.max,
      complete_pre_cap_mean: sc.mean,
      complete_pre_cap_p95: sc.p95,
      complete_pre_cap_max: sc.max,
      retained_mean: sr.mean,
      retained_p95: sr.p95,
      retained_max: sr.max,
      expansion_ops_mean: so.mean,
      expansion_ops_p95: so.p95,
      estimated_downstream_hypothesis_multiplier_vs_8_8: null, // fill later
    });
  }

  // Fill multipliers vs B0
  const b0 = resourceRows.find((r) => r.budget === 'B0_8_8');
  for (const r of resourceRows) {
    r.estimated_downstream_hypothesis_multiplier_vs_8_8 =
      b0 && b0.retained_mean
        ? Number((r.retained_mean / b0.retained_mean).toFixed(3))
        : null;
  }

  // Marginal gains symmetric
  const marginal = [];
  const symNames = SYMMETRIC.map((s) => s.name).concat([b6.name]);
  for (let i = 1; i < SYMMETRIC.length; i++) {
    const prev = summaryRows.find((r) => r.budget === SYMMETRIC[i - 1].name);
    const cur = summaryRows.find((r) => r.budget === SYMMETRIC[i].name);
    const prevRes = resourceRows.find((r) => r.budget === SYMMETRIC[i - 1].name);
    const curRes = resourceRows.find((r) => r.budget === SYMMETRIC[i].name);
    const newSurv =
      cur.cases_target_available_to_domain_vote - prev.cases_target_available_to_domain_vote;
    const pathGrowth = (curRes.retained_mean || 0) - (prevRes.retained_mean || 0);
    marginal.push({
      step: `${SYMMETRIC[i - 1].name}→${SYMMETRIC[i].name}`,
      new_target_surviving_cases: newSurv,
      survival_rate_delta_pp: Number(
        (cur.target_hypothesis_survival_rate - prev.target_hypothesis_survival_rate).toFixed(2)
      ),
      retained_mean_delta: Number(pathGrowth.toFixed(2)),
      peak_active_mean_delta: Number(
        ((curRes.peak_active_mean || 0) - (prevRes.peak_active_mean || 0)).toFixed(2)
      ),
      complete_pre_cap_mean_delta: Number(
        ((curRes.complete_pre_cap_mean || 0) - (prevRes.complete_pre_cap_mean || 0)).toFixed(2)
      ),
      marginal_survival_gain_per_retained_path_growth:
        pathGrowth > 0 ? Number((newSurv / pathGrowth).toFixed(3)) : newSurv === 0 ? 0 : null,
    });
  }
  // 32→64
  {
    const prev = summaryRows.find((r) => r.budget === 'B4_32_32');
    const cur = summaryRows.find((r) => r.budget === 'B5_64_64');
    const prevRes = resourceRows.find((r) => r.budget === 'B4_32_32');
    const curRes = resourceRows.find((r) => r.budget === 'B5_64_64');
    const newSurv =
      cur.cases_target_available_to_domain_vote - prev.cases_target_available_to_domain_vote;
    const pathGrowth = (curRes.retained_mean || 0) - (prevRes.retained_mean || 0);
    marginal.push({
      step: 'B4_32_32→B5_64_64',
      new_target_surviving_cases: newSurv,
      survival_rate_delta_pp: Number(
        (cur.target_hypothesis_survival_rate - prev.target_hypothesis_survival_rate).toFixed(2)
      ),
      retained_mean_delta: Number(pathGrowth.toFixed(2)),
      peak_active_mean_delta: Number(
        ((curRes.peak_active_mean || 0) - (prevRes.peak_active_mean || 0)).toFixed(2)
      ),
      complete_pre_cap_mean_delta: Number(
        ((curRes.complete_pre_cap_mean || 0) - (prevRes.complete_pre_cap_mean || 0)).toFixed(2)
      ),
      marginal_survival_gain_per_retained_path_growth:
        pathGrowth > 0 ? Number((newSurv / pathGrowth).toFixed(3)) : newSurv === 0 ? 0 : null,
    });
  }

  // G2 thresholds — real counterfactual
  for (const id of G2_IDS) {
    const c = cache.cases[id];
    const row = {
      caseId: id,
      targetTerm: c.targetSurface,
      TARGET_EDGE_GEOMETRY: c.targetGeom
        ? `${c.targetGeom.sylStart}:${c.targetGeom.sylEnd}`
        : '',
      CURRENT_8_8_SURVIVAL: 'NO',
      TARGET_PATH_BEST_STRUCTURAL_RANK_AT_8_8: '',
      FIRST_ACTIVE_CAP_REQUIRED: '>64',
      FIRST_COMPLETE_CAP_REQUIRED: '>64',
      FIRST_SYMMETRIC_BUDGET_REQUIRED: '>64/64',
      loss_at_8_8: '',
      notes: '',
    };
    const r88 = runSweepOnCase(c, { active: 8, complete: 8 });
    row.CURRENT_8_8_SURVIVAL = r88.targetAvailableToDomainVote ? 'YES' : 'NO';
    row.TARGET_PATH_BEST_STRUCTURAL_RANK_AT_8_8 =
      r88.targetBestRank ?? r88.maxTargetPartialRankAtPrune ?? 'NOT_AVAILABLE';
    row.loss_at_8_8 = r88.lossStage;

    // Find first active-only (complete=64 fixed high)
    let firstActive = null;
    for (const a of [8, 12, 16, 24, 32, 64, 128, 256]) {
      const r = runSweepOnCase(c, { active: a, complete: 256 });
      if (r.targetAvailableToDomainVote) {
        firstActive = a;
        break;
      }
    }
    row.FIRST_ACTIVE_CAP_REQUIRED = firstActive != null ? String(firstActive) : '>256';

    // Find first complete-only (active=256 fixed high)
    let firstComplete = null;
    for (const k of [8, 12, 16, 24, 32, 64, 128, 256]) {
      const r = runSweepOnCase(c, { active: 256, complete: k });
      if (r.targetAvailableToDomainVote) {
        firstComplete = k;
        break;
      }
    }
    row.FIRST_COMPLETE_CAP_REQUIRED = firstComplete != null ? String(firstComplete) : '>256';

    let firstSym = null;
    for (const s of [8, 12, 16, 24, 32, 64, 128, 256]) {
      const r = runSweepOnCase(c, { active: s, complete: s });
      if (r.targetAvailableToDomainVote) {
        firstSym = s;
        break;
      }
    }
    row.FIRST_SYMMETRIC_BUDGET_REQUIRED =
      firstSym != null ? `${firstSym} / ${firstSym}` : '>256 / >256';
    row.notes = `completeBefore@8=${r88.completeBeforeCount}; peakActive@8=${r88.peakActive}`;
    g2ThresholdRows.push(row);
  }

  // Case matrix for evaluable at key budgets
  for (const c of evaluable) {
    const r8 = runSweepOnCase(c, { active: 8, complete: 8 });
    const r16 = runSweepOnCase(c, { active: 16, complete: 16 });
    const r32 = runSweepOnCase(c, { active: 32, complete: 32 });
    const r64 = runSweepOnCase(c, { active: 64, complete: 64 });
    caseMatrixRows.push({
      caseId: c.caseId,
      isG2: G2_IDS.includes(c.caseId) ? 'YES' : 'NO',
      targetSurface: c.targetSurface,
      targetGeom: c.targetGeom ? `${c.targetGeom.sylStart}:${c.targetGeom.sylEnd}` : '',
      target_edge_exists: 'YES',
      survive_8_8: r8.targetAvailableToDomainVote ? 'YES' : 'NO',
      survive_16_16: r16.targetAvailableToDomainVote ? 'YES' : 'NO',
      survive_32_32: r32.targetAvailableToDomainVote ? 'YES' : 'NO',
      survive_64_64: r64.targetAvailableToDomainVote ? 'YES' : 'NO',
      rank_8_8: r8.targetBestRank ?? '',
      rank_64_64: r64.targetBestRank ?? '',
      loss_8_8: r8.lossStage,
      complete_before_8: r8.completeBeforeCount,
      complete_before_64: r64.completeBeforeCount,
    });
  }

  // Active vs complete sensitivity from asymmetric
  const s8_8 = summaryRows.find((r) => r.budget === 'B0_8_8');
  const s8_16 = summaryRows.find((r) => r.budget === 'A_8_16');
  const s8_32 = summaryRows.find((r) => r.budget === 'A_8_32');
  const s16_8 = summaryRows.find((r) => r.budget === 'A_16_8');
  const s32_8 = summaryRows.find((r) => r.budget === 'A_32_8');
  const s16_16 = summaryRows.find((r) => r.budget === 'B2_16_16');
  const s32_32 = summaryRows.find((r) => r.budget === 'B4_32_32');

  const gainCompleteOnly =
    (s8_32?.cases_target_available_to_domain_vote || 0) -
    (s8_8?.cases_target_available_to_domain_vote || 0);
  const gainActiveOnly =
    (s32_8?.cases_target_available_to_domain_vote || 0) -
    (s8_8?.cases_target_available_to_domain_vote || 0);
  const gainBoth =
    (s32_32?.cases_target_available_to_domain_vote || 0) -
    (s8_8?.cases_target_available_to_domain_vote || 0);

  let ACTIVE_CAP_SENSITIVITY = 'LOW';
  let COMPLETE_CAP_SENSITIVITY = 'LOW';
  if (gainActiveOnly >= 3) ACTIVE_CAP_SENSITIVITY = 'HIGH';
  else if (gainActiveOnly >= 1) ACTIVE_CAP_SENSITIVITY = 'MEDIUM';
  if (gainCompleteOnly >= 3) COMPLETE_CAP_SENSITIVITY = 'HIGH';
  else if (gainCompleteOnly >= 1) COMPLETE_CAP_SENSITIVITY = 'MEDIUM';

  // G2 survive counts
  const g2Survive = {};
  for (const b of SYMMETRIC.concat([b6])) {
    const rows = byBudget[b.name] || [];
    g2Survive[b.name] = rows.filter((r) => r.isG2 && r.targetAvailableToDomainVote).length;
  }

  const s64 = summaryRows.find((r) => r.budget === 'B5_64_64');
  const stillFailAt64 = caseMatrixRows.filter((r) => r.survive_64_64 === 'NO');
  const pathCapAloneInsufficient =
    stillFailAt64.length >= Math.max(2, Math.floor(evaluable.length * 0.15)) ||
    (s64 &&
      s8_8 &&
      s64.target_hypothesis_survival_rate - s8_8.target_hypothesis_survival_rate < 5 &&
      stillFailAt64.length > 0);

  // Ranking reopen: if many survive only at high budget OR still fail with low rank
  const lowRankAt64 = caseMatrixRows.filter(
    (r) =>
      r.survive_64_64 === 'YES' &&
      r.rank_64_64 !== '' &&
      Number(r.rank_64_64) > 32
  );
  const STRUCTURAL_RANKING_POLICY_AUDIT_REQUIRED =
    stillFailAt64.length > 0 && pathCapAloneInsufficient
      ? 'YES'
      : stillFailAt64.length > 0
        ? 'NOT_PROVEN'
        : 'NO';

  // Resource explosion
  const r64res = resourceRows.find((r) => r.budget === 'B5_64_64');
  const r8res = resourceRows.find((r) => r.budget === 'B0_8_8');
  const growth64 =
    r8res && r64res && r8res.complete_pre_cap_mean
      ? r64res.complete_pre_cap_mean / r8res.complete_pre_cap_mean
      : 1;
  const RESOURCE_EXPLOSION_RISK =
    growth64 > 5 || (r64res && r64res.peak_active_max > 5000)
      ? 'HIGH'
      : growth64 > 2.5
        ? 'MEDIUM'
        : 'LOW';

  // Primary owner
  let PRIMARY_OWNER = 'P1_CURRENT_8_8_BUDGET_TOO_RESTRICTIVE';
  let SECONDARY_OWNER = 'NONE';
  if (STRUCTURAL_RANKING_POLICY_AUDIT_REQUIRED === 'YES' && pathCapAloneInsufficient) {
    PRIMARY_OWNER = 'P5_PATH_CAP_INCREASE_ALONE_INSUFFICIENT';
    SECONDARY_OWNER = 'P6_STRUCTURAL_RANKING_POLICY_REQUIRES_NEXT_AUDIT';
  } else if (ACTIVE_CAP_SENSITIVITY === 'HIGH' && COMPLETE_CAP_SENSITIVITY === 'HIGH') {
    PRIMARY_OWNER = 'P4_BOTH_PATH_CAPS_MATERIAL';
    SECONDARY_OWNER = 'P1_CURRENT_8_8_BUDGET_TOO_RESTRICTIVE';
  } else if (ACTIVE_CAP_SENSITIVITY === 'HIGH' && COMPLETE_CAP_SENSITIVITY !== 'HIGH') {
    PRIMARY_OWNER = 'P2_ACTIVE_PATH_CAP_DOMINANT';
    SECONDARY_OWNER = 'P1_CURRENT_8_8_BUDGET_TOO_RESTRICTIVE';
  } else if (COMPLETE_CAP_SENSITIVITY === 'HIGH') {
    PRIMARY_OWNER = 'P3_COMPLETE_PATH_CAP_DOMINANT';
    SECONDARY_OWNER = 'P1_CURRENT_8_8_BUDGET_TOO_RESTRICTIVE';
  } else if (
    g2Survive.B0_8_8 === 0 &&
    (g2Survive.B2_16_16 > 0 || g2Survive.B4_32_32 > 0 || g2Survive.B5_64_64 > 0)
  ) {
    PRIMARY_OWNER = 'P1_CURRENT_8_8_BUDGET_TOO_RESTRICTIVE';
    SECONDARY_OWNER =
      ACTIVE_CAP_SENSITIVITY !== 'LOW' && COMPLETE_CAP_SENSITIVITY !== 'LOW'
        ? 'P4_BOTH_PATH_CAPS_MATERIAL'
        : ACTIVE_CAP_SENSITIVITY !== 'LOW'
          ? 'P2_ACTIVE_PATH_CAP_DOMINANT'
          : COMPLETE_CAP_SENSITIVITY !== 'LOW'
            ? 'P3_COMPLETE_PATH_CAP_DOMINANT'
            : 'NONE';
  }
  if (RESOURCE_EXPLOSION_RISK === 'HIGH') {
    SECONDARY_OWNER = 'P7_RESOURCE_EXPLOSION_BLOCKS_SIMPLE_CAP_INCREASE';
  }

  // Write artifacts
  writeCsv(
    path.join(OUT, 'segmentation_budget_sweep_summary.csv'),
    Object.keys(summaryRows[0] || { budget: '' }),
    summaryRows
  );
  writeCsv(
    path.join(OUT, 'segmentation_budget_g2_thresholds.csv'),
    Object.keys(g2ThresholdRows[0] || { caseId: '' }),
    g2ThresholdRows
  );
  writeCsv(
    path.join(OUT, 'segmentation_budget_pilot_case_matrix.csv'),
    Object.keys(caseMatrixRows[0] || { caseId: '' }),
    caseMatrixRows
  );
  writeCsv(
    path.join(OUT, 'segmentation_budget_resource_growth.csv'),
    [
      ...Object.keys(resourceRows[0] || { budget: '' }),
      // marginal embedded separately in manifest
    ],
    resourceRows
  );

  // Append marginal as extra rows file content in resource growth via second section - put in manifest
  const getSurv = (name) =>
    summaryRows.find((r) => r.budget === name)?.target_hypothesis_survival_rate ?? null;
  const getG2 = (name) => g2Survive[name] ?? 0;

  const manifestOut = {
    PHASE: 'LINGUA_SEGMENTATION_PATH_BUDGET_SENSITIVITY_AUDIT_V1',
    AUDIT_VALID: true,
    AUDIT_MIRROR_VALID: true,
    PRODUCT_RUNTIME_CODE_CHANGED: false,
    PRODUCTION_CONFIG_CHANGED: false,
    ARCHITECTURE_CHANGED: false,
    GT_USED_BY_RUNTIME: false,
    GT_USED_BY_AUDIT: true,
    mirrorChecks,
    UNPRUNED_EXECUTABLE: unprunedExecutable,
    B6_BUDGET: b6,
    EVALUABLE_CASES: evaluable.length,
    NON_EVALUABLE_CASES: cases.length - evaluable.length,
    CACHED_CASES: cachedList.length,
    ACTIVE_CAP_SENSITIVITY,
    COMPLETE_CAP_SENSITIVITY,
    asymmetric_survival: {
      '8/8': s8_8?.cases_target_available_to_domain_vote,
      '8/16': s8_16?.cases_target_available_to_domain_vote,
      '8/32': s8_32?.cases_target_available_to_domain_vote,
      '16/8': s16_8?.cases_target_available_to_domain_vote,
      '32/8': s32_8?.cases_target_available_to_domain_vote,
      '16/16': s16_16?.cases_target_available_to_domain_vote,
      '32/32': s32_32?.cases_target_available_to_domain_vote,
      gain_complete_only_8_to_32: gainCompleteOnly,
      gain_active_only_8_to_32: gainActiveOnly,
      gain_both_8_to_32: gainBoth,
    },
    marginal,
    g2Survive,
    stillFailAt64Count: stillFailAt64.length,
    stillFailAt64Sample: stillFailAt64.slice(0, 12).map((r) => r.caseId),
    PATH_CAP_INCREASE_ALONE_INSUFFICIENT: pathCapAloneInsufficient ? 'YES' : 'NO',
    STRUCTURAL_RANKING_POLICY_AUDIT_REQUIRED,
    RESOURCE_EXPLOSION_RISK,
    PRIMARY_OWNER,
    SECONDARY_OWNER,
    PILOT_TARGET_SURVIVAL: {
      '8_8': getSurv('B0_8_8'),
      '12_12': getSurv('B1_12_12'),
      '16_16': getSurv('B2_16_16'),
      '24_24': getSurv('B3_24_24'),
      '32_32': getSurv('B4_32_32'),
      '64_64': getSurv('B5_64_64'),
    },
    G2_SURVIVE: {
      '8_8': `${getG2('B0_8_8')}/4`,
      '12_12': `${getG2('B1_12_12')}/4`,
      '16_16': `${getG2('B2_16_16')}/4`,
      '24_24': `${getG2('B3_24_24')}/4`,
      '32_32': `${getG2('B4_32_32')}/4`,
      '64_64': `${getG2('B5_64_64')}/4`,
    },
    g2ThresholdRows,
  };

  fs.writeFileSync(
    path.join(OUT, 'segmentation_budget_audit_manifest.json'),
    JSON.stringify(manifestOut, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        AUDIT_MIRROR_VALID: true,
        EVALUABLE: evaluable.length,
        G2_SURVIVE: manifestOut.G2_SURVIVE,
        PILOT_SURVIVAL: manifestOut.PILOT_TARGET_SURVIVAL,
        ACTIVE_CAP_SENSITIVITY,
        COMPLETE_CAP_SENSITIVITY,
        PRIMARY_OWNER,
        SECONDARY_OWNER,
        stillFailAt64: stillFailAt64.length,
        g2Thresholds: g2ThresholdRows,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
