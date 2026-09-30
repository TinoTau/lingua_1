/**
 * Deep probe: Model2 hits vs WindowCandidates vs emittedEdges for G2 cases.
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
function joinKey(a) {
  return a.filter(Boolean).join('|');
}
function splitKey(k) {
  return stripTone(k)
    .split('|')
    .filter(Boolean);
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

async function probeOne(port, caseId, targetGeom, targetPinyin) {
  const cases = JSON.parse(
    '[' +
      fs
        .readFileSync(path.join(DS, 'cases/cases.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .join(',') +
      ']'
  );
  const caseRow = cases.find((c) => c.caseId === caseId);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(OUT, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json'), 'utf8')
  );
  const m = manifest.cases.find((c) => c.caseId === caseId);
  const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
  const profile = JSON.parse(
    fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
  );

  const sessionId = `deep-${caseId}-${Date.now()}`;
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
  const spanV4 = data?.extra?.fw_detector?.spanAssemblyV4 || {};
  const [es, ee] = targetGeom.split(':').map(Number);
  const targetKey = joinKey(splitKey(targetPinyin));

  // Exact-geometry queries + hits
  const exactQueries = [];
  const seenQ = new Set();
  for (const p of paths) {
    for (const w of p?.model2?.windows || []) {
      const win = w.window || {};
      for (const q of w.p_retrieval?.queries || []) {
        const qs = q.syllable_start ?? win.syllable_start;
        const qe = q.syllable_end ?? win.syllable_end;
        if (qs !== es || qe !== ee) continue;
        const k = `${w.window_id}|${q.pinyin_key}|${(q.hits || []).map((h) => h.surface).join(',')}`;
        if (seenQ.has(k)) continue;
        seenQ.add(k);
        exactQueries.push({
          windowId: w.window_id,
          winSyl: `${win.syllable_start}:${win.syllable_end}`,
          qSyl: `${qs}:${qe}`,
          pinyin: q.pinyin_key,
          observed: q.observed_pinyin_key,
          hitCount: (q.hits || []).length,
          hits: (q.hits || []).map((h) => ({
            surface: h.surface,
            pinyin: h.pinyin,
            termId: h.term_id ?? h.termId,
            kind: h.hit_kind ?? h.hitKind,
          })),
          pinyinMatchTarget: joinKey(splitKey(q.pinyin_key)) === targetKey,
        });
      }
    }
  }

  // Candidates at exact geom
  const exactCands = [];
  const seenC = new Set();
  for (const p of paths) {
    for (const c of p?.after_model2_candidates?.items || []) {
      if (c.syllableStart !== es || c.syllableEnd !== ee) continue;
      const k = `${c.surface}|${c.pinyin}|${c.source}`;
      if (seenC.has(k)) continue;
      seenC.add(k);
      exactCands.push(c);
    }
  }

  // Candidates with target surface anywhere
  const targetSurfCands = [];
  const seenT = new Set();
  for (const p of paths) {
    for (const c of p?.after_model2_candidates?.items || []) {
      if (!String(c.surface || '').includes(caseId === 'x' ? '' : '')) continue;
    }
  }

  // Use target term from geom rows
  const life = JSON.parse(fs.readFileSync(path.join(OUT, '_repair_span_geometry_rows.json'), 'utf8'));
  const prev = life.find((r) => r.caseId === caseId);
  const term = prev?.targetTerm;
  const termCands = [];
  const seenTerm = new Set();
  for (const p of paths) {
    for (const c of p?.after_model2_candidates?.items || []) {
      if (c.surface !== term) continue;
      const k = `${c.syllableStart}:${c.syllableEnd}|${c.surface}`;
      if (seenTerm.has(k)) continue;
      seenTerm.add(k);
      termCands.push({
        geom: `${c.syllableStart}:${c.syllableEnd}`,
        surface: c.surface,
        pinyin: c.pinyin,
        source: c.source,
      });
    }
  }

  // emittedEdges from spanV4
  const emitted = spanV4.emittedEdges || spanV4.emitted_edges || [];
  const emittedExact = (Array.isArray(emitted) ? emitted : []).filter((e) => {
    const s = e.syllableStart ?? e.syllable_start ?? e.start;
    const en = e.syllableEnd ?? e.syllable_end ?? e.end;
    return s === es && en === ee;
  });

  // model2PathTrace
  const m2pt = spanV4.model2PathTrace || spanV4.model2_path_trace || null;

  // PathFineSpans at exact
  const exactFs = [];
  for (const p of paths) {
    for (const s of p.finespans || []) {
      if (s.syllable_start === es && s.syllable_end === ee) {
        exactFs.push({ path: p.path_id, text: s.source_text, cands: s.candidate_count });
      }
    }
  }

  // Competing geoms overlapping
  const overlappingCandGeoms = new Map();
  for (const p of paths) {
    for (const c of p?.after_model2_candidates?.items || []) {
      if (c.syllableEnd <= es || ee <= c.syllableStart) continue;
      const g = `${c.syllableStart}:${c.syllableEnd}`;
      if (!overlappingCandGeoms.has(g)) overlappingCandGeoms.set(g, new Set());
      overlappingCandGeoms.get(g).add(c.surface);
    }
  }

  return {
    caseId,
    term,
    targetGeom,
    exactQueryCount: exactQueries.length,
    exactQueriesWithHits: exactQueries.filter((q) => q.hitCount > 0).length,
    exactQueries: exactQueries.slice(0, 8),
    exactCandCount: exactCands.length,
    exactCands: exactCands.slice(0, 8),
    termCandGeoms: termCands,
    emittedEdgesIsArray: Array.isArray(emitted),
    emittedEdgesCount: Array.isArray(emitted) ? emitted.length : typeof emitted,
    emittedExactCount: emittedExact.length,
    emittedExactSample: emittedExact.slice(0, 3),
    emittedSample0: Array.isArray(emitted) && emitted[0] ? Object.keys(emitted[0]) : null,
    model2PathTraceType: m2pt == null ? null : typeof m2pt,
    model2PathTraceKeys: m2pt && typeof m2pt === 'object' ? Object.keys(m2pt).slice(0, 30) : null,
    exactFsCount: exactFs.length,
    overlappingCandGeoms: [...overlappingCandGeoms.entries()].map(([g, s]) => ({
      g,
      surfaces: [...s].slice(0, 5),
    })),
    latticeTrace: spanV4.latticeTrace || null,
  };
}

async function main() {
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

  const life = JSON.parse(fs.readFileSync(path.join(OUT, '_repair_span_geometry_rows.json'), 'utf8'));
  const g2 = life.filter((r) => String(r.firstGeometryDivergenceClass || '').startsWith('G2'));

  const results = [];
  for (const r of g2) {
    const one = await probeOne(port, r.caseId, r.queryEvidenceGeometry, r.queryEvidencePinyin);
    results.push(one);
    console.log(
      JSON.stringify(
        {
          caseId: one.caseId,
          term: one.term,
          exactQHits: one.exactQueriesWithHits,
          exactCands: one.exactCandCount,
          termGeoms: one.termCandGeoms,
          emittedExact: one.emittedExactCount,
          emittedCount: one.emittedEdgesCount,
          exactFs: one.exactFsCount,
          overlapGeoms: one.overlappingCandGeoms.map((x) => x.g),
        },
        null,
        2
      )
    );
  }

  fs.writeFileSync(path.join(OUT, '_g2_deep_probe.json'), JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
