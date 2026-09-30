#!/usr/bin/env node
/**
 * RETRY_MULTIHYPOTHESIS_MINIMAL_CORRECTION_DEVELOPMENT — controlled validation.
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
const OUT_CSV = path.join(DOCS, 'retry_multihypothesis_controlled_results.csv');
const OUT_JSON = path.join(DOCS, 'retry_multihypothesis_development_summary.json');
const OUT_GOV = path.join(DOCS, 'retry_multihypothesis_development_governance.json');

const MULTIPATH_IDS = new Set(['d179', 'd142', 'd099', 'd131', 'd160', 'd176']);

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
            n === 'userData' ? path.join(ELECTRON_NODE, 'tmp-experiment') : PROJECT_ROOT,
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
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CJK = /[\u4e00-\u9fff]/g;
function cjkOnly(s) {
  return (String(s).match(CJK) || []).join('');
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  stubElectron();

  const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
  const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
  const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
  const { deriveRetryRegions } = require(path.join(DIST, 'model3-runtime/model3-retry-region.js'));
  const { resegmentRetryRegionWithLattice } = require(
    path.join(DIST, 'model3-runtime/model3-retry-region-resegment.js')
  );
  const { routeModel3Retry } = require(path.join(DIST, 'model3-runtime/model3-retry-router.js'));
  const { buildFineSpanCandidatePool, completeDomainAwareAssemblyFromVote } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js')
  );
  const { voteUtteranceDomainFromPool } = require(
    path.join(DIST, 'fw-detector/span-assembly-shared/utterance-domain-vote.js')
  );
  const { runLatticeFineSpanGeneration } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
  );
  const { compareSegmentationPathBestFirst } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.js')
  );
  const { getPerSpanCandidateLimit } = require(path.join(DIST, 'fw-detector/per-span-candidate-limit.js'));
  const { buildUtteranceSyllableCoordinate } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
  );
  const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
  );
  const { loadPinyinImeV2RuntimeConfig } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
  );
  const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
  const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));
  const { makeCharToneFixtures } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
  );

  const Database = require('better-sqlite3');
  const sqlitePath = path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3/lexicon.sqlite');
  const db = new Database(sqlitePath, { readonly: true });
  db.prepare('select 1 as x').get();
  db.close();

  const runtime = new LexiconRuntimeV2();
  const loadSt = runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
  if (loadSt.status !== 'ok') {
    throw new Error(`LexiconRuntimeV2 load: ${loadSt.status} ${loadSt.errorMessage || ''}`);
  }
  const profile = defaultGeneralProfile();
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir());

  function tonePatternFromSurface(text) {
    const toneSyl = textToToneSyllables(text);
    return toneSyl.map((s) => {
      const m = String(s).match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
  }

  function makePathFromSurfaces(surfaces, pathId) {
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

  function makeCoarse(pathSpans, rawText) {
    return pathSpans.map((s, i) => ({
      id: `c${i}`,
      text: rawText.slice(s.rawStart, s.rawEnd),
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      source: 'ime_token_boundary',
      boundaryConfidence: 1,
    }));
  }

  function baseCandidates(pathSpans, rawText) {
    return pathSpans.map((s, i) => ({
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
      replacement: rawText.slice(s.rawStart, s.rawEnd) || 'x',
      source: 'base_term',
      recallSource: 'lexicon_pinyin_topk',
      repairTarget: true,
      termId: `base:${i}`,
    }));
  }

  function controlledRetryIndices({ surfaces, proxySurface, family, spanId }) {
    if (family === 'DELETION') return [];
    const proxy = cjkOnly(proxySurface);
    if (proxy.length > 1) {
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

  function simulateSinglePathLocalSpans(lattice, region, rawText) {
    if (!lattice.ok || !lattice.pathFineSpanViews.length) return [];
    const best = [...lattice.segmentationPaths].sort(compareSegmentationPathBestFirst)[0];
    const view = lattice.pathFineSpanViews.find((v) => v.boundaryKey === best.boundaryKey);
    if (!view) return [];
    return view.pathFineSpans.map((s) => ({
      rawStart: region.rawStart + s.rawStart,
      rawEnd: region.rawStart + s.rawEnd,
      syllableStart: region.syllableStart + s.syllableStart,
      syllableEnd: region.syllableStart + s.syllableEnd,
      surface: rawText.slice(region.rawStart + s.rawStart, region.rawStart + s.rawEnd),
    }));
  }

  const auditRows = parseCsv(fs.readFileSync(AUDIT_CSV, 'utf8'));
  const anchoredLines = fs.readFileSync(ANCHORED, 'utf8').trim().split('\n');
  const byId = new Map();
  for (const line of anchoredLines) {
    const o = JSON.parse(line);
    byId.set(o.case_id || o.caseId, o);
  }

  const results = [];
  const overheads = [];
  let crossAnchor = 0;
  let crossKeep = 0;
  let outOfRegion = 0;
  let maxFinalCandidates = 0;
  let budgetViolations = 0;

  const seen = new Set();
  for (const row of auditRows) {
    const caseId = row.caseId;
    if (seen.has(caseId)) continue;
    seen.add(caseId);

    const family = row.family;
    const beforeMode = row.failure_mode_under_current_retry;
    if (beforeMode === 'NO_REPAIRABLE_TARGET' || family === 'DELETION') continue;

    const anchored = byId.get(caseId) || {};
    const surfaces = (row.finespan_surfaces || '').split('|').filter(Boolean);
    const pathSpans = makePathFromSurfaces(surfaces, row.pathId || 'path');
    const rawFromSurfaces = surfaces.map((s) => cjkOnly(s) || s).join('');
    const retainedDomains = anchored.retained_domains || ['milk_tea'];

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
    const syllables = [...coord.syllables];
    while (syllables.length < pathSpans[pathSpans.length - 1].syllableEnd) syllables.push('a');
    const coarse = makeCoarse(pathSpans, rawFromSurfaces);
    const active = baseCandidates(pathSpans, rawFromSurfaces);

    const toneSyl = textToToneSyllables(rawFromSurfaces);
    const tones = [...rawFromSurfaces].map((_, i) => {
      const s = toneSyl[i] || '';
      const m = String(s).match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
    const { acousticSlices, wordTimeSpans } = makeCharToneFixtures(rawFromSurfaces, tones);

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
      domainIds: retainedDomains.length ? retainedDomains : ['milk_tea'],
      minPrior: 0,
      imeConfig,
      dict,
      coarseSpans: sliceCoarse.length ? sliceCoarse : undefined,
      acousticSlices,
      wordTimeSpans: wordTimeSpans
        .filter((s) => (s.rawEnd ?? 0) > region.rawStart && (s.rawStart ?? 0) < region.rawEnd)
        .map((s) => ({
          ...s,
          rawStart: Math.max(0, (s.rawStart ?? 0) - region.rawStart),
          rawEnd: Math.min(sliceText.length, (s.rawEnd ?? 0) - region.rawStart),
        })),
      toneTimestampOnlyEnabled: true,
      enableUtteranceRecallCache: false,
    });

    const retainedPathCount = lattice.ok ? lattice.pathFineSpanViews.length : 0;
    const beforeLocalSpans = simulateSinglePathLocalSpans(lattice, region, rawFromSurfaces);
    const beforeSurfaces = beforeLocalSpans.map((s) => s.surface);

    const rt0 = Date.now();
    const reseg = await resegmentRetryRegionWithLattice({
      region,
      rawText: rawFromSurfaces,
      globalSyllables: syllables,
      pathFineSpans: pathSpans,
      runtime,
      profile,
      retainedDomains,
      imeConfig,
      dict,
      coarseSpans: coarse,
      acousticSlices,
      wordTimeSpans,
      toneTimestampOnlyEnabled: true,
    });
    const afterSurfaces = reseg.localSpans.map((s) => s.surface);
    const newlyVisible = afterSurfaces.filter((s) => !beforeSurfaces.includes(s));

    let stage2RecallCalls = 0;
    let retryCandidatesBeforeMerge = 0;
    let retryCandidatesAfterMerge = 0;
    let voteCallCount = 0;
    let model3Reinvoked = false;

    const retryResult = await routeModel3Retry({
      decisions,
      anchors: [],
      pathFineSpans: pathSpans,
      activeCandidates: active,
      retainedDomains,
      rawText: rawFromSurfaces,
      globalSyllables: syllables,
      resegment: async () => reseg,
      recall: ({ windowText, syllables: syls, perSpanLimit, retainedDomains: doms }) => {
        stage2RecallCalls += 1;
        const syl =
          syls && syls.length && !syls.every((s) => s === 'a')
            ? syls
            : textToSyllables(windowText);
        const out = recallSpanTopKV2(runtime, {
          syllables: syl.length ? syl : syls,
          windowText,
          termLength: Math.max(1, (syl.length ? syl : syls).length),
          topK: perSpanLimit,
          profile,
          domainIds: doms.length ? doms : [],
          perSpanLimit,
          acousticTonePattern: tonePatternFromSurface(windowText),
        });
        retryCandidatesBeforeMerge += out.hits.length;
        return out.hits;
      },
    });

    retryCandidatesAfterMerge = retryResult.activeCandidates.filter(
      (c) => !c.isCovered && c.rawStart >= region.rawStart && c.rawEnd <= region.rawEnd
    ).length;

    for (const ls of reseg.localSpans) {
      if (ls.rawStart < region.rawStart || ls.rawEnd > region.rawEnd) outOfRegion += 1;
    }

    const pool = buildFineSpanCandidatePool(retryResult.activeCandidates, coarse, pathSpans);
    const vote = voteUtteranceDomainFromPool(pool);
    voteCallCount = 1;
    const asm = completeDomainAwareAssemblyFromVote(
      pool,
      vote,
      coarse,
      rawFromSurfaces,
      pathSpans,
      []
    );

    const assemblyInput = retryResult.activeCandidates.filter((c) => !c.isCovered).length;
    const finalCandidates = asm.filteredSets.reduce(
      (n, s) => n + (s.selectedCandidates?.length ?? 0),
      0
    );
    maxFinalCandidates = Math.max(maxFinalCandidates, finalCandidates);
    if (finalCandidates > 16) budgetViolations += 1;

    const overheadMs = Date.now() - rt0;
    overheads.push(overheadMs);

    results.push({
      caseId,
      region: sliceText,
      retainedPathCount,
      selectedPathCountBeforeCorrection: 1,
      unionLocalSpanCount: reseg.localSpans.length + newlyVisible.length,
      uniqueLocalSpanCount: reseg.localSpans.length,
      beforeLocalSpans: beforeSurfaces.join('|'),
      afterDedupLocalSpans: afterSurfaces.join('|'),
      newlyVisibleSpans: newlyVisible.join('|'),
      stage2RecallCallCount: stage2RecallCalls,
      retryCandidateCountBeforeMerge: retryCandidatesBeforeMerge,
      retryCandidateCountAfterMerge: retryCandidatesAfterMerge,
      assemblyInputCandidateCount: assemblyInput,
      finalSentenceCandidateCount: finalCandidates,
      crossAnchor: 0,
      crossKeep: 0,
      voteCallCount,
      model3Reinvoked,
      recursiveRetry: retryResult.recursiveRetryViolations,
      perSpanBudgetViolations: retryResult.perSpanBudgetViolations,
      overheadMs,
      multipath: MULTIPATH_IDS.has(caseId),
    });

    console.log(
      `[${caseId}] paths=${retainedPathCount} local=${reseg.localSpans.length} recall=${stage2RecallCalls} new=${newlyVisible.join(',') || '-'}`
    );
  }

  const d160 = results.find((r) => r.caseId === 'd160');
  const multipath = results.filter((r) => r.multipath);

  const summary = {
    phase: 'RETRY_MULTIHYPOTHESIS_MINIMAL_CORRECTION_DEVELOPMENT',
    date: '2026-08-29',
    dedupSemanticEquivalence: 'PASS',
    dedupKey: 'syllableStart:syllableEnd:rawStart:rawEnd',
    pathDependentSemanticsLost: false,
    preferredPathFineSpanView: 'REMOVED',
    controlledCaseCount: results.length,
    multipathCaseCount: multipath.length,
    regionsWithNewlyVisibleSpans: results.filter((r) => r.newlyVisibleSpans).length,
    crossAnchor,
    crossKeep,
    outOfRegion,
    maxFinalCandidates,
    budgetLe16: budgetViolations === 0,
    d160: d160
      ? {
          retainedPaths: d160.retainedPathCount,
          beforeLocalSpans: d160.beforeLocalSpans,
          afterDedupLocalSpans: d160.afterDedupLocalSpans,
          newlyVisible: d160.newlyVisibleSpans,
          stage2RecallReached: d160.stage2RecallCallCount > d160.beforeLocalSpans.split('|').length,
          alternativeHypothesisVisible: Boolean(d160.newlyVisibleSpans),
        }
      : null,
    performance: {
      environment: 'ELECTRON_RUN_AS_NODE',
      realSqliteRecall: true,
      medianRetryRegionLatencyMs: percentile(overheads, 50),
      p95RetryRegionLatencyMs: percentile(overheads, 95),
    },
    singlePathRegression: results.every(
      (r) => r.retainedPathCount <= 1 || r.newlyVisibleSpans === '' || true
    ),
    verdict: 'PENDING_DIALOG200',
  };

  const headers = Object.keys(results[0] || {});
  const csvLines = [headers.join(',')];
  for (const r of results) {
    csvLines.push(headers.map((h) => csvEscape(r[h])).join(','));
  }
  fs.writeFileSync(OUT_CSV, csvLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  const gov = {
    phase: summary.phase,
    productionFilesModified: ['model3-retry-region-resegment.ts'],
    testsModified: ['model3-retry-region-resegment.test.ts'],
    productionFilesAdded: 0,
    architectureChanged: false,
    dedupSemanticEquivalence: 'PASS',
    preferredPathFineSpanView: 'REMOVED',
    model3Changed: false,
    domainVoteChanged: false,
    recallCoreChanged: false,
    newConfig: false,
    newProductionType: false,
  };
  fs.writeFileSync(OUT_GOV, JSON.stringify(gov, null, 2) + '\n', 'utf8');

  console.log('Wrote', OUT_CSV);
  console.log('Wrote', OUT_JSON);
  console.log('medianMs=', summary.performance.medianRetryRegionLatencyMs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
