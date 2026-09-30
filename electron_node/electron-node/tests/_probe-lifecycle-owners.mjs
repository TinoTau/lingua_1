/**
 * Spot-check lifecycle attribution for C9 coverage + C5 classification.
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

async function postJson(port, route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  return res.json().catch(() => ({}));
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

const rows = JSON.parse(fs.readFileSync(path.join(OUT, '_lifecycle_rows.json'), 'utf8'));
const sampleC9 = rows.filter((r) => r.firstOwner.startsWith('C9')).slice(0, 3).map((r) => r.caseId);
const sampleC5 = rows.filter((r) => r.firstOwner.startsWith('C5')).slice(0, 3).map((r) => r.caseId);
const sampleC4 = rows.filter((r) => r.firstOwner.startsWith('C4')).map((r) => r.caseId);
console.log('samples', { sampleC9, sampleC5, sampleC4 });

const cases = JSON.parse(
  '[' + fs.readFileSync(path.join(DS, 'cases/cases.jsonl'), 'utf8').trim().split(/\r?\n/).join(',') + ']'
);
const caseById = Object.fromEntries(cases.map((c) => [c.caseId, c]));
const manifest = JSON.parse(
  fs.readFileSync(path.join(OUT, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json'), 'utf8')
);
const manById = Object.fromEntries(manifest.cases.map((c) => [c.caseId, c]));
const qev7 = fs
  .readFileSync(path.join(OUT, 'LINGUA_CORRECT_PROFILE_TARGET_QUERY_CASES.csv'), 'utf8')
  .split(/\r?\n/);

const port = getTestServerPort();
// Reuse server if healthy
let healthy = false;
try {
  const h = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
  healthy = h.ok;
} catch {
  healthy = false;
}
if (!healthy) {
  await startElectron();
  healthy = await waitTestServerHealth(port, 180000);
}
if (!healthy) throw new Error('not healthy');

for (const caseId of [...sampleC9, ...sampleC5, ...sampleC4]) {
  const caseRow = caseById[caseId];
  const m = manById[caseId];
  const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
  const profile = JSON.parse(
    fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
  );
  const row = rows.find((r) => r.caseId === caseId);
  const targetPinyin = row.targetCanonicalPinyin;
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
  const paths = data?.extra?.dialog200_path_trace;
  const arr = Array.isArray(paths) ? paths : paths?.paths || [];
  const regions = [];
  for (const p of arr) {
    for (const r of p?.model3?.retry_regions || []) regions.push(r);
  }
  const uniq = [];
  const seen = new Set();
  for (const r of regions) {
    const k = JSON.stringify(r);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  console.log('\n===', caseId, 'owner', row.firstOwner, 'tGeom', row.targetSyllableGeometry, 'target', targetPinyin);
  console.log('retryRegion keys sample', uniq[0] ? Object.keys(uniq[0]) : null);
  console.log(
    'regions',
    uniq.slice(0, 8).map((r) => ({
      id: r.retryRegionId || r.id,
      raw: [r.rawStart, r.rawEnd, r.start, r.end],
      syl: [r.syllableStart, r.syllableEnd, r.syllable_start, r.syllable_end],
      owner: r.ownerSpanId,
      text: r.regionText || r.text || r.surface,
    }))
  );
  // exact queries
  const exact = [];
  for (const p of arr) {
    for (const w of p?.model2?.windows || []) {
      for (const q of w?.p_retrieval?.queries || []) {
        if (stripTone(q.pinyin_key) === stripTone(targetPinyin)) {
          exact.push({
            win: w.window_id,
            py: q.pinyin_key,
            obs: q.observed_pinyin_key,
            action: q.action_id,
            syl: [q.syllable_start, q.syllable_end],
            raw: [q.raw_start, q.raw_end],
          });
        }
      }
    }
  }
  console.log('exactQueries', exact.length, exact.slice(0, 3));
  // stage2 around target
  const s2 = [];
  for (const p of arr) {
    for (const r of p?.model3?.retry_recall_invocations || []) {
      s2.push({
        syl: [r.syllableStart, r.syllableEnd],
        raw: [r.spanStart, r.spanEnd],
        key: r.windowPinyinKey || (r.syllables || []).join('|'),
        src: r.querySource,
        map: r.mappingReason,
        region: r.retryRegionId,
      });
    }
  }
  const t = row.targetSyllableGeometry.split(':').map(Number);
  const near = s2.filter((s) => s.syl[0] != null && s.syl[1] != null && s.syl[1] > t[0] && t[1] > s.syl[0]);
  console.log('stage2NearTarget', near.length, near.slice(0, 6));

  // For C5: show best transformed queries vs target
  if (row.firstOwner.startsWith('C5') || row.firstOwner.startsWith('C4')) {
    const qs = [];
    for (const p of arr) {
      for (const w of p?.model2?.windows || []) {
        if (w.p_retrieval?.status !== 'EXECUTED') continue;
        for (const q of w.p_retrieval.queries || []) {
          const parts = splitKey(q.pinyin_key);
          const tgt = splitKey(targetPinyin);
          if (parts.length === tgt.length) {
            let diffs = 0;
            for (let i = 0; i < parts.length; i++) if (parts[i] !== tgt[i]) diffs++;
            qs.push({
              py: q.pinyin_key,
              obs: q.observed_pinyin_key,
              action: q.action_id,
              diffs,
              syl: [q.syllable_start, q.syllable_end],
            });
          }
        }
      }
    }
    qs.sort((a, b) => a.diffs - b.diffs);
    console.log('bestSameLenTransforms', qs.slice(0, 5));
  }
}
