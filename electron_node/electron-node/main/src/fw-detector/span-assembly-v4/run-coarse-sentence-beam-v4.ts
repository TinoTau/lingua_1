import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { CoarseSpan, CoarseSpanPath } from '../span-assembly-shared/types';
import { CoarseAssemblyLimits } from '../span-assembly-shared/limits';
import { graphEdgesToSpanReplacementPicks } from '../span-assembly-shared/graph-edge-to-fw-span';
import { findOwningCoarseSpanIndexV4 } from './find-owning-coarse-span-v4';

export type PickWithAnchor = SpanReplacementPick & { anchorSpanId?: string };

export type SentenceBeamV4Result = {
  spanSets: SpanReplacementPick[][];
  sentenceTexts: string[];
  sentenceBeamMs: number;
};

function applyReplacementsRightToLeft(
  rawText: string,
  picks: Array<{ start: number; end: number; word: string }>
): string {
  let text = rawText;
  const sorted = [...picks].sort((a, b) => b.start - a.start);
  for (const pick of sorted) {
    text = text.slice(0, pick.start) + pick.word + text.slice(pick.end);
  }
  return text;
}

export function runCoarseSentenceBeamV4(
  rawText: string,
  coarseSpans: CoarseSpan[],
  coarsePaths: CoarseSpanPath[]
): SentenceBeamV4Result {
  const start = Date.now();
  const pathsBySpan = new Map<string, CoarseSpanPath[]>();
  for (const path of coarsePaths) {
    const list = pathsBySpan.get(path.coarseSpanId) ?? [];
    list.push(path);
    pathsBySpan.set(path.coarseSpanId, list);
  }

  type BeamState = { picks: PickWithAnchor[]; score: number };
  let beam: BeamState[] = [{ picks: [], score: 0 }];

  for (const span of coarseSpans) {
    const spanPaths = pathsBySpan.get(span.id) ?? [];
    const next: BeamState[] = [];

    for (const state of beam) {
      for (const path of spanPaths) {
        const pathPicks = graphEdgesToSpanReplacementPicks(rawText, span, path.edges);
        const replacePicks: PickWithAnchor[] = pathPicks
          .filter((p) => p.word !== p.span.text)
          .map((p) => ({ ...p, anchorSpanId: path.coarseSpanId }));
        next.push({
          picks: [...state.picks, ...replacePicks],
          score: state.score + path.score,
        });
      }
    }

    beam = next
      .sort((a, b) => b.score - a.score)
      .slice(0, CoarseAssemblyLimits.maxSentenceBeam);
    if (!beam.length) {
      beam = [{ picks: [], score: 0 }];
    }
  }

  const spanSets: SpanReplacementPick[][] = coarseSpans.map(() => []);
  for (const state of beam) {
    for (const pick of state.picks) {
      const spanIdx = findOwningCoarseSpanIndexV4(
        pick.span.start,
        pick.span.end,
        coarseSpans,
        pick.anchorSpanId
      );
      if (spanIdx >= 0) {
        const set = spanSets[spanIdx];
        if (!set.some((p) => p.word === pick.word && p.span.start === pick.span.start)) {
          set.push(pick);
        }
      }
    }
  }

  for (let i = 0; i < spanSets.length; i += 1) {
    if (!spanSets[i].length) {
      const span = coarseSpans[i];
      spanSets[i] = [
        {
          span: { text: span.text, start: span.rawStart, end: span.rawEnd },
          word: span.text,
          source: 'canonical_exact',
          priorScore: 1,
          repairTarget: false,
          candidateScore: 0,
        },
      ];
    }
  }

  const sentenceTexts = beam.map((state) =>
    applyReplacementsRightToLeft(
      rawText,
      state.picks.map((p) => ({ start: p.span.start, end: p.span.end, word: p.word }))
    )
  );

  return {
    spanSets,
    sentenceTexts,
    sentenceBeamMs: Date.now() - start,
  };
}
