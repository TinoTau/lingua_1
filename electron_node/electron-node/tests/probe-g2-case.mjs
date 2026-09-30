/**
 * Probe one G2 case: dump candidate geometries + model2 hits + latticeTrace.
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
  const caseId = process.argv[2] || 'p2_u001_003';
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

  const sessionId = `probe-${caseId}-${Date.now()}`;
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
  const fw = data?.extra?.fw_detector || {};
  const spanV4 = fw.spanAssemblyV4 || {};
  const latticeTrace = spanV4.latticeTrace || null;

  // Collect all candidate geometries
  const geomMap = new Map();
  for (const p of paths) {
    for (const c of p?.after_model2_candidates?.items || []) {
      const key = `${c.syllableStart}:${c.syllableEnd}`;
      if (!geomMap.has(key)) geomMap.set(key, { surfaces: new Set(), n: 0, sample: c });
      const g = geomMap.get(key);
      g.surfaces.add(c.surface);
      g.n += 1;
    }
  }

  // Model2 windows near target
  const windows = [];
  for (const p of paths) {
    for (const w of p?.model2?.windows || []) {
      const win = w.window || {};
      windows.push({
        id: w.window_id,
        syl: `${win.syllable_start}:${win.syllable_end}`,
        raw: `${win.start}:${win.end}`,
        text: win.text,
        status: w.p_retrieval?.status,
        queries: (w.p_retrieval?.queries || []).map((q) => ({
          pinyin: q.pinyin_key,
          syl: `${q.syllable_start}:${q.syllable_end}`,
          hits: (q.hits || []).map((h) => h.surface),
          hitCount: (q.hits || []).length,
        })),
      });
    }
  }

  // Finespans near 11
  const fines = [];
  for (const p of paths) {
    for (const s of p.finespans || []) {
      if (s.syllable_end > 10 && s.syllable_start < 15) {
        fines.push({
          path: p.path_id,
          geom: `${s.syllable_start}:${s.syllable_end}`,
          text: s.source_text,
          cands: s.candidate_count,
          src: s.window_source,
        });
      }
    }
  }

  const out = {
    caseId,
    pathCount: paths.length,
    latticeTrace,
    spanV4Keys: Object.keys(spanV4 || {}),
    fwKeys: Object.keys(fw || {}).slice(0, 40),
    candidateGeoms: [...geomMap.entries()].map(([k, v]) => ({
      geom: k,
      n: v.n,
      surfaces: [...v.surfaces],
      sampleKeys: Object.keys(v.sample || {}),
    })),
    windowsAround: windows.filter((w) => {
      const [a, b] = w.syl.split(':').map(Number);
      return b > 10 && a < 15;
    }),
    finesNear: fines.slice(0, 40),
    firstPathKeys: paths[0] ? Object.keys(paths[0]) : [],
    afterModel2Sample: paths[0]?.after_model2_candidates?.items?.[0] || null,
  };

  fs.writeFileSync(path.join(OUT, `_g2_probe_${caseId}.json`), JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        pathCount: paths.length,
        latticeTrace,
        candGeomCount: geomMap.size,
        candGeoms: [...geomMap.keys()].sort(),
        has11_14: geomMap.has('11:14'),
        windowsAround: out.windowsAround.length,
        finesNearUnique: [...new Set(fines.map((f) => f.geom))],
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
