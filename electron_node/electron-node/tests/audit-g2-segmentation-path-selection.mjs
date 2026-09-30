/**
 * G2 segmentation path-selection attribution — READ_ONLY.
 * Reconstructs LexicalEdge graph from Model2 window traces (hits → edges),
 * not from path-local after_model2_candidates (which only sees selected PathFineSpans).
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

const LIMITS = { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 };

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
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

/** Mirrors compareSegmentationPathRankingBestFirst */
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

function enumerateOffline(syllableCount, edges, limits) {
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

  const capEvents = [];
  const prunedPartial = [];

  for (let pos = 0; pos < syllableCount; pos++) {
    let prefixes = active[pos];
    if (prefixes.length > limits.maxActivePathsPerPosition && pos > 0) {
      const sorted = [...prefixes].sort(compareBestFirst);
      const kept = sorted.slice(0, limits.maxActivePathsPerPosition);
      const pruned = sorted.slice(limits.maxActivePathsPerPosition);
      capEvents.push({
        pruneStage: 'per_position_cap',
        pos,
        beforeCount: prefixes.length,
        afterCount: kept.length,
      });
      for (const p of pruned) prunedPartial.push({ ...p, pruneStage: 'per_position_cap', pos });
      prefixes = kept;
      active[pos] = kept;
    }
    for (const prefix of prefixes) {
      for (const edge of outgoing[pos] || []) {
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
  let kept = completeBefore;
  const prunedComplete = [];
  if (completeBefore.length > limits.maxCompleteSegmentationPaths) {
    const sorted = [...completeBefore].sort(compareBestFirst);
    kept = sorted.slice(0, limits.maxCompleteSegmentationPaths);
    for (const p of sorted.slice(limits.maxCompleteSegmentationPaths)) {
      prunedComplete.push({ ...p, pruneStage: 'complete_path_cap' });
    }
    capEvents.push({
      pruneStage: 'complete_path_cap',
      beforeCount: completeBefore.length,
      afterCount: kept.length,
    });
  }
  kept = [...kept].sort((a, b) => a.boundaryKey.localeCompare(b.boundaryKey));
  return {
    paths: kept,
    allCompleteBefore: completeBefore,
    completePathCountBeforePrune: completeBefore.length,
    retainedCompletePathCount: kept.length,
    prunedPartial,
    prunedComplete,
    capEvents,
  };
}

function pathHasGeom(p, geom) {
  return (p.edges || []).some((e) => e.sylStart === geom.sylStart && e.sylEnd === geom.sylEnd);
}

function reconstructFromModel2Windows(paths, syllableCount) {
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
        sources: new Set(),
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
        e.sources.add(c.source || 'BASE');
        e.candidateCount += 1;
        e.hasExact = true;
      }

      for (const q of w.p_retrieval?.queries || []) {
        for (const h of q.hits || []) {
          const e = ensure(
            q.syllable_start ?? ws,
            q.syllable_end ?? we
          );
          e.surfaces.add(h.surface);
          e.sources.add('PROFILE_PRONUNCIATION');
          e.candidateCount += 1;
          e.hasExact = true;
        }
      }

      for (const h of w.d_retrieval?.hits || []) {
        if (h.binding_status === 'REJECTED_RANGE_INCONSISTENT') continue;
        if (!h.candidateId && h.binding_status && h.binding_status !== 'BOUND_TO_ORIGIN_SPAN')
          continue;
        const e = ensure(ws, we);
        e.surfaces.add(h.surface);
        e.sources.add('PROFILE_DOMAIN');
        e.candidateCount += 1;
        e.hasExact = true;
      }
    }

    // Also union_before_budget (truncated but useful)
    for (const c of m2.union?.union_before_budget?.items || []) {
      const e = ensure(c.syllableStart, c.syllableEnd);
      e.surfaces.add(c.surface);
      e.sources.add(c.provenance || c.source || 'UNION');
      e.candidateCount += 1;
      e.hasExact = true;
    }

    // Retained path finespans with candidates (selected edges)
    for (const s of p.finespans || []) {
      if ((s.candidate_count || 0) <= 0) continue;
      const e = ensure(s.syllable_start, s.syllable_end);
      e.surfaces.add(s.source_text);
      e.sources.add(s.window_source || 'finespan');
      e.candidateCount = Math.max(e.candidateCount, s.candidate_count || 1);
      e.hasExact = true;
    }
  }

  const lexical = [...byGeom.values()]
    .filter((e) => e.candidateCount > 0)
    .map((e) => ({
      ...e,
      surfaces: [...e.surfaces],
      sources: [...e.sources],
    }));

  // Inject length-1 fallback where no edge (mirrors injectFallbackEdges reachability)
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
        sources: ['audit_synthetic_fallback'],
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

async function main() {
  const lifeRows = JSON.parse(
    fs.readFileSync(path.join(OUT, '_repair_span_geometry_rows.json'), 'utf8')
  );
  const g2prev = lifeRows.filter((r) =>
    String(r.firstGeometryDivergenceClass || '').startsWith('G2')
  );

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
  if (!healthy) throw new Error('not healthy');

  const matrixRows = [];
  const competitionRows = [];
  const classCounts = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, S6: 0, S7: 0, S8: 0 };

  for (const prev of g2prev) {
    const caseId = prev.caseId;
    const caseRow = caseById[caseId];
    const m = manById[caseId];
    const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
    const profile = JSON.parse(
      fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
    );
    const [es, ee] = String(prev.queryEvidenceGeometry).split(':').map(Number);
    const targetGeom = { sylStart: es, sylEnd: ee };

    const sessionId = `g2b-${caseId}-${Date.now()}`;
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
    const summary = paths[0]?.model2_summary || {};

    let syllableCount = 0;
    for (const p of paths) {
      for (const s of p.finespans || []) {
        syllableCount = Math.max(syllableCount, s.syllable_end || 0);
      }
      for (const w of p.model2?.windows || []) {
        const we = w.window?.syllable_end;
        if (typeof we === 'number') syllableCount = Math.max(syllableCount, we);
      }
    }

    const { lexical, withFb } = reconstructFromModel2Windows(paths, syllableCount);
    const targetEdge = lexical.find((e) => e.sylStart === es && e.sylEnd === ee) || null;

    // Window-level hit proof
    let windowHitSurfaces = [];
    let windowHitCount = 0;
    for (const p of paths) {
      for (const w of p.model2?.windows || []) {
        const win = w.window || {};
        if (win.syllable_start !== es || win.syllable_end !== ee) continue;
        for (const q of w.p_retrieval?.queries || []) {
          windowHitCount += (q.hits || []).length;
          windowHitSurfaces.push(...(q.hits || []).map((h) => h.surface));
        }
      }
      break; // one path's model2 windows is enough (shared)
    }
    windowHitSurfaces = [...new Set(windowHitSurfaces)];

    const introduced = summary.introduced_term_ids || [];
    const pMat = summary.p_materialized_count ?? summary.p_added ?? null;
    const termIntroduced =
      Boolean(targetEdge) ||
      (windowHitCount > 0 && (pMat == null || pMat > 0));

    // Competing overlapping lexical edges
    const competing = lexical.filter(
      (e) => !(e.sylStart === es && e.sylEnd === ee) && e.sylEnd > es && ee > e.sylStart
    );

    const enumResult = enumerateOffline(syllableCount, withFb, LIMITS);
    const targetBefore = (enumResult.allCompleteBefore || []).filter((p) =>
      pathHasGeom(p, targetGeom)
    );
    const targetKept = enumResult.paths.filter((p) => pathHasGeom(p, targetGeom));
    const sortedAll = [...(enumResult.allCompleteBefore || [])].sort(compareBestFirst);
    const targetRank =
      sortedAll.findIndex((p) => pathHasGeom(p, targetGeom)) >= 0
        ? sortedAll.findIndex((p) => pathHasGeom(p, targetGeom)) + 1
        : null;

    // Best target path structural profile
    const bestTarget = targetBefore.length
      ? [...targetBefore].sort(compareBestFirst)[0]
      : null;
    const cutoffPath =
      sortedAll.length >= LIMITS.maxCompleteSegmentationPaths
        ? sortedAll[LIMITS.maxCompleteSegmentationPaths - 1]
        : sortedAll[sortedAll.length - 1] || null;

    // Retained PathFineSpan exact geom?
    let retainedExact = 0;
    const selectedGeoms = new Set();
    for (const p of paths) {
      for (const s of p.finespans || []) {
        selectedGeoms.add(`${s.syllable_start}:${s.syllable_end}`);
        if (s.syllable_start === es && s.syllable_end === ee) retainedExact += 1;
      }
    }

    // Partial prune of prefixes that already contain target?
    const prunedPartialWithTarget = enumResult.prunedPartial.filter((p) =>
      pathHasGeom(p, targetGeom)
    );

    let validated = true;
    let reclass = '';
    let firstLossClass = 'S8_UNRESOLVED';
    let firstLossStage = '';
    let firstLossReason = '';
    let responsibleCodeOwner = '';
    let responsibleRule = '';
    let authoritySource = 'IMPLEMENTATION_BEHAVIOR';
    let contractViolationProven = 'NO';

    const targetEdgeExists = Boolean(targetEdge && targetEdge.candidateCount > 0) || termIntroduced;
    // Strengthen: if hits exist and p_materialized > 0, edge exists even if reconstruct missed
    const edgeProven =
      (targetEdge && targetEdge.candidateCount > 0) ||
      (windowHitCount > 0 && Number(pMat) > 0);

    if (!edgeProven) {
      validated = false;
      reclass = 'S6_PREVIOUS_G2_ATTRIBUTION_ERROR';
      firstLossClass = 'S6_PREVIOUS_G2_ATTRIBUTION_ERROR';
      firstLossStage = 'LexicalEdge_validation';
      firstLossReason =
        'Prior G2 assumed target-geometry LexicalEdge from Model2 hits, but neither reconstructed edge nor p_materialized proof holds';
      responsibleCodeOwner = 'prior_audit_classification';
      responsibleRule = 'G2 requires candidate-bearing LexicalEdge at exact geometry';
      authoritySource = 'TEST_ASSUMPTION';
      classCounts.S6 += 1;
    } else if (retainedExact > 0) {
      validated = false;
      reclass = 'S6_PREVIOUS_G2_ATTRIBUTION_ERROR';
      firstLossClass = 'S6_PREVIOUS_G2_ATTRIBUTION_ERROR';
      firstLossStage = 'prior_classification';
      firstLossReason = `Target geometry PathFineSpan retained on ${retainedExact} spans; prior G2 contradicted`;
      responsibleCodeOwner = 'prior_audit_classification';
      responsibleRule = 'G2 requires selected PathFineSpan NOT use target geometry';
      authoritySource = 'TEST_ASSUMPTION';
      classCounts.S6 += 1;
    } else if (prunedPartialWithTarget.length > 0 && targetBefore.length === 0) {
      firstLossClass = 'S3_TARGET_PATH_GENERATED_BUT_PRUNED';
      firstLossStage = 'per_position_cap';
      firstLossReason = `Partial paths containing target edge pruned by maxActivePathsPerPosition=8 before completing; prunedPartialWithTarget=${prunedPartialWithTarget.length}`;
      responsibleCodeOwner =
        'enumerateCompleteSegmentationPaths / V4_LIMITS.maxActivePathsPerPosition';
      responsibleRule =
        'per_position_cap=8 + compareSegmentationPathRankingBestFirst (exactEdgeCount DESC favors finer partitions)';
      authoritySource = 'FROZEN_SSOT';
      contractViolationProven = 'NO';
      classCounts.S3 += 1;
    } else if (targetBefore.length === 0) {
      firstLossClass = 'S2_TARGET_EDGE_AVAILABLE_BUT_TARGET_PATH_NOT_GENERATED';
      firstLossStage = 'path_enumeration';
      firstLossReason =
        'Target LexicalEdge present but no complete contiguous path containing it under reconstructed DAG (connectivity)';
      responsibleCodeOwner = 'enumerateCompleteSegmentationPaths';
      responsibleRule = 'complete contiguous cover 0..N';
      authoritySource = 'FROZEN_SSOT';
      classCounts.S2 += 1;
    } else if (targetKept.length === 0) {
      firstLossClass = 'S3_TARGET_PATH_GENERATED_BUT_PRUNED';
      firstLossStage = 'complete_path_cap';
      const bt = bestTarget;
      const ct = cutoffPath;
      firstLossReason = [
        `completeBefore=${enumResult.completePathCountBeforePrune}`,
        `retained=${enumResult.retainedCompletePathCount}`,
        `targetPathsBefore=${targetBefore.length}`,
        `targetBestRank=${targetRank}`,
        `cap=${LIMITS.maxCompleteSegmentationPaths}`,
        bt && ct
          ? `delta(fallback=${bt.fallbackEdgeCount - ct.fallbackEdgeCount},fuzzy=${bt.fuzzyEdgeCount - ct.fuzzyEdgeCount},exact=${bt.exactEdgeCount - ct.exactEdgeCount},lex=${bt.edges.length - bt.fallbackEdgeCount - (ct.edges.length - ct.fallbackEdgeCount)})`
          : '',
      ]
        .filter(Boolean)
        .join('; ');
      responsibleCodeOwner =
        'enumerateCompleteSegmentationPaths / V4_LIMITS.maxCompleteSegmentationPaths';
      responsibleRule =
        'complete_path_cap=8; prune order fallbackASC,fuzzyASC,toneRelaxedASC,exactDESC,lexicalDESC,boundaryKeyASC';
      authoritySource = 'FROZEN_SSOT';
      // Cap is authorized PROBE; exactEdgeCount DESC is authorized SSOT — expected algorithm when cap fires
      contractViolationProven = 'NO';
      classCounts.S3 += 1;
    } else if (retainedExact === 0 && targetKept.length > 0) {
      firstLossClass = 'S5_TARGET_PATH_SELECTED_BUT_LOST_AFTER_SELECTION';
      firstLossStage = 'PathFineSpan_materialization_or_observability';
      firstLossReason =
        'Offline enum retains target path but dialog200 PathFineSpans lack exact geometry — materialization drift or reconstruct mismatch';
      responsibleCodeOwner = 'materializePathFineSpans';
      responsibleRule = '1:1 LexicalEdge → PathFineSpan';
      authoritySource = 'FROZEN_SSOT';
      contractViolationProven = 'NOT_PROVEN';
      classCounts.S5 += 1;
    } else {
      firstLossClass = 'S8_UNRESOLVED';
      firstLossStage = 'unknown';
      firstLossReason = 'Could not prove first-loss stage with available traces';
      responsibleCodeOwner = 'OBSERVABILITY_GAP';
      responsibleRule = 'n/a';
      authoritySource = 'UNKNOWN';
      classCounts.S8 += 1;
    }

    const scoreDecomp =
      bestTarget && cutoffPath
        ? {
            target: {
              fallback: bestTarget.fallbackEdgeCount,
              fuzzy: bestTarget.fuzzyEdgeCount,
              toneRelaxed: bestTarget.toneRelaxedEdgeCount,
              exact: bestTarget.exactEdgeCount,
              lexical: bestTarget.edges.length - bestTarget.fallbackEdgeCount,
              boundaryKey: bestTarget.boundaryKey,
            },
            cutoffOrSelected: {
              fallback: cutoffPath.fallbackEdgeCount,
              fuzzy: cutoffPath.fuzzyEdgeCount,
              toneRelaxed: cutoffPath.toneRelaxedEdgeCount,
              exact: cutoffPath.exactEdgeCount,
              lexical: cutoffPath.edges.length - cutoffPath.fallbackEdgeCount,
              boundaryKey: cutoffPath.boundaryKey,
            },
          }
        : null;

    matrixRows.push({
      caseId,
      referenceText: prev.referenceText,
      asrText: prev.asrText,
      targetTerm: prev.targetTerm,
      targetEdgeGeometry: `${es}:${ee}`,
      targetEdgeCandidateCount: targetEdge?.candidateCount ?? (edgeProven ? windowHitCount : 0),
      targetEdgeCandidateSurfaces: (targetEdge?.surfaces || windowHitSurfaces).join(';'),
      targetEdgeEnteredEnumeration: edgeProven ? 'YES' : 'NO',
      competingEdgeGeometries: competing
        .map((e) => `${e.sylStart}:${e.sylEnd}:${e.surfaces.slice(0, 2).join('/')}`)
        .join('|'),
      targetPathGenerated: targetBefore.length > 0 ? 'YES' : 'NO',
      targetPathSurvivedPruning:
        targetKept.length > 0 ? 'YES' : targetBefore.length > 0 ? 'NO' : 'NOT_APPLICABLE',
      targetPathFinalRank: targetRank ?? 'NOT_AVAILABLE',
      selectedPathGeometry: prev.selectedPathGeometry,
      selectedPathRank: 'MULTI_PATH_TOP8_RETAINED',
      firstLossStage,
      firstLossClass,
      firstLossReason,
      responsibleCodeOwner,
      responsibleRule,
      authoritySource,
      contractViolationProven,
      notes: [
        `validated=${validated}`,
        reclass ? `reclass=${reclass}` : '',
        `sylN=${syllableCount}`,
        `lexEdges=${lexical.length}`,
        `completeBefore=${enumResult.completePathCountBeforePrune}`,
        `retained=${enumResult.retainedCompletePathCount}`,
        `windowHits=${windowHitCount}`,
        `pMat=${pMat}`,
        `retainedExactPFS=${retainedExact}`,
        scoreDecomp
          ? `scoreTarget=${JSON.stringify(scoreDecomp.target)};scoreCutoff=${JSON.stringify(scoreDecomp.cutoffOrSelected)}`
          : '',
      ]
        .filter(Boolean)
        .join('; '),
      _validated: validated,
      _reclass: reclass,
      _edgeProven: edgeProven,
      _targetBefore: targetBefore.length,
      _targetKept: targetKept.length,
      _targetRank: targetRank,
      _retainedExact: retainedExact,
      _scoreDecomp: scoreDecomp,
      _completeBefore: enumResult.completePathCountBeforePrune,
      _competing: competing,
      _targetEdge: targetEdge,
      _windowHitSurfaces: windowHitSurfaces,
    });

    competitionRows.push({
      caseId,
      targetTerm: prev.targetTerm,
      targetEdge_rawStartEnd: `${es}:${ee}`,
      targetEdge_syllableStartEnd: `${es}:${ee}`,
      targetEdge_surface: (targetEdge?.surfaces || windowHitSurfaces).join(';'),
      targetEdge_candidateCount: targetEdge?.candidateCount ?? windowHitCount,
      targetEdge_candidateSurfaces: (targetEdge?.surfaces || windowHitSurfaces).join(';'),
      targetEdge_candidateProvenance: (targetEdge?.sources || ['PROFILE_PRONUNCIATION']).join(';'),
      targetEdge_hasExact: targetEdge?.hasExact ?? true,
      competingEdges_compact: competing
        .slice(0, 16)
        .map(
          (e) =>
            `${e.sylStart}:${e.sylEnd}|${e.surfaces.slice(0, 3).join('/')}|c${e.candidateCount}|${e.edgeKind}`
        )
        .join(' || '),
      TARGET_EDGE_CREATED: edgeProven ? 'YES' : 'NO',
      TARGET_EDGE_ENTERED_ENUMERATION: edgeProven ? 'YES' : 'NO',
      TARGET_PATH_GENERATED: targetBefore.length > 0 ? 'YES' : 'NO',
      TARGET_PATH_SURVIVED_PRUNING:
        targetKept.length > 0 ? 'YES' : targetBefore.length > 0 ? 'NO' : 'NOT_APPLICABLE',
      TARGET_PATH_FINAL_RANK: targetRank ?? 'NOT_AVAILABLE',
      SELECTED_PATH_RANK: 'MULTI_PATH_TOP8',
      FIRST_LOSS_STAGE: firstLossStage,
      FIRST_LOSS_REASON: firstLossReason,
      score_decomposition: scoreDecomp ? JSON.stringify(scoreDecomp) : '',
    });

    console.log(
      caseId,
      'edge',
      edgeProven,
      'gen',
      targetBefore.length,
      'kept',
      targetKept.length,
      'rank',
      targetRank,
      'class',
      firstLossClass,
      'complete',
      enumResult.completePathCountBeforePrune
    );
  }

  // Emit artifacts
  const validated = matrixRows.filter((r) => r._validated);
  const reclassified = matrixRows.filter((r) => !r._validated);

  const funnel = {
    PHASE: 'LINGUA_G2_SEGMENTATION_PATH_SELECTION_ATTRIBUTION_AUDIT_V1',
    G2_EXPECTED_CASES: g2prev.length,
    G2_VALIDATED_CASES: validated.length,
    G2_RECLASSIFIED_CASES: reclassified.length,
    TARGET_EDGE_EXISTS: matrixRows.filter((r) => r._edgeProven).length,
    TARGET_EDGE_ENTERED_ENUMERATION: matrixRows.filter((r) => r._edgeProven).length,
    TARGET_PATH_GENERATED: matrixRows.filter((r) => r._targetBefore > 0).length,
    TARGET_PATH_SURVIVED_STRUCTURAL_PRUNING: matrixRows.filter((r) => r._targetKept > 0).length,
    TARGET_PATH_REACHED_FINAL_RANKING: matrixRows.filter((r) => r._targetRank != null).length,
    TARGET_PATH_SELECTED: matrixRows.filter((r) => r._retainedExact > 0).length,
    TARGET_GEOMETRY_PATHFINESPAN_CREATED: matrixRows.filter((r) => r._retainedExact > 0).length,
    ATTRIBUTION: { ...classCounts },
    RECONCILE:
      classCounts.S1 +
        classCounts.S2 +
        classCounts.S3 +
        classCounts.S4 +
        classCounts.S5 +
        classCounts.S6 +
        classCounts.S7 +
        classCounts.S8 ===
      g2prev.length,
  };

  writeCsv(
    path.join(OUT, 'LINGUA_G2_SEGMENTATION_CASE_MATRIX.csv'),
    [
      'caseId',
      'referenceText',
      'asrText',
      'targetTerm',
      'targetEdgeGeometry',
      'targetEdgeCandidateCount',
      'targetEdgeCandidateSurfaces',
      'targetEdgeEnteredEnumeration',
      'competingEdgeGeometries',
      'targetPathGenerated',
      'targetPathSurvivedPruning',
      'targetPathFinalRank',
      'selectedPathGeometry',
      'selectedPathRank',
      'firstLossStage',
      'firstLossClass',
      'firstLossReason',
      'responsibleCodeOwner',
      'responsibleRule',
      'authoritySource',
      'contractViolationProven',
      'notes',
    ],
    matrixRows
  );

  writeCsv(
    path.join(OUT, 'LINGUA_G2_PATH_COMPETITION_MATRIX.csv'),
    [
      'caseId',
      'targetTerm',
      'targetEdge_rawStartEnd',
      'targetEdge_syllableStartEnd',
      'targetEdge_surface',
      'targetEdge_candidateCount',
      'targetEdge_candidateSurfaces',
      'targetEdge_candidateProvenance',
      'targetEdge_hasExact',
      'competingEdges_compact',
      'TARGET_EDGE_CREATED',
      'TARGET_EDGE_ENTERED_ENUMERATION',
      'TARGET_PATH_GENERATED',
      'TARGET_PATH_SURVIVED_PRUNING',
      'TARGET_PATH_FINAL_RANK',
      'SELECTED_PATH_RANK',
      'FIRST_LOSS_STAGE',
      'FIRST_LOSS_REASON',
      'score_decomposition',
    ],
    competitionRows
  );

  const authorityRows = [
    {
      mechanism: 'segmentation_path_enumeration',
      CODE_OWNER: 'enumerateCompleteSegmentationPaths.ts',
      INPUT: 'syllableCount + LexicalEdge[] (+fallback) + V4_LIMITS',
      OUTPUT: 'SegmentationPath[] retained + prunedPaths + capEvents',
      BUSINESS_PURPOSE: 'Enumerate complete contiguous boundary hypotheses for multi-path lattice',
      CURRENT_RULE: 'DAG expansion from pos=0; contiguous edges; legal path cover 0..N',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'LexicalEdge_eligibility',
      CODE_OWNER: 'build-lexical-edges.ts',
      INPUT: 'recalledWindows with ≥1 WindowCandidate',
      OUTPUT: 'LexicalEdge per unique syllableStart:syllableEnd',
      BUSINESS_PURPOSE: 'Only candidate-bearing windows become edges',
      CURRENT_RULE: 'skip empty candidate bundles; first boundary wins',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'path_scoring_structural',
      CODE_OWNER: 'compareSegmentationPathRankingBestFirst',
      INPUT: 'fallback/fuzzy/toneRelaxed/exact/lexical counts + boundaryKey',
      OUTPUT: 'best-first ordering (negative if a better than b)',
      BUSINESS_PURPOSE: 'Resource prune ordering when caps fire — not language decision',
      CURRENT_RULE:
        'fallbackASC → fuzzyASC → toneRelaxedASC → exactDESC → lexicalDESC → boundaryKeyASC',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'path_ranking',
      CODE_OWNER: 'compareSegmentationPathRankingBestFirst',
      INPUT: 'same structural fields',
      OUTPUT: 'ordering for prune and consumer best-path needs',
      BUSINESS_PURPOSE: 'Deterministic structural ranking under caps',
      CURRENT_RULE: 'Implementation Contract §8.3',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'path_pruning_per_position',
      CODE_OWNER: 'enumerateCompleteSegmentationPaths / maxActivePathsPerPosition',
      INPUT: 'partial paths at position',
      OUTPUT: 'top-K partials by structural ranking',
      BUSINESS_PURPOSE: 'Resource protection during enumeration',
      CURRENT_RULE: 'PROBE maxActivePathsPerPosition=8',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'path_pruning_complete_cap',
      CODE_OWNER: 'enumerateCompleteSegmentationPaths / maxCompleteSegmentationPaths',
      INPUT: 'all complete paths',
      OUTPUT: 'top-K complete paths by structural ranking',
      BUSINESS_PURPOSE: 'Resource protection; retain ≤8 complete SegmentationPaths',
      CURRENT_RULE: 'PROBE maxCompleteSegmentationPaths=8',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'beam',
      CODE_OWNER: 'NONE (forbidden semantic/KenLM/domain beam)',
      INPUT: 'n/a',
      OUTPUT: 'n/a',
      BUSINESS_PURPOSE: 'Architecture explicitly forbids language beam; caps ≠ beam',
      CURRENT_RULE: 'No semantic/KenLM/domain beam; path width = resource protection',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'dedup',
      CODE_OWNER: 'enumerate (duplicate edge boundary rejected) + boundaryKey identity',
      INPUT: 'edges / paths',
      OUTPUT: 'unique boundary edges; path identity by boundaryKey',
      BUSINESS_PURPOSE: 'Determinism / no duplicate boundaries',
      CURRENT_RULE: 'One edge per geometry; pathId from boundaryKey',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'overlap_resolution',
      CODE_OWNER: 'path enumeration (paths are partitions — edges within a path do not overlap)',
      INPUT: 'DAG edges',
      OUTPUT: 'non-overlapping edge sequences per path',
      BUSINESS_PURPOSE: 'Each path is a full cover partition; overlap only across paths',
      CURRENT_RULE: 'Contiguous non-overlapping within path',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'fallback_edge_handling',
      CODE_OWNER: 'inject-fallback-edges.ts',
      INPUT: 'lexical edges + syllableCount',
      OUTPUT: 'length-1 fallback edges for reachability',
      BUSINESS_PURPOSE: 'Guarantee connectivity without inventing lexical terms',
      CURRENT_RULE: 'fallback length=1; no domain tags; increases fallbackEdgeCount',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'candidate_vs_fallback_preference',
      CODE_OWNER: 'compareSegmentationPathRankingBestFirst',
      INPUT: 'fallbackEdgeCount',
      OUTPUT: 'paths with fewer fallbacks ranked better',
      BUSINESS_PURPOSE: 'Prefer lexical coverage over fallback when pruning',
      CURRENT_RULE: 'fallbackEdgeCount ASC is primary prune key',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'tie_breaking',
      CODE_OWNER: 'compareSegmentationPathRankingBestFirst',
      INPUT: 'boundaryKey',
      OUTPUT: 'ASC lexicographic',
      BUSINESS_PURPOSE: 'Deterministic final tie-break',
      CURRENT_RULE: 'boundaryKey ASC',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'lexical_candidate_budget',
      CODE_OWNER: 'Model2 P/D candBudget=8 + V4 exactTopK; global mergeCrossPath ≤16',
      INPUT: 'per-window / global candidates',
      OUTPUT: 'bounded candidate pools',
      BUSINESS_PURPOSE: 'Candidate cardinality control (separate from path count)',
      CURRENT_RULE: 'Global sentence candidates ≤16 FROZEN; path cap PROBE=8',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'segmentation_path_budget',
      CODE_OWNER: 'V4_LIMITS.maxCompleteSegmentationPaths / maxActivePathsPerPosition',
      INPUT: 'enumerated paths',
      OUTPUT: '≤8 retained complete paths (probe)',
      BUSINESS_PURPOSE: 'Resource protection for multi-path retention',
      CURRENT_RULE: 'PROBE 8/8 — NOT final frozen values',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
    {
      mechanism: 'assembled_sentence_budget',
      CODE_OWNER: 'mergeCrossPathSentenceCandidates / maxSentenceCandidates=16',
      INPUT: 'per-path assembled sentences',
      OUTPUT: '≤16 global sentence candidates for KenLM',
      BUSINESS_PURPOSE: 'Global post-path sentence cap',
      CURRENT_RULE: 'maxSentenceCandidates=16 FROZEN',
      AUTHORITY_SOURCE: 'FROZEN_SSOT',
    },
  ];

  writeCsv(
    path.join(OUT, 'LINGUA_G2_SEGMENTATION_AUTHORITY_MATRIX.csv'),
    [
      'mechanism',
      'CODE_OWNER',
      'INPUT',
      'OUTPUT',
      'BUSINESS_PURPOSE',
      'CURRENT_RULE',
      'AUTHORITY_SOURCE',
    ],
    authorityRows
  );

  fs.writeFileSync(
    path.join(OUT, 'LINGUA_G2_SEGMENTATION_FUNNEL.json'),
    JSON.stringify(funnel, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(OUT, '_g2_attribution_rows.json'),
    JSON.stringify(
      matrixRows.map((r) => {
        const { _competing, _targetEdge, _scoreDecomp, ...rest } = r;
        return { ...rest, scoreDecomp: _scoreDecomp };
      }),
      null,
      2
    ),
    'utf8'
  );

  console.log('FUNNEL', JSON.stringify(funnel, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
