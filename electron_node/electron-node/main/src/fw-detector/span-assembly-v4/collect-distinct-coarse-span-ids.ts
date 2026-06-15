import type { CoarseSpan } from '../span-assembly-shared/types';

/** Collect distinct coarse span ids covering syllables [syllableStart, syllableEnd). */
export function collectDistinctCoarseSpanIds(
  syllableStart: number,
  syllableEnd: number,
  coarseSpans: CoarseSpan[]
): string[] {
  const ids = new Set<string>();
  for (let s = syllableStart; s < syllableEnd; s += 1) {
    for (const span of coarseSpans) {
      if (s >= span.syllableStart && s < span.syllableEnd) {
        ids.add(span.id);
      }
    }
  }
  return [...ids];
}

export function resolveAnchorCoarseSpanId(
  spanIds: string[],
  coarseSpans: CoarseSpan[]
): string {
  if (!spanIds.length) {
    return '';
  }
  if (spanIds.length === 1) {
    return spanIds[0];
  }
  const ordered = spanIds
    .map((id) => coarseSpans.find((s) => s.id === id))
    .filter((s): s is CoarseSpan => s != null)
    .sort((a, b) => a.rawStart - b.rawStart);
  return ordered[ordered.length - 1]?.id ?? spanIds[spanIds.length - 1];
}
