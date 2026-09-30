#!/usr/bin/env node
/**
 * RETRY_REGION_LATTICE_INPUT_PARITY_CORRECTION — targeted validation
 * Must run under Electron ABI:
 *   ELECTRON_RUN_AS_NODE=1 electron.exe <this-script>
 *
 * Offline fixtures: surface-derived AcousticToneSlice / WordTimeSpan via existing
 * makeCharToneFixtures + textToToneSyllables (validation-only stand-in for ASR SSOT).
 * Production path passes real first-pass acousticSlices/wordTimeSpans.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT =
  process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

const ELECTRON_NODE = path.join(PROJECT_ROOT, 'electron_node', 'electron-node');
const DIST = path.join(ELECTRON_NODE, 'dist', 'main', 'electron-node', 'main', 'src');
const DOCS = path.join(PROJECT_ROOT, 'docs', 'user_correction', 'model3');
const AUDIT_CSV = path.join(DOCS, 'model3_v1_retry_region_case_audit.csv');
const ANCHORED = path.join(DOCS, 'model3_v1_feature_contract_dialog200_anchored.jsonl');

import { retryRegionArtifactPaths, mergeBundlePhase, csvEscape as bundleCsvEscape } from './lib/retry-region-artifact-bundle.mjs';

const ART = retryRegionArtifactPaths(DOCS);

function stubElectron() {
  try {
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
      id: electronPath,
      filename: electronPath,
      loaded: true,
      exports: {
        app: {
          getPath: (n) =>
            n === 'userData'
              ? path.join(ELECTRON_NODE, 'tmp-experiment')
              : PROJECT_ROOT,
        },
      },
    };
  } catch (_) {}
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const CJK = /[\u4e00-\u9fff]/g;
function cjkOnly(s) {
  return (String(s).match(CJK) || []).join('');
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function controlledRetryIndices({ surfaces, proxySurface, family, spanId }) {
  const proxy = cjkOnly(proxySurface || '');
  if (proxy) {
    const joined = surfaces.map((s) => cjkOnly(s) || s).join('');
    const idx = joined.indexOf(proxy);
    if (idx >= 0) {
      const indices = [];
      let cursor = 0;
      for (let i = 0; i < surfaces.length; i += 1) {
        const len = Math.max(1, cjkOnly(surfaces[i]).length || surfaces[i].length || 1);
        const start = cursor;
        const end = cursor + len;
        if (start < idx + proxy.length && end > idx) indices.push(i);
        cursor = end;
      }
      if (indices.length) return indices;
    }
  }
  const m = String(spanId).match(/:(\d+)$/);
  const startIdx = m ? Number(m[1]) : 0;
  if (family === 'MULTI_CHAR_REPLACEMENT' || family === 'INSERTION') {
    const n = Math.max(1, cjkOnly(proxySurface).length || 1);
    const out = [];
    for (let i = startIdx; i < Math.min(surfaces.length, startIdx + n); i += 1) out.push(i);
    return out;
  }
  return [Math.min(startIdx, surfaces.length - 1)];
}

function makePath(surfaces, pathId) {
  let raw = 0;
  let syl = 0;
  return surfaces.map((surf, i) => {
    const len = Math.max(1, cjkOnly(surf).length || surf.length || 1);
    const span = {
      spanId: `fine:${pathId}:${i}`,
      rawStart: raw,
      rawEnd: raw + len,
      syllableStart: syl,
      syllableEnd: syl + len,
      coarseSpanIds: [`c${i}`],
      boundaryCrossCount: 0,
      windowSource: 'in_span_window',
      candidates: [],
      selectionReason: 'complete_in_span',
    };
    raw += len;
    syl += len;
    return span;
  });
}

function makeCoarse(pathSpans, raw) {
  return pathSpans.map((s, i) => ({
    id: `c${i}`,
    text: raw.slice(s.rawStart, s.rawEnd),
    rawStart: s.rawStart,
    rawEnd: s.rawEnd,
    syllableStart: s.syllableStart,
    syllableEnd: s.syllableEnd,
    source: 'ime_token_boundary',
    boundaryConfidence: 1,
  }));
}

async function main() {
  stubElectron();

  const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
  const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
  const { deriveRetryRegions } = require(path.join(DIST, 'model3-runtime/model3-retry-region.js'));
  const { resegmentRetryRegionWithLattice } = require(
    path.join(DIST, 'model3-runtime/model3-retry-region-resegment.js')
  );
  const { runLatticeFineSpanGeneration } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
  );
  const { makeCharToneFixtures } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
  );
  const { buildUtteranceSyllableCoordinate } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
  );
  const { loadPinyinImeV2RuntimeConfig } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
  );
  const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
  );
  const { loadFwDetectorRuntimeConfig } = require(
    path.join(DIST, 'fw-detector/fw-config.js')
  );
  const { isFuzzyPinyinRecallEnabled } = require(
    path.join(DIST, 'lexicon-v2/lexicon-fw-recall-config.js')
  );
  const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
  const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));
  const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
  const { resolveRecallScope } = require(
    path.join(DIST, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
  );

  function tonesFromSurface(text) {
    const chars = [...text];
    const toneSyl = textToToneSyllables(text);
    return chars.map((_, i) => {
      const s = toneSyl[i] || '';
      const m = String(s).match(/([1-5])$/);
      return /** @type {1|2|3|4|5} */ (m ? Number(m[1]) : 1);
    });
  }

  function fixtureAcousticForUtterance(rawText) {
    return makeCharToneFixtures(rawText, tonesFromSurface(rawText));
  }

  const runtime = new LexiconRuntimeV2();
  const st = runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
  if (st.status !== 'ok') throw new Error('lexicon load fail: ' + st.status);
  const profile = defaultGeneralProfile();
  const fullScope = resolveRecallScope({ configEnabledDomains: [] });
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
    enabledDomains: imeConfig.enabledDomains,
  });
  const fwCfg = loadFwDetectorRuntimeConfig();
  const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
  const toneTimestampOnlyEnabled = fwCfg.toneTimestampOnlyEnabled !== false;

  const auditRows = parseCsv(fs.readFileSync(AUDIT_CSV, 'utf8'));
  const byId = new Map();
  for (const line of fs.readFileSync(ANCHORED, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    byId.set(String(o.id), o);
  }

  const BEFORE = {
    regionsWith2charEdges: 0,
    regionsWith3charEdges: 0,
    regionsWith4charEdges: 0,
    regionsWith5charEdges: 0,
    regionsWithMoreThan1Path: 0,
    segmentationChanged: 0,
  };

  const caseRows = [];
  let regionsWith2 = 0;
  let regionsWith3 = 0;
  let regionsWith4 = 0;
  let regionsWith5 = 0;
  let regionsGt1Path = 0;
  let segChanged = 0;
  let toneEvidencePassed = 0;
  let latticeOkCount = 0;
  let resegmentOkCount = 0;
  const pathObs = [];
  const seen = new Set();

  for (const row of auditRows) {
    const caseId = row.caseId;
    if (seen.has(caseId)) continue;
    seen.add(caseId);
    if (row.family === 'DELETION' || row.failure_mode_under_current_retry === 'NO_REPAIRABLE_TARGET') {
      continue;
    }

    const family = row.family;
    const anchored = byId.get(caseId) || {};
    const surfaces = (row.finespan_surfaces || '').split('|').filter(Boolean);
    if (!surfaces.length) continue;

    const pathId = row.pathId || 'path';
    const pathSpans = makePath(surfaces, pathId);
    const rawFromSurfaces = surfaces.map((s) => cjkOnly(s) || s).join('');
    const proxyRef = row.proxy_reference || '';
    const proxySurf = row.proxy_surface || '';
    const retainedDomains = anchored.retained_domains || [];
    const domainIds =
      retainedDomains.length > 0 ? retainedDomains : fullScope.domainIds.slice(0, 8);

    const retryIdx = controlledRetryIndices({
      surfaces,
      proxySurface: proxySurf,
      family,
      spanId: row.spanId || '',
    });
    const decisions = pathSpans.map((s, i) => ({
      spanId: s.spanId,
      decision: retryIdx.includes(i) ? 'RETRY' : 'KEEP',
      eligible: true,
    }));
    const regions = deriveRetryRegions({
      decisions,
      anchors: [],
      pathFineSpans: pathSpans,
    });
    const region = regions[0];
    if (!region) {
      caseRows.push({
        caseId,
        family,
        toneEvidencePassed: false,
        multiCharEdge: false,
        pathCount: 0,
        note: 'no region',
      });
      continue;
    }

    const sliceText = rawFromSurfaces.slice(region.rawStart, region.rawEnd);
    const oldLocal = pathSpans
      .filter((p) => region.sourceSpanIds.includes(p.spanId))
      .map((p) => rawFromSurfaces.slice(p.rawStart, p.rawEnd));

    const coord = buildUtteranceSyllableCoordinate(rawFromSurfaces);
    const globalSyllables = [...coord.syllables];
    while (globalSyllables.length < pathSpans[pathSpans.length - 1].syllableEnd) {
      globalSyllables.push('a');
    }

    const { acousticSlices, wordTimeSpans } = fixtureAcousticForUtterance(rawFromSurfaces);
    const coarse = makeCoarse(pathSpans, rawFromSurfaces);

    // Production resegment with SSOT-equivalent acoustic wiring
    const reseg = await resegmentRetryRegionWithLattice({
      region,
      rawText: rawFromSurfaces,
      globalSyllables,
      pathFineSpans: pathSpans,
      runtime,
      profile,
      retainedDomains: domainIds,
      imeConfig,
      dict,
      coarseSpans: coarse,
      minPrior: 0,
      acousticSlices,
      wordTimeSpans,
      fuzzyRecallEnabled: fuzzyEnabled,
      toneTimestampOnlyEnabled,
    });
    if (reseg.ok) resegmentOkCount += 1;

    // Same lattice inputs as resegment (region-local word times) for edge/path metrics
    const sliceLen = region.rawEnd - region.rawStart;
    const localWts = wordTimeSpans
      .filter((s) => (s.rawEnd ?? 0) > region.rawStart && (s.rawStart ?? 0) < region.rawEnd)
      .map((s) => ({
        ...s,
        rawStart: Math.max(0, (s.rawStart ?? 0) - region.rawStart),
        rawEnd: Math.min(sliceLen, (s.rawEnd ?? 0) - region.rawStart),
      }));
    const sliceCoarse = coarse
      .filter((c) => c.rawStart < region.rawEnd && c.rawEnd > region.rawStart)
      .map((c) => ({
        ...c,
        rawStart: Math.max(0, c.rawStart - region.rawStart),
        rawEnd: Math.min(sliceText.length, c.rawEnd - region.rawStart),
        syllableStart: Math.max(0, c.syllableStart - region.syllableStart),
        syllableEnd: Math.min(
          region.syllableEnd - region.syllableStart,
          c.syllableEnd - region.syllableStart
        ),
      }));

    const lattice = runLatticeFineSpanGeneration({
      rawText: sliceText,
      runtime,
      profile,
      domainIds: [...domainIds],
      minPrior: 0,
      imeConfig,
      dict,
      coarseSpans: sliceCoarse.length ? sliceCoarse : undefined,
      acousticSlices: [...acousticSlices],
      wordTimeSpans: localWts,
      fuzzyRecallEnabled: fuzzyEnabled,
      toneTimestampOnlyEnabled,
      enableUtteranceRecallCache: false,
    });

    if (!lattice.ok) {
      caseRows.push({
        caseId,
        family,
        toneEvidencePassed: acousticSlices.length > 0 && localWts.length > 0,
        multiCharEdge: false,
        pathCount: 0,
        latticeOk: false,
        note: lattice.code,
      });
      continue;
    }
    latticeOkCount += 1;

    const tonePassed =
      acousticSlices.length > 0 &&
      localWts.length > 0 &&
      toneTimestampOnlyEnabled &&
      (lattice.tone?.ngramTonePatternAttemptCount ?? 0) > 0;
    if (tonePassed) toneEvidencePassed += 1;

    const edgesAfter = lattice.edgesAfterFallback || [];
    const byLenLexical = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const multiCharLexical = [];
    for (const e of edgesAfter) {
      const len = e.syllableEnd - e.syllableStart;
      if (e.edgeKind === 'lexical' && len >= 1 && len <= 5) byLenLexical[len] += 1;
      if (e.edgeKind === 'lexical' && len >= 2) {
        let surface = '';
        if (e.candidates?.length) {
          const c0 = e.candidates[0];
          surface = sliceText.slice(c0.rawStart, c0.rawEnd) || c0.replacement || '';
        }
        multiCharLexical.push({ len, surface });
      }
    }

    if (byLenLexical[2] > 0) regionsWith2 += 1;
    if (byLenLexical[3] > 0) regionsWith3 += 1;
    if (byLenLexical[4] > 0) regionsWith4 += 1;
    if (byLenLexical[5] > 0) regionsWith5 += 1;

    const views = lattice.pathFineSpanViews || [];
    const pathCount = views.length;
    if (pathCount > 1) regionsGt1Path += 1;

    const pathSurfaces = views.map((v) =>
      v.pathFineSpans.map((s) => sliceText.slice(s.rawStart, s.rawEnd)).join('|')
    );
    const selectedSurfaces = pathSurfaces[0] || '';
    const changed = selectedSurfaces !== oldLocal.join('|');
    if (changed) segChanged += 1;

    const newLocalSurfaces = (reseg.localSpans || []).map((s) => s.surface).join('|');

    const usefulAlt = pathSurfaces.filter((ps) => {
      const parts = ps.split('|');
      return parts.some((p) => cjkOnly(p).length >= 2) || ps !== oldLocal.join('|');
    });
    const path0Wrong =
      usefulAlt.length > 0 &&
      !usefulAlt.includes(selectedSurfaces) &&
      usefulAlt.some((u) => u !== selectedSurfaces);

    if (pathCount > 1) {
      pathObs.push({
        caseId,
        pathCount,
        pathSurfaces,
        selected: selectedSurfaces,
        usefulAlt,
        path0Wrong,
      });
    }

    // Lexicon reachability for 项目 (d160)
    let xiangmuReachable = null;
    if (caseId === 'd160') {
      const syl = textToSyllables('项目');
      const tonePat = textToToneSyllables('项目')
        .map((s) => {
          const m = String(s).match(/([1-5])$/);
          return m ? Number(m[1]) : 0;
        })
        .filter((n) => n > 0);
      const out = recallSpanTopKV2(runtime, {
        syllables: syl,
        windowText: '项目',
        termLength: syl.length,
        topK: 4,
        profile,
        domainIds: [...domainIds],
        perSpanLimit: 4,
        acousticTonePattern: tonePat.length ? tonePat : undefined,
      });
      xiangmuReachable =
        out.hits.some((h) => h.hotword?.word === '项目') ||
        multiCharLexical.some((e) => e.surface === '项目') ||
        pathSurfaces.some((ps) => ps.includes('项目')) ||
        newLocalSurfaces.includes('项目');
    }

    caseRows.push({
      caseId,
      family,
      regionText: sliceText,
      oldLocal: oldLocal.join('|'),
      selected: selectedSurfaces,
      resegSurfaces: newLocalSurfaces,
      toneEvidencePassed: tonePassed,
      toneAttempts: lattice.tone?.ngramTonePatternAttemptCount ?? 0,
      toneHits: lattice.tone?.ngramTonePatternHitCount ?? 0,
      lex2: byLenLexical[2],
      lex3: byLenLexical[3],
      lex4: byLenLexical[4],
      lex5: byLenLexical[5],
      multiCharEdge: multiCharLexical.length > 0,
      multiCharSurfaces: multiCharLexical.map((m) => m.surface).join(';'),
      pathCount,
      segmentationChanged: changed,
      resegmentOk: reseg.ok,
      xiangmuReachable,
      path0Wrong,
    });
  }

  const AFTER = {
    regionsWith2charEdges: regionsWith2,
    regionsWith3charEdges: regionsWith3,
    regionsWith4charEdges: regionsWith4,
    regionsWith5charEdges: regionsWith5,
    regionsWithMoreThan1Path: regionsGt1Path,
    segmentationChanged: segChanged,
  };

  const n = caseRows.length;
  const critical = {
    d142: caseRows.find((c) => c.caseId === 'd142'),
    d160: caseRows.find((c) => c.caseId === 'd160'),
    d131: caseRows.find((c) => c.caseId === 'd131'),
    d176: caseRows.find((c) => c.caseId === 'd176'),
    d099: caseRows.find((c) => c.caseId === 'd099'),
  };

  const multiCharRecovered = regionsWith2 + regionsWith3 + regionsWith4 + regionsWith5 > 0;
  const toneWiringOk = toneEvidencePassed > 0;
  const inputParityOk = toneWiringOk && latticeOkCount === n && resegmentOkCount === n;

  let verdict = 'PASS';
  if (!inputParityOk) verdict = 'INPUT_PARITY_FAIL';
  else if (!multiCharRecovered) verdict = 'PASS_WITH_REMAINING_COVERAGE_GAPS';
  else if (
    (critical.d099 && critical.d099.multiCharEdge === false) ||
    (critical.d131 && critical.d131.multiCharEdge === false) ||
    (critical.d176 && critical.d176.multiCharEdge === false)
  ) {
    verdict = 'PASS_WITH_REMAINING_COVERAGE_GAPS';
  }

  const trainingGate =
    toneWiringOk && multiCharRecovered
      ? 'OPEN'
      : 'HOLD';

  const remaining =
    !multiCharRecovered
      ? 'INCONCLUSIVE'
      : critical.d099 && !critical.d099.multiCharEdge
        ? 'PHONETIC_RECALL_COVERAGE'
        : pathObs.some((p) => p.path0Wrong)
          ? 'PATH_SELECTION'
          : (critical.d131 && !critical.d131.multiCharEdge) ||
              (critical.d176 && !critical.d176.multiCharEdge)
            ? 'LEXICON_COVERAGE'
            : multiCharRecovered
              ? 'NONE'
              : 'MULTIPLE';

  fs.writeFileSync(
    ART.metrics,
    [
      'phase,metric,before,after,notes',
      `inputParity,regionsWith2charEdges,${BEFORE.regionsWith2charEdges},${AFTER.regionsWith2charEdges},`,
      `inputParity,regionsWith3charEdges,${BEFORE.regionsWith3charEdges},${AFTER.regionsWith3charEdges},`,
      `inputParity,regionsWithMoreThan1Path,${BEFORE.regionsWithMoreThan1Path},${AFTER.regionsWithMoreThan1Path},`,
      `inputParity,segmentationChanged,${BEFORE.segmentationChanged},${AFTER.segmentationChanged},`,
      `inputParity,toneEvidencePassed,0,${toneEvidencePassed},`,
    ].join('\n'),
    'utf8'
  );

  mergeBundlePhase(
    ART.bundle,
    'inputParity',
    {
      phase: 'RETRY_REGION_LATTICE_INPUT_PARITY_CORRECTION',
      verdict,
      n,
      beforeAfter: { BEFORE, AFTER },
      toneEvidencePassed,
      latticeOkCount,
      resegmentOkCount,
      critical,
      pathObs,
      remainingBottleneck: remaining,
    },
    { trainingGate, recommendedNextPhase: 'RETRY_REGION_PATH_SELECTION_MINIMAL_CORRECTION' }
  );

  console.log(JSON.stringify({ verdict, BEFORE, AFTER, toneEvidencePassed, trainingGate, remaining, artifactBundle: ART.bundle }, null, 2));
  runtime.close?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
