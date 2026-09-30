/**
 * READ_ONLY — CORRECT_PROFILE residual QEV7 (43) target-query lifecycle attribution.
 * CODE_FROZEN / NO product changes. GT audit-only.
 * Requires MODEL2_DIALOG200_TRACE=1 (set by harness).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const START = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const LEXICON_DB = path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
const PHASE = 'LINGUA_CORRECT_PROFILE_TARGET_QUERY_LIFECYCLE_ATTRIBUTION_AUDIT_V1';

const OWNERS = [
  'C1_TARGET_LENGTH_WINDOW_NEVER_ENUMERATED',
  'C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE',
  'C3_MODEL2_ACTION_NOT_TARGET_REACHABLE',
  'C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE',
  'C5_COMPOUND_NON_PROFILE_ASR_ERROR',
  'C6_TARGET_QUERY_NOT_EXECUTED_FIRST_PASS',
  'C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED',
  'C8_EVIDENCE_STORE_LIFETIME_LOSS',
  'C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY',
  'C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED',
  'C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT',
  'C12_EVIDENCE_SELECTION_POLICY',
  'C13_STAGE2_QUERY_EXECUTION_CONTRADICTION',
  'C14_TARGET_QUERY_REACHED_STAGE2_RECALL',
  'C15_OTHER_PROVEN',
  'C16_UNRESOLVED',
];

function stripTone(p) {
  return String(p || '')
    .toLowerCase()
    .replace(/[0-5]/g, '')
    .replace(/\s+/g, '');
}

function splitKey(k) {
  return stripTone(k)
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinKey(parts) {
  return parts.join('|');
}

function pinyinFamily(query, target) {
  const qs = splitKey(query);
  const ts = splitKey(target);
  if (!qs.length || !ts.length) return { ok: false };
  if (joinKey(qs) === joinKey(ts)) return { ok: true, how: 'EXACT', offset: 0 };
  if (qs.length >= ts.length) {
    for (let i = 0; i <= qs.length - ts.length; i++) {
      if (joinKey(qs.slice(i, i + ts.length)) === joinKey(ts)) {
        return { ok: true, how: 'QUERY_CONTAINS_TARGET', offset: i };
      }
    }
  }
  if (ts.length > qs.length) {
    for (let i = 0; i <= ts.length - qs.length; i++) {
      if (joinKey(ts.slice(i, i + qs.length)) === joinKey(qs)) {
        return { ok: true, how: 'TARGET_CONTAINS_QUERY', offset: i };
      }
    }
  }
  return { ok: false };
}

function parseCsv(text) {
  const rows = [];
  let i = 0,
    cur = '',
    row = [],
    inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const h = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(h.map((k, idx) => [k, r[idx] ?? ''])));
}

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function geomVsTarget(w, t) {
  if (w.sylStart == null || w.sylEnd == null || t.sylStart == null || t.sylEnd == null) {
    return 'W_UNKNOWN';
  }
  if (w.sylStart === t.sylStart && w.sylEnd === t.sylEnd) return 'W_EXACT_TARGET';
  if (w.sylStart <= t.sylStart && w.sylEnd >= t.sylEnd) return 'W_CONTAINS_TARGET';
  if (w.sylStart >= t.sylStart && w.sylEnd <= t.sylEnd) return 'W_INSIDE_TARGET';
  if (w.sylEnd > t.sylStart && t.sylEnd > w.sylStart) return 'W_PARTIAL_OVERLAP';
  return 'W_DISJOINT';
}

function coversInterval(outer, inner) {
  if (
    outer == null ||
    inner == null ||
    outer.sylStart == null ||
    outer.sylEnd == null ||
    inner.sylStart == null ||
    inner.sylEnd == null
  ) {
    return false;
  }
  return outer.sylStart <= inner.sylStart && outer.sylEnd >= inner.sylEnd;
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
      LEXICON_RECALL_V2_DIAGNOSTICS: '1',
      MODEL3_CANDIDATE_PROVENANCE_TRACE: '1',
    },
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
      resolve({ pid: m ? Number(m[1]) : null });
    });
  });
}

async function postJson(port, route, body, timeoutMs = 180000) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json().catch(() => ({}));
}

function preloadLexiconSurfaces(surfaces) {
  const uniq = [...new Set(surfaces.filter(Boolean))];
  const inPath = path.join(OUT, '_lifecycle_lexicon_surfaces_in.json');
  const outPath = path.join(OUT, '_lifecycle_lexicon_surfaces_out.json');
  fs.writeFileSync(inPath, JSON.stringify(uniq, null, 0), 'utf8');
  const r = spawnSync(
    process.env.PYTHON || 'python',
    [path.join(__dirname, '_lexicon_preload_surfaces.py'), LEXICON_DB, inPath, outPath],
    { encoding: 'utf8', timeout: 60000 }
  );
  if (r.status !== 0) {
    console.error('lexicon preload failed', r.stderr || r.stdout);
    return new Map();
  }
  const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  return new Map(Object.entries(data));
}

function lexiconHasPinyinSurface(lexMap, pinyinKey, surface) {
  if (!lexMap || !pinyinKey || !surface) return false;
  const keys = lexMap.get(surface) || [];
  return keys.includes(stripTone(pinyinKey));
}

/** Frozen mapper (mirror product) for audit attribution. */
function mapEvidenceToStage2Window(evidenceStore, window) {
  const wS = window.sylStart;
  const wE = window.sylEnd;
  if (wE <= wS) return { mappedPinyinKey: null, reason: 'NONE', querySource: 'ASR' };
  const cands = [];
  let sawRawConflict = false;
  let sawInvalid = false;
  let sawUnsupported = false;
  for (const e of evidenceStore) {
    const parts = splitKey(e.pinyinKey);
    const span = e.sylEnd - e.sylStart;
    if (span <= 0 || parts.length !== span) {
      sawInvalid = true;
      continue;
    }
    const eS = e.sylStart;
    const eE = e.sylEnd;
    const sylExact = eS === wS && eE === wE;
    const sylContains = eS <= wS && eE >= wE && !sylExact;
    const sylContained = wS <= eS && wE >= eE && !sylExact;
    const sylOverlap = eE > wS && wE > eS && !sylExact && !sylContains && !sylContained;
    if (sylContained || sylOverlap) {
      sawUnsupported = true;
      continue;
    }
    if (!sylExact && !sylContains) {
      sawUnsupported = true;
      continue;
    }
    const rawExact = e.rawStart === window.rawStart && e.rawEnd === window.rawEnd;
    const rawContains = e.rawStart <= window.rawStart && e.rawEnd >= window.rawEnd;
    const rawOk = sylExact ? rawExact : rawContains;
    if (!rawOk) {
      sawRawConflict = true;
      continue;
    }
    if (sylExact) {
      cands.push({
        kind: 'EXACT',
        mapped: e.pinyinKey,
        span: eE - eS,
        syllableStart: eS,
        syllableEnd: eE,
        pinyinKey: e.pinyinKey,
      });
      continue;
    }
    const mapped = parts.slice(wS - eS, wE - eS).join('|');
    if (splitKey(mapped).length !== wE - wS) {
      sawInvalid = true;
      continue;
    }
    cands.push({
      kind: 'SUBSPAN',
      mapped,
      span: eE - eS,
      syllableStart: eS,
      syllableEnd: eE,
      pinyinKey: e.pinyinKey,
    });
  }
  if (!cands.length) {
    if (sawRawConflict && !sawUnsupported && !sawInvalid) {
      return { mappedPinyinKey: null, reason: 'RAW_CONFLICT_REJECT', querySource: 'ASR' };
    }
    if (sawInvalid && !sawUnsupported && !sawRawConflict) {
      return { mappedPinyinKey: null, reason: 'INVALID_EVIDENCE', querySource: 'ASR' };
    }
    if (!evidenceStore.length) return { mappedPinyinKey: null, reason: 'NONE', querySource: 'ASR' };
    return { mappedPinyinKey: null, reason: 'UNSUPPORTED_GEOMETRY', querySource: 'ASR' };
  }
  cands.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'EXACT' ? -1 : 1;
    if (a.span !== b.span) return a.span - b.span;
    if (a.syllableStart !== b.syllableStart) return a.syllableStart - b.syllableStart;
    if (a.syllableEnd !== b.syllableEnd) return a.syllableEnd - b.syllableEnd;
    return a.pinyinKey < b.pinyinKey ? -1 : a.pinyinKey > b.pinyinKey ? 1 : 0;
  });
  const winner = cands[0];
  return {
    mappedPinyinKey: winner.mapped,
    reason: winner.kind,
    querySource: 'RECALL_QUERY_EVIDENCE',
    winnerEvidence: winner,
    legalCandidates: cands,
  };
}

function extractPaths(data) {
  const raw = data?.extra?.dialog200_path_trace;
  return Array.isArray(raw) ? raw : raw?.paths || [];
}

function extractModel2Windows(paths) {
  const out = [];
  const seen = new Set();
  for (const p of paths || []) {
    const wins = p?.model2?.windows || p?.model2?.path_trace?.windows || [];
    for (const w of wins) {
      const win = w.window || {};
      const id = w.window_id || win.window_id || `${win.syllable_start}:${win.syllable_end}`;
      const key = `${id}|${win.syllable_start}|${win.syllable_end}|${win.start}|${win.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pr = w.p_retrieval;
      out.push({
        windowId: id,
        rawStart: win.start ?? null,
        rawEnd: win.end ?? null,
        sylStart: win.syllable_start ?? null,
        sylEnd: win.syllable_end ?? null,
        pinyinKey: win.phonetic_representation || null,
        sourceText: win.source_text || null,
        baseCandidateCount: win.candidate_count ?? w.base_candidates?.count ?? null,
        model2Invoked: Boolean(w.model2_inference_id) || w.reason == null,
        notInvokedReason: w.reason || (pr?.status === 'NOT_EXECUTED' ? pr.reason : null),
        pRetrievalStatus: pr?.status || (w.model2_inference_id ? 'UNKNOWN' : 'NO_INFER'),
        pRetrievalReason: pr?.reason || null,
        selectedActions: w.model2_raw?.p_selected_actions || [],
        queries: pr?.status === 'EXECUTED' ? pr.queries || [] : [],
      });
    }
  }
  return out;
}

function extractExecutedQueries(paths, caseId, runId) {
  const out = [];
  let inv = 0;
  for (const p of paths || []) {
    const wins = p?.model2?.windows || p?.model2?.path_trace?.windows || [];
    for (const w of wins) {
      const win = w.window || {};
      const pr = w.p_retrieval;
      if (!pr || pr.status !== 'EXECUTED') continue;
      for (const q of pr.queries || []) {
        inv += 1;
        out.push({
          invocationId: `${runId}|${w.window_id || win.window_id}|${q.action_id}|${q.pinyin_key}|${inv}`,
          caseId,
          pathId: p.path_id,
          windowId: w.window_id || win.window_id || null,
          rawStart: q.raw_start ?? win.start ?? null,
          rawEnd: q.raw_end ?? win.end ?? null,
          sylStart: q.syllable_start ?? win.syllable_start ?? null,
          sylEnd: q.syllable_end ?? win.syllable_end ?? null,
          observedPinyinKey: q.observed_pinyin_key || win.phonetic_representation || null,
          observedSyllables: q.observed_syllables || null,
          actionId: q.action_id || null,
          transformedPinyinKey: q.pinyin_key || null,
          querySyllables: q.query_syllables || q.query || null,
          hitCount: (q.hits || []).length,
          hits: (q.hits || []).map((h) => ({
            surface: h.surface,
            pinyin: h.pinyin,
            domains: h.domains,
          })),
        });
      }
    }
  }
  return out;
}

function reconstructEvidenceStore(queries) {
  const store = [];
  const seen = new Set();
  for (const q of queries) {
    const parts = splitKey(q.transformedPinyinKey);
    const span = (q.sylEnd ?? 0) - (q.sylStart ?? 0);
    if (span <= 0 || parts.length !== span) continue;
    if ((q.rawEnd ?? 0) <= (q.rawStart ?? 0)) continue;
    const key = `${q.sylStart}|${q.sylEnd}|${stripTone(q.transformedPinyinKey)}|MODEL2_CONDITIONED_FIRST_PASS`;
    if (seen.has(key)) continue;
    seen.add(key);
    store.push({
      pinyinKey: stripTone(q.transformedPinyinKey),
      sylStart: q.sylStart,
      sylEnd: q.sylEnd,
      rawStart: q.rawStart,
      rawEnd: q.rawEnd,
      source: 'MODEL2_CONDITIONED_FIRST_PASS',
      fromInvocationId: q.invocationId,
    });
  }
  return store;
}

function extractRetryRegions(paths) {
  const out = [];
  const seen = new Set();
  for (const p of paths || []) {
    for (const r of p?.model3?.retry_regions || []) {
      const id = r.retryRegionId || r.id || `${r.rawStart}:${r.rawEnd}`;
      const key = `${id}|${r.rawStart}|${r.rawEnd}|${r.syllableStart}|${r.syllableEnd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        retryRegionId: id,
        rawStart: r.rawStart ?? r.start ?? null,
        rawEnd: r.rawEnd ?? r.end ?? null,
        sylStart: r.syllableStart ?? r.syllable_start ?? null,
        sylEnd: r.syllableEnd ?? r.syllable_end ?? null,
      });
    }
  }
  return out;
}

function extractStage2Invocations(paths) {
  const out = [];
  let inv = 0;
  for (const p of paths || []) {
    for (const r of p?.model3?.retry_recall_invocations || []) {
      inv += 1;
      const syllables = r.syllables || [];
      const pinyinKey =
        r.windowPinyinKey || (Array.isArray(syllables) ? syllables.join('|') : null) || null;
      out.push({
        invocationId: `s2|${r.retryRegionId || ''}|${inv}`,
        retryRegionId: r.retryRegionId || null,
        rawStart: r.spanStart ?? r.rawStart ?? null,
        rawEnd: r.spanEnd ?? r.rawEnd ?? null,
        sylStart: r.syllableStart ?? null,
        sylEnd: r.syllableEnd ?? null,
        pinyinKey: pinyinKey ? stripTone(pinyinKey) : null,
        syllables,
        querySource: r.querySource || null,
        mappingReason: r.mappingReason || null,
        candidateCount: r.candidateCount ?? (r.candidates || []).length,
        candidates: (r.candidates || []).map((c) => ({
          surface: c.surface,
          source: c.source,
        })),
      });
    }
  }
  return out;
}

function evaluateReachability(q, targetSurface, targetPinyin, lexMap) {
  const py = pinyinFamily(q.transformedPinyinKey, targetPinyin);
  if (!py.ok) {
    return { reachable: false, proof: 'TRANSFORMED_PINYIN_NOT_TARGET_FAMILY', pinyinRelation: py };
  }
  // Exact target key OR query contains complete target contiguous syllables.
  if (py.how === 'TARGET_CONTAINS_QUERY') {
    return { reachable: false, proof: 'TQ_WRONG_LENGTH_QUERY_SHORTER', pinyinRelation: py };
  }
  const hitSurface = (q.hits || []).some((h) => h.surface === targetSurface);
  const hitPinyin = (q.hits || []).some((h) => h.pinyin && pinyinFamily(h.pinyin, targetPinyin).ok);
  if (hitSurface || hitPinyin || lexiconHasPinyinSurface(lexMap, targetPinyin, targetSurface)) {
    return {
      reachable: true,
      proof: hitSurface
        ? 'EXACT_HIT_SURFACE'
        : hitPinyin
          ? 'HIT_PINYIN'
          : `LEXICON_COUNTERFACTUAL(${py.how})`,
      pinyinRelation: py,
      tqClass: py.how === 'EXACT' ? 'TQ_EXACT_CANONICAL' : 'TQ_FROZEN_RELATION_REACHABLE',
    };
  }
  return { reachable: false, proof: 'PINYIN_OK_BUT_LEXICON_MISS', pinyinRelation: py };
}

function deriveTargetGeometry(queries, targetPinyin, targetLen) {
  // Prefer exact transformed key geometry.
  const exact = queries.filter((q) => joinKey(splitKey(q.transformedPinyinKey)) === joinKey(splitKey(targetPinyin)));
  if (exact.length) {
    const q = exact[0];
    return {
      sylStart: q.sylStart,
      sylEnd: q.sylEnd,
      rawStart: q.rawStart,
      rawEnd: q.rawEnd,
      source: 'EXACT_TRANSFORMED_QUERY',
      proofQuery: q.invocationId,
    };
  }
  // Contain: slice offset within query.
  for (const q of queries) {
    const rel = pinyinFamily(q.transformedPinyinKey, targetPinyin);
    if (rel.ok && rel.how === 'QUERY_CONTAINS_TARGET') {
      return {
        sylStart: q.sylStart + rel.offset,
        sylEnd: q.sylStart + rel.offset + targetLen,
        rawStart: q.rawStart != null ? q.rawStart + rel.offset : null,
        rawEnd: q.rawStart != null ? q.rawStart + rel.offset + targetLen : null,
        source: 'CONTAIN_TRANSFORMED_QUERY_SLICE',
        proofQuery: q.invocationId,
      };
    }
  }
  // Observed window after relation would need transform; use observed exact length windows whose
  // observed pinyin is targetLen and phonetically near — weak fallback: any window with len==targetLen
  // overlapping reachable? If none, leave null → C1 may use length-only enumeration.
  return null;
}

function windowTargetLengthCompatible(w, targetGeom, targetLen) {
  if (w.sylStart == null || w.sylEnd == null) return false;
  const len = w.sylEnd - w.sylStart;
  if (len < targetLen) return false;
  if (!targetGeom) {
    // Without absolute target interval, length>=target is necessary but not sufficient.
    // Treat length==target or longer as candidate only when we later prove contain via pinyin.
    return len >= targetLen;
  }
  const g = geomVsTarget(w, targetGeom);
  return g === 'W_EXACT_TARGET' || g === 'W_CONTAINS_TARGET';
}

function classifyActionCapability(window, targetPinyin, targetGeom, queriesOnWindow, lexMap, targetSurface) {
  if (!queriesOnWindow.length) {
    if (!window.selectedActions?.length) return 'NO_ACTION';
    return 'ACTION_NOT_TARGET_REACHABLE'; // selected but no executed queries / empty
  }
  const any = queriesOnWindow.some((q) => evaluateReachability(q, targetSurface, targetPinyin, lexMap).reachable);
  if (any) return 'ACTION_TARGET_REACHABLE';
  return 'ACTION_NOT_TARGET_REACHABLE';
}

function attributeCase(ctx) {
  const {
    caseId,
    targetTerm,
    targetPinyin,
    targetLen,
    windows,
    queries,
    evidenceStore,
    retryRegions,
    stage2,
    lexMap,
  } = ctx;

  const notes = [];
  let secondaryObservation = '';

  // Derive target geometry from executed queries first.
  const targetGeom = deriveTargetGeometry(queries, targetPinyin, targetLen);

  const overlapping = windows.filter((w) => {
    if (w.sylStart == null || w.sylEnd == null) return false;
    if (!targetGeom) return w.sylEnd - w.sylStart >= targetLen;
    const g = geomVsTarget(w, targetGeom);
    return g !== 'W_DISJOINT' && g !== 'W_UNKNOWN';
  });

  const targetLenWindows = windows.filter((w) => windowTargetLengthCompatible(w, targetGeom, targetLen));
  // When no targetGeom yet, refine: windows whose observed/transformed can host target length
  // and later pinyin proof.
  let firstPassTargetWindowExists = targetLenWindows.length > 0;
  let firstPassTargetWindowGeometry = null;
  if (targetGeom) {
    const best =
      targetLenWindows.find((w) => geomVsTarget(w, targetGeom) === 'W_EXACT_TARGET') ||
      targetLenWindows.find((w) => geomVsTarget(w, targetGeom) === 'W_CONTAINS_TARGET') ||
      null;
    if (best) {
      firstPassTargetWindowGeometry = geomVsTarget(best, targetGeom);
    } else {
      firstPassTargetWindowExists = false;
    }
  } else {
    // No absolute geom: if any window length >= targetLen exists overlapping any executed query region, keep YES tentatively
    firstPassTargetWindowExists = windows.some((w) => (w.sylEnd ?? 0) - (w.sylStart ?? 0) >= targetLen);
    firstPassTargetWindowGeometry = firstPassTargetWindowExists ? 'W_LENGTH_OK_GEOM_UNANCHORED' : null;
  }

  const funnel = {
    cohort: true,
    targetLengthFirstPassWindow: false,
    model2Eligible: false,
    targetCapableAction: false,
    targetReachableTransformedQuery: false,
    firstPassRecallExecuted: false,
    evidenceEmitted: false,
    evidenceStored: false,
    retryCovers: false,
    stage2TargetWindow: false,
    mapperCanConsume: false,
    targetEvidenceSelected: false,
    reachedStage2Recall: false,
  };

  const rowBase = () => ({
    caseId,
    targetTerm,
    targetCanonicalPinyin: targetPinyin,
    targetRawGeometry: targetGeom ? `${targetGeom.rawStart}:${targetGeom.rawEnd}` : '',
    targetSyllableGeometry: targetGeom ? `${targetGeom.sylStart}:${targetGeom.sylEnd}` : '',
    targetGeomSource: targetGeom?.source || '',
    firstPassTargetWindowExists: firstPassTargetWindowExists ? 'YES' : 'NO',
    firstPassTargetWindowGeometry: firstPassTargetWindowGeometry || '',
    model2Eligible: '',
    model2Actions: '',
    relationTransform: '',
    targetReachableTransformedQueryExists: 'NO',
    firstPassRecallExecuted: 'NO',
    targetEvidenceEmitted: 'NO',
    targetEvidenceStored: 'NO',
    retryRegion: String(retryRegions.length),
    retryRegionCoversTarget: 'NO',
    stage2TargetWindowExists: 'NO',
    mapperCanConsumeTargetEvidence: 'NO',
    selectedEvidence: '',
    selectedPinyinKey: '',
    targetQueryReachedStage2Recall: 'NO',
    firstOwner: 'C16_UNRESOLVED',
    secondaryObservation: '',
    evidenceRefs: '',
    notes: '',
    funnel,
  });

  if (!firstPassTargetWindowExists) {
    // Check length-6 SSOT conflict
    const length6 = targetLen >= 6;
    const r = rowBase();
    r.firstOwner = 'C1_TARGET_LENGTH_WINDOW_NEVER_ENUMERATED';
    r.secondaryObservation = length6
      ? 'WINDOW_LENGTH_SSOT_CONFLICT_CANDIDATE_TARGET_LEN_GE_6'
      : overlapping.length
        ? 'OVERLAP_WINDOWS_EXIST_BUT_NONE_TARGET_LENGTH_COMPATIBLE'
        : 'NO_OVERLAPPING_FIRST_PASS_WINDOW';
    r.notes = `windows=${windows.length}; overlap=${overlapping.length}; targetLen=${targetLen}`;
    r.evidenceRefs = `windows:${windows.length}`;
    return r;
  }

  funnel.targetLengthFirstPassWindow = true;

  // Step B — Model2 eligibility on a target-length window
  const eligibleTargetWindows = targetLenWindows.filter((w) => {
    // Invoked Model2 OR has inference id; NOT_INVOKED with reason = not eligible
    if (w.notInvokedReason && !w.model2Invoked && w.pRetrievalStatus === 'NO_INFER') return false;
    if (w.reason && String(w.notInvokedReason).includes('NOT_INVOKED')) return false;
    return w.model2Invoked || w.pRetrievalStatus === 'EXECUTED' || w.pRetrievalStatus === 'NOT_EXECUTED';
  });
  // Refine: window entered expand and got model2_inference_id or explicit not-invoked reason
  const trulyEligible = targetLenWindows.filter((w) => w.model2Invoked || w.pRetrievalStatus === 'EXECUTED' || (w.pRetrievalStatus === 'NOT_EXECUTED' && w.selectedActions));
  const ineligibleOnly = targetLenWindows.filter((w) => !trulyEligible.includes(w) && w.notInvokedReason);

  let model2Eligible = trulyEligible.length > 0;
  // If target-length window exists in traces with any model2 presence, count eligible
  if (!model2Eligible && targetLenWindows.some((w) => w.pRetrievalStatus !== 'NO_INFER' || w.model2Invoked)) {
    model2Eligible = true;
  }
  // Windows that appear in model2.windows were passed to expandWindowsWithModel2 — they are the Model2 window set.
  // If they have reason NOT_INVOKED → C2. If they have inference → eligible.
  const invokedTarget = targetLenWindows.filter((w) => w.model2Invoked || w.selectedActions?.length || w.pRetrievalStatus === 'EXECUTED' || w.pRetrievalStatus === 'NOT_EXECUTED');
  const notInvokedTarget = targetLenWindows.filter((w) => w.notInvokedReason && !invokedTarget.includes(w));

  if (invokedTarget.length === 0 && notInvokedTarget.length > 0) {
    const r = rowBase();
    r.model2Eligible = 'NO';
    r.firstOwner = 'C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE';
    r.secondaryObservation = notInvokedTarget[0].notInvokedReason || 'NOT_INVOKED';
    r.notes = `targetLenWindows=${targetLenWindows.length}; notInvoked=${notInvokedTarget.length}`;
    return r;
  }
  if (invokedTarget.length === 0) {
    // Target-length windows present but none show Model2 activity — treat as C2 if windows lack inference
    const r = rowBase();
    r.model2Eligible = 'NO';
    r.firstOwner = 'C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE';
    r.secondaryObservation = 'TARGET_LENGTH_WINDOW_IN_TRACE_WITHOUT_MODEL2_INFER';
    return r;
  }

  funnel.model2Eligible = true;
  const r0 = rowBase();
  r0.model2Eligible = 'YES';
  r0.model2Actions = [
    ...new Set(invokedTarget.flatMap((w) => (w.selectedActions || []).map((a) => a.action_id || a))),
  ].join(';');

  // Step C/D — actions + transforms on target-length windows
  const queriesOnTargetWindows = queries.filter((q) =>
    invokedTarget.some(
      (w) =>
        w.sylStart === q.sylStart &&
        w.sylEnd === q.sylEnd &&
        (w.rawStart == null || w.rawStart === q.rawStart)
    )
  );
  // Broader: any query whose window geometry is target-length compatible
  const queriesOnCompat = queries.filter((q) =>
    windowTargetLengthCompatible(
      { sylStart: q.sylStart, sylEnd: q.sylEnd },
      targetGeom,
      targetLen
    )
  );

  const reachableAll = queries
    .map((q) => ({ q, r: evaluateReachability(q, targetTerm, targetPinyin, lexMap) }))
    .filter((x) => x.r.reachable);
  const reachableExact = reachableAll.filter(
    (x) => joinKey(splitKey(x.q.transformedPinyinKey)) === joinKey(splitKey(targetPinyin))
  );
  // For lifecycle "target-reachable query", require complete target key retrievable:
  // EXACT transformed key OR CONTAINS with contiguous target (frozen Recall can retrieve if query==key;
  // CONTAINS means the query itself is longer — Stage2 needs exact/subspan map).
  // Spec: "target-reachable only when it can legally retrieve the complete target term".
  // Exact key: YES. Contain superspan key: Recall of superspan may not return shorter term depending on lexicon —
  // E5 treated CONTAINS as reachable via lexicon counterfactual on target. Keep same:
  const targetReachableQueries = reachableAll;

  // Action capability: among target-length windows that ran Model2
  let actionClass = 'NO_ACTION';
  for (const w of invokedTarget) {
    const qs = queries.filter((q) => q.sylStart === w.sylStart && q.sylEnd === w.sylEnd);
    const cls = classifyActionCapability(w, targetPinyin, targetGeom, qs, lexMap, targetTerm);
    if (cls === 'ACTION_TARGET_REACHABLE') {
      actionClass = cls;
      break;
    }
    if (cls === 'ACTION_NOT_TARGET_REACHABLE') actionClass = cls;
  }
  // Also: reachable query may exist on a contain-window (W_CONTAINS_TARGET) — still target-capable
  if (targetReachableQueries.length && actionClass !== 'ACTION_TARGET_REACHABLE') {
    actionClass = 'ACTION_TARGET_REACHABLE';
  }

  r0.model2Actions = actionClass + (r0.model2Actions ? `|${r0.model2Actions}` : '');

  if (actionClass === 'NO_ACTION' || actionClass === 'ACTION_NOT_TARGET_REACHABLE') {
    const pool = (queriesOnCompat.length ? queriesOnCompat : queries).filter(
      (q) => splitKey(q.transformedPinyinKey).length === targetLen || splitKey(q.observedPinyinKey).length === targetLen
    );
    const scored = pool
      .map((q) => {
        const t = splitKey(q.transformedPinyinKey);
        const o = splitKey(q.observedPinyinKey);
        const tgt = splitKey(targetPinyin);
        if (t.length !== tgt.length) return null;
        let diffs = 0;
        let brokeCorrect = 0; // obs==tgt but transform≠tgt at position
        let independentResidual = 0; // transform≠tgt and obs≠tgt (unfixed)
        let relationOverApply = 0; // obs==tgt, transform≠tgt (global relation damage)
        for (let i = 0; i < tgt.length; i++) {
          if (t[i] !== tgt[i]) {
            diffs++;
            if (o[i] === tgt[i]) {
              brokeCorrect++;
              relationOverApply++;
            } else {
              independentResidual++;
            }
          }
        }
        return { q, diffs, brokeCorrect, independentResidual, relationOverApply, o, t };
      })
      .filter(Boolean)
      .sort((a, b) => a.diffs - b.diffs || a.relationOverApply - b.relationOverApply);

    if (!scored.length && actionClass === 'NO_ACTION') {
      r0.firstOwner = 'C3_MODEL2_ACTION_NOT_TARGET_REACHABLE';
      r0.secondaryObservation = 'NO_SAME_LENGTH_QUERY_ON_TARGET_COMPAT_WINDOW';
      return r0;
    }
    if (!scored.length) {
      r0.firstOwner = 'C3_MODEL2_ACTION_NOT_TARGET_REACHABLE';
      r0.secondaryObservation = 'ACTIONS_EXECUTED_BUT_NO_TARGET_LENGTH_TRANSFORM';
      r0.relationTransform = 'TRANSFORM_WRONG_LENGTH';
      return r0;
    }

    const best = scored[0];
    r0.relationTransform = 'TRANSFORM_NOT_TARGET_REACHABLE';
    r0.notes = `bestTransform=${best.q.transformedPinyinKey}; obs=${best.q.observedPinyinKey}; diffs=${best.diffs}; overApply=${best.relationOverApply}; indep=${best.independentResidual}; action=${best.q.actionId}`;

    // C4: global relation application damaged a syllable that already matched target
    // (intentional global apply makes query non-reachable), with no other residual — or
    // over-apply is the decisive first loss even if other diffs exist when overApply>=1 and
    // removing over-apply positions would yield exact target.
    if (best.relationOverApply > 0) {
      const repaired = [...best.t];
      for (let i = 0; i < best.o.length; i++) {
        if (best.o[i] === splitKey(targetPinyin)[i] && best.t[i] !== best.o[i]) {
          repaired[i] = best.o[i]; // undo over-apply
        }
      }
      if (joinKey(repaired) === joinKey(splitKey(targetPinyin))) {
        r0.firstOwner = 'C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE';
        r0.secondaryObservation = 'GLOBAL_RELATION_OVER_APPLICATION_BROKE_CORRECT_SYLLABLE';
        return r0;
      }
    }

    // C5: ≥1 independent non-profile ASR residual remains after transform
    if (best.independentResidual >= 1 && best.diffs >= 1) {
      r0.firstOwner = 'C5_COMPOUND_NON_PROFILE_ASR_ERROR';
      r0.secondaryObservation =
        best.diffs >= 2
          ? 'MULTI_SYLLABLE_RESIDUAL_AFTER_RELATION'
          : 'SINGLE_INDEPENDENT_NON_PROFILE_ASR_RESIDUAL';
      return r0;
    }

    // C4 residual without independent ASR (pure transform miss / wrong length family)
    if (best.diffs >= 1 && best.relationOverApply > 0) {
      r0.firstOwner = 'C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE';
      r0.secondaryObservation = 'RELATION_TRANSFORM_RESIDUAL';
      return r0;
    }

    r0.firstOwner = 'C3_MODEL2_ACTION_NOT_TARGET_REACHABLE';
    r0.secondaryObservation = 'NO_TARGET_REACHABLE_AFTER_SELECTED_ACTIONS';
    return r0;
  }

  funnel.targetCapableAction = true;

  if (!targetReachableQueries.length) {
    r0.firstOwner = 'C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE';
    r0.relationTransform = 'TRANSFORM_NOT_TARGET_REACHABLE';
    return r0;
  }

  funnel.targetReachableTransformedQuery = true;
  r0.targetReachableTransformedQueryExists = 'YES';
  r0.relationTransform = targetReachableQueries.some(
    (x) => joinKey(splitKey(x.q.transformedPinyinKey)) === joinKey(splitKey(targetPinyin))
  )
    ? 'TRANSFORM_EXACT_TARGET'
    : 'TRANSFORM_TARGET_REACHABLE';
  r0.firstPassRecallExecuted = 'YES';
  funnel.firstPassRecallExecuted = true;

  // Re-derive geom from reachable if needed
  const geom2 =
    targetGeom ||
    deriveTargetGeometry(
      targetReachableQueries.map((x) => x.q),
      targetPinyin,
      targetLen
    );
  if (geom2 && !targetGeom) {
    r0.targetRawGeometry = `${geom2.rawStart}:${geom2.rawEnd}`;
    r0.targetSyllableGeometry = `${geom2.sylStart}:${geom2.sylEnd}`;
    r0.targetGeomSource = geom2.source;
  }
  const tGeom = geom2 || targetGeom;

  // Target evidence: exact target key preferred; also superspan evidence that contains target key syllables
  const exactEvidence = evidenceStore.filter(
    (e) => joinKey(splitKey(e.pinyinKey)) === joinKey(splitKey(targetPinyin))
  );
  const containEvidence = evidenceStore.filter((e) => {
    const rel = pinyinFamily(e.pinyinKey, targetPinyin);
    return rel.ok && rel.how === 'QUERY_CONTAINS_TARGET';
  });
  const targetEvidence = exactEvidence.length ? exactEvidence : containEvidence;

  // Emission: if query executed and aligned, upsert should have stored — reconstruct proves emission
  const executedTargetQueries = targetReachableQueries.map((x) => x.q);
  const alignFail = executedTargetQueries.filter((q) => {
    const parts = splitKey(q.transformedPinyinKey);
    const span = (q.sylEnd ?? 0) - (q.sylStart ?? 0);
    return parts.length !== span || (q.rawEnd ?? 0) <= (q.rawStart ?? 0);
  });

  if (!targetEvidence.length) {
    if (alignFail.length === executedTargetQueries.length) {
      r0.firstOwner = 'C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED';
      r0.secondaryObservation = 'PINYIN_GEOMETRY_ALIGNMENT_REJECT';
      r0.targetEvidenceEmitted = 'NO';
      return r0;
    }
    // Executed reachable but not in reconstructed store — emission contradiction
    r0.firstOwner = 'C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED';
    r0.targetEvidenceEmitted = 'NO';
    return r0;
  }

  r0.targetEvidenceEmitted = 'YES';
  r0.targetEvidenceStored = 'YES';
  funnel.evidenceEmitted = true;
  funnel.evidenceStored = true;

  // Prefer evidence that is exact target key at target geometry
  const bestEvidence =
    exactEvidence.find((e) => tGeom && e.sylStart === tGeom.sylStart && e.sylEnd === tGeom.sylEnd) ||
    exactEvidence[0] ||
    containEvidence[0];

  // Step H — RetryRegion coverage of target query geometry (use bestEvidence interval)
  const evidenceInterval = {
    sylStart: bestEvidence.sylStart,
    sylEnd: bestEvidence.sylEnd,
    rawStart: bestEvidence.rawStart,
    rawEnd: bestEvidence.rawEnd,
  };
  // For contain evidence, also check coverage of sliced target geom
  const coverTarget = tGeom || evidenceInterval;
  const coveringRegions = retryRegions.filter((r) => {
    // Prefer syllable cover; fall back to raw
    if (r.sylStart != null && r.sylEnd != null && coverTarget.sylStart != null) {
      return coversInterval(r, coverTarget);
    }
    if (r.rawStart != null && r.rawEnd != null && coverTarget.rawStart != null) {
      return r.rawStart <= coverTarget.rawStart && r.rawEnd >= coverTarget.rawEnd;
    }
    return false;
  });

  r0.retryRegion = coveringRegions.map((r) => r.retryRegionId).join(';') || String(retryRegions.length);
  if (!coveringRegions.length) {
    const partial = retryRegions.filter((r) => {
      if (r.sylStart == null || coverTarget.sylStart == null) return false;
      return r.sylEnd > coverTarget.sylStart && coverTarget.sylEnd > r.sylStart;
    });
    r0.retryRegionCoversTarget = 'NO';
    r0.firstOwner = 'C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY';
    r0.secondaryObservation = partial.length
      ? `R_PARTIAL_TARGET_COVERAGE; retryRegions=${retryRegions.length}; evidence=${bestEvidence.sylStart}:${bestEvidence.sylEnd}:${bestEvidence.pinyinKey}`
      : `R_NO_TARGET_COVERAGE; retryRegions=${retryRegions.length}; evidence=${bestEvidence.sylStart}:${bestEvidence.sylEnd}:${bestEvidence.pinyinKey}`;
    r0.evidenceRefs = bestEvidence.fromInvocationId || '';
    return r0;
  }
  r0.retryRegionCoversTarget = 'YES';
  funnel.retryCovers = true;

  // Step I — Stage2 target-length window
  const stage2TargetWindows = stage2.filter((s) => {
    if (s.sylStart == null || s.sylEnd == null) return false;
    const len = s.sylEnd - s.sylStart;
    if (len !== targetLen) return false;
    if (!tGeom) return true;
    return s.sylStart === tGeom.sylStart && s.sylEnd === tGeom.sylEnd;
  });
  // Also accept Stage2 windows that exactly match exact evidence geometry
  const stage2ExactEvidenceWindows = stage2.filter(
    (s) =>
      exactEvidence.some((e) => e.sylStart === s.sylStart && e.sylEnd === s.sylEnd) ||
      (tGeom && s.sylStart === tGeom.sylStart && s.sylEnd === tGeom.sylEnd && s.sylEnd - s.sylStart === targetLen)
  );
  const stage2Compat = stage2TargetWindows.length ? stage2TargetWindows : stage2ExactEvidenceWindows;

  // Broader: any Stage2 window with length==targetLen overlapping coverTarget
  const stage2LenOk = stage2.filter((s) => {
    if (s.sylStart == null || s.sylEnd == null) return false;
    if (s.sylEnd - s.sylStart !== targetLen) return false;
    if (!tGeom) return true;
    return s.sylStart === tGeom.sylStart && s.sylEnd === tGeom.sylEnd;
  });

  if (!stage2LenOk.length && !stage2Compat.length) {
    // Check if any Stage2 window could be fed by contain-evidence via SUBSPAN to produce target
    const subspanCapable = stage2.filter((s) => {
      if (s.sylEnd - s.sylStart !== targetLen) return false;
      const mapped = mapEvidenceToStage2Window(evidenceStore, s);
      return mapped.mappedPinyinKey && joinKey(splitKey(mapped.mappedPinyinKey)) === joinKey(splitKey(targetPinyin));
    });
    if (!subspanCapable.length) {
      r0.stage2TargetWindowExists = 'NO';
      r0.firstOwner = 'C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED';
      r0.secondaryObservation = `stage2Invocs=${stage2.length}; targetLen=${targetLen}; tGeom=${tGeom ? `${tGeom.sylStart}:${tGeom.sylEnd}` : 'null'}`;
      return r0;
    }
    // subspanCapable windows exist
    stage2LenOk.push(...subspanCapable);
  }

  r0.stage2TargetWindowExists = 'YES';
  funnel.stage2TargetWindow = true;

  // Step J/K — mapper consumption on target-length Stage2 windows
  const targetWindowsForMap = stage2LenOk.length ? stage2LenOk : stage2Compat;
  let anyMapperConsume = false;
  let anySelectedTarget = false;
  let mapperFailReason = '';
  let selectedSample = null;
  let legalTargetButOtherChosen = false;

  for (const s of targetWindowsForMap) {
    const mapped = mapEvidenceToStage2Window(evidenceStore, s);
    const legalTarget = (mapped.legalCandidates || []).some(
      (c) => joinKey(splitKey(c.mapped)) === joinKey(splitKey(targetPinyin))
    );
    if (legalTarget || (mapped.mappedPinyinKey && joinKey(splitKey(mapped.mappedPinyinKey)) === joinKey(splitKey(targetPinyin)))) {
      anyMapperConsume = true;
    }
    if (mapped.mappedPinyinKey && joinKey(splitKey(mapped.mappedPinyinKey)) === joinKey(splitKey(targetPinyin))) {
      anySelectedTarget = true;
      selectedSample = { ...s, mapped };
    } else if (legalTarget && mapped.mappedPinyinKey && joinKey(splitKey(mapped.mappedPinyinKey)) !== joinKey(splitKey(targetPinyin))) {
      legalTargetButOtherChosen = true;
      selectedSample = { ...s, mapped };
    } else if (!mapped.mappedPinyinKey) {
      mapperFailReason = mapped.reason;
    }
  }

  // Cross-check actual Stage2 selected keys from runtime invocations on those windows
  const runtimeTargetReach = stage2.filter(
    (s) => s.pinyinKey && joinKey(splitKey(s.pinyinKey)) === joinKey(splitKey(targetPinyin))
  );

  if (!anyMapperConsume) {
    r0.mapperCanConsumeTargetEvidence = 'NO';
    r0.firstOwner = 'C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT';
    r0.secondaryObservation = mapperFailReason || 'MAPPER_NO_LEGAL_TARGET_MAPPING';
    r0.selectedPinyinKey = targetWindowsForMap[0]?.pinyinKey || '';
    return r0;
  }
  funnel.mapperCanConsume = true;
  r0.mapperCanConsumeTargetEvidence = 'YES';

  if (legalTargetButOtherChosen && !anySelectedTarget && !runtimeTargetReach.length) {
    r0.firstOwner = 'C12_EVIDENCE_SELECTION_POLICY';
    r0.selectedEvidence = selectedSample?.mapped?.winnerEvidence?.pinyinKey || '';
    r0.selectedPinyinKey = selectedSample?.mapped?.mappedPinyinKey || selectedSample?.pinyinKey || '';
    r0.secondaryObservation = 'TARGET_EVIDENCE_LEGAL_BUT_DETERMINISTIC_WINNER_OTHER';
    return r0;
  }

  if (runtimeTargetReach.length || anySelectedTarget) {
    const hit = runtimeTargetReach[0] || selectedSample;
    const key = hit.pinyinKey || hit.mapped?.mappedPinyinKey;
    const sylJoin = Array.isArray(hit.syllables) ? hit.syllables.join('|') : key;
    if (key && stripTone(sylJoin) !== stripTone(key) && hit.syllables) {
      r0.firstOwner = 'C13_STAGE2_QUERY_EXECUTION_CONTRADICTION';
      r0.selectedPinyinKey = key;
      r0.targetQueryReachedStage2Recall = 'NO';
      return r0;
    }
    r0.targetQueryReachedStage2Recall = 'YES';
    r0.selectedPinyinKey = key || '';
    r0.selectedEvidence = bestEvidence.pinyinKey;
    r0.firstOwner = 'C14_TARGET_QUERY_REACHED_STAGE2_RECALL';
    funnel.targetEvidenceSelected = true;
    funnel.reachedStage2Recall = true;
    r0.secondaryObservation = 'RECONCILE_WITH_PRIOR_QEV7_A1_A2';
    return r0;
  }

  // Mapper can consume and would select target on audit replay of mapper, but runtime Stage2 did not use that key
  if (anySelectedTarget) {
    r0.targetQueryReachedStage2Recall = 'YES';
    r0.firstOwner = 'C14_TARGET_QUERY_REACHED_STAGE2_RECALL';
    return r0;
  }

  // Mapper can legally consume target evidence on a Stage2 window, but actual runtime selected something else
  // without target being in legalCandidates winner — check runtime mappingReason
  const runtimeOnTargetWindows = stage2.filter((s) =>
    targetWindowsForMap.some((t) => t.sylStart === s.sylStart && t.sylEnd === s.sylEnd)
  );
  const runtimeSelectedOther = runtimeOnTargetWindows.filter(
    (s) => s.pinyinKey && joinKey(splitKey(s.pinyinKey)) !== joinKey(splitKey(targetPinyin))
  );
  if (runtimeSelectedOther.length && anyMapperConsume) {
    // Audit mapper says target would win on store — if runtime differs, selection/policy or store divergence
    const auditWouldWin = targetWindowsForMap.some((s) => {
      const m = mapEvidenceToStage2Window(evidenceStore, s);
      return m.mappedPinyinKey && joinKey(splitKey(m.mappedPinyinKey)) === joinKey(splitKey(targetPinyin));
    });
    if (auditWouldWin) {
      r0.firstOwner = 'C12_EVIDENCE_SELECTION_POLICY';
      r0.selectedPinyinKey = runtimeSelectedOther[0].pinyinKey;
      r0.secondaryObservation = 'AUDIT_MAPPER_WOULD_SELECT_TARGET_RUNTIME_DID_NOT';
      return r0;
    }
    r0.firstOwner = 'C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT';
    r0.secondaryObservation = 'RUNTIME_TARGET_WINDOW_PRESENT_BUT_MAPPER_PATH_NON_TARGET';
    r0.selectedPinyinKey = runtimeSelectedOther[0].pinyinKey;
    return r0;
  }

  r0.firstOwner = 'C16_UNRESOLVED';
  r0.notes = `reachable=${targetReachableQueries.length}; evidence=${targetEvidence.length}; stage2=${stage2.length}; stage2LenOk=${stage2LenOk.length}`;
  r0.secondaryObservation = secondaryObservation || 'FALLTHROUGH';
  return r0;
}

async function main() {
  const qev7 = parseCsv(fs.readFileSync(path.join(OUT, 'LINGUA_QEV7_CASE_ATTRIBUTION.csv'), 'utf8'));
  const cohort = qev7.filter(
    (r) =>
      r.condition === 'CORRECT_PROFILE' &&
      (r.firstOwner === 'A1_QUERY_NOT_TARGET_REACHABLE' ||
        r.firstOwner === 'A2_TARGET_GEOMETRY_NOT_COMPATIBLE')
  );
  const expected = 43;
  console.log('EXPECTED', expected, 'ACTUAL', cohort.length);
  if (cohort.length !== expected) {
    console.error('AUDIT_VALID=NO cohort mismatch');
    process.exit(2);
  }

  const cases = JSON.parse(
    '[' +
      fs
        .readFileSync(path.join(DS, 'cases', 'cases.jsonl'), 'utf8')
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

  const surfaces = cohort.map((r) => r.targetTerm || caseById[r.caseId]?.evaluationTargetSurface);
  const lexMap = preloadLexiconSurfaces(surfaces);
  console.log('lexMap', lexMap.size);

  const port = getTestServerPort();
  console.log('Starting Electron on', port);
  await startElectron();
  const ready = await waitTestServerHealth(port, 180000);
  if (!ready) {
    console.error('Server not healthy');
    process.exit(1);
  }

  const dumpPath = path.join(OUT, '_lifecycle_path_trace_dump.jsonl');
  fs.writeFileSync(dumpPath, '', 'utf8');

  const rows = [];
  for (const qrow of cohort) {
    const caseId = qrow.caseId;
    const caseRow = caseById[caseId];
    const m = manById[caseId];
    if (!caseRow || !m) {
      console.error('missing case/manifest', caseId);
      rows.push({
        caseId,
        firstOwner: 'C16_UNRESOLVED',
        notes: 'missing case or manifest',
        funnel: {},
      });
      continue;
    }
    const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
    const profile = JSON.parse(
      fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
    );
    const targetTerm = qrow.targetTerm || caseRow.evaluationTargetSurface;
    const targetPinyin = stripTone(qrow.targetCanonicalPinyin || qrow.lexiconStoredPinyin || '');
    const targetLen = splitKey(targetPinyin).length;
    const runId = `${caseId}_CORRECT_PROFILE`;
    const sessionId = `lifecycle-${runId}-${Date.now()}`;
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
    const paths = extractPaths(data);
    const windows = extractModel2Windows(paths);
    const queries = extractExecutedQueries(paths, caseId, runId);
    const evidenceStore = reconstructEvidenceStore(queries);
    const retryRegions = extractRetryRegions(paths);
    const stage2 = extractStage2Invocations(paths);

    fs.appendFileSync(
      dumpPath,
      JSON.stringify({
        caseId,
        windowCount: windows.length,
        queryCount: queries.length,
        evidenceCount: evidenceStore.length,
        retryCount: retryRegions.length,
        stage2Count: stage2.length,
        // Compact: keep reachable keys only in dump summary
      }) + '\n',
      'utf8'
    );

    const attributed = attributeCase({
      caseId,
      referenceText: qrow.referenceText || caseRow.referenceText,
      asrText: qrow.asrText || evidence.rawMergedAsrText,
      targetTerm,
      targetPinyin,
      targetLen,
      windows,
      queries,
      evidenceStore,
      retryRegions,
      stage2,
      lexMap,
    });
    attributed.referenceText = qrow.referenceText || caseRow.referenceText;
    attributed.asrText = qrow.asrText || evidence.rawMergedAsrText;
    attributed.priorOwner = qrow.firstOwner;
    attributed.windowCount = windows.length;
    attributed.queryCount = queries.length;
    attributed.evidenceCount = evidenceStore.length;
    attributed.retryCount = retryRegions.length;
    attributed.stage2Count = stage2.length;
    attributed.reachableCount = queries.filter(
      (q) => evaluateReachability(q, targetTerm, targetPinyin, lexMap).reachable
    ).length;
    rows.push(attributed);
    console.log(
      `${caseId} owner=${attributed.firstOwner} win=${windows.length} q=${queries.length} reach=${attributed.reachableCount} ev=${evidenceStore.length} rr=${retryRegions.length} s2=${stage2.length} tGeom=${attributed.targetSyllableGeometry}`
    );
  }

  // Funnel + matrices
  const ownerCounts = Object.fromEntries(OWNERS.map((o) => [o, 0]));
  for (const r of rows) ownerCounts[r.firstOwner] = (ownerCounts[r.firstOwner] || 0) + 1;

  const everExisted = rows.filter((r) => r.targetReachableTransformedQueryExists === 'YES').length;
  const evidenceExists = rows.filter((r) => r.targetEvidenceStored === 'YES').length;
  const evButRetryFail = rows.filter(
    (r) => r.targetEvidenceStored === 'YES' && r.firstOwner === 'C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY'
  ).length;
  const evRegionOkStage2Fail = rows.filter(
    (r) => r.targetEvidenceStored === 'YES' && r.retryRegionCoversTarget === 'YES' && r.firstOwner === 'C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED'
  ).length;
  const evStage2OkMapperFail = rows.filter(
    (r) =>
      r.targetEvidenceStored === 'YES' &&
      r.stage2TargetWindowExists === 'YES' &&
      r.firstOwner === 'C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT'
  ).length;

  const funnel = {
    phase: PHASE,
    date: new Date().toISOString().slice(0, 10),
    EXPECTED_CASES: 43,
    ACTUAL_CASES: rows.length,
    steps: [
      { name: 'CORRECT_PROFILE_residual_QEV7', count: rows.length },
      {
        name: 'target_length_first_pass_window_exists',
        count: rows.filter((r) => r.firstPassTargetWindowExists === 'YES').length,
        dropOwner: 'C1_TARGET_LENGTH_WINDOW_NEVER_ENUMERATED',
        drop: ownerCounts.C1_TARGET_LENGTH_WINDOW_NEVER_ENUMERATED,
      },
      {
        name: 'window_Model2_eligible',
        count: rows.filter((r) => r.model2Eligible === 'YES').length,
        dropOwner: 'C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE',
        drop: ownerCounts.C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE,
      },
      {
        name: 'target_capable_Model2_action',
        count: rows.filter((r) => r.funnel?.targetCapableAction).length,
        dropOwner: 'C3_MODEL2_ACTION_NOT_TARGET_REACHABLE',
        drop: ownerCounts.C3_MODEL2_ACTION_NOT_TARGET_REACHABLE,
      },
      {
        name: 'target_reachable_transformed_query',
        count: everExisted,
        dropOwners: [
          'C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE',
          'C5_COMPOUND_NON_PROFILE_ASR_ERROR',
        ],
        drop:
          ownerCounts.C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE +
          ownerCounts.C5_COMPOUND_NON_PROFILE_ASR_ERROR,
      },
      {
        name: 'first_pass_Recall_executed',
        count: rows.filter((r) => r.firstPassRecallExecuted === 'YES').length,
        dropOwner: 'C6_TARGET_QUERY_NOT_EXECUTED_FIRST_PASS',
        drop: ownerCounts.C6_TARGET_QUERY_NOT_EXECUTED_FIRST_PASS,
      },
      {
        name: 'RecallQueryEvidence_emitted',
        count: rows.filter((r) => r.targetEvidenceEmitted === 'YES').length,
        dropOwner: 'C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED',
        drop: ownerCounts.C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED,
      },
      {
        name: 'evidence_survives_store',
        count: evidenceExists,
        dropOwner: 'C8_EVIDENCE_STORE_LIFETIME_LOSS',
        drop: ownerCounts.C8_EVIDENCE_STORE_LIFETIME_LOSS,
      },
      {
        name: 'RetryRegion_fully_covers_target_query',
        count: rows.filter((r) => r.retryRegionCoversTarget === 'YES').length,
        dropOwner: 'C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY',
        drop: ownerCounts.C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY,
      },
      {
        name: 'target_length_Stage2_window_exists',
        count: rows.filter((r) => r.stage2TargetWindowExists === 'YES').length,
        dropOwner: 'C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED',
        drop: ownerCounts.C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED,
      },
      {
        name: 'mapper_can_legally_consume_target_evidence',
        count: rows.filter((r) => r.mapperCanConsumeTargetEvidence === 'YES').length,
        dropOwner: 'C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT',
        drop: ownerCounts.C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT,
      },
      {
        name: 'target_evidence_selected',
        count: rows.filter((r) => r.funnel?.targetEvidenceSelected || r.firstOwner === 'C14_TARGET_QUERY_REACHED_STAGE2_RECALL').length,
        dropOwner: 'C12_EVIDENCE_SELECTION_POLICY',
        drop: ownerCounts.C12_EVIDENCE_SELECTION_POLICY,
      },
      {
        name: 'target_query_reaches_Stage2_Recall',
        count: rows.filter((r) => r.targetQueryReachedStage2Recall === 'YES').length,
        dropOwners: [
          'C13_STAGE2_QUERY_EXECUTION_CONTRADICTION',
          'C14_TARGET_QUERY_REACHED_STAGE2_RECALL',
          'C15_OTHER_PROVEN',
          'C16_UNRESOLVED',
        ],
      },
    ],
    ownerCounts,
    TARGET_REACHABLE_QUERY_EVER_EXISTED_FIRST_PASS: `${everExisted}/43`,
    TARGET_REACHABLE_EVIDENCE_STORE_EXISTS: `${evidenceExists}/43`,
    TARGET_REACHABLE_EVIDENCE_BUT_RETRY_REGION_FAIL: evButRetryFail,
    TARGET_REACHABLE_EVIDENCE_AND_REGION_OK_BUT_STAGE2_WINDOW_FAIL: evRegionOkStage2Fail,
    TARGET_REACHABLE_EVIDENCE_AND_STAGE2_WINDOW_OK_BUT_MAPPER_FAIL: evStage2OkMapperFail,
  };

  const caseCsvHeader = [
    'caseId',
    'referenceText',
    'asrText',
    'targetTerm',
    'targetCanonicalPinyin',
    'targetRawGeometry',
    'targetSyllableGeometry',
    'firstPassTargetWindowExists',
    'firstPassTargetWindowGeometry',
    'model2Eligible',
    'model2Actions',
    'relationTransform',
    'targetReachableTransformedQueryExists',
    'firstPassRecallExecuted',
    'targetEvidenceEmitted',
    'targetEvidenceStored',
    'retryRegion',
    'retryRegionCoversTarget',
    'stage2TargetWindowExists',
    'mapperCanConsumeTargetEvidence',
    'selectedEvidence',
    'selectedPinyinKey',
    'targetQueryReachedStage2Recall',
    'firstOwner',
    'secondaryObservation',
    'evidenceRefs',
    'notes',
    'priorOwner',
    'windowCount',
    'queryCount',
    'reachableCount',
    'evidenceCount',
    'retryCount',
    'stage2Count',
  ];
  const caseCsv = [caseCsvHeader.join(',')];
  for (const r of rows) {
    caseCsv.push(
      caseCsvHeader
        .map((h) => csvEscape(r[h]))
        .join(',')
    );
  }

  const ownerMatrix = ['Owner,Count,Percent'];
  for (const o of OWNERS) {
    const c = ownerCounts[o] || 0;
    ownerMatrix.push(`${o},${c},${((100 * c) / rows.length).toFixed(1)}`);
  }
  ownerMatrix.push(`TOTAL,${rows.length},100`);

  const arch = {
    FINESPAN_WINDOW_OWNER: ownerCounts.C1_TARGET_LENGTH_WINDOW_NEVER_ENUMERATED,
    MODEL2_ELIGIBILITY_OWNER: ownerCounts.C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE,
    MODEL2_ACTION_OWNER: ownerCounts.C3_MODEL2_ACTION_NOT_TARGET_REACHABLE,
    RELATION_TRANSFORM_OWNER: ownerCounts.C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE,
    COMPOUND_ASR_OWNER: ownerCounts.C5_COMPOUND_NON_PROFILE_ASR_ERROR,
    FIRST_PASS_RECALL_EXECUTION_OWNER: ownerCounts.C6_TARGET_QUERY_NOT_EXECUTED_FIRST_PASS,
    QUERY_EVIDENCE_PRODUCER_OWNER: ownerCounts.C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED,
    QUERY_EVIDENCE_LIFETIME_OWNER: ownerCounts.C8_EVIDENCE_STORE_LIFETIME_LOSS,
    RETRY_REGION_GEOMETRY_OWNER: ownerCounts.C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY,
    STAGE2_WINDOW_ENUMERATION_OWNER: ownerCounts.C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED,
    QUERY_EVIDENCE_MAPPING_CONTRACT_OWNER: ownerCounts.C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT,
    EVIDENCE_SELECTION_OWNER: ownerCounts.C12_EVIDENCE_SELECTION_POLICY,
    STAGE2_EXECUTION_OWNER:
      ownerCounts.C13_STAGE2_QUERY_EXECUTION_CONTRADICTION +
      ownerCounts.C14_TARGET_QUERY_REACHED_STAGE2_RECALL,
    UNRESOLVED: ownerCounts.C15_OTHER_PROVEN + ownerCounts.C16_UNRESOLVED,
  };
  const archCsv = ['Boundary,Count', ...Object.entries(arch).map(([k, v]) => `${k},${v}`)];

  const inventory = [
    'path,action,product_runtime',
    'electron_node/electron-node/tests/audit-correct-profile-target-query-lifecycle.mjs,created,NO',
    'docs/user_correction/model3/LINGUA_CORRECT_PROFILE_TARGET_QUERY_LIFECYCLE_AUDIT.md,created,NO',
    'docs/user_correction/model3/LINGUA_CORRECT_PROFILE_TARGET_QUERY_CASES.csv,created,NO',
    'docs/user_correction/model3/LINGUA_CORRECT_PROFILE_TARGET_QUERY_FUNNEL.json,created,NO',
    'docs/user_correction/model3/LINGUA_CORRECT_PROFILE_TARGET_QUERY_OWNER_MATRIX.csv,created,NO',
    'docs/user_correction/model3/LINGUA_CORRECT_PROFILE_TARGET_QUERY_ARCHITECTURE_MATRIX.csv,created,NO',
    'docs/user_correction/model3/modified_file_inventory.csv,created,NO',
  ];

  fs.writeFileSync(path.join(OUT, 'LINGUA_CORRECT_PROFILE_TARGET_QUERY_CASES.csv'), caseCsv.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'LINGUA_CORRECT_PROFILE_TARGET_QUERY_FUNNEL.json'), JSON.stringify(funnel, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'LINGUA_CORRECT_PROFILE_TARGET_QUERY_OWNER_MATRIX.csv'), ownerMatrix.join('\n'), 'utf8');
  fs.writeFileSync(
    path.join(OUT, 'LINGUA_CORRECT_PROFILE_TARGET_QUERY_ARCHITECTURE_MATRIX.csv'),
    archCsv.join('\n'),
    'utf8'
  );
  fs.writeFileSync(path.join(OUT, 'modified_file_inventory.csv'), inventory.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT, '_lifecycle_rows.json'), JSON.stringify(rows, null, 2), 'utf8');

  // Decision
  const actionable = OWNERS.filter((o) => o !== 'C16_UNRESOLVED' && o !== 'C15_OTHER_PROVEN');
  let dominant = actionable[0];
  let dominantCount = 0;
  for (const o of actionable) {
    if ((ownerCounts[o] || 0) > dominantCount) {
      dominant = o;
      dominantCount = ownerCounts[o] || 0;
    }
  }

  const qevReopen =
    ownerCounts.C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED +
      ownerCounts.C8_EVIDENCE_STORE_LIFETIME_LOSS +
      ownerCounts.C13_STAGE2_QUERY_EXECUTION_CONTRADICTION >
    0;

  console.log('\nOWNER_MATRIX', ownerCounts);
  console.log('EVER_EXISTED', everExisted, 'EVIDENCE', evidenceExists);
  console.log('DOMINANT', dominant, dominantCount);
  console.log('QEV_REOPEN', qevReopen);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
