import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { FwSpanDiagnostics } from '../types';
import type { CoarseSpan, GraphEdge } from './types';
import { buildCandidateSentence } from '../candidate-sentence-builder';

export function graphEdgesToSpanReplacementPicks(
  rawText: string,
  coarseSpan: CoarseSpan,
  edges: GraphEdge[]
): SpanReplacementPick[] {
  if (!edges.length) {
    return [
      {
        span: { text: coarseSpan.text, start: coarseSpan.rawStart, end: coarseSpan.rawEnd },
        word: coarseSpan.text,
        source: 'canonical_exact',
        priorScore: 1,
        repairTarget: false,
        candidateScore: 0,
      },
    ];
  }

  return edges.map((edge) => ({
    span: {
      text: rawText.slice(edge.rawStart, edge.rawEnd),
      start: edge.rawStart,
      end: edge.rawEnd,
    },
    word: edge.replacement,
    source: edge.recallSource,
    priorScore: edge.score,
    repairTarget: edge.repairTarget,
    candidateScore: edge.score,
  }));
}

export function buildFwSpansFromCoarseAssembly(
  rawText: string,
  coarseSpans: CoarseSpan[],
  spanSets: SpanReplacementPick[][]
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
      domain: 'general',
      riskScore: 0,
      signals: ['span_assembly_v3'],
      candidates,
      applied: false,
    };
  });
}
