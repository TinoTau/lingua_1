/**
 * Authoritative merge: Base WindowCandidates + Model2 profile WindowCandidates by termId.
 * ONE merge before LexicalEdge (Aug-12 pre-edge SSOT).
 */

import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { RetrievalProvenance } from './types';

export type MergeResult = {
  merged: WindowCandidate[];
  introducedTermIds: string[];
  duplicateTermIds: string[];
};

export function mergeProfileIntoWindowCandidates(
  base: readonly WindowCandidate[],
  profile: readonly WindowCandidate[]
): MergeResult {
  const byTerm = new Map<string, WindowCandidate>();
  const noTerm: WindowCandidate[] = [];
  const introduced: string[] = [];
  const duplicates: string[] = [];

  for (const c of base) {
    if (c.termId) {
      byTerm.set(c.termId, c);
    } else {
      noTerm.push(c);
    }
  }

  for (const c of profile) {
    if (!c.termId) {
      noTerm.push(c);
      continue;
    }
    const existing = byTerm.get(c.termId);
    if (existing) {
      duplicates.push(c.termId);
      const ext = existing as WindowCandidate & {
        retrievalProvenance?: RetrievalProvenance;
        alsoProfileRetrieval?: boolean;
      };
      ext.alsoProfileRetrieval = true;
      const incoming = (c as WindowCandidate & { retrievalProvenance?: RetrievalProvenance })
        .retrievalProvenance;
      if (
        incoming &&
        ext.retrievalProvenance &&
        incoming !== ext.retrievalProvenance &&
        ext.retrievalProvenance !== 'BASE_FUZZY'
      ) {
        ext.alsoProfileRetrieval = true;
      }
      continue;
    }
    byTerm.set(c.termId, c);
    introduced.push(c.termId);
  }

  return {
    merged: [...byTerm.values(), ...noTerm],
    introducedTermIds: introduced,
    duplicateTermIds: duplicates,
  };
}

/** Alias — same algorithm as mergeProfileIntoWindowCandidates. */
export const mergeProfileIntoActiveCandidates = mergeProfileIntoWindowCandidates;
