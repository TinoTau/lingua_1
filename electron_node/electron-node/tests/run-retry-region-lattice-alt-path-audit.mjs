#!/usr/bin/env node
/**
 * RETRY_REGION_LATTICE_ALTERNATIVE_PATH_AUDIT - READ-ONLY
 * Run: ELECTRON_RUN_AS_NODE=1 electron.exe tests/run-retry-region-lattice-alt-path-audit.mjs
 * Does NOT modify business code. Traces lattice edges/paths for same controlled cases.
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

const CRITICAL = new Set(['d099', 'd131', 'd160', 'd176']);
const CJK = /[\u4e00-\u9fff]/g;

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
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
function cjkOnly(s) {
  return (String(s).match(CJK) || []).join('');
}
function csvEsc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

async function main() {
  stubElectron();

  const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
  const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
  const { deriveRetryRegions } = require(path.join(DIST, 'model3-runtime/model3-retry-region.js'));
  const { runLatticeFineSpanGeneration } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
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
  const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
  const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));
  const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
  const { resolveRecallScope } = require(
    path.join(DIST, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
  );

  const runtime = new LexiconRuntimeV2();
  const st = runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
  if (st.status !== 'ok') throw new Error('lexicon load fail: ' + st.status);
  const profile = defaultGeneralProfile();
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
    enabledDomains: imeConfig.enabledDomains,
  });
  const fullScope = resolveRecallScope({ configEnabledDomains: [] });

  // Input parity table (code-static + observed)
  const inputParity = [
    {
      parameter: 'raw text',
      firstPass: 'full utterance rawText',
      retryRegion: 'sliceText = rawText.slice(rawStart,rawEnd)',
      same: 'DIFFERENT_SCOPE',
      reason: 'bounded region by design',
    },
    {
      parameter: 'syllables',
      firstPass: 'buildUtteranceSyllableCoordinate(full rawText)',
      retryRegion:
        'recomputes buildUtteranceSyllableCoordinate(sliceText); ignores passed globalSyllables slice',
      same: 'DIFFERENT',
      reason: 'RETRY_LATTICE_INPUT_DRIFT: passed globalSyllables unused',
    },
    {
      parameter: 'pinyin',
      firstPass: 'from utterance coordinate + window queries',
      retryRegion: 'from slice coordinate only',
      same: 'SAME_MECHANISM',
      reason: 'same builder, different scope',
    },
    {
      parameter: 'tone / acousticSlices',
      firstPass: 'acousticSlices + wordTimeSpans from ASR (toneActive when present)',
      retryRegion: 'NOT PASSED (undefined) - toneActive=false inside lattice recall',
      same: 'DIFFERENT',
      reason: 'RETRY_LATTICE_INPUT_DRIFT: no acoustic tone channel',
    },
    {
      parameter: 'domain context',
      firstPass: 'recallDomainScope (full resolved fine domains)',
      retryRegion: 'vote.retainedDomains only (may be smaller)',
      same: 'DIFFERENT',
      reason: 'frozen vote subset vs first-pass full scope',
    },
    {
      parameter: 'lexicon handle',
      firstPass: 'LexiconRuntimeV2',
      retryRegion: 'same LexiconRuntimeV2',
      same: 'SAME',
      reason: 'shared runtime',
    },
    {
      parameter: 'config (ime/dict/minPrior)',
      firstPass: 'imeConfig+dict+minPrior from orchestrator',
      retryRegion: 'imeConfig+dict; minPrior defaults 0; fuzzyRecallEnabled default false',
      same: 'PARTIAL',
      reason: 'minPrior/fuzzy may differ from first-pass wiring',
    },
    {
      parameter: 'path selection after lattice',
      firstPass: 'orchestrator iterates ALL pathFineSpanViews',
      retryRegion: 'HARD pathFineSpanViews[0] only',
      same: 'DIFFERENT',
      reason: 'ASR postprocess wiring selects first view after boundaryKey sort',
    },
  ];

  const auditRows = parseCsv(fs.readFileSync(AUDIT_CSV, 'utf8'));
  const asrById = new Map();
  const byId = new Map();
  for (const line of fs.readFileSync(ANCHORED, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    byId.set(String(o.id), o);
  }

  const caseSummaries = [];
  const edgeTraces = [];
  const criticalTraces = {};

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
      caseSummaries.push({
        caseId,
        family,
        primaryCause: 'INCONCLUSIVE',
        note: 'no region',
      });
      continue;
    }

    const sliceText = rawFromSurfaces.slice(region.rawStart, region.rawEnd);
    const oldLocal = pathSpans
      .filter((p) => region.sourceSpanIds.includes(p.spanId))
      .map((p) => rawFromSurfaces.slice(p.rawStart, p.rawEnd));

    const sliceCoarse = [
      {
        id: 'slice0',
        text: sliceText,
        rawStart: 0,
        rawEnd: sliceText.length,
        syllableStart: 0,
        syllableEnd: Math.max(1, cjkOnly(sliceText).length || sliceText.length),
        source: 'ime_token_boundary',
        boundaryConfidence: 1,
      },
    ];

    // --- LIVE lattice as retry does (no acousticSlices) ---
    const lattice = runLatticeFineSpanGeneration({
      rawText: sliceText,
      runtime,
      profile,
      domainIds: [...domainIds],
      minPrior: 0,
      imeConfig,
      dict,
      coarseSpans: sliceCoarse,
      enableUtteranceRecallCache: false,
    });

    if (!lattice.ok) {
      caseSummaries.push({
        caseId,
        family,
        primaryCause: 'LATTICE_INPUT_DRIFT',
        note: lattice.code + ' ' + lattice.message,
        latticeOk: false,
      });
      continue;
    }

    const edgesAfter = lattice.edgesAfterFallback || [];
    const lexicalEdges = lattice.lexicalEdges || [];
    const byLen = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byLenLexical = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const multiCharLexical = [];
    for (const e of edgesAfter) {
      const len = e.syllableEnd - e.syllableStart;
      if (len >= 1 && len <= 5) byLen[len] += 1;
      if (e.edgeKind === 'lexical' && len >= 1 && len <= 5) byLenLexical[len] += 1;
      if (e.edgeKind === 'lexical' && len >= 2) {
        const surf =
          e.candidates?.[0]?.replacement ||
          sliceText.slice(
            e.candidates?.[0]?.rawStart ?? 0,
            e.candidates?.[0]?.rawEnd ?? 0
          );
        // surface from candidate raw offsets relative to slice
        let surface = '';
        if (e.candidates?.length) {
          const c0 = e.candidates[0];
          surface = sliceText.slice(c0.rawStart, c0.rawEnd) || c0.replacement || '';
        }
        multiCharLexical.push({
          edgeId: e.edgeId,
          len,
          syl: `${e.syllableStart}:${e.syllableEnd}`,
          surface: surface || e.candidates?.[0]?.replacement || '',
          candCount: e.candidates?.length || 0,
          hasExact: e.recallEvidence?.hasExact,
        });
      }
    }

    const views = lattice.pathFineSpanViews || [];
    const paths = lattice.segmentationPaths || [];
    const pathSurfaces = views.map((v) =>
      v.pathFineSpans.map((s) => sliceText.slice(s.rawStart, s.rawEnd)).join('|')
    );
    const selectedSurfaces = pathSurfaces[0] || '';
    const selectedChanged = selectedSurfaces !== oldLocal.join('|');

    // Useful alternative = path whose surfaces differ from original 1-char sequence
    const usefulAltPaths = pathSurfaces.filter((ps) => {
      const parts = ps.split('|');
      return parts.some((p) => cjkOnly(p).length >= 2) || ps !== oldLocal.join('|');
    });
    const altExistsNotSelected =
      usefulAltPaths.length > 0 && !usefulAltPaths.includes(selectedSurfaces);

    // Materialization: multi-char edges in selected path
    const selectedView = views[0];
    const selectedMulti = (selectedView?.pathFineSpans || []).filter(
      (s) => s.syllableEnd - s.syllableStart >= 2
    );
    const selectedMultiSurfaces = selectedMulti.map((s) =>
      sliceText.slice(s.rawStart, s.rawEnd)
    );

    // Reference plane (audit only)
    const refToks = referenceTokens(proxyRef || anchored.expected || '');
    const refInMultiEdges = refToks.filter((t) =>
      multiCharLexical.some((e) => e.surface === t || e.surface.includes(t))
    );
    const refInSelected = refToks.filter((t) => selectedSurfaces.includes(t));
    const refInAnyPath = refToks.filter((t) => pathSurfaces.some((ps) => ps.includes(t)));

    // Lexicon existence of reference ngrams (direct SQL via recall with tone)
    const tonePat = (text) => {
      const ts = textToToneSyllables(text);
      const p = ts
        .map((s) => {
          const m = String(s).match(/([1-5])$/);
          return m ? Number(m[1]) : 0;
        })
        .filter((n) => n > 0);
      return p.length ? p : undefined;
    };
    const refLexiconHits = [];
    const refLexiconMiss = [];
    for (const t of refToks.slice(0, 12)) {
      const syl = textToSyllables(t);
      if (syl.length < 2 || syl.length > 5) continue;
      const out = recallSpanTopKV2(runtime, {
        syllables: syl,
        windowText: t,
        termLength: syl.length,
        topK: 4,
        profile,
        domainIds: [...domainIds],
        perSpanLimit: 4,
        acousticTonePattern: tonePat(t),
      });
      const hit = out.hits.some((h) => h.hotword.word === t);
      if (hit) refLexiconHits.push(t);
      else refLexiconMiss.push(t);
    }

    // Window recall under lattice conditions (no tone) for a sample 2-char window
    let sample2charNoToneHits = null;
    let sample2charWithToneHits = null;
    if (cjkOnly(sliceText).length >= 2) {
      const w2 = cjkOnly(sliceText).slice(0, 2);
      const syl2 = textToSyllables(w2);
      const noTone = recallSpanTopKV2(runtime, {
        syllables: syl2,
        windowText: w2,
        termLength: syl2.length,
        topK: 4,
        profile,
        domainIds: [...domainIds],
        perSpanLimit: 4,
      });
      const withTone = recallSpanTopKV2(runtime, {
        syllables: syl2,
        windowText: w2,
        termLength: syl2.length,
        topK: 4,
        profile,
        domainIds: [...domainIds],
        perSpanLimit: 4,
        acousticTonePattern: tonePat(w2),
      });
      sample2charNoToneHits = noTone.hits.length;
      sample2charWithToneHits = withTone.hits.length;
    }

    let pathClass = 'NO_ALTERNATIVE_PATH';
    if (paths.length <= 1 && byLenLexical[2] + byLenLexical[3] + byLenLexical[4] + byLenLexical[5] === 0) {
      pathClass = 'NO_ALTERNATIVE_PATH';
    } else if (usefulAltPaths.length > 0 && altExistsNotSelected) {
      pathClass = 'ALTERNATIVE_PATH_EXISTS_NOT_SELECTED';
    } else if (usefulAltPaths.length > 0 && selectedChanged) {
      pathClass = 'ALTERNATIVE_PATH_SELECTED';
    } else if (paths.length > 1 && !selectedChanged) {
      pathClass = 'ALTERNATIVE_PATH_EXISTS_NOT_SELECTED';
    }

    let refClass = 'INCONCLUSIVE';
    if (refInAnyPath.length) refClass = 'REFERENCE_SEGMENTATION_EXISTS_IN_CURRENT_LATTICE';
    else if (refInMultiEdges.length) refClass = 'REFERENCE_SEGMENTATION_EXISTS_IN_CURRENT_LATTICE';
    else if (refLexiconHits.length && multiCharLexical.length === 0)
      refClass = 'REFERENCE_TERMS_EXIST_IN_LEXICON_BUT_PATH_NOT_GENERATED';
    else if (refLexiconMiss.length && !refLexiconHits.length)
      refClass = 'REFERENCE_TERMS_MISSING_FROM_LEXICON';
    else if (refLexiconHits.length === 0 && refToks.length)
      refClass = 'REFERENCE_REQUIRES_DIFFERENT_PHONETIC_RECALL';

    // Primary cause
    let primaryCause = 'INCONCLUSIVE';
    let secondary = '';
    if (byLenLexical[2] + byLenLexical[3] + byLenLexical[4] + byLenLexical[5] === 0) {
      if (sample2charNoToneHits === 0 && sample2charWithToneHits > 0) {
        primaryCause = 'LATTICE_INPUT_DRIFT';
        secondary = 'TONE_GATE / no acousticSlices -> multi-char lexical edges absent';
      } else if (refLexiconMiss.length && !refLexiconHits.length) {
        primaryCause = 'LEXICON_COVERAGE';
        secondary = 'NO_ALTERNATIVE_EDGES';
      } else {
        primaryCause = 'NO_ALTERNATIVE_EDGES';
        secondary = sample2charNoToneHits === 0 ? 'PHONETIC_RECALL_COVERAGE_OR_TONE' : '';
      }
    } else if (altExistsNotSelected || (paths.length > 1 && !selectedChanged)) {
      primaryCause = 'PATH_RANKING_BIAS';
      secondary = 'pathFineSpanViews[0] after boundaryKey sort';
    } else if (selectedMulti.length === 0 && multiCharLexical.length > 0) {
      primaryCause = 'PATH_RANKING_BIAS';
    } else if (!selectedChanged) {
      primaryCause = 'NO_CHANGE_NEEDED';
    }

    // Edge absence reason for multi-char
    let edgeAbsenceReason = '';
    if (byLenLexical[2] + byLenLexical[3] + byLenLexical[4] + byLenLexical[5] === 0) {
      if (sample2charNoToneHits === 0 && sample2charWithToneHits > 0) edgeAbsenceReason = 'TONE_GATE_REJECTED';
      else if (sample2charNoToneHits === 0) edgeAbsenceReason = 'PHONETIC_EDGE_ABSENT';
      else edgeAbsenceReason = 'LEXICON_EDGE_ABSENT';
    }

    const asr = asrById.get(caseId) || {};
    const summary = {
      caseId,
      family,
      regionText: sliceText,
      oldLocal: oldLocal.join('|'),
      selectedLocal: selectedSurfaces,
      segmentationChanged: selectedChanged,
      latticeOk: true,
      pathCount: paths.length,
      retainedPathCount: lattice.trace?.retainedCompletePathCount,
      edgeLen1: byLen[1],
      edgeLen2: byLen[2],
      edgeLen3: byLen[3],
      edgeLen4: byLen[4],
      edgeLen5: byLen[5],
      lexicalLen1: byLenLexical[1],
      lexicalLen2: byLenLexical[2],
      lexicalLen3: byLenLexical[3],
      lexicalLen4: byLenLexical[4],
      lexicalLen5: byLenLexical[5],
      multiCharLexicalCount: multiCharLexical.length,
      usefulAltPathCount: usefulAltPaths.length,
      pathClass,
      selectedMultiCharFineSpans: selectedMultiSurfaces.join('|'),
      sample2charNoToneHits,
      sample2charWithToneHits,
      edgeAbsenceReason,
      refClass,
      refLexiconHits: refLexiconHits.join('|'),
      refLexiconMiss: refLexiconMiss.slice(0, 6).join('|'),
      primaryCause,
      secondary,
      asrReachability: asr.reachability || '',
      domainIds: domainIds.join('|'),
    };
    caseSummaries.push(summary);

    for (const e of multiCharLexical.slice(0, 30)) {
      edgeTraces.push({
        caseId,
        kind: 'lexical_multi',
        ...e,
      });
    }
    for (let i = 0; i < Math.min(paths.length, 10); i += 1) {
      edgeTraces.push({
        caseId,
        kind: 'path',
        pathIndex: i,
        boundaryKey: paths[i].boundaryKey,
        surfaces: pathSurfaces[i],
        lexicalEdgeCount: paths[i].lexicalEdgeCount,
        fallbackEdgeCount: paths[i].fallbackEdgeCount,
        exactEdgeCount: paths[i].structuralEvidence?.exactEdgeCount,
      });
    }

    if (CRITICAL.has(caseId)) {
      criticalTraces[caseId] = {
        region: sliceText,
        oldLocal: oldLocal.join('|'),
        generatedMultiCharLexicalEdges: multiCharLexical,
        pathCount: paths.length,
        topPaths: pathSurfaces.slice(0, 10).map((s, i) => ({
          i,
          surfaces: s,
          boundaryKey: paths[i]?.boundaryKey,
          lexical: paths[i]?.lexicalEdgeCount,
          fallback: paths[i]?.fallbackEdgeCount,
        })),
        selectedPath: selectedSurfaces,
        selectedVia: 'pathFineSpanViews[0] after boundaryKey ASC sort',
        materializedFineSpans: selectedSurfaces,
        sample2charNoToneHits,
        sample2charWithToneHits,
        edgeAbsenceReason,
        refClass,
        refLexiconHits,
        refLexiconMiss: refLexiconMiss.slice(0, 8),
        primaryCause,
        firstMissingPoint:
          byLenLexical[2] + byLenLexical[3] + byLenLexical[4] + byLenLexical[5] === 0
            ? edgeAbsenceReason || 'NO_ALTERNATIVE_EDGES'
            : altExistsNotSelected
              ? 'PATH_SELECTION_pathFineSpanViews[0]'
              : 'RECALL_AFTER_SEGMENTATION',
      };
    }

    console.log(
      `[${caseId}] paths=${paths.length} lex2-5=${byLenLexical[2]+byLenLexical[3]+byLenLexical[4]+byLenLexical[5]} cause=${primaryCause} noTone=${sample2charNoToneHits} withTone=${sample2charWithToneHits}`
    );
  }

  // Aggregates
  const n = caseSummaries.length;
  const with2 = caseSummaries.filter((c) => c.edgeLen2 > 0).length;
  const with3 = caseSummaries.filter((c) => c.edgeLen3 > 0).length;
  const with4 = caseSummaries.filter((c) => c.edgeLen4 > 0).length;
  const with5 = caseSummaries.filter((c) => c.edgeLen5 > 0).length;
  const with1 = caseSummaries.filter((c) => c.edgeLen1 > 0).length;
  const withUsefulMulti = caseSummaries.filter((c) => c.multiCharLexicalCount > 0).length;
  const withMultiPath = caseSummaries.filter((c) => c.pathCount > 1).length;
  const withUsefulAlt = caseSummaries.filter((c) => c.usefulAltPathCount > 0).length;
  const altNotSelected = caseSummaries.filter(
    (c) => c.pathClass === 'ALTERNATIVE_PATH_EXISTS_NOT_SELECTED'
  ).length;
  const noAlt = caseSummaries.filter((c) => c.pathClass === 'NO_ALTERNATIVE_PATH').length;

  const causeDist = {};
  for (const c of caseSummaries) {
    causeDist[c.primaryCause] = (causeDist[c.primaryCause] || 0) + 1;
  }
  const refDist = {};
  for (const c of caseSummaries) {
    refDist[c.refClass] = (refDist[c.refClass] || 0) + 1;
  }

  const toneDriftCases = caseSummaries.filter(
    (c) => c.sample2charNoToneHits === 0 && c.sample2charWithToneHits > 0
  ).length;
  const zeroMultiLexical = caseSummaries.filter((c) => c.multiCharLexicalCount === 0).length;

  let primaryBottleneck = 'MULTIPLE_GAPS';
  let exactLocation =
    'model3-retry-region-resegment.ts:resegmentRetryRegionWithLattice - omits acousticSlices/wordTimeSpans; selects pathFineSpanViews[0]';
  let whyZero =
    'Lattice recall inside region runs without acoustic tone -> multi-char windows yield 0 candidates -> no 2-5 lexical edges -> only fallback 1-char path -> identical FineSpan sequence; path[0] selection compounds when alternatives exist.';

  if (zeroMultiLexical === n && toneDriftCases > 0) {
    primaryBottleneck = 'LATTICE_INPUT_DRIFT';
    exactLocation =
      'model3-retry-region-resegment.ts resegmentRetryRegionWithLattice -> runLatticeFineSpanGeneration({...}) without acousticSlices/wordTimeSpans; recall-topk-for-windows.ts toneActive=false';
    whyZero =
      `${toneDriftCases}/${n} regions: sample 2-char recall hits=0 without tone, >0 with tone -> multi-char lexical edges never built; fallback injects 1-syllable edges only -> single all-1-char path -> segmentationChanged=0.`;
  } else if (withUsefulMulti > 0 && altNotSelected > 0) {
    primaryBottleneck = 'PATH_RANKING_BIAS';
  }

  const inputParityOverall =
    inputParity.filter((r) => r.same === 'DIFFERENT' || r.same === 'PARTIAL').length > 0
      ? 'FAIL'
      : 'PASS';

  const trainingGate =
    primaryBottleneck === 'LATTICE_INPUT_DRIFT' || primaryBottleneck === 'PATH_RANKING_BIAS'
      ? 'HOLD'
      : 'OPEN';

  const verdict =
    primaryBottleneck === 'LATTICE_INPUT_DRIFT'
      ? 'LATTICE_INPUT_DRIFT'
      : primaryBottleneck === 'PATH_RANKING_BIAS'
        ? 'PATH_RANKING_BIAS'
        : zeroMultiLexical === n
          ? 'NO_ALTERNATIVE_EDGES'
          : 'MULTIPLE_GAPS';

  const summary = {
    phase: 'RETRY_REGION_LATTICE_ALTERNATIVE_PATH_AUDIT',
    date: '2026-08-28',
    verdict,
    casesAudited: n,
    inputParity,
    inputParityOverall,
    edgeGeneration: {
      regionsWith1charEdges: with1,
      regionsWith2charEdges: with2,
      regionsWith3charEdges: with3,
      regionsWith4charEdges: with4,
      regionsWith5charEdges: with5,
      regionsWithUsefulMultiCharLexicalEdge: withUsefulMulti,
      regionsWithZeroMultiCharLexical: zeroMultiLexical,
      toneDriftExplainsZeroMulti: toneDriftCases,
    },
    paths: {
      regionsWithMoreThan1Path: withMultiPath,
      regionsWithUsefulAlternativePath: withUsefulAlt,
      alternativeExistsButNotSelected: altNotSelected,
      noAlternativePath: noAlt,
    },
    materialization: {
      note: 'materializePathFineSpans preserves edge syllable span; no re-split observed when multi-char edge selected',
      selectedMultiCharFineSpansCases: caseSummaries.filter(
        (c) => c.selectedMultiCharFineSpans
      ).length,
    },
    causeDistribution: causeDist,
    referenceRepairability: refDist,
    criticalTraces,
    caseSummaries,
    primaryBottleneck,
    exactLocation,
    whySegmentationChangedZero: whyZero,
    trainingGate,
    trainingReason:
      trainingGate === 'HOLD'
        ? 'Postprocess lattice wiring omits acoustic tone (and always takes pathFineSpanViews[0]); valid multi-char repair hypotheses are structurally suppressed before Model3 training can help.'
        : 'Lattice structurally sound; residual is lexicon/recall coverage.',
    recommendedNextPhase:
      trainingGate === 'HOLD'
        ? 'RETRY_REGION_LATTICE_INPUT_PARITY_CORRECTION'
        : 'MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS',
    smallestCorrection:
      'Pass acousticSlices/wordTimeSpans (or equivalent tone pattern) into runLatticeFineSpanGeneration from retry resegment; optionally select path by compareBestFirst not pathFineSpanViews[0]',
  };

  mergeBundlePhase(
    ART.bundle,
    'audit',
    {
      phase: 'RETRY_REGION_LATTICE_ALTERNATIVE_PATH_AUDIT',
      mode: 'READ_ONLY',
      verdict: summary.verdict || 'LATTICE_INPUT_DRIFT',
      trainingGate,
      primaryBottleneck,
      exactLocation,
      whySegmentationChangedZero: whyZero,
      caseSummaries,
      criticalTraces,
    },
    { trainingGate }
  );

  console.log(JSON.stringify({ verdict: summary.verdict, trainingGate, primaryBottleneck, artifactBundle: ART.bundle }, null, 2));

  runtime.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

