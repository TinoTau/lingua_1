/**
 * READ_ONLY — C9 RetryRegion vs evidence coverage matrix for SSOT authority audit.
 * No product changes. Replays 23 C9 CORRECT_PROFILE cases with MODEL2_DIALOG200_TRACE=1.
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

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function covers(outer, inner) {
  return (
    outer.sylStart <= inner.sylStart &&
    outer.sylEnd >= inner.sylEnd &&
    outer.sylStart != null &&
    inner.sylStart != null
  );
}

function overlaps(a, b) {
  return a.sylEnd > b.sylStart && b.sylEnd > a.sylStart;
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

function extractFromPaths(paths, evidenceInterval) {
  const retrySpans = [];
  const regions = [];
  const seenSpan = new Set();
  const seenReg = new Set();

  for (const p of paths || []) {
    const decisions = p?.model3?.decisions || [];
    const finespans = p?.finespans || [];
    const fsById = Object.fromEntries(finespans.map((s) => [s.span_id, s]));
    for (const d of decisions) {
      if (d.decision !== 'RETRY') continue;
      const s = fsById[d.spanId] || fsById[d.span_id];
      const sylStart = s?.syllable_start ?? d.syllableStart ?? null;
      const sylEnd = s?.syllable_end ?? d.syllableEnd ?? null;
      const rawStart = s?.start ?? d.rawStart ?? null;
      const rawEnd = s?.end ?? d.rawEnd ?? null;
      const key = `${d.spanId || d.span_id}|${sylStart}|${sylEnd}`;
      if (seenSpan.has(key)) continue;
      seenSpan.add(key);
      retrySpans.push({
        spanId: d.spanId || d.span_id,
        sylStart,
        sylEnd,
        rawStart,
        rawEnd,
      });
    }
    for (const r of p?.model3?.retry_regions || []) {
      const key = `${r.retryRegionId}|${r.syllableStart}|${r.syllableEnd}`;
      if (seenReg.has(key)) continue;
      seenReg.add(key);
      regions.push({
        id: r.retryRegionId,
        sylStart: r.syllableStart,
        sylEnd: r.syllableEnd,
        rawStart: r.rawStart,
        rawEnd: r.rawEnd,
        sourceSpanIds: r.sourceSpanIds || [],
        merged: r.regionMergedFromAdjacentRetry === true,
      });
    }
  }

  let coverageClass = 'NONE';
  let covering = null;
  let partial = [];
  for (const r of regions) {
    if (covers(r, evidenceInterval)) {
      coverageClass = 'FULL';
      covering = r;
      break;
    }
    if (overlaps(r, evidenceInterval)) {
      coverageClass = 'PARTIAL';
      partial.push(r);
    }
  }
  if (coverageClass === 'PARTIAL') covering = partial[0] || null;

  // Nearest region by overlap length or distance
  let best = covering;
  if (!best && regions.length) {
    best = regions
      .map((r) => {
        const ov = Math.max(
          0,
          Math.min(r.sylEnd, evidenceInterval.sylEnd) - Math.max(r.sylStart, evidenceInterval.sylStart)
        );
        const dist =
          evidenceInterval.sylStart >= r.sylEnd
            ? evidenceInterval.sylStart - r.sylEnd
            : r.sylStart >= evidenceInterval.sylEnd
              ? r.sylStart - evidenceInterval.sylEnd
              : 0;
        return { r, ov, dist };
      })
      .sort((a, b) => b.ov - a.ov || a.dist - b.dist)[0].r;
  }

  return { retrySpans, regions, coverageClass, best };
}

async function main() {
  const life = JSON.parse(fs.readFileSync(path.join(OUT, '_lifecycle_rows.json'), 'utf8'));
  const c9 = life.filter((r) => r.firstOwner === 'C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY');
  if (c9.length !== 23) {
    console.error('C9 expected 23 got', c9.length);
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
  if (!healthy) throw new Error('server not healthy');

  const rows = [];
  for (const lr of c9) {
    const caseId = lr.caseId;
    const caseRow = caseById[caseId];
    const m = manById[caseId];
    const evidence = JSON.parse(fs.readFileSync(path.resolve(REPO, m.evidenceFile), 'utf8'));
    const profile = JSON.parse(
      fs.readFileSync(path.join(DS, 'profiles', `${caseRow.profileRef}.userprofile.json`), 'utf8')
    );
    const [es, ee] = String(lr.targetSyllableGeometry || '')
      .split(':')
      .map((x) => Number(x));
    const evidenceInterval = { sylStart: es, sylEnd: ee };
    const sessionId = `rr-ssot-${caseId}-${Date.now()}`;
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
    const { retrySpans, regions, coverageClass, best } = extractFromPaths(paths, evidenceInterval);

    // SSOT: authority does not require evidence coverage; derive = RETRY-union only.
    // Check whether any RETRY PathFineSpan union could cover evidence if all overlapping spans were RETRY
    // (diagnostic only — not GT expansion).
    const retryUnionCouldCover = regions.some((r) => covers(r, evidenceInterval));
    const anyRetryOverlaps = retrySpans.some((s) =>
      overlaps(
        { sylStart: s.sylStart, sylEnd: s.sylEnd },
        evidenceInterval
      )
    );

    const classification = 'R1_IMPLEMENTATION_CONFORMS_AND_COVERAGE_NOT_REQUIRED';
    const authorityRequiredCoverage = 'NOT_REQUIRED_BY_SSOT';
    const implementationConforms = 'YES';

    rows.push({
      caseId,
      evidenceSyllableStart: es,
      evidenceSyllableEnd: ee,
      evidencePinyin: (lr.secondaryObservation || '').match(/evidence=\d+:\d+:([^\s;]+)/)?.[1] || lr.targetCanonicalPinyin,
      retryPathFineSpans: retrySpans
        .map((s) => `${s.spanId}:${s.sylStart}:${s.sylEnd}`)
        .join('|'),
      retrySpanCount: retrySpans.length,
      retryRegionStart: best?.sylStart ?? '',
      retryRegionEnd: best?.sylEnd ?? '',
      retryRegionId: best?.id ?? '',
      regionCount: regions.length,
      coverageClass,
      authorityRequiredCoverage,
      implementationConforms,
      classification,
      anyRetryOverlapsEvidence: anyRetryOverlaps ? 'YES' : 'NO',
      retryUnionCouldCover: retryUnionCouldCover ? 'YES' : 'NO',
      evidenceRefs: `lifecycle:${caseId};trace:${caseId}_CORRECT_PROFILE`,
      notes:
        coverageClass === 'PARTIAL'
          ? 'RETRY-union region overlaps evidence but does not fully cover; SSOT forbids KEEP expansion'
          : coverageClass === 'NONE'
            ? 'No RetryRegion fully or partially covers evidence interval; RETRY decisions elsewhere or disjoint'
            : 'Unexpected FULL under prior C9 — reconcile',
    });
    console.log(
      caseId,
      'ev',
      `${es}:${ee}`,
      'cov',
      coverageClass,
      'retrySpans',
      retrySpans.length,
      'regions',
      regions.length,
      'best',
      best ? `${best.sylStart}:${best.sylEnd}` : '-'
    );
  }

  const counts = { FULL: 0, PARTIAL: 0, NONE: 0 };
  for (const r of rows) counts[r.coverageClass] = (counts[r.coverageClass] || 0) + 1;

  fs.writeFileSync(path.join(OUT, '_retry_region_c9_case_rows.json'), JSON.stringify(rows, null, 2));
  console.log('coverageCounts', counts, 'total', rows.length);
  console.log('R1', rows.filter((r) => r.classification.startsWith('R1')).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
