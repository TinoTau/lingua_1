/**
 * DIAGNOSTIC ONLY — exact first-pass / Stage2 query-window attribution for E5+Q1.
 * Does not change product semantics. Requires MODEL2_DIALOG200_TRACE=1 (set by harness).
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
const LEXICON_HELPER = path.join(__dirname, '_lexicon_cf_helper.py');

function stripTone(p) {
  return String(p || '')
    .toLowerCase()
    .replace(/[0-5]/g, '')
    .replace(/\s+/g, '');
}

function pinyinEqualOrSubspan(query, target) {
  const q = stripTone(query);
  const t = stripTone(target);
  if (!q || !t) return false;
  if (q === t) return { ok: true, how: 'EXACT' };
  const qs = q.split('|').filter(Boolean);
  const ts = t.split('|').filter(Boolean);
  if (!ts.length || qs.length < ts.length) return { ok: false };
  for (let i = 0; i <= qs.length - ts.length; i++) {
    if (qs.slice(i, i + ts.length).join('|') === ts.join('|')) {
      return { ok: true, how: 'QUERY_CONTAINS_TARGET_SUBSPAN' };
    }
  }
  for (let i = 0; i <= ts.length - qs.length; i++) {
    if (ts.slice(i, i + qs.length).join('|') === qs.join('|')) {
      return { ok: true, how: 'TARGET_CONTAINS_QUERY_SUBSPAN' };
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

/** Audit-only: preload surface→toneless pinyin keys via Python (UTF-8 files; no stdin CJK). */
function preloadLexiconSurfaces(surfaces) {
  const uniq = [...new Set(surfaces.filter(Boolean))];
  const inPath = path.join(OUT, '_attr_lexicon_surfaces_in.json');
  const outPath = path.join(OUT, '_attr_lexicon_surfaces_out.json');
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
  const want = stripTone(pinyinKey);
  return keys.includes(want);
}

function extractModel2Queries(paths, caseId, runId) {
  const out = [];
  let inv = 0;
  for (const p of paths || []) {
    const windows = p?.model2?.windows || p?.model2?.path_trace?.windows || [];
    // path may nest path_trace on model2
    const wins =
      windows.length > 0
        ? windows
        : p?.model2?.path_trace?.windows || [];
    for (const w of wins) {
      const win = w.window || {};
      const pr = w.p_retrieval;
      if (!pr || pr.status !== 'EXECUTED') continue;
      for (const q of pr.queries || []) {
        inv += 1;
        const invocationId = `${runId}|${w.window_id || win.window_id}|${q.action_id}|${q.pinyin_key}|${inv}`;
        out.push({
          invocationId,
          caseId,
          runId,
          pathId: p.path_id,
          windowId: w.window_id || win.window_id || null,
          originSpanId: q.origin_span_id || null,
          rawStart: q.raw_start ?? win.start ?? null,
          rawEnd: q.raw_end ?? win.end ?? null,
          sylStart: q.syllable_start ?? win.syllable_start ?? null,
          sylEnd: q.syllable_end ?? win.syllable_end ?? null,
          observedSurface: win.source_text || null,
          observedSyllables: q.observed_syllables || null,
          observedPinyinKey: q.observed_pinyin_key || win.phonetic_representation || null,
          model2Action: q.action_id || null,
          transformedSyllables: q.query_syllables || q.query || null,
          transformedPinyinKey: q.pinyin_key || null,
          tonePattern: pr.window_local_tone_pattern || w.window?.tone_representation || null,
          hitCount: (q.hits || []).length,
          hits: (q.hits || []).map((h) => ({
            termId: h.termId,
            surface: h.surface,
            pinyin: h.pinyin,
            domains: h.domains,
            source: h.source,
          })),
        });
      }
    }
  }
  return out;
}

function extractStage2Queries(paths, caseId, runId) {
  const out = [];
  let inv = 0;
  for (const p of paths || []) {
    for (const r of p?.model3?.retry_recall_invocations || []) {
      inv += 1;
      out.push({
        invocationId: `${runId}|s2|${r.retryRegionId || ''}|${r.ownerSpanId || ''}|${inv}`,
        caseId,
        runId,
        pathId: p.path_id,
        retryRegionId: r.retryRegionId || null,
        ownerSpanId: r.ownerSpanId || null,
        rawStart: r.spanStart ?? null,
        rawEnd: r.spanEnd ?? null,
        sylStart: r.syllableStart ?? null,
        sylEnd: r.syllableEnd ?? null,
        surface: r.windowText || r.spanSurface || null,
        syllables: r.syllables || null,
        pinyinKey: r.windowPinyinKey || (r.syllables || []).join('|') || null,
        recallMode: 'model3_retry_pinyin_domain_recovery',
        retainedDomains: r.retainedDomains || [],
        candidateCount: r.candidateCount ?? (r.candidates || []).length,
        candidates: (r.candidates || []).map((c) => ({
          surface: c.surface,
          source: c.source,
          domains: c.domains,
        })),
      });
    }
  }
  return out;
}

function geomRelation(a, b) {
  if (
    a.sylStart == null ||
    a.sylEnd == null ||
    b.sylStart == null ||
    b.sylEnd == null
  ) {
    return 'UNKNOWN';
  }
  if (a.sylStart === b.sylStart && a.sylEnd === b.sylEnd) return 'EXACT';
  if (a.sylStart >= b.sylStart && a.sylEnd <= b.sylEnd) return 'CONTAINED';
  if (a.sylStart <= b.sylStart && a.sylEnd >= b.sylEnd) return 'CONTAINS';
  if (a.sylEnd > b.sylStart && b.sylEnd > a.sylStart) return 'OVERLAP';
  return 'DISJOINT';
}

function evaluateReachability(q, targetSurface, targetPinyin, lexMap) {
  const py = pinyinEqualOrSubspan(q.transformedPinyinKey, targetPinyin);
  const hitSurface = (q.hits || []).some((h) => h.surface === targetSurface);
  const hitPinyin = (q.hits || []).some(
    (h) => h.pinyin && pinyinEqualOrSubspan(h.pinyin, targetPinyin).ok
  );
  let proof = null;
  let reachable = false;
  if (!py || py.ok !== true) {
    return {
      reachable: false,
      proof: hitSurface ? 'HIT_SURFACE_BUT_PINYIN_FAMILY_MISMATCH' : 'TRANSFORMED_PINYIN_NOT_TARGET_FAMILY',
      pinyinRelation: py,
    };
  }
  if (hitSurface) {
    reachable = true;
    proof = 'EXACT_HIT_SURFACE_ON_TRANSFORMED_QUERY';
  } else if (hitPinyin) {
    reachable = true;
    proof = 'HIT_PINYIN_ON_TRANSFORMED_QUERY';
  } else if (lexiconHasPinyinSurface(lexMap, targetPinyin, targetSurface)) {
    reachable = true;
    proof = `NO_TONE_COUNTERFACTUAL_LEXICON_HAS_TARGET(${py.how})`;
  } else {
    reachable = false;
    proof = 'PINYIN_FAMILY_OK_BUT_LEXICON_OR_HIT_MISSING';
  }
  return { reachable, proof, pinyinRelation: py };
}

async function main() {
  const e5Doc = JSON.parse(
    fs.readFileSync(path.join(OUT, 'LINGUA_STAGE2_TONE_RELAX_E5_TARGETED_RESULT.json'), 'utf8')
  );
  const e5Ids = e5Doc.cases.map((c) => c.caseId);
  const e5Meta = Object.fromEntries(e5Doc.cases.map((c) => [c.caseId, c]));

  const q1Prov = parseCsv(
    fs.readFileSync(path.join(OUT, 'LINGUA_STAGE2_QUERY_FAILURE_257_MATRIX.csv'), 'utf8')
  ).filter(
    (r) =>
      r.failureClass === 'Q1_MODEL2_QUERY_EVIDENCE_LOST' && r.condition === 'CORRECT_PROFILE'
  );
  const q1Ids = [...new Set(q1Prov.map((r) => r.caseId))];
  const q1Meta = Object.fromEntries(
    q1Prov.map((r) => [r.caseId, { target: r.target, targetPinyin: r.targetPinyin }])
  );

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

  const runIds = [...new Set([...e5Ids, ...q1Ids])];
  console.log(`Running exact attribution for ${runIds.length} unique cases (E5=${e5Ids.length}, Q1prov=${q1Ids.length})`);

  const surfacesForLex = runIds.map((id) => {
    const caseRow = caseById[id];
    return caseRow?.evaluationTargetSurface || e5Meta[id]?.target || q1Meta[id]?.target;
  });
  const lexMap = preloadLexiconSurfaces(surfacesForLex);
  console.log(`Lexicon preload surfaces=${surfacesForLex.filter(Boolean).length} mapSize=${lexMap.size}`);

  const port = getTestServerPort();
  console.log('Starting Electron…');
  await startElectron();
  const ready = await waitTestServerHealth(port, 180000);
  if (!ready) {
    console.error('Server not healthy');
    process.exit(1);
  }

  const caseResults = [];
  for (const caseId of runIds) {
    const caseRow = caseById[caseId];
    const m = manById[caseId];
    if (!caseRow || !m) {
      console.error('missing', caseId);
      continue;
    }
    const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
    const profile = JSON.parse(
      fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
    );
    const target =
      caseRow.evaluationTargetSurface || e5Meta[caseId]?.target || q1Meta[caseId]?.target;
    const targetPinyin = e5Meta[caseId]?.pinyin || q1Meta[caseId]?.targetPinyin || '';
    const runId = `${caseId}_CORRECT_PROFILE`;
    const sessionId = `attr-${runId}-${Date.now()}`;
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
    const m2Queries = extractModel2Queries(paths, caseId, runId);
    const s2Queries = extractStage2Queries(paths, caseId, runId);

    const annotated = m2Queries.map((q) => {
      const r = evaluateReachability(q, target, targetPinyin, lexMap);
      return { ...q, targetReachable: r.reachable, targetReachabilityProof: r.proof };
    });
    const reachable = annotated.filter((q) => q.targetReachable);

    // Stage2 target reachable?
    const s2Reach = s2Queries.filter((q) => {
      const py = pinyinEqualOrSubspan(q.pinyinKey, targetPinyin);
      const hit = (q.candidates || []).some((c) => c.surface === target);
      return py.ok || hit;
    });

    // Geometry: best reachable query vs any Stage2 window / retry region
    const mapping = [];
    for (const q of reachable) {
      let best = 'DISJOINT';
      let reuse = 'NOT_SAFE';
      for (const s of s2Queries) {
        const relSyl = geomRelation(
          { sylStart: q.sylStart, sylEnd: q.sylEnd },
          { sylStart: s.sylStart, sylEnd: s.sylEnd }
        );
        const relRaw =
          q.rawStart != null && s.rawStart != null
            ? (() => {
                const a = { s: q.rawStart, e: q.rawEnd };
                const b = { s: s.rawStart, e: s.rawEnd };
                if (a.s === b.s && a.e === b.e) return 'EXACT';
                if (a.s >= b.s && a.e <= b.e) return 'CONTAINED';
                if (a.s <= b.s && a.e >= b.e) return 'CONTAINS';
                if (a.e > b.s && b.e > a.s) return 'OVERLAP';
                return 'DISJOINT';
              })()
            : 'UNKNOWN';
        // Prefer syllable geometry (Stage2 ASR slice authority); fall back to raw.
        const use = relSyl !== 'UNKNOWN' ? relSyl : relRaw;
        if (use === 'EXACT') {
          best = 'EXACT';
          reuse = 'EXACT_REUSE';
          break;
        }
        if (use === 'CONTAINED' || use === 'CONTAINS') {
          best = use;
          reuse = 'SUBSPAN_REUSE';
        } else if (use === 'OVERLAP' && best === 'DISJOINT') {
          best = 'OVERLAP';
          reuse = 'RESEGMENT_MAP';
        }
      }
      if (s2Queries.length === 0) reuse = 'NOT_SAFE';
      else if (best === 'DISJOINT' && s2Queries.length) reuse = 'RESEGMENT_MAP';
      mapping.push({
        queryInvocationId: q.invocationId,
        transformedPinyin: q.transformedPinyinKey,
        geomVsStage2: best,
        reuseClass: reuse,
        stage2TargetReachableCount: s2Reach.length,
      });
    }

    const isE5 = e5Ids.includes(caseId);
    let e5Class = null;
    if (isE5) {
      if (annotated.length === 0) e5Class = 'E5-E';
      else if (reachable.length > 0) e5Class = 'E5-A';
      else if (annotated.length > 0) e5Class = 'E5-B';
      else e5Class = 'E5-E';
    }

    const row = {
      caseId,
      isE5,
      isQ1Provisional: q1Ids.includes(caseId),
      target,
      targetPinyin,
      asr: evidence.rawMergedAsrText,
      model2QueryCount: annotated.length,
      targetReachableQueryCount: reachable.length,
      targetReachableQueryIds: reachable.map((q) => q.invocationId),
      queries: annotated,
      stage2QueryCount: s2Queries.length,
      stage2TargetReachableQueryCount: s2Reach.length,
      stage2QueriesSample: s2Queries.slice(0, 8).map((q) => ({
        id: q.invocationId,
        pinyinKey: q.pinyinKey,
        surface: q.surface,
        n: q.candidateCount,
      })),
      geometryMappings: mapping,
      e5Class,
      finalText:
        data?.extra?.repairedText ||
        data?.extra?.spanAssemblyV4?.bestSentence ||
        data?.text_asr ||
        null,
    };
    caseResults.push(row);
    console.log(
      `${caseId} m2Q=${annotated.length} reach=${reachable.length} s2=${s2Queries.length} s2Reach=${s2Reach.length} class=${e5Class || '-'}`
    );
  }

  // E5 reconciliation
  const e5Rows = caseResults.filter((r) => r.isE5);
  const e5Counts = { 'E5-A': 0, 'E5-B': 0, 'E5-C': 0, 'E5-D': 0, 'E5-E': 0 };
  for (const r of e5Rows) {
    // E5-D: prior attribution defect if Gate-E claimed PINYIN_YES but no exact reachable query
    const gateE = JSON.parse(
      fs.readFileSync(path.join(OUT, 'LINGUA_GATE_E_FAILURE_CLASSIFICATION.json'), 'utf8')
    ).cases.find((c) => c.caseId === r.caseId && c.condition === 'CORRECT_PROFILE');
    const chosenPy = (gateE?.chosenQueries || []).map((q) => q.pinyin_key);
    const chosenMatches = chosenPy.some((p) => pinyinEqualOrSubspan(p, r.targetPinyin).ok);
    if (r.e5Class === 'E5-A' && gateE?.queryLegallyMatchesTarget?.startsWith('PINYIN_YES') && !chosenMatches) {
      // still E5-A (exact exists) but note prior chosen-window defect
      r.priorChosenWindowMisjoin = true;
    }
    if (r.e5Class === 'E5-B' && gateE?.queryLegallyMatchesTarget?.startsWith('PINYIN_YES')) {
      r.e5Class = 'E5-D'; // claimed reachable but exact invocations not reachable
      r.priorAttributionDefect = true;
    }
    e5Counts[r.e5Class] = (e5Counts[r.e5Class] || 0) + 1;
  }

  // Q1 revalidation
  const q1Rows = caseResults.filter((r) => r.isQ1Provisional);
  let q1Confirmed = 0;
  let q1Reclass = [];
  const geomCounts = {
    EXACT_REUSE: 0,
    SUBSPAN_REUSE: 0,
    SYLLABLE_MAP: 0,
    RESEGMENT_MAP: 0,
    NOT_SAFE: 0,
  };
  const q1Csv = [
    [
      'caseId',
      'target',
      'targetPinyin',
      'm2QueryCount',
      'reachableCount',
      's2Count',
      's2ReachCount',
      'q1Status',
      'destClass',
      'bestReuse',
      'reachablePinyins',
      'notes',
    ].join(','),
  ];
  for (const r of q1Rows) {
    const hasReach = r.targetReachableQueryCount > 0;
    const s2Miss = r.stage2TargetReachableQueryCount === 0;
    let status = 'RECLASSIFIED';
    let dest = 'Q2_TRANSFORMED_QUERY_STILL_UNREACHABLE';
    let bestReuse = '';
    if (hasReach && s2Miss && r.model2QueryCount > 0) {
      status = 'CONFIRMED';
      dest = 'Q1_MODEL2_QUERY_EVIDENCE_LOST';
      q1Confirmed += 1;
      const reuse = (r.geometryMappings[0] && r.geometryMappings[0].reuseClass) || 'RESEGMENT_MAP';
      bestReuse = reuse;
      geomCounts[reuse] = (geomCounts[reuse] || 0) + 1;
    } else if (!hasReach && r.model2QueryCount > 0) {
      dest = 'Q2_TRANSFORMED_QUERY_STILL_UNREACHABLE';
      q1Reclass.push({ caseId: r.caseId, dest });
    } else if (r.model2QueryCount === 0) {
      dest = 'Q6_NO_REUSABLE_FIRST_PASS_QUERY';
      q1Reclass.push({ caseId: r.caseId, dest });
    } else if (hasReach && !s2Miss) {
      dest = 'Q8_OTHER_PROVEN_STAGE2_ALREADY_REACHABLE';
      q1Reclass.push({ caseId: r.caseId, dest });
    } else {
      dest = 'Q8_OTHER_PROVEN';
      q1Reclass.push({ caseId: r.caseId, dest });
    }
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    q1Csv.push(
      [
        r.caseId,
        esc(r.target),
        r.targetPinyin,
        r.model2QueryCount,
        r.targetReachableQueryCount,
        r.stage2QueryCount,
        r.stage2TargetReachableQueryCount,
        status,
        dest,
        bestReuse,
        esc(r.queries.filter((q) => q.targetReachable).map((q) => q.transformedPinyinKey).join(';')),
        esc(r.e5Class || ''),
      ].join(',')
    );
  }

  const geomCsv = [
    [
      'caseId',
      'queryInvocationId',
      'transformedPinyin',
      'geomVsStage2',
      'reuseClass',
      'stage2TargetReachableCount',
    ].join(','),
  ];
  for (const r of caseResults) {
    for (const m of r.geometryMappings || []) {
      geomCsv.push(
        [
          r.caseId,
          `"${m.queryInvocationId}"`,
          m.transformedPinyin,
          m.geomVsStage2,
          m.reuseClass,
          m.stage2TargetReachableCount,
        ].join(',')
      );
    }
  }

  const e5Json = {
    phase: 'LINGUA_STAGE2_QUERY_EVIDENCE_FREEZE_AND_EXACT_ATTRIBUTION',
    date: new Date().toISOString().slice(0, 10),
    E5_TOTAL: e5Rows.length,
    counts: e5Counts,
    E5_RECONCILIATION: Object.values(e5Counts).reduce((a, b) => a + b, 0) === 35 ? 'PASS' : 'FAIL',
    note: 'Reachability evaluated per Model2 query invocation (transformed pinyinKey + geometry). Counterfactual no-Tone uses lexicon surface+pinyin presence only.',
    cases: e5Rows.map((r) => ({
      caseId: r.caseId,
      target: r.target,
      targetPinyin: r.targetPinyin,
      e5Class: r.e5Class,
      priorChosenWindowMisjoin: r.priorChosenWindowMisjoin || false,
      priorAttributionDefect: r.priorAttributionDefect || false,
      E5_EXACT_MODEL2_QUERY_COUNT: r.model2QueryCount,
      E5_TARGET_REACHABLE_QUERY_COUNT: r.targetReachableQueryCount,
      E5_TARGET_REACHABLE_QUERY_IDS: r.targetReachableQueryIds,
      E5_BEST_REUSABLE_QUERY_GEOMETRY: r.geometryMappings[0] || null,
      reachableQueries: r.queries
        .filter((q) => q.targetReachable)
        .map((q) => ({
          invocationId: q.invocationId,
          windowId: q.windowId,
          observedPinyinKey: q.observedPinyinKey,
          transformedPinyinKey: q.transformedPinyinKey,
          action: q.model2Action,
          rawStart: q.rawStart,
          rawEnd: q.rawEnd,
          sylStart: q.sylStart,
          sylEnd: q.sylEnd,
          proof: q.targetReachabilityProof,
          hitCount: q.hitCount,
        })),
      allTransformedPinyins: r.queries.map((q) => q.transformedPinyinKey),
      stage2TargetReachableQueryCount: r.stage2TargetReachableQueryCount,
    })),
  };

  fs.writeFileSync(path.join(OUT, 'LINGUA_E5_EXACT_QUERY_ATTRIBUTION_35.json'), JSON.stringify(e5Json, null, 2));
  fs.writeFileSync(path.join(OUT, 'LINGUA_Q1_EXACT_REVALIDATION_33.csv'), q1Csv.join('\n'));
  fs.writeFileSync(path.join(OUT, 'LINGUA_QUERY_GEOMETRY_MAPPING_MATRIX.csv'), geomCsv.join('\n'));

  const summary = {
    e5Counts,
    e5Total: e5Rows.length,
    q1Provisional: q1Rows.length,
    q1Confirmed,
    q1Reclassified: q1Reclass.length,
    q1ReclassDest: q1Reclass.reduce((a, x) => {
      a[x.dest] = (a[x.dest] || 0) + 1;
      return a;
    }, {}),
    geomCounts,
  };
  fs.writeFileSync(path.join(OUT, '_attr_scratch_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
