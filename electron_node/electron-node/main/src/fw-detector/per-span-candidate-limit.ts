/** P4 frozen per-span candidate limit (base+domain+alias combined cap). */
export function getPerSpanCandidateLimit(spanCount: number): number {
  if (spanCount <= 1) {
    return 8;
  }
  if (spanCount === 2) {
    return 4;
  }
  return 2;
}
