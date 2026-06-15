import type { CoarseSpan, ParentTermEvidence } from '../span-assembly-shared/types';

/** V4: anchor-only span membership — no syllable containment gate. */
export function evidenceInSpanV4(
  span: CoarseSpan,
  evidence: ParentTermEvidence[]
): ParentTermEvidence[] {
  return evidence.filter((e) => e.coarseSpanId === span.id);
}
