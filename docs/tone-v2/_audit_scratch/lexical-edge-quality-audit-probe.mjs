/**
 * LexicalEdge Quality Audit probe — READ ONLY.
 * Does not modify Window/Recall/Edge/Path/Fallback business code.
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\lexical-edge-quality-audit-probe.mjs
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, 'lattice_v1_lexical_edge_quality');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;
fs.mkdirSync(outDir, { recursive: true });

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { syllableRangeToRawCharRange } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff.js')
);
const { injectFallbackEdges } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/inject-fallback-edges.js')
);
const { enumerateCompleteSegmentationPaths } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.js')
);
const { V4_LIMITS } = require(path.join(dist, 'fw-detector/span-assembly-v4/v4-limits.js'));

const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
if (loadState.status !== 'ok') {
  console.error('lexicon load failed', loadState);
  process.exit(1);
}

const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });

const stmtWordExact = db.prepare(
  `SELECT id, word, pinyin_key, tone_pinyin_key, prior_score, enabled, source
   FROM term WHERE word = ? LIMIT 20`
);
const stmtWordLike = db.prepare(
  `SELECT id, word, pinyin_key, tone_pinyin_key, prior_score, enabled, source
   FROM term WHERE word LIKE ? LIMIT 20`
);
const stmtBaseByWord = db.prepare(
  `SELECT id, word, pinyin_key, prior_score, enabled, source FROM base_lexicon WHERE word = ? LIMIT 20`
);
const stmtDomainTags = db.prepare(
  `SELECT domain_id, weight FROM term_domain_tags WHERE term_id = ?`
);

function lookupSurface(surface) {
  if (!surface || !surface.trim()) return { inTerm: [], inBase: [], tags: [] };
  const inTerm = stmtWordExact.all(surface);
  const inBase = stmtBaseByWord.all(surface);
  const tags = [];
  for (const t of inTerm.slice(0, 5)) {
    tags.push({ termId: t.id, domains: stmtDomainTags.all(t.id) });
  }
  return { inTerm, inBase, tags };
}

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({
  configEnabledDomains: fwConfig.enabledDomains,
}).domainIds;

const cases = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
).cases.filter((c) => typeof c.text === 'string' && c.text.length > 0);

function buildOutgoing(edges, N) {
  const out = Array.from({ length: N + 1 }, () => []);
  for (const e of edges) {
    if (e.edgeKind && e.edgeKind !== 'lexical') continue;
    out[e.syllableStart].push(e);
  }
  return out;
}

function reachableForward(outgoing, N) {
  const seen = new Array(N + 1).fill(false);
  const q = [0];
  seen[0] = true;
  while (q.length) {
    const p = q.shift();
    for (const e of outgoing[p] || []) {
      if (!seen[e.syllableEnd]) {
        seen[e.syllableEnd] = true;
        q.push(e.syllableEnd);
      }
    }
  }
  return seen;
}

function reachableBackward(edges, N) {
  const incoming = Array.from({ length: N + 1 }, () => []);
  for (const e of edges) {
    if (e.edgeKind && e.edgeKind !== 'lexical') continue;
    incoming[e.syllableEnd].push(e);
  }
  const seen = new Array(N + 1).fill(false);
  const q = [N];
  seen[N] = true;
  while (q.length) {
    const p = q.shift();
    for (const e of incoming[p] || []) {
      if (!seen[e.syllableStart]) {
        seen[e.syllableStart] = true;
        q.push(e.syllableStart);
      }
    }
  }
  return seen;
}

function classifyBreakpoint(pos, phase1, outgoing, fwd, bwd, N) {
  const windowsAt = phase1.filteredWindows.filter((w) => w.syllableStart === pos);
  const blocked = windowsAt.filter((w) => w.blocked);
  const recallable = windowsAt.filter((w) => !w.blocked);
  const recalled = phase1.recalledWindows.filter((w) => Number(w.windowId.split(':')[0]) === pos);
  const hitCount = recalled.reduce((n, w) => n + (w.candidates?.length || 0), 0);
  const outs = outgoing[pos] || [];

  if (windowsAt.length === 0) return { reason: 'NO_WINDOW', hitCount, outs: outs.length, blocked: blocked.length };
  if (recallable.length === 0 && blocked.length > 0) {
    return {
      reason: 'ALL_WINDOWS_BLOCKED',
      hitCount,
      outs: outs.length,
      blocked: blocked.length,
      blockedReasons: [...new Set(blocked.map((w) => w.blockedBoundaryReason).filter(Boolean))],
    };
  }
  if (outs.length === 0) {
    if (hitCount === 0) return { reason: 'RECALL_ZERO_HIT', hitCount, outs: 0, blocked: blocked.length };
    return { reason: 'EDGE_DROPPED', hitCount, outs: 0, blocked: blocked.length };
  }
  // Has outgoing but still stuck: all ends cannot reach N or don't advance usefully
  const anyUseful = outs.some((e) => bwd[e.syllableEnd]);
  if (!anyUseful) return { reason: 'EDGE_EXISTS_BUT_DEAD_END', hitCount, outs: outs.length, blocked: blocked.length };
  return { reason: 'OTHER', hitCount, outs: outs.length, blocked: blocked.length };
}

function reclassifyUnknownFallback(pos, outgoing, fwd, bwd, N, minCostUsedFallback) {
  const outs = outgoing[pos] || [];
  if (!outs.length) return { class: 'EDGE_GRAPH_GAP', detail: 'no outgoing at fallback pos' };
  const ends = outs.map((e) => e.syllableEnd);
  const anyEndReachN = ends.some((end) => bwd[end]);
  const startReachable = fwd[pos] === true;
  if (!startReachable) return { class: 'ORPHAN_LEXICAL_EDGE', detail: `start ${pos} not reachable from 0` };
  if (!anyEndReachN) return { class: 'DEAD_END_LEXICAL_BRANCH', detail: `outs→${ends.join(',')} cannot reach N` };
  // Lexical outs exist and some can reach N — DP still chose fallback because alternate min path
  if (minCostUsedFallback) {
    return {
      class: 'LEXICAL_EDGE_HIGHER_FALLBACK_COST_PATH',
      detail: 'lexical branch exists to N but min-cost DP chose another path using this fallback',
    };
  }
  return { class: 'DP_TIE_BREAK', detail: 'possible deterministic parent tie-break' };
}

function asciiGraph(N, edges, breakpoint, fallbacks) {
  const lex = edges
    .filter((e) => !e.edgeKind || e.edgeKind === 'lexical')
    .map((e) => `${e.syllableStart}-${e.syllableEnd}`)
    .sort();
  const fb = (fallbacks || []).map((p) => `${p}-${p + 1}`);
  return {
    positions: `0..${N}`,
    lexical: lex,
    fallback: fb,
    breakpoint: breakpoint == null ? null : String(breakpoint),
  };
}

// Aggregates
const positionRows = [];
const breakpointRows = [];
const noHitCases = [];
const hardBlockCases = [];
const candidateDropCases = [];
const deadEndCases = [];
const unknownReclass = [];
const missingSurfaceFreq = new Map();

const summary = {
  utterances: 0,
  completePathRate: 0,
  completePathCount: 0,
  totalPositions: 0,
  positionsWithNoWindow: 0,
  positionsWithOnlyBlockedWindows: 0,
  positionsWithRecallableWindows: 0,
  positionsWithLexiconHit: 0,
  positionsWithOutgoingLexicalEdge: 0,
  positionsReachableFromStart: 0,
  breakpointDist: {},
  blockedReasonDist: {},
  edgeLenDist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  edgeLenDeadEnd: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  edgeLenOrphan: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  singleSyllableWindowCount: 0,
  singleSyllableRecallHitCount: 0,
  singleSyllableLexicalEdgeCount: 0,
  baseEdgeCount: 0,
  domainEdgeCount: 0,
  multiDomainEdgeCount: 0,
  candidateProducedButNoEdgeCount: 0,
  duplicateBoundaryInputCount: 0,
  mergedBoundaryCount: 0,
  unknownOriginal: 0,
  unknownRemaining: 0,
  unknownReclassDist: {},
  fallbackInjectionSum: 0,
  firstBreakpointSentences: {},
  multiPathUtterances: 0,
  highFallbackCases: [],
  representative: { noHit: [], hardBlock: [], deadEnd: [], multiPath: [], highFb: [] },
};

for (const c of cases) {
  const caseId = c.id || c.caseId;
  const phase1 = runPhase1WindowEdgeHarness({
    rawText: c.text,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
  });
  const coord = buildUtteranceSyllableCoordinate(c.text);
  const N = phase1.syllableCount;
  const edges = phase1.edges;
  const outgoing = buildOutgoing(edges, N);
  const fwd = reachableForward(outgoing, N);
  const bwd = reachableBackward(edges, N);
  const lexicalComplete = fwd[N] === true;

  const inj = injectFallbackEdges({ syllableCount: N, lexicalEdges: edges });
  const fbPositions = [];
  for (const r of inj.fallbackInjectionRanges) {
    for (let p = r.start; p < r.end; p += 1) fbPositions.push(p);
  }
  const enumAfter = enumerateCompleteSegmentationPaths({
    syllableCount: N,
    lexicalEdges: inj.edges,
    limits: {
      maxActivePathsPerPosition: V4_LIMITS.maxActivePathsPerPosition,
      maxCompleteSegmentationPaths: V4_LIMITS.maxCompleteSegmentationPaths,
    },
  });

  summary.utterances += 1;
  summary.totalPositions += N;
  if (lexicalComplete) summary.completePathCount += 1;
  summary.fallbackInjectionSum += inj.fallbackInjectionCount;
  if (enumAfter.retainedCompletePathCount > 1) {
    summary.multiPathUtterances += 1;
    if (summary.representative.multiPath.length < 10) {
      summary.representative.multiPath.push(caseId);
    }
  }
  if (inj.fallbackInjectionCount >= 15 && summary.highFallbackCases.length < 30) {
    summary.highFallbackCases.push({ caseId, fb: inj.fallbackInjectionCount, N, edges: edges.length });
  }
  if (inj.fallbackInjectionCount >= 15 && summary.representative.highFb.length < 10) {
    summary.representative.highFb.push(caseId);
  }

  // Candidate → edge: windows with candidates but no edge for that boundary
  const edgeBoundaries = new Set(edges.map((e) => `${e.syllableStart}:${e.syllableEnd}`));
  const seenBundles = new Set();
  for (const w of phase1.recalledWindows) {
    if (!w.candidates?.length) continue;
    const [s, e] = w.windowId.split(':').map(Number);
    const key = `${s}:${e}`;
    if (seenBundles.has(key)) {
      summary.duplicateBoundaryInputCount += 1;
    }
    seenBundles.add(key);
    if (!edgeBoundaries.has(key)) {
      summary.candidateProducedButNoEdgeCount += 1;
      candidateDropCases.push({
        sentenceId: caseId,
        windowId: w.windowId,
        candidateCount: w.candidates.length,
        replacements: w.candidates.slice(0, 5).map((x) => x.replacement),
      });
    }
  }
  summary.mergedBoundaryCount += edgeBoundaries.size;

  // First breakpoint
  let firstBreakpoint = null;
  if (!lexicalComplete) {
    let maxReach = 0;
    for (let i = 0; i <= N; i += 1) if (fwd[i]) maxReach = i;
    firstBreakpoint = maxReach;
  }
  let bpClass = null;
  if (firstBreakpoint != null && firstBreakpoint < N) {
    bpClass = classifyBreakpoint(firstBreakpoint, phase1, outgoing, fwd, bwd, N);
    summary.breakpointDist[bpClass.reason] = (summary.breakpointDist[bpClass.reason] || 0) + 1;
    summary.firstBreakpointSentences[bpClass.reason] =
      summary.firstBreakpointSentences[bpClass.reason] || [];
    if (summary.firstBreakpointSentences[bpClass.reason].length < 12) {
      summary.firstBreakpointSentences[bpClass.reason].push(caseId);
    }
    const rawRange = syllableRangeToRawCharRange(coord.ranges, firstBreakpoint, firstBreakpoint + 1);
    breakpointRows.push({
      sentenceId: caseId,
      rawText: c.text,
      syllableCount: N,
      firstBreakpoint,
      reachablePrefixEnd: firstBreakpoint,
      reverseReachableSuffixStart: (() => {
        for (let i = 0; i <= N; i += 1) if (bwd[i]) return i;
        return N;
      })(),
      reason: bpClass.reason,
      detail: bpClass,
      rawTextAtBreakpoint: rawRange ? c.text.slice(rawRange.start, rawRange.end) : null,
      graph: asciiGraph(N, edges, firstBreakpoint, fbPositions),
      lexicalEdgeCount: edges.length,
      fallbackInjectionCount: inj.fallbackInjectionCount,
      boundaryKeys: enumAfter.paths.map((p) => p.boundaryKey),
    });
  }

  // Edge stats
  for (const e of edges) {
    const len = e.syllableEnd - e.syllableStart;
    if (len >= 1 && len <= 5) summary.edgeLenDist[len] += 1;
    const orphan = !fwd[e.syllableStart];
    const deadEnd = fwd[e.syllableStart] && !bwd[e.syllableEnd];
    if (orphan && len >= 1 && len <= 5) summary.edgeLenOrphan[len] += 1;
    if (deadEnd && len >= 1 && len <= 5) {
      summary.edgeLenDeadEnd[len] += 1;
      if (deadEndCases.length < 500) {
        deadEndCases.push({
          sentenceId: caseId,
          edgeId: e.edgeId,
          start: e.syllableStart,
          end: e.syllableEnd,
          replacements: e.candidates.slice(0, 3).map((x) => x.replacement),
        });
      }
    }
    if (len === 1) summary.singleSyllableLexicalEdgeCount += 1;

    const domains = new Set();
    let hasBase = false;
    for (const cand of e.candidates) {
      if (cand.source === 'base_term') hasBase = true;
      for (const d of cand.domains || []) {
        if (d && d !== 'general' && d !== 'base_term') domains.add(d);
      }
    }
    if (hasBase || domains.size === 0) summary.baseEdgeCount += 1;
    if (domains.size === 1) summary.domainEdgeCount += 1;
    if (domains.size >= 2) summary.multiDomainEdgeCount += 1;
  }

  // Per-position matrix
  for (let pos = 0; pos < N; pos += 1) {
    const windowsAt = phase1.windows.filter((w) => w.syllableStart === pos);
    const filteredAt = phase1.filteredWindows.filter((w) => w.syllableStart === pos);
    const blocked = filteredAt.filter((w) => w.blocked);
    const recallable = filteredAt.filter((w) => !w.blocked);
    const recalled = phase1.recalledWindows.filter((w) => Number(w.windowId.split(':')[0]) === pos);
    const hitCount = recalled.reduce((n, w) => n + (w.candidates?.length || 0), 0);
    const outs = outgoing[pos] || [];
    const rawRange = syllableRangeToRawCharRange(coord.ranges, pos, pos + 1);
    const rawTextAt = rawRange ? c.text.slice(rawRange.start, rawRange.end) : '';
    const pinyin = coord.syllables[pos] || '';

    if (windowsAt.length === 0) summary.positionsWithNoWindow += 1;
    else if (recallable.length === 0 && blocked.length > 0) summary.positionsWithOnlyBlockedWindows += 1;
    if (recallable.length > 0) summary.positionsWithRecallableWindows += 1;
    if (hitCount > 0) summary.positionsWithLexiconHit += 1;
    if (outs.length > 0) summary.positionsWithOutgoingLexicalEdge += 1;
    if (fwd[pos]) summary.positionsReachableFromStart += 1;

    for (const w of blocked) {
      const r = w.blockedBoundaryReason || 'other';
      summary.blockedReasonDist[r] = (summary.blockedReasonDist[r] || 0) + 1;
    }

    const len1Windows = filteredAt.filter((w) => w.syllableEnd - w.syllableStart === 1);
    summary.singleSyllableWindowCount += len1Windows.length;
    const len1Recalled = recalled.filter((w) => {
      const [, e] = w.windowId.split(':').map(Number);
      return e - Number(w.windowId.split(':')[0]) === 1;
    });
    const len1Hits = len1Recalled.reduce((n, w) => n + (w.candidates?.length || 0), 0);
    summary.singleSyllableRecallHitCount += len1Hits;

    const fbRequired = fbPositions.includes(pos);
    let fallbackReason = null;
    if (fbRequired) {
      if (outs.length === 0) {
        if (recallable.length === 0 && blocked.length > 0) {
          fallbackReason = 'HARD_BLOCKED_WINDOW';
          if (hardBlockCases.length < 400) {
            hardBlockCases.push({
              sentenceId: caseId,
              position: pos,
              rawTextAt,
              blockedReasons: [...new Set(blocked.map((w) => w.blockedBoundaryReason))],
              windowCount: windowsAt.length,
              len1Blocked: len1Windows.filter((w) => w.blocked).length,
              len1Total: len1Windows.length,
            });
          }
        } else {
          fallbackReason = 'NO_LEXICON_HIT';
          if (noHitCases.length < 800) {
            const surface = rawTextAt;
            const look = lookupSurface(surface);
            const key = surface || pinyin || `pos:${pos}`;
            const freq = missingSurfaceFreq.get(key) || {
              surface: key,
              count: 0,
              sentences: new Set(),
              inTerm: look.inTerm.length,
              inBase: look.inBase.length,
              samplePinyin: pinyin,
            };
            freq.count += 1;
            freq.sentences.add(caseId);
            missingSurfaceFreq.set(key, freq);

            let subclass = 'K';
            if (look.inTerm.length === 0 && look.inBase.length === 0) {
              subclass = surface.length === 1 ? 'B' : surface.length <= 3 ? 'C' : 'D';
            } else {
              subclass = 'E'; // exists in DB but recall miss — pinyin/tone/query
            }
            noHitCases.push({
              sentenceId: caseId,
              position: pos,
              rawTextAt,
              pinyin,
              subclass,
              sqliteInTerm: look.inTerm.slice(0, 3),
              sqliteInBase: look.inBase.slice(0, 3),
              windowsAtPosition: windowsAt.length,
              recallable: recallable.length,
              hitCount,
            });
          }
          if (summary.representative.noHit.length < 10 && rawTextAt) {
            summary.representative.noHit.push(caseId);
          }
        }
      } else {
        summary.unknownOriginal += 1;
        const rc = reclassifyUnknownFallback(pos, outgoing, fwd, bwd, N, true);
        summary.unknownReclassDist[rc.class] = (summary.unknownReclassDist[rc.class] || 0) + 1;
        unknownReclass.push({
          sentenceId: caseId,
          position: pos,
          rawTextAt,
          outgoing: outs.map((e) => `${e.syllableStart}-${e.syllableEnd}`),
          endsCanReachN: outs.map((e) => ({ end: e.syllableEnd, canReachEnd: !!bwd[e.syllableEnd] })),
          reachableFromStart: !!fwd[pos],
          reclass: rc.class,
          detail: rc.detail,
        });
      }
    }

    positionRows.push({
      sentenceId: caseId,
      syllableCount: N,
      position: pos,
      rawStart: rawRange?.start ?? null,
      rawEnd: rawRange?.end ?? null,
      rawTextAtPosition: rawTextAt,
      pinyin,
      windowGenerated: windowsAt.length > 0,
      windowLengthsGenerated: windowsAt.map((w) => w.syllableEnd - w.syllableStart),
      windowBlocked: blocked.length,
      blockedReasons: [...new Set(blocked.map((w) => w.blockedBoundaryReason).filter(Boolean))],
      recallExecuted: recallable.length > 0,
      recallHitCount: hitCount,
      lexicalOutgoingEdgeCount: outs.length,
      lexicalOutgoingEdgeRanges: outs.map((e) => [e.syllableStart, e.syllableEnd]),
      reachableFromStart: !!fwd[pos],
      canReachSentenceEnd: !!bwd[pos],
      fallbackRequired: fbRequired,
      fallbackReason,
    });
  }

  // dead-start / counts per utterance recorded in breakpoint row already
  if (bpClass?.reason === 'ALL_WINDOWS_BLOCKED' && summary.representative.hardBlock.length < 10) {
    summary.representative.hardBlock.push(caseId);
  }
  if (bpClass?.reason === 'EDGE_EXISTS_BUT_DEAD_END' && summary.representative.deadEnd.length < 10) {
    summary.representative.deadEnd.push(caseId);
  }
}

summary.completePathRate = summary.utterances
  ? summary.completePathCount / summary.utterances
  : 0;
summary.positionLexiconHitRate = summary.totalPositions
  ? summary.positionsWithLexiconHit / summary.totalPositions
  : 0;
summary.positionLexicalEdgeRate = summary.totalPositions
  ? summary.positionsWithOutgoingLexicalEdge / summary.totalPositions
  : 0;
summary.reachablePositionRate = summary.totalPositions
  ? summary.positionsReachableFromStart / summary.totalPositions
  : 0;
summary.avgFallbackPerSentence = summary.utterances
  ? summary.fallbackInjectionSum / summary.utterances
  : 0;
summary.unknownRemaining = unknownReclass.filter((u) => u.reclass === 'CLASSIFIER_ERROR' || u.reclass === 'OTHER').length;

// Top missing surfaces
const topMissing = [...missingSurfaceFreq.values()]
  .map((x) => ({
    surface: x.surface,
    count: x.count,
    sentenceCount: x.sentences.size,
    inTerm: x.inTerm,
    inBase: x.inBase,
    samplePinyin: x.samplePinyin,
    expectedInBase: x.surface.length === 1 && /[\u4e00-\u9fff]/.test(x.surface),
  }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 40);
summary.topMissingSurfaces = topMissing;

// UNKNOWN should be 0 remaining unresolved
summary.unknownFullyReclassified = unknownReclass.length;
summary.unknownUnresolved = unknownReclass.filter(
  (u) => !['DEAD_END_LEXICAL_BRANCH', 'ORPHAN_LEXICAL_EDGE', 'LEXICAL_EDGE_HIGHER_FALLBACK_COST_PATH', 'DP_TIE_BREAK', 'EDGE_GRAPH_GAP'].includes(u.reclass)
).length;

function writeJsonl(name, rows) {
  fs.writeFileSync(path.join(outDir, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

writeJsonl('lexical_edge_position_matrix.jsonl', positionRows);
writeJsonl('lexical_edge_first_breakpoints.jsonl', breakpointRows);
writeJsonl('lexical_edge_no_hit_cases.jsonl', noHitCases);
writeJsonl('lexical_edge_hard_block_cases.jsonl', hardBlockCases);
writeJsonl('lexical_edge_candidate_drop_cases.jsonl', candidateDropCases);
writeJsonl('lexical_edge_dead_end_cases.jsonl', deadEndCases);
writeJsonl('lexical_edge_unknown_reclassified.jsonl', unknownReclass);

// Serialize Sets in summary
const summaryOut = {
  ...summary,
  firstBreakpointSentences: summary.firstBreakpointSentences,
};
fs.writeFileSync(path.join(outDir, 'lexical_edge_quality_summary.json'), JSON.stringify(summaryOut, null, 2));

db.close();
console.log(JSON.stringify({
  completePathRate: summary.completePathRate,
  positionLexiconHitRate: summary.positionLexiconHitRate,
  positionLexicalEdgeRate: summary.positionLexicalEdgeRate,
  reachablePositionRate: summary.reachablePositionRate,
  breakpointDist: summary.breakpointDist,
  unknownReclassDist: summary.unknownReclassDist,
  unknownUnresolved: summary.unknownUnresolved,
  edgeLenDist: summary.edgeLenDist,
  singleSyllableLexicalEdgeCount: summary.singleSyllableLexicalEdgeCount,
  candidateDrop: summary.candidateProducedButNoEdgeCount,
  topMissing: topMissing.slice(0, 15),
  avgFallback: summary.avgFallbackPerSentence,
}, null, 2));
