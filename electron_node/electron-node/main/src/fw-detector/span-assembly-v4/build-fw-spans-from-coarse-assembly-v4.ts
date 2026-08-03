import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { FwSpanDiagnostics } from '../types';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { PathFineSpan } from './path-fine-span-types';
import { buildCandidateSentence } from '../candidate-sentence-builder';

function toCandidateDiagnostics(
  rawText: string,
  picks: SpanReplacementPick[]
): FwSpanDiagnostics['candidates'] {
  return picks.map((pick, candidateIndex) => ({
    candidateIndex,
    word: pick.word,
    priorScore: pick.priorScore,
    candidateScore: pick.candidateScore,
    phoneticScore: pick.candidateScore,
    source: pick.source,
    candidateSentence: buildCandidateSentence(rawText, pick.span, pick.word),
    domains: [],
    domainMatched: false,
    domainScore: 0,
    kenlmDelta: 0,
    repairTarget: pick.repairTarget,
    finalScore: pick.candidateScore,
    vetoed: false,
    selected: false,
  }));
}

/** @deprecated production entry now uses buildFwSpansFromPathFineSpans (PathFineSpan is the assembly unit). */
export function buildFwSpansFromCoarseAssemblyV4(
  rawText: string,
  coarseSpans: CoarseSpan[],
  spanSets: SpanReplacementPick[][],
  utteranceDomain: string
): FwSpanDiagnostics[] {
  return coarseSpans.map((span, idx) => ({
    text: span.text,
    start: span.rawStart,
    end: span.rawEnd,
    domain: utteranceDomain,
    riskScore: 0,
    signals: ['span_assembly_v4'],
    candidates: toCandidateDiagnostics(rawText, spanSets[idx] ?? []),
    applied: false,
  }));
}

/**
 * Production entry: zip by PathFineSpan (not coarse span) — spanSets/pool are keyed
 * one-per-path-fine-span, so index alignment with the coarse partition would silently
 * mis-zip whenever path fine span count differs from coarse span count (AC-02).
 */
export function buildFwSpansFromPathFineSpans(
  rawText: string,
  pathFineSpans: readonly PathFineSpan[],
  spanSets: SpanReplacementPick[][],
  utteranceDomain: string
): FwSpanDiagnostics[] {
  return pathFineSpans.map((span, idx) => ({
    text: rawText.slice(span.rawStart, span.rawEnd),
    start: span.rawStart,
    end: span.rawEnd,
    domain: utteranceDomain,
    riskScore: 0,
    // Production Fine Span owner is SegmentationPath / Lattice (Step 3 cutover).
    signals: ['span_assembly_v4', 'path_fine_span'],
    candidates: toCandidateDiagnostics(rawText, spanSets[idx] ?? []),
    applied: false,
  }));
}
