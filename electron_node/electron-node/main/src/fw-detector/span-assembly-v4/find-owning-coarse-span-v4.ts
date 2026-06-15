import type { CoarseSpan } from '../span-assembly-shared/types';

/** V4: prefer anchorCoarseSpanId, then raw containment fallback. */
export function findOwningCoarseSpanIndexV4(
  pickStart: number,
  pickEnd: number,
  coarseSpans: CoarseSpan[],
  anchorCoarseSpanId?: string
): number {
  if (anchorCoarseSpanId) {
    const idx = coarseSpans.findIndex((s) => s.id === anchorCoarseSpanId);
    if (idx >= 0) {
      return idx;
    }
  }
  return coarseSpans.findIndex(
    (span) => pickStart >= span.rawStart && pickEnd <= span.rawEnd
  );
}
