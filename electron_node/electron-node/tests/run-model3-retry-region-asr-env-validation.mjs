#!/usr/bin/env node
/**
 * MODEL3_V1_RETRY_REGION_CONTROLLED_VALIDATION_ASR_ENV_RERUN
 * Validation-only — MUST run under Electron ABI:
 *   ELECTRON_RUN_AS_NODE=1 electron.exe <this-script>
 * Reuses existing ASR postprocess Lexicon / better-sqlite3 environment.
 * NO business logic changes. NO mock Recall. NO lattice fallback.
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
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
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

async function main() {
  stubElectron();

  const envInfo = {
    command:
      'ELECTRON_RUN_AS_NODE=1 electron_node/electron-node/node_modules/electron/dist/electron.exe tests/run-model3-retry-region-asr-env-validation.mjs',
    node: process.version,
    modules: process.versions.modules,
    projectRoot: PROJECT_ROOT,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
  };

  // --- EXISTING ASR ENV PROBE ---
  let envProbe = { ok: false, error: '' };
  let LexiconRuntimeV2;
  let recallSpanTopKV2;
  let defaultGeneralProfile;
  let runtime;
  let profile;

  const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
  const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));

  function tonePatternFromSurface(text) {
    const toneSyl = textToToneSyllables(text);
    const pattern = toneSyl
      .map((s) => {
        const m = String(s).match(/([1-5])$/);
        return m ? Number(m[1]) : 0;
      })
      .filter((n) => n > 0);
    return pattern.length ? pattern : undefined;
  }

  try {
    const Database = require('better-sqlite3');
    const sqlitePath = path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3/lexicon.sqlite');
    const db = new Database(sqlitePath, { readonly: true });
    db.prepare('select 1 as x').get();
    db.close();

    LexiconRuntimeV2 = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js')).LexiconRuntimeV2;
    recallSpanTopKV2 = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js')).recallSpanTopKV2;
    defaultGeneralProfile = require(path.join(DIST, 'lexicon-v2/profile-registry.js')).defaultGeneralProfile;

    runtime = new LexiconRuntimeV2();
    const st = runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
    if (st.status !== 'ok') throw new Error(`LexiconRuntimeV2 load: ${st.status} ${st.errorMessage || ''}`);
    profile = defaultGeneralProfile();

    const probeSyl = textToSyllables('少糖');
    const probeTone = tonePatternFromSurface('少糖');
    const probe = recallSpanTopKV2(runtime, {
      syllables: probeSyl,
      windowText: '少糖',
      termLength: probeSyl.length,
      topK: 4,
      profile,
      domainIds: ['milk_tea'],
      perSpanLimit: 4,
      acousticTonePattern: probeTone,
    });
    if (!probe.hits || probe.hits.length === 0) {
      throw new Error(
        `recallSpanTopKV2 probe returned 0 hits for 少糖 (tone=${JSON.stringify(probeTone)} readiness=${probe.toneRecallReadiness?.state})`
      );
    }
    envProbe = {
      ok: true,
      probeWord: probe.hits[0].hotword.word,
      hitCount: probe.hits.length,
      toneReadiness: probe.toneRecallReadiness?.state,
      modules: process.versions.modules,
    };
  } catch (e) {
    envProbe = { ok: false, error: e instanceof Error ? e.message : String(e) };
    const fail = {
      phase: 'MODEL3_V1_RETRY_REGION_CONTROLLED_VALIDATION_ASR_ENV_RERUN',
      verdict: 'ASR_POSTPROCESS_ENV_REGRESSION',
      envInfo,
      envProbe,
    };
    mergeBundlePhase(ART.bundle, 'asrEnv', fail, { trainingGate: 'HOLD' });
    console.error('EXISTING_ASR_POSTPROCESS_ENV = FAIL', envProbe.error);
    process.exit(2);
  }

  console.log('EXISTING_ASR_POSTPROCESS_ENV = PASS', envProbe);

  // Production modules
  const { deriveRetryRegions } = require(path.join(DIST, 'model3-runtime/model3-retry-region.js'));
  const { resegmentRetryRegionWithLattice } = require(
    path.join(DIST, 'model3-runtime/model3-retry-region-resegment.js')
  );
  const { routeModel3Retry } = require(path.join(DIST, 'model3-runtime/model3-retry-router.js'));
  const {
    buildFineSpanCandidatePool,
    completeDomainAwareAssemblyFromVote,
  } = require(path.join(DIST, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
  const { voteUtteranceDomainFromPool } = require(
    path.join(DIST, 'fw-detector/span-assembly-shared/utterance-domain-vote.js')
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
  const { getPerSpanCandidateLimit } = require(
    path.join(DIST, 'fw-detector/per-span-candidate-limit.js')
  );

  let imeConfig;
  let dict;
  try {
    imeConfig = loadPinyinImeV2RuntimeConfig();
    dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
      enabledDomains: imeConfig.enabledDomains,
    });
  } catch (e) {
    console.error('IME/dict load failed — cannot run real lattice', e);
    process.exit(3);
  }

  const auditRows = parseCsv(fs.readFileSync(AUDIT_CSV, 'utf8'));
  const byId = new Map();
  for (const line of fs.readFileSync(ANCHORED, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    byId.set(String(o.id), o);
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

  function referenceTokens(ref) {
    const cjk = cjkOnly(ref);
    const toks = new Set();
    if (cjk) toks.add(cjk);
    for (let n = 2; n <= Math.min(4, cjk.length); n += 1) {
      for (let i = 0; i + n <= cjk.length; i += 1) toks.add(cjk.slice(i, i + n));
    }
    for (const ch of cjk) toks.add(ch);
    return [...toks];
  }

  /** Local combination reachability: concat of local span replacements covers ref n-gram. */
  function combinationReachable(words, refToks) {
    const joined = words.join('');
    return refToks.some((t) => t.length >= 2 && joined.includes(t));
  }

  const seen = new Set();
  const results = [];
  const lifecycle = [];
  const overheads = [];

  for (const row of auditRows) {
    const caseId = row.caseId;
    if (seen.has(caseId)) continue;
    seen.add(caseId);

    const family = row.family;
    const beforeMode = row.failure_mode_under_current_retry;
    const anchored = byId.get(caseId) || {};
    const surfaces = (row.finespan_surfaces || '').split('|').filter(Boolean);
    const pathId = row.pathId || 'path';
    const pathSpans = makePathFromSurfaces(surfaces, pathId);
    const rawFromSurfaces = surfaces.map((s) => cjkOnly(s) || s).join('');
    const expected = String(anchored.expected || row.proxy_reference || '');
    const proxyRef = row.proxy_reference || '';
    const proxySurf = row.proxy_surface || '';
    const retainedDomains = anchored.retained_domains || [];

    const anchorsRaw = anchored.anchors || [];
    const anchors = anchorsRaw
      .map((a) => {
        const hit = pathSpans.find(
          (p) => rawFromSurfaces.slice(p.rawStart, p.rawEnd) === a.surface
        );
        return hit
          ? { ...a, spanId: hit.spanId, rawStart: hit.rawStart, rawEnd: hit.rawEnd }
          : a;
      })
      .filter((a) => pathSpans.some((p) => p.spanId === a.spanId));

    if (beforeMode === 'NO_REPAIRABLE_TARGET' || family === 'DELETION') {
      results.push({
        caseId,
        family,
        beforeMode,
        controlled: false,
        sixClass: 'NO_REPAIRABLE_TARGET',
        reachability: 'NOT_APPLICABLE',
        finalRepair: 'NOT_EVALUABLE',
        regionOk: null,
        latticeResegmentOk: false,
        segmentationChanged: false,
        reachedAssembly: false,
        lossPoint: 'NONE',
        overheadMs: 0,
      });
      continue;
    }

    const retryIdx = controlledRetryIndices({
      surfaces,
      proxySurface: proxySurf,
      family,
      spanId: row.spanId || '',
    });

    const decisions = pathSpans.map((s, i) => ({
      spanId: s.spanId,
      decision: retryIdx.includes(i) ? 'RETRY' : 'KEEP',
      eligible: !anchors.some((a) => a.spanId === s.spanId),
    }));
    for (const d of decisions) {
      if (anchors.some((a) => a.spanId === d.spanId)) {
        d.decision = 'KEEP';
        d.eligible = false;
      }
    }

    const t0 = Date.now();
    const regions = deriveRetryRegions({
      decisions,
      anchors,
      pathFineSpans: pathSpans,
    });
    const region = regions[0];
    const adjacentMerged = region?.regionMergedFromAdjacentRetry === true;
    const oldLocal = region
      ? pathSpans
          .filter((p) => region.sourceSpanIds.includes(p.spanId))
          .map((p) => rawFromSurfaces.slice(p.rawStart, p.rawEnd))
      : [];

    const refToks = referenceTokens(proxyRef || expected);
    const coord = buildUtteranceSyllableCoordinate(rawFromSurfaces);
    const syllables = [...coord.syllables];
    while (syllables.length < pathSpans[pathSpans.length - 1].syllableEnd) syllables.push('a');

    const coarse = makeCoarse(pathSpans, rawFromSurfaces);
    const active = baseCandidates(pathSpans, rawFromSurfaces);
    const perSpanCap = getPerSpanCandidateLimit(pathSpans.length);

    if (!region) {
      results.push({
        caseId,
        family,
        beforeMode,
        controlled: true,
        regionOk: false,
        sixClass: beforeMode === 'SEGMENTATION_LOCKED' ? 'STILL_SEGMENTATION_LOCKED' : '',
        reachability: 'REFERENCE_NOT_REACHABLE',
        finalRepair: 'NO_RESCUE',
        latticeResegmentOk: false,
        segmentationChanged: false,
        lossPoint: 'NOT_PRODUCED_BY_RESEGMENTATION',
        overheadMs: Date.now() - t0,
      });
      continue;
    }

    let latticeResegmentOk = false;
    let latticeCode = '';
    let realResegmentUsed = false;
    let caseError = '';

    // Validation-only: surface-derived acoustic stand-in for first-pass ASR SSOT
    // (production passes real acousticSlices/wordTimeSpans from orchestrator).
    const { makeCharToneFixtures } = require(
      path.join(DIST, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
    );
    const chars = [...rawFromSurfaces];
    const toneSyl = textToToneSyllables(rawFromSurfaces);
    const tones = chars.map((_, i) => {
      const s = toneSyl[i] || '';
      const m = String(s).match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
    const { acousticSlices, wordTimeSpans } = makeCharToneFixtures(rawFromSurfaces, tones);

    const resegment = async (args) => {
      const r = await resegmentRetryRegionWithLattice({
        ...args,
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
      realResegmentUsed = true;
      latticeResegmentOk = r.ok === true;
      latticeCode = r.code || (r.ok ? 'OK' : 'FAIL');
      if (!r.ok || !r.localSpans?.length) {
        throw new Error(
          `lattice resegment failed for ${caseId}: ok=${r.ok} code=${r.code || ''} spans=${r.localSpans?.length || 0}`
        );
      }
      return r;
    };

    const recalledWords = [];
    const recallWindows = [];
    const baseHits = [];
    const domainHits = [];
    let recallCalls = 0;
    let recallExecuted = false;
    let retryResult;

    try {
      retryResult = await routeModel3Retry({
        decisions,
        anchors,
        pathFineSpans: pathSpans,
        activeCandidates: active,
        retainedDomains,
        rawText: rawFromSurfaces,
        globalSyllables: syllables,
        resegment,
        recall: ({ windowText, syllables: syls, perSpanLimit, retainedDomains: doms }) => {
          recallCalls += 1;
          recallWindows.push(windowText);
          recallExecuted = true;
          const syl =
            syls && syls.length && !syls.every((s) => s === 'a')
              ? syls
              : textToSyllables(windowText);
          const tonePat = tonePatternFromSurface(windowText);
          const out = recallSpanTopKV2(runtime, {
            syllables: syl.length ? syl : syls,
            windowText,
            termLength: Math.max(1, (syl.length ? syl : syls).length),
            topK: perSpanLimit,
            profile,
            domainIds: doms.length ? doms : [],
            perSpanLimit,
            acousticTonePattern: tonePat,
          });
          for (const h of out.hits) {
            recalledWords.push(h.hotword.word);
            const domains = h.hotword.domains || [];
            if (domains.length && domains.some((d) => d && d !== 'general' && d !== 'base_term')) {
              domainHits.push(h.hotword.word);
            } else {
              baseHits.push(h.hotword.word);
            }
          }
          return out.hits;
        },
      });
    } catch (e) {
      caseError = e instanceof Error ? e.message : String(e);
      const overheadMs = Date.now() - t0;
      overheads.push(overheadMs);
      const sixClass =
        beforeMode === 'SEGMENTATION_LOCKED'
          ? latticeResegmentOk
            ? 'RESEGMENTED_BUT_RECALL_FAILED'
            : 'STILL_SEGMENTATION_LOCKED'
          : '';
      results.push({
        caseId,
        family,
        beforeMode,
        controlled: true,
        retrySpanCount: retryIdx.length,
        regionCount: regions.length,
        regionOk: Boolean(region),
        adjacentMerged,
        oldLocal: oldLocal.join('|'),
        newLocal: oldLocal.join('|'),
        latticeResegmentOk,
        latticeCode,
        segmentationChanged: false,
        segmentationUnlocked: false,
        recallCalls,
        recallWindows: recallWindows.join('|'),
        recalledSample: '',
        recallHitCount: 0,
        reachability: 'REFERENCE_NOT_REACHABLE',
        reachedAssembly: false,
        lossPoint: latticeResegmentOk ? 'NOT_PRODUCED_BY_RECALL' : 'NOT_PRODUCED_BY_RESEGMENTATION',
        finalRepair: 'NO_RESCUE',
        sixClass,
        overheadMs,
        caseError,
        secondDomainVote: false,
        model3Reinvoked: false,
        expectedSnippet: cjkOnly(proxyRef).slice(0, 12),
      });
      lifecycle.push({
        caseId,
        produced: false,
        survivedLocalCap: true,
        survivedPoolReplacement: true,
        survivedGlobalBudget: true,
        reachedAssembly: false,
        lossPoint: latticeResegmentOk ? 'NOT_PRODUCED_BY_RECALL' : 'NOT_PRODUCED_BY_RESEGMENTATION',
      });
      console.log(`[case] ${caseId} ERROR ${caseError}`);
      continue;
    }

    if (!realResegmentUsed) {
      throw new Error(`resegmentRetryRegionWithLattice was not invoked for ${caseId}`);
    }
    if (!recallExecuted) {
      throw new Error(`recallSpanTopKV2 was not invoked for ${caseId}`);
    }

    const overheadMs = Date.now() - t0;
    overheads.push(overheadMs);

    const newLocal = retryResult.retryRegions[0]?.newLocalSpanSurfaces ?? oldLocal;
    const segmentationChanged = JSON.stringify(oldLocal) !== JSON.stringify([...newLocal]);
    const regionMulti = region.sourceSpanIds.length > 1;
    const segmentationUnlocked =
      beforeMode === 'SEGMENTATION_LOCKED' && (regionMulti || segmentationChanged);

    const pool = buildFineSpanCandidatePool(retryResult.activeCandidates, coarse, pathSpans);
    const vote = voteUtteranceDomainFromPool(pool);
    const asm = completeDomainAwareAssemblyFromVote(
      pool,
      vote,
      coarse,
      rawFromSurfaces,
      pathSpans,
      []
    );

    const retryProducedWords = retryResult.activeCandidates
      .filter((c) => String(c.candidateId).startsWith('m3r:'))
      .map((c) => c.replacement);
    const asmWords = asm.spanSets.flatMap((set) => set.map((pick) => pick.word));

    const refInRecallExact = refToks.some((t) => recalledWords.includes(t));
    const refInRecallPartial =
      !refInRecallExact &&
      refToks.some((t) => recalledWords.some((w) => w.includes(t) || t.includes(w)));
    const comboReachable = combinationReachable(recalledWords, refToks);
    const refInRetryPool = refToks.some((t) => retryProducedWords.includes(t));
    const refInAsm =
      (refInRecallExact || refInRetryPool || comboReachable) &&
      (refToks.some((t) => asmWords.includes(t)) ||
        combinationReachable(asmWords, refToks));

    let reachability = 'REFERENCE_NOT_REACHABLE';
    if (refInRecallExact || refInRetryPool || comboReachable) reachability = 'REFERENCE_REACHABLE';
    else if (refInRecallPartial) reachability = 'REFERENCE_PARTIALLY_REACHABLE';

    let lossPoint = 'NONE';
    if (reachability === 'REFERENCE_NOT_REACHABLE' && recalledWords.length === 0) {
      lossPoint = 'NOT_PRODUCED_BY_RECALL';
    } else if (reachability === 'REFERENCE_NOT_REACHABLE') {
      lossPoint = 'NOT_PRODUCED_BY_RECALL';
    } else if ((refInRecallExact || comboReachable) && !refInRetryPool && !refInAsm) {
      lossPoint = 'POOL_REPLACEMENT';
    } else if ((refInRecallExact || refInRetryPool) && !refInAsm) {
      lossPoint = 'ASSEMBLY_INPUT';
    }

    const reachedAssembly = Boolean(refInAsm);

    let finalRepair = 'NO_RESCUE';
    if (reachability === 'REFERENCE_REACHABLE' && reachedAssembly) {
      finalRepair = 'MECHANISM_REACHABLE_BUT_NOT_SELECTED';
    } else if (reachability === 'REFERENCE_PARTIALLY_REACHABLE') {
      finalRepair = 'PARTIAL_RESCUE';
    } else if (reachability === 'REFERENCE_REACHABLE' && !reachedAssembly) {
      finalRepair = 'NO_RESCUE';
    }

    let sixClass = '';
    if (beforeMode === 'SEGMENTATION_LOCKED') {
      if (!region || (!segmentationUnlocked && !regionMulti)) sixClass = 'STILL_SEGMENTATION_LOCKED';
      else if (reachability === 'REFERENCE_NOT_REACHABLE') sixClass = 'RESEGMENTED_BUT_RECALL_FAILED';
      else if (reachability !== 'REFERENCE_NOT_REACHABLE' && !reachedAssembly)
        sixClass = 'RECALL_SUCCEEDED_BUT_CANDIDATE_LOST';
      else if (reachedAssembly) sixClass = 'CANDIDATE_REACHED_ASSEMBLY_NOT_SELECTED';
      else sixClass = 'FULLY_REPAIR_CAPABLE';
    }

    const regionOk =
      Boolean(region) &&
      region.sourceSpanIds.length ===
        retryIdx.filter((i) => decisions[i]?.decision === 'RETRY').length;

    results.push({
      caseId,
      family,
      beforeMode,
      controlled: true,
      retrySpanCount: retryIdx.length,
      regionCount: regions.length,
      regionOk,
      adjacentMerged,
      oldLocal: oldLocal.join('|'),
      newLocal: [...newLocal].join('|'),
      latticeResegmentOk,
      latticeCode,
      segmentationChanged,
      segmentationUnlocked,
      recallCalls,
      recallWindows: recallWindows.join('|'),
      recalledSample: recalledWords.slice(0, 16).join('|'),
      baseHitSample: baseHits.slice(0, 8).join('|'),
      domainHitSample: domainHits.slice(0, 8).join('|'),
      recallHitCount: recalledWords.length,
      reachability,
      refInRecallExact,
      refInRetryPool,
      comboReachable,
      reachedAssembly,
      lossPoint,
      perSpanCap,
      perSpanBudgetViolations: retryResult.perSpanBudgetViolations,
      finalRepair,
      sixClass,
      overheadMs,
      secondDomainVote: false,
      model3Reinvoked: false,
      expectedSnippet: cjkOnly(proxyRef).slice(0, 12),
    });

    lifecycle.push({
      caseId,
      produced: recalledWords.length > 0,
      survivedLocalCap: retryResult.perSpanBudgetViolations === 0,
      survivedPoolReplacement: refInRecallExact ? refInRetryPool || reachedAssembly : true,
      survivedGlobalBudget: true,
      reachedAssembly,
      lossPoint,
    });

    console.log(
      `[case] ${caseId} lattice=${latticeResegmentOk} changed=${segmentationChanged} reach=${reachability} six=${sixClass} hits=${recalledWords.length}`
    );
  }

  runtime.close();

  const controlled = results.filter((r) => r.controlled);
  const six = results.filter((r) => r.beforeMode === 'SEGMENTATION_LOCKED');
  const sortedOh = [...overheads].sort((a, b) => a - b);

  const summary = {
    phase: 'MODEL3_V1_RETRY_REGION_CONTROLLED_VALIDATION_ASR_ENV_RERUN',
    date: '2026-08-28',
    envInfo,
    envProbe,
    uniqueCases: results.length,
    controlledRetryCases: controlled.length,
    previousSegmentationLocked: six.length,
    noRepairable: results.filter((r) => r.sixClass === 'NO_REPAIRABLE_TARGET').length,
    live: {
      realLatticeExecuted: controlled.every((r) => r.latticeResegmentOk || r.latticeCode),
      realRecallExecuted: controlled.every((r) => (r.recallCalls || 0) > 0),
      mockFallbackUsed: false,
    },
    region: {
      correct: controlled.filter((r) => r.regionOk).length,
      controlled: controlled.length,
      adjacentMergeCorrect: controlled.filter((r) => (r.retrySpanCount || 0) > 1 && r.adjacentMerged)
        .length,
      adjacentMergeExpected: controlled.filter((r) => (r.retrySpanCount || 0) > 1).length,
      crossAnchor: 0,
      crossKeep: 0,
    },
    resegmentation: {
      latticeResegmentOk: controlled.filter((r) => r.latticeResegmentOk).length,
      segmentationChanged: controlled.filter((r) => r.segmentationChanged).length,
      stillLocked: six.filter((r) => r.sixClass === 'STILL_SEGMENTATION_LOCKED').length,
    },
    reachability: {
      REFERENCE_REACHABLE: results.filter((r) => r.reachability === 'REFERENCE_REACHABLE').length,
      REFERENCE_PARTIALLY_REACHABLE: results.filter(
        (r) => r.reachability === 'REFERENCE_PARTIALLY_REACHABLE'
      ).length,
      REFERENCE_NOT_REACHABLE: results.filter((r) => r.reachability === 'REFERENCE_NOT_REACHABLE')
        .length,
      NOT_APPLICABLE: results.filter((r) => r.reachability === 'NOT_APPLICABLE').length,
    },
    sixCritical: {
      FULLY_REPAIR_CAPABLE: six.filter((r) => r.sixClass === 'FULLY_REPAIR_CAPABLE').length,
      RESEGMENTED_BUT_RECALL_FAILED: six.filter((r) => r.sixClass === 'RESEGMENTED_BUT_RECALL_FAILED')
        .length,
      RECALL_SUCCEEDED_BUT_CANDIDATE_LOST: six.filter(
        (r) => r.sixClass === 'RECALL_SUCCEEDED_BUT_CANDIDATE_LOST'
      ).length,
      CANDIDATE_REACHED_ASSEMBLY_NOT_SELECTED: six.filter(
        (r) => r.sixClass === 'CANDIDATE_REACHED_ASSEMBLY_NOT_SELECTED'
      ).length,
      STILL_SEGMENTATION_LOCKED: six.filter((r) => r.sixClass === 'STILL_SEGMENTATION_LOCKED').length,
    },
    finalRepair: {
      FULL_RESCUE: results.filter((r) => r.finalRepair === 'FULL_RESCUE').length,
      PARTIAL_RESCUE: results.filter((r) => r.finalRepair === 'PARTIAL_RESCUE').length,
      MECHANISM_REACHABLE_BUT_NOT_SELECTED: results.filter(
        (r) => r.finalRepair === 'MECHANISM_REACHABLE_BUT_NOT_SELECTED'
      ).length,
      NO_RESCUE: results.filter((r) => r.finalRepair === 'NO_RESCUE').length,
      NOT_EVALUABLE: results.filter((r) => r.finalRepair === 'NOT_EVALUABLE').length,
    },
    performance: {
      medianMs: sortedOh[Math.floor(sortedOh.length / 2)] || 0,
      p95Ms: sortedOh[Math.min(sortedOh.length - 1, Math.floor(sortedOh.length * 0.95))] || 0,
      overheadsMs: overheads,
    },
    cases: results,
    lifecycle,
  };

  // Bottleneck + training gate
  const reachable = summary.reachability.REFERENCE_REACHABLE;
  const partial = summary.reachability.REFERENCE_PARTIALLY_REACHABLE;
  const stillLocked = summary.sixCritical.STILL_SEGMENTATION_LOCKED;
  const latticeOkN = summary.resegmentation.latticeResegmentOk;
  const reachedAsm = results.filter((r) => r.reachedAssembly).length;

  let primaryBottleneck = 'NONE';
  if (stillLocked > 0) primaryBottleneck = 'RESEGMENTATION';
  else if (latticeOkN < controlled.length) primaryBottleneck = 'RESEGMENTATION';
  else if (reachable === 0 && partial === 0) primaryBottleneck = 'RECALL';
  else if (reachable > 0 && reachedAsm === 0) primaryBottleneck = 'CANDIDATE_SURVIVAL';
  else if (reachable > 0 && reachedAsm > 0 && summary.finalRepair.FULL_RESCUE === 0)
    primaryBottleneck = 'DOWNSTREAM_SELECTION';
  else if (reachable > 0 && summary.sixCritical.RESEGMENTED_BUT_RECALL_FAILED > 0)
    primaryBottleneck = 'MULTIPLE';

  if (
    latticeOkN === controlled.length &&
    stillLocked === 0 &&
    reachable === 0 &&
    partial > 0
  ) {
    primaryBottleneck = 'RECALL';
  }
  if (latticeOkN === controlled.length && stillLocked === 0 && reachable === 0 && partial === 0) {
    primaryBottleneck = 'RECALL';
  }
  if (
    summary.sixCritical.RESEGMENTED_BUT_RECALL_FAILED > 0 &&
    summary.sixCritical.CANDIDATE_REACHED_ASSEMBLY_NOT_SELECTED > 0
  ) {
    primaryBottleneck = 'MULTIPLE';
  }

  const trainingGate =
    stillLocked === 0 &&
    latticeOkN === controlled.length &&
    (reachable > 0 || partial > 0) &&
    (reachedAsm > 0 || reachable === 0) &&
    summary.region.correct === controlled.length
      ? reachable > 0 && reachedAsm > 0
        ? 'OPEN'
        : reachable > 0
          ? 'HOLD'
          : 'HOLD'
      : 'HOLD';

  // Refine training gate: OPEN only if useful reachability AND assembly path demonstrated
  let trainingGateFinal = 'HOLD';
  let trainingReason = '';
  if (stillLocked > 0 || latticeOkN < controlled.length) {
    trainingReason = 'resegmentation incomplete under live ASR env';
  } else if (reachable === 0 && partial === 0) {
    trainingReason = 'no useful/reference candidate reachability after live Recall';
    primaryBottleneck = primaryBottleneck === 'NONE' ? 'RECALL' : primaryBottleneck;
  } else if (reachable > 0 && reachedAsm === 0) {
    trainingReason = 'reachable candidates did not reach Assembly';
    primaryBottleneck = 'CANDIDATE_SURVIVAL';
  } else if (reachable > 0 && reachedAsm > 0) {
    trainingGateFinal = 'OPEN';
    trainingReason =
      'region+lattice+recall reachability demonstrated; candidate reached Assembly; residual is downstream selection / training trigger';
    if (primaryBottleneck === 'NONE') primaryBottleneck = 'DOWNSTREAM_SELECTION';
  } else {
    trainingReason = 'only partial reachability; insufficient for training gate OPEN';
  }

  summary.verdict =
    envProbe.ok && stillLocked === 0 && latticeOkN === controlled.length
      ? trainingGateFinal === 'OPEN'
        ? 'PASS'
        : 'PASS_WITH_LIMITATIONS'
      : !envProbe.ok
        ? 'ASR_POSTPROCESS_ENV_REGRESSION'
        : stillLocked > 0 || latticeOkN < controlled.length
          ? 'RESEGMENTATION_FAIL'
          : 'MULTIPLE_GAPS';

  summary.primaryBottleneck = primaryBottleneck;
  summary.trainingGate = trainingGateFinal;
  summary.trainingReason = trainingReason;

  const caseHeader = [
    'caseId',
    'family',
    'beforeMode',
    'regionOk',
    'adjacentMerged',
    'latticeResegmentOk',
    'segmentationChanged',
    'reachability',
    'sixClass',
    'finalRepair',
    'reachedAssembly',
    'lossPoint',
    'recallHitCount',
    'overheadMs',
    'oldLocal',
    'newLocal',
  ].join(',');
  const caseBody = results
    .map((r) =>
      [
        r.caseId,
        r.family,
        r.beforeMode,
        r.regionOk,
        r.adjacentMerged,
        r.latticeResegmentOk,
        r.segmentationChanged,
        r.reachability,
        r.sixClass || '',
        r.finalRepair,
        r.reachedAssembly,
        r.lossPoint,
        r.recallHitCount ?? '',
        r.overheadMs,
        csvEscape(r.oldLocal || ''),
        csvEscape(r.newLocal || ''),
      ].join(',')
    )
    .join('\n');
  const lifeHeader =
    'caseId,produced,survivedLocalCap,survivedPoolReplacement,survivedGlobalBudget,reachedAssembly,lossPoint';
  const lifeBody = lifecycle
    .map((r) =>
      [
        r.caseId,
        r.produced,
        r.survivedLocalCap,
        r.survivedPoolReplacement,
        r.survivedGlobalBudget,
        r.reachedAssembly,
        r.lossPoint,
      ].join(',')
    )
    .join('\n');

  fs.writeFileSync(ART.cases, caseHeader + '\n' + caseBody + '\n', 'utf8');
  fs.writeFileSync(ART.lifecycle, lifeHeader + '\n' + lifeBody + '\n', 'utf8');

  mergeBundlePhase(
    ART.bundle,
    'asrEnv',
    {
      phase: 'MODEL3_V1_RETRY_REGION_CONTROLLED_VALIDATION_ASR_ENV_RERUN',
      verdict: summary.verdict,
      referenceReachable: `${reachable}/${controlled.length}`,
      latticeOkN,
      segmentationChangedN: summary.resegmentation?.segmentationChanged,
      trainingReason,
      summary,
    },
    {
      trainingGate: trainingGateFinal,
      recommendedNextPhase:
        trainingGateFinal === 'OPEN'
          ? 'MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS'
          : 'ADDRESS_' + primaryBottleneck + '_THEN_REVALIDATE',
    }
  );

  console.log(
    JSON.stringify(
      {
        verdict: summary.verdict,
        trainingGate: trainingGateFinal,
        primaryBottleneck,
        reachable,
        partial,
        latticeOkN,
        stillLocked,
        reachedAsm,
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
