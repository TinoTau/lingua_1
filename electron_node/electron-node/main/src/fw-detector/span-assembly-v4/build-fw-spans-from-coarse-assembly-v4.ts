import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { FwSpanDiagnostics } from '../types';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { FormalFineSpan } from './ltr-fine-span-generator';
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

/** @deprecated production entry now uses buildFwSpansFromFormalFineSpans (formal FineSpan is the assembly unit). */
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
 * Production entry: zip by committed Formal FineSpan (not coarse span) — spanSets/pool are now
 * keyed one-per-formal-span, so index alignment with the coarse partition would silently
 * mis-zip whenever formal span count differs from coarse span count (AC-02).
 */
export function buildFwSpansFromFormalFineSpans(
  rawText: string,
  formalSpans: readonly FormalFineSpan[],
  spanSets: SpanReplacementPick[][],
  utteranceDomain: string
): FwSpanDiagnostics[] {
  return formalSpans.map((span, idx) => ({
    text: rawText.slice(span.rawStart, span.rawEnd),
    start: span.rawStart,
    end: span.rawEnd,
    domain: utteranceDomain,
    riskScore: 0,
    signals: ['span_assembly_v4', 'ltr_fine_span'],
    candidates: toCandidateDiagnostics(rawText, spanSets[idx] ?? []),
    applied: false,
  }));
}
