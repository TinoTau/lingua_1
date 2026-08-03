/**
 * Materialize SegmentationPath edges into PathFineSpanView.
 * Path ownership — does not call LTR commit / options / generation result.
 */

import type { UtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import type { LexicalEdge } from './build-lexical-edges';
import type { SegmentationPath } from './lattice-path-types';
import type { PathFineSpan, PathFineSpanView } from './path-fine-span-types';

export function materializePathFineSpans(
  path: SegmentationPath,
  coordinate: UtteranceSyllableCoordinate
): PathFineSpanView {
  const pathFineSpans: PathFineSpan[] = path.edgeRefs.map((edge: LexicalEdge, idx) => {
    const { rawStart, rawEnd } =
      edge.candidates.length > 0
        ? { rawStart: edge.candidates[0]!.rawStart, rawEnd: edge.candidates[0]!.rawEnd }
        : (() => {
            const mapped = syllableRangeToRawCharRange(
              coordinate.ranges,
              edge.syllableStart,
              edge.syllableEnd
            );
            if (!mapped) {
              throw new Error(
                `[materializePathFineSpans] failed to map syllable range to raw range for edge ${edge.syllableStart}:${edge.syllableEnd}`
              );
            }
            return { rawStart: mapped.start, rawEnd: mapped.end };
          })();

    const coarseSpanIds =
      edge.candidates.length > 0
        ? Array.from(new Set(edge.candidates.map((c) => c.anchorCoarseSpanId))).filter(
            (id) => id && id.length > 0
          )
        : [];

    const boundaryCrossCount: 0 | 1 = coarseSpanIds.length > 1 ? 1 : 0;
    const windowSource =
      edge.edgeKind === 'fallback'
        ? 'fallback'
        : boundaryCrossCount === 1
          ? 'boundary_window'
          : 'in_span_window';

    return {
      spanId: `fine:${path.pathId}:${idx}`,
      rawStart,
      rawEnd,
      syllableStart: edge.syllableStart,
      syllableEnd: edge.syllableEnd,
      coarseSpanIds,
      boundaryCrossCount,
      windowSource,
      candidates: edge.candidates,
      selectionReason: 'lattice_path_edge',
    };
  });

  return {
    pathId: path.pathId,
    boundaryKey: path.boundaryKey,
    pathFineSpans,
  };
}
