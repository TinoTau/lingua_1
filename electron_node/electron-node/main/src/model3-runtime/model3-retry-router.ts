/**
 * Model3 RETRY router — bounded retry regions, local re-segmentation, existing Recall.
 * Max 1 region pass per span; no recursion; Anchor protected.
 */

import { getPerSpanCandidateLimit } from '../fw-detector/per-span-candidate-limit';
import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { RecallSpanTopKV2Hit } from '../lexicon-v2/recall-span-topk-v2';
import { anchorSpanIdSet } from './model3-anchor-adapter';
import {
  deriveRetryRegions,
  regionOverlapsCandidate,
  surfacesForRegion,
  type Model3RetryRegion,
} from './model3-retry-region';
import {
  fallbackRegionLocalSpans,
  type Model3RetryRegionResegmentFn,
  type ResegmentRetryRegionResult,
  type RetryRegionLocalSpan,
} from './model3-retry-region-resegment';
import { enumerateStage2SuccessPathQueryLocals } from './model3-retry-stage2-windows';
import { isDialog200PathTraceEnabled } from '../model2-runtime/dialog200-path-trace';
import {
  beginPathProvenance,
  isCandidateProvenanceTraceEnabled,
  recordMaterialized,
  recordMergePerSpan,
  recordPostRetryWorking,
  recordRawRecall,
  snapshotPathProvenance,
  type PathProvenanceBag,
} from './model3-candidate-provenance-trace';
import type {
  Model3AnchorMark,
  Model3RetryAttemptTrace,
  Model3RetryRecallInvocationTrace,
  Model3RetryRegionTrace,
  Model3SpanDecision,
} from './model3-types';
import {
  mapEvidenceToStage2Window,
  type RecallQueryEvidence,
} from '../lexicon-v2/recall-query-evidence';

function resolveGraphSource(domains: readonly string[] | undefined): WindowCandidate['source'] {
  const fine = (domains ?? []).filter((d) => d && d !== 'general' && d !== 'base_term');
  return fine.length ? 'domain_term' : 'base_term';
}

function candidateKey(c: WindowCandidate): string {
  if (c.termId) return `tid:${c.termId}`;
  return `surf:${c.replacement}:${c.rawStart}:${c.rawEnd}`;
}

function boundToSpan(c: WindowCandidate, span: PathFineSpan): boolean {
  if (c.originSpanId === span.spanId) return true;
  if (c.isCovered) return false;
  return (
    c.syllableStart >= span.syllableStart &&
    c.syllableEnd <= span.syllableEnd &&
    c.rawStart >= span.rawStart &&
    c.rawEnd <= span.rawEnd
  );
}

function findOwningPathFineSpan(
  local: RetryRegionLocalSpan,
  pathFineSpans: readonly PathFineSpan[]
): PathFineSpan | undefined {
  return pathFineSpans.find(
    (p) =>
      p.syllableStart === local.syllableStart &&
      p.syllableEnd === local.syllableEnd &&
      p.rawStart === local.rawStart &&
      p.rawEnd === local.rawEnd
  );
}

function overlappingOriginalSpans(
  local: RetryRegionLocalSpan,
  region: Model3RetryRegion,
  pathFineSpans: readonly PathFineSpan[]
): PathFineSpan[] {
  return pathFineSpans.filter(
    (p) =>
      region.sourceSpanIds.includes(p.spanId) &&
      p.syllableStart < local.syllableEnd &&
      p.syllableEnd > local.syllableStart
  );
}

function materializeRetryHits(args: {
  hits: readonly RecallSpanTopKV2Hit[];
  ownerSpan: PathFineSpan;
  windowPinyinKey: string;
  seqStart: number;
  replacementOverride?: string;
}): WindowCandidate[] {
  const out: WindowCandidate[] = [];
  let seq = args.seqStart;
  for (const hit of args.hits) {
    seq += 1;
    const domains =
      hit.hotword.domains && hit.hotword.domains.length
        ? Object.freeze([...hit.hotword.domains])
        : undefined;
    const termId =
      hit.hotword?.id != null && String(hit.hotword.id).length > 0
        ? String(hit.hotword.id)
        : undefined;
    const replacement = args.replacementOverride ?? hit.hotword.word;
    out.push({
      candidateId: `m3r:${args.ownerSpan.spanId}:${seq}`,
      windowId: `${args.ownerSpan.syllableStart}:${args.ownerSpan.syllableEnd}`,
      windowSource: 'in_span_window',
      anchorCoarseSpanId: args.ownerSpan.coarseSpanIds[0] ?? args.ownerSpan.spanId,
      originSpanId: args.ownerSpan.spanId,
      syllableStart: args.ownerSpan.syllableStart,
      syllableEnd: args.ownerSpan.syllableEnd,
      rawStart: args.ownerSpan.rawStart,
      rawEnd: args.ownerSpan.rawEnd,
      windowPinyinKey: args.windowPinyinKey,
      candidateScore: hit.candidateScore,
      score: hit.candidateScore,
      boundaryPenalty: 1,
      candidateRank: seq,
      hitKind: 'exact_term',
      replacement,
      termId,
      recallCandidateKind: hit.recallCandidateKind,
      domains,
      source: resolveGraphSource(domains),
      recallSource: hit.source,
      repairTarget: hit.hotword.repairTarget === true,
    });
  }
  return out;
}

function materializeLocalSpanHits(args: {
  hits: readonly RecallSpanTopKV2Hit[];
  local: RetryRegionLocalSpan;
  region: Model3RetryRegion;
  pathFineSpans: readonly PathFineSpan[];
  globalSyllables: readonly string[];
  seqStart: number;
}): WindowCandidate[] {
  const exact = findOwningPathFineSpan(args.local, args.pathFineSpans);
  const windowPinyinKey = args.globalSyllables
    .slice(args.local.syllableStart, args.local.syllableEnd)
    .join('|');
  if (exact) {
    return materializeRetryHits({
      hits: args.hits,
      ownerSpan: exact,
      windowPinyinKey,
      seqStart: args.seqStart,
    });
  }

  const overlapping = overlappingOriginalSpans(args.local, args.region, args.pathFineSpans);
  if (overlapping.length === 0) {
    return [];
  }

  const out: WindowCandidate[] = [];
  let seq = args.seqStart;
  for (const hit of args.hits) {
    const word = hit.hotword.word;
    if (word.length === overlapping.length && overlapping.length > 1) {
      for (let i = 0; i < overlapping.length; i += 1) {
        const owner = overlapping[i]!;
        const char = word[i] ?? word;
        const piece = materializeRetryHits({
          hits: [{ ...hit, hotword: { ...hit.hotword, word: char } }],
          ownerSpan: owner,
          windowPinyinKey: args.globalSyllables
            .slice(owner.syllableStart, owner.syllableEnd)
            .join('|'),
          seqStart: seq,
          replacementOverride: char,
        });
        out.push(...piece);
        seq += piece.length;
      }
    } else {
      const owner = overlapping[0]!;
      const piece = materializeRetryHits({
        hits: [hit],
        ownerSpan: owner,
        windowPinyinKey,
        seqStart: seq,
      });
      out.push(...piece);
      seq += piece.length;
    }
  }
  return out;
}

function mergeSpanCandidates(
  existing: WindowCandidate[],
  retry: WindowCandidate[],
  perSpanCap: number
): WindowCandidate[] {
  const byKey = new Map<string, WindowCandidate>();
  for (const c of existing) {
    const k = candidateKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  }
  for (const c of retry) {
    const k = candidateKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  }
  return [...byKey.values()]
    .sort(
      (a, b) =>
        (b.candidateScore ?? b.score ?? 0) - (a.candidateScore ?? a.score ?? 0) ||
        String(a.candidateId).localeCompare(String(b.candidateId))
    )
    .slice(0, perSpanCap);
}

export type Model3RetryRecallFn = (args: {
  span: PathFineSpan;
  local: RetryRegionLocalSpan;
  retainedDomains: readonly string[];
  syllables: string[];
  windowText: string;
  windowPinyinKey: string;
  perSpanLimit: number;
}) => RecallSpanTopKV2Hit[] | Promise<RecallSpanTopKV2Hit[]>;

export type RouteModel3RetryResult = {
  activeCandidates: WindowCandidate[];
  mutated: boolean;
  retryAttempts: Model3RetryAttemptTrace[];
  retryRegions: Model3RetryRegionTrace[];
  retryRecallInvocations?: Model3RetryRecallInvocationTrace[];
  /** Observation-only (MODEL3_CANDIDATE_PROVENANCE_TRACE=1). */
  candidateProvenance?: PathProvenanceBag;
  anchorRetryRejections: number;
  recursiveRetryViolations: number;
  perSpanBudgetViolations: number;
  retryPathLatencyMs: number;
};

function defaultResegment(args: {
  region: Model3RetryRegion;
  rawText: string;
  pathFineSpans: readonly PathFineSpan[];
}): ResegmentRetryRegionResult {
  return {
    ok: true,
    localSpans: fallbackRegionLocalSpans(args.region, args.pathFineSpans, args.rawText),
  };
}

function localSurfaces(localSpans: readonly RetryRegionLocalSpan[]): string[] {
  return localSpans.map((s) => s.surface);
}

/**
 * Derive retry regions; local re-segment + recall per region; replace region candidates.
 * Does NOT invoke Model3. Does NOT mutate vote.
 */
export async function routeModel3Retry(args: {
  decisions: readonly Model3SpanDecision[];
  anchors: readonly Model3AnchorMark[];
  pathFineSpans: readonly PathFineSpan[];
  activeCandidates: readonly WindowCandidate[];
  retainedDomains: readonly string[];
  rawText: string;
  globalSyllables: readonly string[];
  recall: Model3RetryRecallFn;
  resegment?: Model3RetryRegionResegmentFn;
  /** Observation-only path key for candidate provenance collector. */
  pathId?: string;
  /**
   * Utterance-local RecallQueryEvidence (ACP V1). Runtime routing only —
   * NOT Model3 model input.
   */
  recallQueryEvidence?: readonly RecallQueryEvidence[];
}): Promise<RouteModel3RetryResult> {
  const t0 = Date.now();
  const anchorIds = anchorSpanIdSet(args.anchors);
  const decisionBySpan = new Map(args.decisions.map((d) => [d.spanId, d]));
  const perSpanCap = getPerSpanCandidateLimit(args.pathFineSpans.length);
  const resegment = args.resegment ?? defaultResegment;
  const provenanceEnabled = isCandidateProvenanceTraceEnabled();
  const provenancePathId = args.pathId ?? '_anonymous';

  let working = [...args.activeCandidates];
  let mutated = false;
  let anchorRetryRejections = 0;
  let recursiveRetryViolations = 0;
  const attemptedSpanIds = new Set<string>();
  const retryAttempts: Model3RetryAttemptTrace[] = [];
  const retryRegions: Model3RetryRegionTrace[] = [];
  const retryRecallInvocations: Model3RetryRecallInvocationTrace[] = [];
  const recallTraceEnabled = isDialog200PathTraceEnabled();

  if (provenanceEnabled) {
    beginPathProvenance(provenancePathId);
  }

  const regions = deriveRetryRegions({
    decisions: args.decisions,
    anchors: args.anchors,
    pathFineSpans: args.pathFineSpans,
  });

  for (const span of args.pathFineSpans) {
    const decision = decisionBySpan.get(span.spanId);
    if (!decision || decision.decision !== 'RETRY') continue;
    if (anchorIds.has(span.spanId)) {
      anchorRetryRejections += 1;
      retryAttempts.push({
        spanId: span.spanId,
        attempted: false,
        rejectedAsAnchor: true,
        retainedDomains: [...args.retainedDomains],
        candidateCountBefore: working.filter((c) => boundToSpan(c, span) && !c.isCovered).length,
        returnedCandidateCount: 0,
        mergedCandidateCount: 0,
        finalPerSpanCandidateCount: working.filter((c) => boundToSpan(c, span) && !c.isCovered)
          .length,
        latencyMs: 0,
      });
    }
  }

  for (const region of regions) {
    for (const spanId of region.sourceSpanIds) {
      if (attemptedSpanIds.has(spanId)) {
        recursiveRetryViolations += 1;
      }
      attemptedSpanIds.add(spanId);
    }

    const oldLocalSpanSurfaces = surfacesForRegion(args.pathFineSpans, region, args.rawText);
    const regionCandidatesBefore = working.filter((c) => regionOverlapsCandidate(region, c));
    const rt0 = Date.now();

    const resegmentResult = await Promise.resolve(
      resegment({
        region,
        rawText: args.rawText,
        globalSyllables: args.globalSyllables,
        pathFineSpans: args.pathFineSpans,
      })
    );
    const localSpans =
      resegmentResult.localSpans.length > 0
        ? resegmentResult.localSpans
        : fallbackRegionLocalSpans(region, args.pathFineSpans, args.rawText);
    const newLocalSpanSurfaces = localSurfaces(localSpans);
    const localSpanSource: 'LATTICE' | 'FALLBACK' = resegmentResult.ok ? 'LATTICE' : 'FALLBACK';
    // Delta2: fallback query geometry = RetryRegion legal window space (not FineSpan lock).
    // Delta1 success path unchanged: same shared enumerator. resegmentOk stays false on fallback.
    const fallbackGeometrySource = resegmentResult.ok
      ? undefined
      : ('RETRY_REGION_LEGAL_WINDOW_SPACE' as const);
    const fallbackReason = resegmentResult.ok
      ? undefined
      : resegmentResult.code ?? 'LATTICE_FAIL_OR_NO_PATH';

    const outsideRegion = working.filter((c) => !regionOverlapsCandidate(region, c));
    const keptInRegion = working.filter(
      (c) => regionOverlapsCandidate(region, c) && c.isCovered
    );

    const regionRetryCandidates: WindowCandidate[] = [];
    let recallCandidatesReturned = 0;
    let seq = working.length;

    // Stage-2 queries: legal 1..min(5,R) windows inside RetryRegion (success + fallback).
    // localSpans retained for supporting/trace surfaces only — not query geometry authority.
    const stage2QueryLocals: RetryRegionLocalSpan[] = enumerateStage2SuccessPathQueryLocals({
      region,
      rawText: args.rawText,
      globalSyllables: args.globalSyllables,
    });

    for (const local of stage2QueryLocals) {
      const owner =
        findOwningPathFineSpan(local, args.pathFineSpans) ??
        overlappingOriginalSpans(local, region, args.pathFineSpans)[0];
      if (!owner) continue;

      const asrSyllables = args.globalSyllables.slice(local.syllableStart, local.syllableEnd);
      const mapped = mapEvidenceToStage2Window(args.recallQueryEvidence ?? [], {
        syllableStart: local.syllableStart,
        syllableEnd: local.syllableEnd,
        rawStart: local.rawStart,
        rawEnd: local.rawEnd,
      });
      const syllables =
        mapped.mappedPinyinKey != null
          ? mapped.mappedPinyinKey.split('|').map((s) => s.trim()).filter(Boolean)
          : [...asrSyllables];
      const windowPinyinKey = syllables.join('|');
      const windowText = args.rawText.slice(local.rawStart, local.rawEnd);

      let hits: RecallSpanTopKV2Hit[] = [];
      try {
        hits = await Promise.resolve(
          args.recall({
            span: owner,
            local,
            retainedDomains: args.retainedDomains,
            syllables,
            windowText,
            windowPinyinKey,
            perSpanLimit: perSpanCap,
          })
        );
      } catch {
        hits = [];
      }

      if (recallTraceEnabled) {
        retryRecallInvocations.push({
          retryRegionId: region.retryRegionId,
          localSpanSource,
          ...(fallbackGeometrySource ? { fallbackGeometrySource } : {}),
          ownerSpanId: owner.spanId,
          spanStart: local.rawStart,
          spanEnd: local.rawEnd,
          syllableStart: local.syllableStart,
          syllableEnd: local.syllableEnd,
          spanSurface: windowText,
          windowText,
          windowPinyinKey,
          syllables: [...syllables],
          querySource: mapped.querySource,
          mappingReason: mapped.reason,
          acousticTonePattern: owner.toneRebindTrace?.acousticTonePattern
            ? [...owner.toneRebindTrace.acousticTonePattern]
            : undefined,
          retainedDomains: [...args.retainedDomains],
          perSpanLimit: perSpanCap,
          candidateCount: hits.length,
          candidates: hits.map((h) => ({
            surface: h.hotword.word,
            source: String(h.source),
            domains: h.hotword.domains ? [...h.hotword.domains] : [],
            phoneticScore: h.phoneticScore,
            candidateScore: h.candidateScore,
            toneCompatible: h.toneCompatible,
          })),
        });
      }

      if (provenanceEnabled) {
        recordRawRecall(
          provenancePathId,
          region.retryRegionId,
          {
            ownerSpanId: owner.spanId,
            windowText,
            windowPinyinKey,
            syllables: [...syllables],
            retainedDomains: [...args.retainedDomains],
            perSpanLimit: perSpanCap,
            localRawStart: local.rawStart,
            localRawEnd: local.rawEnd,
          },
          hits
        );
      }

      recallCandidatesReturned += hits.length;
      const materialized = materializeLocalSpanHits({
        hits,
        local,
        region,
        pathFineSpans: args.pathFineSpans,
        globalSyllables: args.globalSyllables,
        seqStart: seq,
      });
      if (provenanceEnabled) {
        recordMaterialized(provenancePathId, region.retryRegionId, materialized);
      }
      seq += materialized.length;
      regionRetryCandidates.push(...materialized);
    }

    const perSpanMerged = new Map<string, WindowCandidate[]>();
    for (const spanId of region.sourceSpanIds) {
      const span = args.pathFineSpans.find((s) => s.spanId === spanId);
      if (!span) continue;
      const before = regionCandidatesBefore.filter((c) => boundToSpan(c, span) && !c.isCovered);
      const retryForSpan = regionRetryCandidates.filter((c) => boundToSpan(c, span) && !c.isCovered);
      const after = mergeSpanCandidates(before, retryForSpan, perSpanCap);
      if (provenanceEnabled) {
        recordMergePerSpan(provenancePathId, spanId, before, retryForSpan, after, perSpanCap);
      }
      perSpanMerged.set(spanId, after);
    }

    const mergedInRegion: WindowCandidate[] = [];
    for (const merged of perSpanMerged.values()) {
      mergedInRegion.push(...merged);
    }

    const next = [...outsideRegion, ...keptInRegion, ...mergedInRegion];
    const regionMutated =
      regionRetryCandidates.length > 0 ||
      regionCandidatesBefore.length !== mergedInRegion.length ||
      regionCandidatesBefore.some((c) => !mergedInRegion.some((m) => candidateKey(m) === candidateKey(c)));

    if (regionMutated) {
      mutated = true;
      working = next;
    }

    for (const spanId of region.sourceSpanIds) {
      const span = args.pathFineSpans.find((s) => s.spanId === spanId)!;
      const before = regionCandidatesBefore.filter((c) => boundToSpan(c, span) && !c.isCovered);
      const after = working.filter((c) => boundToSpan(c, span) && !c.isCovered);
      retryAttempts.push({
        spanId,
        attempted: true,
        rejectedAsAnchor: false,
        retainedDomains: [...args.retainedDomains],
        candidateCountBefore: before.length,
        returnedCandidateCount: regionRetryCandidates.filter((c) => boundToSpan(c, span)).length,
        mergedCandidateCount: after.length,
        finalPerSpanCandidateCount: after.length,
        latencyMs: Date.now() - rt0,
      });
    }

    retryRegions.push({
      retryRegionId: region.retryRegionId,
      sourceSpanIds: [...region.sourceSpanIds],
      rawStart: region.rawStart,
      rawEnd: region.rawEnd,
      syllableStart: region.syllableStart,
      syllableEnd: region.syllableEnd,
      oldLocalSpanSurfaces,
      newLocalSpanSurfaces,
      regionMergedFromAdjacentRetry: region.regionMergedFromAdjacentRetry,
      recallCandidatesReturned,
      candidateBudgetAfter: mergedInRegion.filter((c) => !c.isCovered).length,
      secondDomainVote: false,
      model3Reinvoked: false,
      resegmentOk: resegmentResult.ok,
      ...(fallbackGeometrySource ? { fallbackGeometrySource } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
    });
  }

  let totalPerSpanViolations = 0;
  for (const span of args.pathFineSpans) {
    const n = working.filter((c) => boundToSpan(c, span) && !c.isCovered).length;
    if (n > perSpanCap) totalPerSpanViolations += 1;
  }

  if (provenanceEnabled) {
    recordPostRetryWorking(provenancePathId, working);
  }

  return {
    activeCandidates: working,
    mutated,
    retryAttempts,
    retryRegions,
    ...(recallTraceEnabled && retryRecallInvocations.length
      ? { retryRecallInvocations }
      : {}),
    ...(provenanceEnabled
      ? { candidateProvenance: snapshotPathProvenance(provenancePathId) ?? undefined }
      : {}),
    anchorRetryRejections,
    recursiveRetryViolations,
    perSpanBudgetViolations: totalPerSpanViolations,
    retryPathLatencyMs: Date.now() - t0,
  };
}
