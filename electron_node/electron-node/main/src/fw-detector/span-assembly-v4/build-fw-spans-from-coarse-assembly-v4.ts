import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { FwSpanDiagnostics } from '../types';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { buildCandidateSentence } from '../candidate-sentence-builder';

export function buildFwSpansFromCoarseAssemblyV4(
  rawText: string,
  coarseSpans: CoarseSpan[],
  spanSets: SpanReplacementPick[][],
  utteranceDomain: string
): FwSpanDiagnostics[] {
  return coarseSpans.map((span, idx) => {
    const picks = spanSets[idx] ?? [];
    const candidates = picks.map((pick, candidateIndex) => ({
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

    return {
      text: span.text,
      start: span.rawStart,
      end: span.rawEnd,
      domain: utteranceDomain,
      riskScore: 0,
      signals: ['span_assembly_v4'],
      candidates,
      applied: false,
    };
  });
}
