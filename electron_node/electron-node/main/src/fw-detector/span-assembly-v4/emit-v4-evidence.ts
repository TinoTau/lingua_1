import type { GraphEdge, ParentTermEvidence } from '../span-assembly-shared/types';
import type { WindowCandidate } from './v4-types';

export type EmitV4Result = {
  parentEvidence: ParentTermEvidence[];
  exactEdges: GraphEdge[];
};

export function emitParentEvidenceAndExactEdges(candidates: WindowCandidate[]): EmitV4Result {
  const parentEvidence: ParentTermEvidence[] = [];
  const exactEdges: GraphEdge[] = [];

  for (const candidate of candidates) {
    if (candidate.hitKind === 'parent_fragment') {
      if (
        candidate.parentTermId &&
        candidate.parentTerm &&
        candidate.parentPinyinKey &&
        candidate.matchedTermStart !== undefined &&
        candidate.matchedTermEnd !== undefined
      ) {
        parentEvidence.push({
          coarseSpanId: candidate.anchorCoarseSpanId,
          parentTermId: candidate.parentTermId,
          parentTerm: candidate.parentTerm,
          parentPinyinKey: candidate.parentPinyinKey,
          parentTermSyllableCount:
            candidate.parentTermSyllableCount ??
            candidate.parentPinyinKey.split('|').filter(Boolean).length,
          domainId: candidate.domainId,
          score: candidate.score,
          repairTarget: candidate.repairTarget,
          matchedTermStart: candidate.matchedTermStart,
          matchedTermEnd: candidate.matchedTermEnd,
          rawStart: candidate.rawStart,
          rawEnd: candidate.rawEnd,
          windowSyllableStart: candidate.syllableStart,
          windowSyllableEnd: candidate.syllableEnd,
          fragmentTonePinyinKey: candidate.fragmentTonePinyinKey,
          source: candidate.source,
          windowSource: candidate.windowSource,
          windowId: candidate.windowId,
        });
      }
      continue;
    }

    exactEdges.push({
      coarseSpanId: candidate.anchorCoarseSpanId,
      syllableStart: candidate.syllableStart,
      syllableEnd: candidate.syllableEnd,
      rawStart: candidate.rawStart,
      rawEnd: candidate.rawEnd,
      replacement: candidate.replacement,
      source: candidate.source,
      domainId: candidate.domainId,
      score: candidate.score,
      ngramKey: candidate.windowPinyinKey,
      recallSource: candidate.recallSource,
      repairTarget: candidate.repairTarget,
      hitKind: 'exact_term',
    });
  }

  return { parentEvidence, exactEdges };
}
