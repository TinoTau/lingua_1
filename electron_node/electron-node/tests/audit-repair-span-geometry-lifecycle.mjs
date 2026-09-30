/**
 * READ_ONLY — Repair span geometry lifecycle audit for 23 C9 cases.
 * CODE_FROZEN. No product changes.
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

function stripTone(p) {
  return String(p || '')
    .toLowerCase()
    .replace(/[0-5]/g, '');
}
function splitKey(k) {
  return stripTone(k)
    .split('|')
    .filter(Boolean);
}
function joinKey(parts) {
  return parts.join('|');
}
function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}
function sameGeom(a, b) {
  return a && b && a.sylStart === b.sylStart && a.sylEnd === b.sylEnd;
}
function covers(outer, inner) {
  return outer.sylStart <= inner.sylStart && outer.sylEnd >= inner.sylEnd;
}
function overlaps(a, b) {
  return a.sylEnd > b.sylStart && b.sylEnd > a.sylStart;
}
function pinyinFamily(query, target) {
  const qs = splitKey(query);
  const ts = splitKey(target);
  if (!qs.length || !ts.length) return { ok: false };
  if (joinKey(qs) === joinKey(ts)) return { ok: true, how: 'EXACT' };
  if (qs.length >= ts.length) {
    for (let i = 0; i <= qs.length - ts.length; i++) {
      if (joinKey(qs.slice(i, i + ts.length)) === joinKey(ts)) {
        return { ok: true, how: 'CONTAINS', offset: i };
      }
    }
  }
  return { ok: false };
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

function extractTargetQueries(paths, targetPinyin) {
  const out = [];
  const seen = new Set();
  for (const p of paths || []) {
    for (const w of p?.model2?.windows || []) {
      const win = w.window || {};
      const pr = w.p_retrieval;
      if (!pr || pr.status !== 'EXECUTED') continue;
      for (const q of pr.queries || []) {
        const rel = pinyinFamily(q.pinyin_key, targetPinyin);
        if (!rel.ok || rel.how === 'TARGET_CONTAINS') continue;
        // Prefer exact key; also allow CONTAINS
        const sylStart = q.syllable_start ?? win.syllable_start;
        const sylEnd = q.syllable_end ?? win.syllable_end;
        const rawStart = q.raw_start ?? win.start;
        const rawEnd = q.raw_end ?? win.end;
        const key = `${sylStart}|${sylEnd}|${stripTone(q.pinyin_key)}|${q.action_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          windowId: w.window_id || win.window_id,
          sylStart,
          sylEnd,
          rawStart,
          rawEnd,
          rawLength: rawEnd - rawStart,
          syllableLength: sylEnd - sylStart,
          observedPinyin: q.observed_pinyin_key || win.phonetic_representation,
          transformedPinyin: stripTone(q.pinyin_key),
          action: q.action_id,
          hitCount: (q.hits || []).length,
          hits: (q.hits || []).map((h) => h.surface),
          how: rel.how,
          exactKey: joinKey(splitKey(q.pinyin_key)) === joinKey(splitKey(targetPinyin)),
        });
      }
    }
  }
  // Prefer exact target key windows
  out.sort((a, b) => Number(b.exactKey) - Number(a.exactKey) || a.syllableLength - b.syllableLength);
  return out;
}

function analyzeCase(paths, targetPinyin, targetTerm) {
  const queries = extractTargetQueries(paths, targetPinyin);
  const exactQs = queries.filter((q) => q.exactKey);
  const primary = exactQs[0] || queries[0] || null;
  if (!primary) {
    return { error: 'NO_TARGET_REACHABLE_QUERY', queries: [] };
  }

  // Evidence identity (reconstructed): exact key preferred
  const evidenceGeom = {
    sylStart: primary.sylStart,
    sylEnd: primary.sylEnd,
    rawStart: primary.rawStart,
    rawEnd: primary.rawEnd,
    pinyin: primary.transformedPinyin,
  };

  // Aggregate across paths
  const allFinespans = [];
  const allDecisions = [];
  const allRegions = [];
  const afterM2Cands = [];
  const seenFs = new Set();
  const seenDec = new Set();
  const seenReg = new Set();
  const seenCand = new Set();

  for (const p of paths || []) {
    for (const s of p.finespans || []) {
      const key = `${s.span_id}|${s.syllable_start}|${s.syllable_end}`;
      if (seenFs.has(key)) continue;
      seenFs.add(key);
      allFinespans.push({
        spanId: s.span_id,
        sylStart: s.syllable_start,
        sylEnd: s.syllable_end,
        rawStart: s.start,
        rawEnd: s.end,
        sourceText: s.source_text,
        windowSource: s.window_source,
        selectionReason: s.selection_reason,
        candidateCount: s.candidate_count,
        phonetic: s.phonetic_representation,
        len: (s.syllable_end ?? 0) - (s.syllable_start ?? 0),
        rawLen: (s.end ?? 0) - (s.start ?? 0),
      });
    }
    for (const d of p?.model3?.decisions || []) {
      const key = `${d.spanId}|${d.decision}|${d.rawStart}|${d.rawEnd}`;
      if (seenDec.has(key)) continue;
      seenDec.add(key);
      // Resolve geometry from finespan if missing
      const fs = allFinespans.find((s) => s.spanId === d.spanId);
      allDecisions.push({
        spanId: d.spanId,
        decision: d.decision,
        surface: d.surface,
        sylStart: fs?.sylStart ?? d.syllableStart ?? null,
        sylEnd: fs?.sylEnd ?? d.syllableEnd ?? null,
        rawStart: d.rawStart ?? fs?.rawStart ?? null,
        rawEnd: d.rawEnd ?? fs?.rawEnd ?? null,
      });
    }
    for (const r of p?.model3?.retry_regions || []) {
      const key = `${r.retryRegionId}|${r.syllableStart}|${r.syllableEnd}`;
      if (seenReg.has(key)) continue;
      seenReg.add(key);
      allRegions.push({
        id: r.retryRegionId,
        sylStart: r.syllableStart,
        sylEnd: r.syllableEnd,
        rawStart: r.rawStart,
        rawEnd: r.rawEnd,
      });
    }
    for (const c of p?.after_model2_candidates?.items || []) {
      const key = `${c.syllableStart}|${c.syllableEnd}|${c.surface}|${c.pinyin}`;
      if (seenCand.has(key)) continue;
      seenCand.add(key);
      afterM2Cands.push({
        surface: c.surface,
        pinyin: c.pinyin,
        sylStart: c.syllableStart,
        sylEnd: c.syllableEnd,
        rawStart: c.rawStart,
        rawEnd: c.rawEnd,
        source: c.source,
      });
    }
  }

  // Same-geometry LexicalEdge proxy:
  // 1) After-Model2 candidate with exact same syl geometry (would enter edge bundle)
  // 2) OR finespan with same geometry and candidateCount>0 (selected edge existed)
  const sameGeomCands = afterM2Cands.filter((c) => sameGeom(c, evidenceGeom));
  const sameGeomFs = allFinespans.filter((s) => sameGeom(s, evidenceGeom));
  const sameGeomFsWithCands = sameGeomFs.filter((s) => (s.candidateCount || 0) > 0);
  const sameGeomFsFallback = sameGeomFs.filter(
    (s) => s.windowSource === 'fallback' || (s.candidateCount || 0) === 0
  );

  // Hit-based edge eligibility for exact evidence window
  const anyHitOnExactWindow = exactQs.some((q) => q.hitCount > 0);
  const anyCandOnExactGeom =
    sameGeomCands.length > 0 ||
    afterM2Cands.some(
      (c) =>
        sameGeom(c, evidenceGeom) ||
        (c.surface === targetTerm && sameGeom(c, evidenceGeom))
    );

  // LexicalEdge existence inference:
  // - If any PathFineSpan at exact geom with candidates → edge existed AND was selected on some path
  // - Else if after_m2 candidate at exact geom → edge could exist (may not be selected)
  // - Else if queries had hits at that geom → likely edge existed
  // - Else zero-hit evidence only → NO same-geometry LexicalEdge
  let lexicalEdgeExists = 'NO';
  let lexicalEdgeGeom = '';
  if (sameGeomFsWithCands.length) {
    lexicalEdgeExists = 'YES_SELECTED_ON_SOME_PATH';
    lexicalEdgeGeom = `${sameGeomFsWithCands[0].sylStart}:${sameGeomFsWithCands[0].sylEnd}`;
  } else if (anyCandOnExactGeom || anyHitOnExactWindow) {
    lexicalEdgeExists = 'POSSIBLE_BUT_NOT_ON_OBSERVED_PATHFINESPAN';
    lexicalEdgeGeom = `${evidenceGeom.sylStart}:${evidenceGeom.sylEnd}`;
  } else if (sameGeomFsFallback.length) {
    lexicalEdgeExists = 'FALLBACK_ONLY_EMPTY_CANDS';
    lexicalEdgeGeom = `${sameGeomFsFallback[0].sylStart}:${sameGeomFsFallback[0].sylEnd}`;
  }

  // Selected path geometry around evidence: finespans overlapping evidence
  const overlappingFs = allFinespans
    .filter((s) => overlaps(s, evidenceGeom))
    .sort((a, b) => a.sylStart - b.sylStart || a.sylEnd - b.sylEnd);

  // Unique coverage partition patterns near evidence
  const coveringExact = sameGeomFs.length > 0;
  const splitIntoSubspans = !coveringExact && overlappingFs.some((s) => s.len < evidenceGeom.sylEnd - evidenceGeom.sylStart);

  // Model3 on exact geom
  const decExact = allDecisions.filter((d) => sameGeom(d, evidenceGeom));
  const retryExact = decExact.filter((d) => d.decision === 'RETRY');
  const keepExact = decExact.filter((d) => d.decision === 'KEEP');

  // RETRY decisions overlapping evidence
  const retryOverlap = allDecisions.filter(
    (d) => d.decision === 'RETRY' && d.sylStart != null && overlaps(d, evidenceGeom)
  );
  const retryInside = retryOverlap.filter(
    (d) => d.sylStart >= evidenceGeom.sylStart && d.sylEnd <= evidenceGeom.sylEnd
  );

  // RetryRegion covering exact evidence
  const regionFull = allRegions.filter((r) => covers(r, evidenceGeom));
  const regionPartial = allRegions.filter((r) => overlaps(r, evidenceGeom) && !covers(r, evidenceGeom));

  // Length-changing candidates among after_m2 near evidence
  const lengthChanging = afterM2Cands.filter((c) => {
    if (!overlaps(c, evidenceGeom) && !sameGeom(c, evidenceGeom)) return false;
    const spanRawLen = (c.rawEnd ?? 0) - (c.rawStart ?? 0);
    const surfLen = String(c.surface || '').length;
    return spanRawLen > 0 && surfLen > 0 && spanRawLen !== surfLen;
  });

  // First divergence classification
  let firstClass = 'G11_UNRESOLVED';
  let firstStage = '';
  let replaceableSpanGeometry = '';
  let queryEvidenceStructurallyApplicable = 'NOT_PROVEN';
  let notes = '';

  const evLen = evidenceGeom.sylEnd - evidenceGeom.sylStart;

  if (lexicalEdgeExists === 'NO' || lexicalEdgeExists === 'FALLBACK_ONLY_EMPTY_CANDS' || (!anyHitOnExactWindow && !anyCandOnExactGeom && !sameGeomFsWithCands.length)) {
    // No same-geometry lexical edge with candidates
    if (!anyHitOnExactWindow && !anyCandOnExactGeom) {
      // Zero-hit QueryEvidence — never became repairable LexicalEdge
      firstClass = 'G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE';
      firstStage = 'LexicalEdge';
      // Also G8 flavor: evidence is search geometry only
      queryEvidenceStructurallyApplicable = 'NO';
      notes = 'Zero-hit (or no candidate) at exact evidence geometry → buildLexicalEdges skips; QueryEvidence is not repair authority';
      // Prefer G8 if we can prove evidence was never a replaceable span on selected path
      // G1 is the first divergence (window→edge). G8 is interpretive. Spec wants one class.
      // Use G1 as first divergence; mark structural applicability NO.
      replaceableSpanGeometry = overlappingFs.map((s) => `${s.sylStart}:${s.sylEnd}`).slice(0, 8).join('|') || 'NONE_OVERLAP';
    } else if (lexicalEdgeExists === 'POSSIBLE_BUT_NOT_ON_OBSERVED_PATHFINESPAN') {
      firstClass = 'G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY';
      firstStage = 'segmentation';
      queryEvidenceStructurallyApplicable = 'NO';
      notes = 'Candidates at evidence geometry observed, but no PathFineSpan with that exact geometry on traced paths';
      replaceableSpanGeometry = overlappingFs.map((s) => `${s.sylStart}:${s.sylEnd}`).slice(0, 8).join('|');
    } else {
      firstClass = 'G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE';
      firstStage = 'LexicalEdge';
      queryEvidenceStructurallyApplicable = 'NO';
      replaceableSpanGeometry = overlappingFs.map((s) => `${s.sylStart}:${s.sylEnd}`).slice(0, 8).join('|');
    }
  } else if (sameGeomFsWithCands.length === 0 && sameGeomFs.length === 0) {
    // Edge existed in candidate pool sense but not selected
    firstClass = 'G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY';
    firstStage = 'segmentation';
    queryEvidenceStructurallyApplicable = 'NO';
    notes = 'Evidence-geometry candidates existed; selected path uses other overlapping span(s)';
    replaceableSpanGeometry = overlappingFs.map((s) => `${s.sylStart}:${s.sylEnd}`).slice(0, 8).join('|');
  } else if (sameGeomFsWithCands.length > 0) {
    // Same geometry PathFineSpan exists
    if (retryExact.length > 0 && regionFull.length > 0) {
      firstClass = 'G7_NO_GEOMETRY_DIVERGENCE_BEFORE_RETRYREGION';
      firstStage = 'none_before_RetryRegion';
      queryEvidenceStructurallyApplicable = 'YES';
      replaceableSpanGeometry = `${evidenceGeom.sylStart}:${evidenceGeom.sylEnd}`;
      notes = 'Unexpected under prior C9 — reconcile';
    } else if (retryExact.length > 0 && regionFull.length === 0) {
      firstClass = 'G6_RETRY_PATHFINESPAN_GEOMETRY_CORRECT_BUT_RETRYREGION_CHANGES_IT';
      firstStage = 'RetryRegion';
      queryEvidenceStructurallyApplicable = 'YES';
      replaceableSpanGeometry = `${evidenceGeom.sylStart}:${evidenceGeom.sylEnd}`;
    } else if (retryExact.length === 0 && keepExact.length > 0) {
      firstClass = 'G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN';
      firstStage = 'Model3';
      // Actually KEEP on exact geom — Model3 did not RETRY the full geometry
      // Check if subset RETRY
      if (retryInside.length) {
        firstClass = 'G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN';
      }
      queryEvidenceStructurallyApplicable = 'MIXED';
      replaceableSpanGeometry = `${evidenceGeom.sylStart}:${evidenceGeom.sylEnd}`;
      notes = `exactGeom KEEP=${keepExact.length} RETRY=${retryExact.length}; retryInside=${retryInside.length}`;
    } else if (retryExact.length === 0) {
      // PathFineSpan exists but never got RETRY — maybe only on some paths without RETRY
      // Check split: multiple PFS covering evidence with subset RETRY
      const coveringSpans = allFinespans.filter((s) => covers(evidenceGeom, s) || sameGeom(s, evidenceGeom) || (s.sylStart >= evidenceGeom.sylStart && s.sylEnd <= evidenceGeom.sylEnd && overlaps(s, evidenceGeom)));
      const subspans = allFinespans.filter(
        (s) => s.sylStart >= evidenceGeom.sylStart && s.sylEnd <= evidenceGeom.sylEnd && s.len < evLen
      );
      if (subspans.length >= 2 && retryInside.length > 0 && retryInside.length < subspans.length) {
        firstClass = 'G5_TARGET_GEOMETRY_SPLIT_ACROSS_MULTIPLE_PATHFINESPANS_AND_ONLY_SUBSET_RETRY';
        firstStage = 'Model3';
      } else if (retryExact.length === 0 && sameGeomFsWithCands.length) {
        // Exact PFS exists; Model3 may not have RETRYed it on the paths we see
        firstClass = 'G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN';
        firstStage = 'Model3';
      }
      queryEvidenceStructurallyApplicable = sameGeomFsWithCands.length ? 'YES' : 'NO';
      replaceableSpanGeometry = `${evidenceGeom.sylStart}:${evidenceGeom.sylEnd}`;
      notes = `subspans=${subspans.length}; retryInside=${retryInside.length}`;
    }
  }

  // Refine: if no same-geom PFS but overlapping shorter PFS dominate → still G1/G2
  if (
    (firstClass === 'G11_UNRESOLVED' || firstClass.startsWith('G4')) &&
    sameGeomFsWithCands.length === 0 &&
    overlappingFs.length &&
    overlappingFs.every((s) => s.len < evLen)
  ) {
    if (anyCandOnExactGeom || anyHitOnExactWindow) {
      firstClass = 'G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY';
      firstStage = 'segmentation';
    } else {
      firstClass = 'G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE';
      firstStage = 'LexicalEdge';
    }
    queryEvidenceStructurallyApplicable = 'NO';
    replaceableSpanGeometry = overlappingFs.map((s) => `${s.sylStart}:${s.sylEnd}:${s.sourceText}`).slice(0, 6).join('|');
    notes = `Selected path uses shorter spans over evidence [${evidenceGeom.sylStart},${evidenceGeom.sylEnd}); evidence not a replaceable unit`;
  }

  // G8: when G1 and zero-hit — mark as structurally search-only (secondary note). Spec wants one class; keep G1.
  // If we want G8 when evidence never was repairable: use G8 when G1 + zero hit + selected path has only shorter spans
  if (
    firstClass === 'G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE' &&
    !anyHitOnExactWindow &&
    !anyCandOnExactGeom &&
    overlappingFs.length > 0 &&
    overlappingFs.every((s) => s.len < evLen)
  ) {
    firstClass = 'G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY';
    firstStage = 'LexicalEdge/segmentation';
    queryEvidenceStructurallyApplicable = 'NO';
    notes =
      'Target-length QueryEvidence preserved without LexicalEdge; selected path repair spans are shorter; length-invariant forbids applying 2+char evidence to 1-char repair span';
  }

  return {
    primary,
    exactQueryCount: exactQs.length,
    anyHitOnExactWindow,
    anyCandOnExactGeom,
    lexicalEdgeExists,
    lexicalEdgeGeom,
    sameGeomFsCount: sameGeomFs.length,
    sameGeomFsWithCands: sameGeomFsWithCands.length,
    overlappingFs: overlappingFs.slice(0, 12),
    decExact,
    retryExact: retryExact.length,
    keepExact: keepExact.length,
    retryInside: retryInside.map((d) => `${d.sylStart}:${d.sylEnd}`),
    regionFull: regionFull.length,
    regionPartial: regionPartial.length,
    lengthChangingCount: lengthChanging.length,
    lengthChangingSample: lengthChanging.slice(0, 3),
    firstClass,
    firstStage,
    replaceableSpanGeometry,
    queryEvidenceStructurallyApplicable,
    evidenceGeom,
    notes,
    funnel: {
      sameGeometryLexicalEdgeExists:
        lexicalEdgeExists === 'YES_SELECTED_ON_SOME_PATH' ||
        lexicalEdgeExists === 'POSSIBLE_BUT_NOT_ON_OBSERVED_PATHFINESPAN',
      sameGeometryEdgeSelected: sameGeomFsWithCands.length > 0,
      sameGeometryPathFineSpanExists: sameGeomFs.length > 0,
      sameGeometryPathFineSpanRetry: retryExact.length > 0,
      sameGeometryRetryRegionExists: regionFull.length > 0,
    },
  };
}

async function main() {
  const c9meta = JSON.parse(fs.readFileSync(path.join(OUT, '_retry_region_c9_case_rows.json'), 'utf8'));
  const life = JSON.parse(fs.readFileSync(path.join(OUT, '_lifecycle_rows.json'), 'utf8'));
  const lifeById = Object.fromEntries(life.map((r) => [r.caseId, r]));
  if (c9meta.length !== 23) {
    console.error('C9 meta != 23', c9meta.length);
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

  const port = getTestServerPort();
  let healthy = false;
  try {
    healthy = (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    healthy = false;
  }
  if (!healthy) {
    await startElectron();
    healthy = await waitTestServerHealth(port, 180000);
  }
  if (!healthy) throw new Error('not healthy');

  const rows = [];
  for (const meta of c9meta) {
    const caseId = meta.caseId;
    const lr = lifeById[caseId];
    const caseRow = caseById[caseId];
    const m = manById[caseId];
    const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
    const profile = JSON.parse(
      fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
    );
    const targetPinyin = stripTone(lr?.targetCanonicalPinyin || meta.evidencePinyin);
    const targetTerm = lr?.targetTerm || caseRow.evaluationTargetSurface;
    const sessionId = `geom-${caseId}-${Date.now()}`;
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
    const a = analyzeCase(paths, targetPinyin, targetTerm);
    if (a.error) {
      console.error(caseId, a.error);
      rows.push({
        caseId,
        firstGeometryDivergenceClass: 'G11_UNRESOLVED',
        notes: a.error,
      });
      continue;
    }
    const p = a.primary;
    const row = {
      caseId,
      referenceText: lr?.referenceText || caseRow.referenceText,
      asrText: lr?.asrText || evidence.rawMergedAsrText,
      targetTerm,
      targetWindowRawGeometry: `${p.rawStart}:${p.rawEnd}`,
      targetWindowSyllableGeometry: `${p.sylStart}:${p.sylEnd}`,
      queryEvidenceGeometry: `${a.evidenceGeom.sylStart}:${a.evidenceGeom.sylEnd}`,
      queryEvidencePinyin: a.evidenceGeom.pinyin,
      queryHitCount: p.hitCount,
      sameGeometryLexicalEdgeExists: a.lexicalEdgeExists,
      lexicalEdgeGeometry: a.lexicalEdgeGeom,
      selectedPathRelevantEdges: a.overlappingFs
        .map((s) => `${s.sylStart}:${s.sylEnd}:${s.sourceText}:c${s.candidateCount}`)
        .join('|'),
      selectedPathGeometry: a.overlappingFs.map((s) => `${s.sylStart}:${s.sylEnd}`).join('|'),
      pathFineSpans: a.overlappingFs
        .map((s) => `${s.spanId}:${s.sylStart}:${s.sylEnd}:${s.windowSource}`)
        .slice(0, 8)
        .join('|'),
      model3Decisions: [...a.decExact, ...a.retryInside.map((x) => ({ decision: 'RETRY_INSIDE', surface: x }))]
        .map((d) => `${d.decision}:${d.sylStart ?? ''}:${d.sylEnd ?? ''}:${d.surface || ''}`)
        .join('|'),
      retryPathFineSpans: a.retryInside.join('|'),
      retryRegion: `full=${a.regionFull};partial=${a.regionPartial}`,
      firstGeometryDivergenceStage: a.firstStage,
      firstGeometryDivergenceClass: a.firstClass,
      replaceableSpanGeometry: a.replaceableSpanGeometry,
      queryEvidenceStructurallyApplicable: a.queryEvidenceStructurallyApplicable,
      lengthInvariantSatisfied: 'NOT_PROVEN',
      lengthChangingNearEvidence: a.lengthChangingCount,
      anyHitOnExactWindow: a.anyHitOnExactWindow ? 'YES' : 'NO',
      funnel: a.funnel,
      evidenceRefs: `trace:${caseId}_CORRECT_PROFILE;priorC9:${meta.coverageClass}`,
      notes: a.notes,
    };
    rows.push(row);
    console.log(
      caseId,
      'ev',
      row.queryEvidenceGeometry,
      'hits',
      p.hitCount,
      'edge',
      a.lexicalEdgeExists,
      'class',
      a.firstClass,
      'appl',
      a.queryEvidenceStructurallyApplicable
    );
  }

  const gCounts = {};
  for (const r of rows) {
    gCounts[r.firstGeometryDivergenceClass] = (gCounts[r.firstGeometryDivergenceClass] || 0) + 1;
  }
  fs.writeFileSync(path.join(OUT, '_repair_span_geometry_rows.json'), JSON.stringify(rows, null, 2));
  console.log('GCOUNTS', gCounts, 'total', rows.length);
  console.log(
    'funnel',
    {
      edge: rows.filter((r) => r.funnel?.sameGeometryLexicalEdgeExists).length,
      selected: rows.filter((r) => r.funnel?.sameGeometryEdgeSelected).length,
      pfs: rows.filter((r) => r.funnel?.sameGeometryPathFineSpanExists).length,
      retry: rows.filter((r) => r.funnel?.sameGeometryPathFineSpanRetry).length,
      region: rows.filter((r) => r.funnel?.sameGeometryRetryRegionExists).length,
    }
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
