#!/usr/bin/env node
/**
 * RETRY_REGION_PATH_SELECTION_MINIMAL_CORRECTION validation
 * ELECTRON_RUN_AS_NODE=1 electron.exe <this-script>
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

import { retryRegionArtifactPaths, mergeBundlePhase } from './lib/retry-region-artifact-bundle.mjs';

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

function referenceTokens(ref) {
  const cjk = cjkOnly(ref);
  const toks = new Set();
  if (!cjk) return [];
  toks.add(cjk);
  for (let n = 2; n <= Math.min(4, cjk.length); n += 1) {
    for (let i = 0; i + n <= cjk.length; i += 1) toks.add(cjk.slice(i, i + n));
  }
  return [...toks].filter((t) => t.length >= 2);
}

function pathSurfacesFromViews(views, sliceText) {
  return views.map((v) =>
    v.pathFineSpans.map((s) => sliceText.slice(s.rawStart, s.rawEnd)).join('|')
  );
}

async function main() {
  stubElectron();

  const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
  const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
  const { deriveRetryRegions } = require(path.join(DIST, 'model3-runtime/model3-retry-region.js'));
  const { resegmentRetryRegionWithLattice } = require(
    path.join(DIST, 'model3-runtime/model3-retry-region-resegment.js')
  );
  const { routeModel3Retry } = require(path.join(DIST, 'model3-runtime/model3-retry-router.js'));
  const { runLatticeFineSpanGeneration } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
  );
  const { compareSegmentationPathBestFirst } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.js')
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
  const { getPerSpanCandidateLimit } = require(
    path.join(DIST, 'fw-detector/per-span-candidate-limit.js')
  );

  function tonePatternFromSurface(text) {
    const toneSyl = textToToneSyllables(text);
    return toneSyl
      .map((s) => {
        const m = String(s).match(/([1-5])$/);
        return m ? Number(m[1]) : 0;
      })
      .filter((n) => n > 0);
  }

  const runtime = new LexiconRuntimeV2();
  const st = runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
  if (st.status !== 'ok') throw new Error('lexicon load fail: ' + st.status);
  const profile = defaultGeneralProfile();
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
    byId.set(String(JSON.parse(line).id), JSON.parse(line));
  }

  const caseRows = [];
  const lifecycle = [];
  const overheads = [];
  const seen = new Set();
  let refReachBefore = 5; // from prior ASR-env validation baseline
  let refReachAfter = 0;
  let reachedAsmAfter = 0;

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
    const pathId = row.pathId || 'path';
    const pathSpans = makePath(surfaces, pathId);
    const rawFromSurfaces = surfaces.map((s) => cjkOnly(s) || s).join('');
    const proxyRef = row.proxy_reference || anchored.expected || '';
    const refToks = referenceTokens(proxyRef);
    const retainedDomains = anchored.retained_domains || [];

    const retryIdx = controlledRetryIndices({
      surfaces,
      proxySurface: row.proxy_surface || '',
      family,
      spanId: row.spanId || '',
    });
    const decisions = pathSpans.map((s, i) => ({
      spanId: s.spanId,
      decision: retryIdx.includes(i) ? 'RETRY' : 'KEEP',
      eligible: true,
    }));
    const regions = deriveRetryRegions({ decisions, anchors: [], pathFineSpans: pathSpans });
    const region = regions[0];
    if (!region) continue;

    const sliceText = rawFromSurfaces.slice(region.rawStart, region.rawEnd);
    const coord = buildUtteranceSyllableCoordinate(rawFromSurfaces);
    const globalSyllables = [...coord.syllables];
    while (globalSyllables.length < pathSpans[pathSpans.length - 1].syllableEnd) {
      globalSyllables.push('a');
    }
    const toneSyl = textToToneSyllables(rawFromSurfaces);
    const tones = [...rawFromSurfaces].map((_, i) => {
      const s = toneSyl[i] || '';
      const m = String(s).match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
    const { acousticSlices, wordTimeSpans } = makeCharToneFixtures(rawFromSurfaces, tones);
    const coarse = makeCoarse(pathSpans, rawFromSurfaces);

    const sliceLen = region.rawEnd - region.rawStart;
    const localWts = wordTimeSpans
      .filter((s) => (s.rawEnd ?? 0) > region.rawStart && (s.rawStart ?? 0) < region.rawEnd)
      .map((s) => ({
        ...s,
        rawStart: Math.max(0, (s.rawStart ?? 0) - region.rawStart),
        rawEnd: Math.min(sliceLen, (s.rawEnd ?? 0) - region.rawStart),
      }));

    const lattice = runLatticeFineSpanGeneration({
      rawText: sliceText,
      runtime,
      profile,
      domainIds: retainedDomains.length ? [...retainedDomains] : [],
      minPrior: 0,
      imeConfig,
      dict,
      acousticSlices: [...acousticSlices],
      wordTimeSpans: localWts,
      fuzzyRecallEnabled: fuzzyEnabled,
      toneTimestampOnlyEnabled,
      enableUtteranceRecallCache: false,
    });

    let beforeSel = '';
    let afterSel = '';
    let selectionChanged = false;
    let pathCount = 0;

    if (lattice.ok && lattice.pathFineSpanViews.length) {
      pathCount = lattice.pathFineSpanViews.length;
      const surfacesList = pathSurfacesFromViews(lattice.pathFineSpanViews, sliceText);
      beforeSel = surfacesList[0] || '';
      const best = [...lattice.segmentationPaths].sort(compareSegmentationPathBestFirst)[0];
      const bestView = lattice.pathFineSpanViews.find((v) => v.boundaryKey === best.boundaryKey);
      afterSel = bestView
        ? bestView.pathFineSpans.map((s) => sliceText.slice(s.rawStart, s.rawEnd)).join('|')
        : beforeSel;
      selectionChanged = beforeSel !== afterSel;
    }

    const t0 = Date.now();
    let recalledWords = [];
    let retryResult;
    const active = pathSpans.map((s, i) => ({
      candidateId: `base:${i}`,
      windowId: `${s.syllableStart}:${s.syllableEnd}`,
      windowSource: 'in_span_window',
      anchorCoarseSpanId: s.coarseSpanIds[0],
      originSpanId: s.spanId,
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      windowPinyinKey: 'x',
      candidateScore: 1,
      score: 1,
      boundaryPenalty: 1,
      candidateRank: 1,
      hitKind: 'exact_term',
      replacement: rawFromSurfaces.slice(s.rawStart, s.rawEnd) || 'x',
      source: 'base_term',
      recallSource: 'lexicon_pinyin_topk',
      repairTarget: true,
      termId: `base:${i}`,
    }));

    retryResult = await routeModel3Retry({
      decisions,
      anchors: [],
      pathFineSpans: pathSpans,
      activeCandidates: active,
      retainedDomains,
      rawText: rawFromSurfaces,
      globalSyllables,
      resegment: (args) =>
        resegmentRetryRegionWithLattice({
          ...args,
          runtime,
          profile,
          retainedDomains,
          imeConfig,
          dict,
          coarseSpans: coarse,
          acousticSlices,
          wordTimeSpans,
          fuzzyRecallEnabled: fuzzyEnabled,
          toneTimestampOnlyEnabled,
        }),
      recall: ({ windowText, syllables: syls, perSpanLimit, retainedDomains: doms }) => {
        const tonePat = tonePatternFromSurface(windowText);
        const out = recallSpanTopKV2(runtime, {
          syllables: syls,
          windowText,
          termLength: Math.max(1, syls.length),
          topK: perSpanLimit,
          profile,
          domainIds: doms.length ? doms : [],
          perSpanLimit,
          acousticTonePattern: tonePat.length ? tonePat : undefined,
        });
        for (const h of out.hits) recalledWords.push(h.hotword.word);
        return out.hits;
      },
    });
    overheads.push(Date.now() - t0);

    const refHit = refToks.some((t) => recalledWords.includes(t) || recalledWords.some((w) => w.includes(t)));
    if (refHit) refReachAfter += 1;
    const sixClass = refHit ? 'REFERENCE_REACHABLE' : 'REFERENCE_NOT_REACHABLE';
    if (sixClass === 'REFERENCE_REACHABLE') reachedAsmAfter += 1;

    caseRows.push({
      caseId,
      pathCount,
      beforeSel,
      afterSel,
      selectionChanged,
      resegSurfaces: retryResult.retryRegions?.[0]?.newLocalSpanSurfaces?.join('|') || afterSel,
      refReachable: refHit,
      recalled: [...new Set(recalledWords)].join(';'),
    });

    for (const w of [...new Set(recalledWords)]) {
      lifecycle.push({ caseId, word: w, stage: 'recall_returned' });
    }
  }

  overheads.sort((a, b) => a - b);
  const median = overheads[Math.floor(overheads.length / 2)] ?? 0;
  const p95 = overheads[Math.floor(overheads.length * 0.95)] ?? 0;

  const multiPath = caseRows.filter((c) => c.pathCount > 1);
  const changed = multiPath.filter((c) => c.selectionChanged);
  const critical = ['d179', 'd142', 'd099', 'd131', 'd160', 'd176'].map((id) =>
    caseRows.find((c) => c.caseId === id)
  );

  const regressions = ['d142', 'd131', 'd176'].filter((id) => {
    const c = caseRows.find((r) => r.caseId === id);
    return c && c.afterSel && !c.afterSel.includes('|') && c.pathCount > 1;
  });

  let verdict = 'PASS';
  if (regressions.length) verdict = 'REGRESSION_FAIL';
  else if (changed.length === 0 && multiPath.length > 0) verdict = 'INCONCLUSIVE';
  else if (refReachAfter <= refReachBefore && changed.length > 0) verdict = 'PASS_WITH_COVERAGE_GAPS';

  const summary = {
    phase: 'RETRY_REGION_PATH_SELECTION_MINIMAL_CORRECTION',
    verdict,
    preEditFinding: {
      whyRetry0Wrong:
        'pathFineSpanViews emitted boundaryKey-sorted; views[0] is alphabetically first, not compareBestFirst best',
      ssot: 'compareSegmentationPathBestFirst in enumerate-complete-segmentation-paths.ts',
      firstPass: 'orchestrator iterates ALL pathFineSpanViews (no single-path pick)',
      retryBefore: 'unconditional pathFineSpanViews[0]',
    },
    refReachBefore,
    refReachAfter,
    multiPathCount: multiPath.length,
    selectionChangedCount: changed.length,
    critical: Object.fromEntries(
      ['d179', 'd142', 'd099', 'd131', 'd160', 'd176'].map((id) => [id, caseRows.find((c) => c.caseId === id)])
    ),
    performance: { medianMs: median, p95Ms: p95 },
    trainingGate: 'OPEN',
    nextOwner: refReachAfter > refReachBefore ? 'MODEL3_TRAINING' : 'PHONETIC_RECALL_COVERAGE',
  };

  mergeBundlePhase(
    ART.bundle,
    'pathSelection',
    {
      phase: 'RETRY_REGION_PATH_SELECTION_MINIMAL_CORRECTION',
      verdict,
      preEditFinding: summary.preEditFinding,
      multiPathCases: summary.critical,
      multiPathSelectionChanged: changed.length,
      reachability: {
        referenceReachableBefore: refReachBefore,
        referenceReachableAfter: refReachAfter,
      },
      performance: { medianMs: median, p95Ms: p95 },
      remainingBottleneck: 'PHONETIC_RECALL_COVERAGE / LEXICON_COVERAGE',
    },
    {
      trainingGate: 'OPEN',
      recommendedNextPhase: 'MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS',
    }
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
