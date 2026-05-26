/**
 * Lexicon V3 — frozen WindowCandidate.source values (production only).
 */

export const V3_WINDOW_CANDIDATE_SOURCES = [
  'lexicon_pinyin_topk',
  'canonical_exact',
  'alias_exact',
  'alias_pinyin',
] as const;

export type WindowCandidateSource = (typeof V3_WINDOW_CANDIDATE_SOURCES)[number];

export type HotwordRecallPath = WindowCandidateSource;

export const FORBIDDEN_WINDOW_CANDIDATE_SOURCES = [
  'confusion_evidence',
  'fuzzy_observed',
  'observed_confusion',
  'replay_candidate',
  'legacy_hotword',
  'hotword',
] as const;

export function isV3WindowCandidateSource(source: string): source is WindowCandidateSource {
  return (V3_WINDOW_CANDIDATE_SOURCES as readonly string[]).includes(source);
}

export function resolveWindowCandidateSource(input: {
  matchedAlias?: string;
  viaPinyin: boolean;
}): WindowCandidateSource {
  if (input.matchedAlias?.trim()) {
    return input.viaPinyin ? 'alias_pinyin' : 'alias_exact';
  }
  return input.viaPinyin ? 'lexicon_pinyin_topk' : 'canonical_exact';
}
