/**
 * Prove whether Model2 materialized target-geometry candidates into the
 * pre-LexicalEdge union (union_before_budget), independent of path selection.
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

  const results = [];
  for (const prev of g2) {
    const caseId = prev.caseId;
    const caseRow = caseById[caseId];
    const m = manById[caseId];
    const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
    const profile = JSON.parse(
      fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
    );
    const [es, ee] = String(prev.queryEvidenceGeometry).split(':').map(Number);

    const sessionId = `union-${caseId}-${Date.now()}`;
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
    // model2 path_trace is duplicated on each path; take first with union
    let unionItems = [];
    let model2Summary = null;
    let pAdded = null;
    let windowExact = null;
    for (const p of paths) {
      const m2 = p.model2 || {};
      if (m2.union?.union_before_budget?.items) {
        unionItems = m2.union.union_before_budget.items;
        model2Summary = p.model2_summary || null;
        pAdded = m2.union?.p_added_count ?? null;
        // find window 11:14 style
        for (const w of m2.windows || []) {
          const win = w.window || {};
          if (win.syllable_start === es && win.syllable_end === ee) {
            windowExact = {
              windowId: w.window_id,
              p_retrieval: w.p_retrieval,
              base_count: w.base_candidates?.total ?? w.base_candidates?.items?.length,
              profile_p: (w.p_retrieval?.queries || []).map((q) => ({
                pinyin: q.pinyin_key,
                hits: (q.hits || []).map((h) => h.surface),
              })),
            };
          }
        }
        break;
      }
    }

    const unionExact = unionItems.filter(
      (c) => c.syllableStart === es && c.syllableEnd === ee
    );
    const unionTerm = unionItems.filter((c) => c.surface === prev.targetTerm);
    const unionGeoms = [...new Set(unionItems.map((c) => `${c.syllableStart}:${c.syllableEnd}`))];

    // emittedEdges with exact geom
    const emitted = data?.extra?.fw_detector?.spanAssemblyV4?.emittedEdges || [];
    const emittedExact = emitted.filter(
      (e) =>
        (e.syllableStart ?? e.syllable_start) === es &&
        (e.syllableEnd ?? e.syllable_end) === ee
    );

    // Also scan poolBeforeDrop / poolAfterDrop / recallHits if present
    const spanV4 = data?.extra?.fw_detector?.spanAssemblyV4 || {};
    const poolBefore = spanV4.poolBeforeDrop || [];
    const poolAfter = spanV4.poolAfterDrop || [];
    const poolBeforeExact = (Array.isArray(poolBefore) ? poolBefore : []).filter(
      (c) =>
        (c.syllableStart ?? c.syllable_start) === es &&
        (c.syllableEnd ?? c.syllable_end) === ee
    );
    const poolAfterExact = (Array.isArray(poolAfter) ? poolAfter : []).filter(
      (c) =>
        (c.syllableStart ?? c.syllable_start) === es &&
        (c.syllableEnd ?? c.syllable_end) === ee
    );

    const row = {
      caseId,
      term: prev.targetTerm,
      geom: `${es}:${ee}`,
      unionTotal: unionItems.length,
      unionExactCount: unionExact.length,
      unionExactSurfaces: unionExact.map((c) => c.surface),
      unionTermGeoms: unionTerm.map((c) => `${c.syllableStart}:${c.syllableEnd}:${c.surface}`),
      pAdded,
      model2Summary,
      windowExact,
      emittedExactCount: emittedExact.length,
      poolBeforeExactCount: poolBeforeExact.length,
      poolAfterExactCount: poolAfterExact.length,
      poolBeforeExactSample: poolBeforeExact.slice(0, 3),
      overlappingUnionGeoms: unionGeoms.filter((g) => {
        const [a, b] = g.split(':').map(Number);
        return b > es && ee > a;
      }),
    };
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  fs.writeFileSync(path.join(OUT, '_g2_union_probe.json'), JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
