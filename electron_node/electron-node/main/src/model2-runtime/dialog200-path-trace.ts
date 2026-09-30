/**
 * Observation-only dialog_200 full-path tracing.
 *
 * Gated by MODEL2_DIALOG200_TRACE=1.
 * TRACE_OFF (unset/other) must not change ranking, candidates, budget, or Model2 I/O.
 * Snapshots are copies taken AFTER live decisions.
 */

import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';

export const DIALOG200_PATH_TRACE_ENV = 'MODEL2_DIALOG200_TRACE';
export const DIALOG200_CANDIDATE_CAP = 24;

export function isDialog200PathTraceEnabled(): boolean {
  return process.env[DIALOG200_PATH_TRACE_ENV] === '1';
}

export type CompactCandidate = {
  termId: string | null;
  surface: string;
  pinyin: string;
  domains: string[];
  score: number;
  source: string;
  provenance: string | null;
  alsoProfile: boolean;
  rank: number;
  candidateId: string;
  originSpanId: string | null;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  hitKind: string;
  repairTarget: boolean;
  retrievalId: string | null;
  model2ActionId?: string;
};

export function compactCandidate(c: WindowCandidate, rank: number): CompactCandidate {
  return {
    termId: c.termId ?? null,
    surface: c.replacement,
    pinyin: c.windowPinyinKey,
    domains: c.domains ? [...c.domains] : [],
    score: c.score,
    source: String(c.source),
    provenance: c.retrievalProvenance ?? null,
    alsoProfile: c.alsoProfileRetrieval === true,
    rank,
    candidateId: c.candidateId,
    originSpanId: c.originSpanId ?? null,
    rawStart: c.rawStart,
    rawEnd: c.rawEnd,
    syllableStart: c.syllableStart,
    syllableEnd: c.syllableEnd,
    hitKind: c.hitKind,
    repairTarget: c.repairTarget === true,
    retrievalId: c.retrievalId ?? null,
    ...(c.model2ActionId ? { model2ActionId: c.model2ActionId } : {}),
  };
}

export function compactCandidates(list: readonly WindowCandidate[]): {
  count: number;
  items: CompactCandidate[];
} {
  const uncovered = list.filter((c) => !c.isCovered);
  return {
    count: uncovered.length,
    items: uncovered.slice(0, DIALOG200_CANDIDATE_CAP).map((c, i) => compactCandidate(c, i + 1)),
  };
}

export function compactFineSpan(span: PathFineSpan, rawText: string): Record<string, unknown> {
  const sourceText = rawText.slice(span.rawStart, span.rawEnd);
  const tone = span.toneRebindTrace;
  return {
    span_id: span.spanId,
    source_text: sourceText,
    start: span.rawStart,
    end: span.rawEnd,
    syllable_start: span.syllableStart,
    syllable_end: span.syllableEnd,
    source_token_range: [span.syllableStart, span.syllableEnd],
    phonetic_representation: span.candidates[0]?.windowPinyinKey ?? null,
    tone_representation: tone?.acousticTonePattern ?? null,
    coarse_span_ids: [...span.coarseSpanIds],
    window_source: span.windowSource,
    selection_reason: span.selectionReason,
    boundary_cross_count: span.boundaryCrossCount,
    candidate_count: span.candidates.length,
  };
}

/** Pre-edge WindowEvidence compact (Model2 insertion SSOT). */
export function compactWindowEvidence(ev: {
  windowId: string;
  windowText: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  windowPinyinKey: string;
  acousticTonePattern: number[] | null;
  baseCandidates: readonly WindowCandidate[];
}): Record<string, unknown> {
  return {
    window_id: ev.windowId,
    source_text: ev.windowText,
    start: ev.rawStart,
    end: ev.rawEnd,
    syllable_start: ev.syllableStart,
    syllable_end: ev.syllableEnd,
    source_token_range: [ev.syllableStart, ev.syllableEnd],
    phonetic_representation: ev.windowPinyinKey || null,
    tone_representation: ev.acousticTonePattern,
    candidate_count: ev.baseCandidates.length,
  };
}

export function profileInputSummary(
  profile: {
    profile_version?: number | null;
    phonetic_bias?: Record<string, number>;
    personal_terms?: string[];
    long_term_domain_evidence?: Record<string, number>;
  } | null
  | undefined
): Record<string, unknown> {
  if (!profile) {
    return {
      profile_present: false,
      profile_version: null,
      pronunciation_keys: [],
      personal_terms_count: 0,
      long_term_domain_evidence_keys: [],
      injected_default: false,
    };
  }
  const bias = profile.phonetic_bias || {};
  const domain = profile.long_term_domain_evidence || {};
  return {
    profile_present: true,
    profile_version: profile.profile_version ?? null,
    pronunciation_keys: Object.keys(bias).filter((k) => Number(bias[k]) > 0),
    personal_terms_count: (profile.personal_terms || []).length,
    long_term_domain_evidence_keys: Object.keys(domain).filter((k) => Number(domain[k]) > 0),
    injected_default: false,
  };
}
