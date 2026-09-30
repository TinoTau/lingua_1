/**
 * WindowEvidence → Model2PolicyInput adapter (Aug-12 pre-LexicalEdge SSOT).
 * No PathFineSpan ownership.
 */

import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { Model2PolicyInput } from './types';
import type { UserProfileV1 } from '../../../../shared/protocols/messages';
import type { WindowEvidence } from './window-evidence';

function positiveRecord(src: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src || {})) {
    if (typeof v === 'number' && v > 0) out[k] = v;
  }
  return out;
}

/**
 * Build Model2 policy input from pre-edge WindowEvidence.
 * spanId / origin identity = windowId (stable pre-segmentation id).
 */
export function buildModel2PolicyInput(args: {
  evidence: WindowEvidence;
  profile: UserProfileV1 | null | undefined;
  sessionId?: string;
  baseCandidates?: readonly WindowCandidate[];
}): Model2PolicyInput | null {
  const { evidence, profile, sessionId, baseCandidates } = args;
  if (!evidence.spanSyllables.length) {
    return null;
  }
  const phoneticBias = positiveRecord(profile?.phonetic_bias);
  const longTermDomainEvidence = positiveRecord(profile?.long_term_domain_evidence);
  const personalTermEvidence = positiveRecord(profile?.personal_term_evidence);
  const personalTerms = (profile?.personal_terms || []).filter(
    (t) => typeof t === 'string' && t.trim()
  );
  const pool = (baseCandidates ?? evidence.baseCandidates).filter((c) => !c.isCovered).length;
  return {
    spanId: evidence.windowId,
    spanSyllables: [...evidence.spanSyllables],
    windowText: evidence.windowText,
    windowPinyinKey: evidence.windowPinyinKey,
    syllableStart: evidence.syllableStart,
    syllableEnd: evidence.syllableEnd,
    rawStart: evidence.rawStart,
    rawEnd: evidence.rawEnd,
    basePool: pool,
    phoneticBias,
    personalTerms,
    longTermDomainEvidence,
    personalTermEvidence,
    profileVersion: profile?.profile_version,
    sessionId,
  };
}

/** True if profile has usable Stage P pronunciation signal. Diagnostic only — not a skip gate. */
export function hasStagePPhoneticProfile(profile: UserProfileV1 | null | undefined): boolean {
  if (!profile?.phonetic_bias) return false;
  return Object.values(profile.phonetic_bias).some((v) => typeof v === 'number' && v > 0);
}

export function emptyUserProfile(): UserProfileV1 {
  return { schema_version: 1, profile_version: 0 };
}
