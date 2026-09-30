/**
 * materializeModel3Anchors — PROFILE_PRONUNCIATION-only Anchor adapter.
 * ACP: LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1
 *
 * Domain / PROFILE_DOMAIN / PROFILE_RETRIEVAL do NOT create Anchors.
 * Domain evidence remains available to Vote / SameDomain / Assembly / KenLM.
 */

import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { Model3AnchorMark } from './model3-types';

function isProfilePronunciationProvenance(p: string | undefined): boolean {
  return p === 'PROFILE_PRONUNCIATION';
}

function candidateBoundToSpan(c: WindowCandidate, span: PathFineSpan): boolean {
  if (c.originSpanId === span.spanId) return true;
  if (c.isCovered) return false;
  return (
    c.syllableStart >= span.syllableStart &&
    c.syllableEnd <= span.syllableEnd &&
    c.rawStart >= span.rawStart &&
    c.rawEnd <= span.rawEnd
  );
}

/** True iff PathFineSpan has an eligible bound PROFILE_PRONUNCIATION candidate. */
function hasEligibleProfilePronunciationEvidence(
  candidates: readonly WindowCandidate[],
  span: PathFineSpan
): boolean {
  for (const c of candidates) {
    if (!candidateBoundToSpan(c, span)) continue;
    if (c.isCovered) continue;
    if (isProfilePronunciationProvenance(c.retrievalProvenance)) {
      return true;
    }
  }
  return false;
}

/**
 * Read-only. Does not mutate inputs.
 * Anchor only when PROFILE_PRONUNCIATION evidence is bound to the PathFineSpan.
 */
export function materializeModel3Anchors(args: {
  pathFineSpans: readonly PathFineSpan[];
  activeCandidates: readonly WindowCandidate[];
  rawText: string;
}): {
  anchors: Model3AnchorMark[];
} {
  const { pathFineSpans, activeCandidates, rawText } = args;
  const anchors: Model3AnchorMark[] = [];

  for (const span of pathFineSpans) {
    if (!hasEligibleProfilePronunciationEvidence(activeCandidates, span)) continue;
    anchors.push({
      spanId: span.spanId,
      surface: rawText.slice(span.rawStart, span.rawEnd),
      rawStart: span.rawStart,
      rawEnd: span.rawEnd,
      source: 'MODEL2',
    });
  }

  return { anchors };
}

export function anchorSpanIdSet(anchors: readonly Model3AnchorMark[]): Set<string> {
  return new Set(anchors.map((a) => a.spanId));
}
