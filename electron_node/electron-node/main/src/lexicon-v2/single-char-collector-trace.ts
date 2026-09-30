/**
 * SINGLE_CHAR_COLLECTOR_TRACE_V1 — observation-only taxonomy.
 * Does not decide Recall; classifies already-computed collector locals.
 */

export const SINGLE_CHAR_COLLECTOR_TRACE_V1 = 'SINGLE_CHAR_COLLECTOR_TRACE_V1';

export type Length1CollectorTerminal =
  | 'NOT_APPLICABLE_WINDOW_LENGTH'
  | 'NO_QUERY_KEY'
  | 'SQL_NOT_EXECUTED'
  | 'SQL_NO_HIT'
  | 'TONE_READINESS_NOT_READY'
  | 'NO_TONE_PATTERN'
  | 'NO_TONE_EXACT_CANDIDATE'
  | 'MULTIPLE_TONE_EXACT_CANDIDATES'
  | 'SURFACE_EXACT_MISS'
  | 'LIMIT_TRUNCATION_REJECT'
  | 'MIN_SCORE_REJECT'
  | 'NORMALIZATION_SURFACE_MISMATCH'
  | 'INVALID_ROW'
  | 'OTHER_REJECT'
  | 'ACCEPT_SURFACE_EXACT'
  | 'ACCEPT_UNIQUE_TONE_EXACT';

export type Length1ChosenSource =
  | 'unique_tone_exact'
  | 'page_surface_exact'
  | 'identity_surface_exact'
  | null;

export type Length1SqlHitTrace = {
  termId: string;
  surface: string;
  pinyin: string;
  tone: string | null;
  enabled: boolean;
  sourceTable: 'base_lexicon';
  priorScore: number;
};

export type Length1CollectorSnapshot = {
  syllablesLength: number;
  pinyinKey: string;
  windowText: string;
  windowTextCanonical: string;
  readinessState: string;
  sqlExecuted: boolean;
  sqlLimit: number;
  sqlHitCount: number;
  eligibleHitCount: number;
  truncated: boolean;
  identityLookupRan: boolean;
  identitySqlHitCount: number;
  identityEligibleCount: number;
  chosenSource: Length1ChosenSource;
  chosenWord: string | null;
  candidateScore: number | null;
  minCandidateScore: number;
  scoreRejected: boolean;
  hitPresent: boolean;
  canonicalInSqlHits: boolean;
};

export type Length1CollectorDiagnostic = {
  contract: typeof SINGLE_CHAR_COLLECTOR_TRACE_V1;
  pinyinKey: string;
  windowText: string;
  windowTextCanonical: string;
  toneRecallReadiness: string;
  queryExecuted: boolean;
  querySource: 'live' | 'utterance_cache';
  sqlLimit: number;
  sqlHitCount: number;
  postLimitCount: number;
  preLimitCount: number | null;
  truncated: boolean;
  eligibleHitCount: number;
  toneExactHitCount: number;
  uniqueToneExact: boolean;
  surfaceExactHitCount: number;
  chosenSource: Length1ChosenSource;
  selectedCandidate: string | null;
  candidateScore: number | null;
  minCandidateScore: number;
  terminalReason: Length1CollectorTerminal;
  sqlHits: Length1SqlHitTrace[];
  queryTonePinyinKey: string | null;
};

export type Length1WindowTrace = Length1CollectorDiagnostic & {
  windowId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  windowSource: string;
  blocked: boolean;
  boundCandidateCount: number;
  tonePattern: number[] | null;
  queryTonePinyinKey: string | null;
};

export function classifyLength1CollectorTerminal(
  s: Length1CollectorSnapshot
): Length1CollectorTerminal {
  if (s.syllablesLength !== 1) {
    return 'NOT_APPLICABLE_WINDOW_LENGTH';
  }
  if (!s.pinyinKey) {
    return 'NO_QUERY_KEY';
  }
  if (s.readinessState !== 'ready') {
    return s.readinessState === 'no_pattern' ? 'NO_TONE_PATTERN' : 'TONE_READINESS_NOT_READY';
  }
  if (s.hitPresent) {
    return s.chosenSource === 'unique_tone_exact'
      ? 'ACCEPT_UNIQUE_TONE_EXACT'
      : 'ACCEPT_SURFACE_EXACT';
  }
  if (s.scoreRejected) {
    return 'MIN_SCORE_REJECT';
  }
  if (!s.sqlExecuted) {
    return 'SQL_NOT_EXECUTED';
  }
  if (s.sqlHitCount === 0 && s.identitySqlHitCount === 0) {
    return 'SQL_NO_HIT';
  }
  if (s.sqlHitCount > 0 && s.eligibleHitCount === 0) {
    return 'INVALID_ROW';
  }
  if (s.truncated && s.eligibleHitCount === 1) {
    return 'LIMIT_TRUNCATION_REJECT';
  }
  const scriptFolded = s.windowText !== s.windowTextCanonical && Boolean(s.windowTextCanonical);
  if (scriptFolded && s.canonicalInSqlHits && !s.hitPresent) {
    return 'NORMALIZATION_SURFACE_MISMATCH';
  }
  if (s.eligibleHitCount > 1) {
    return 'MULTIPLE_TONE_EXACT_CANDIDATES';
  }
  if (s.identityLookupRan && s.identityEligibleCount !== 1) {
    return 'SURFACE_EXACT_MISS';
  }
  if (s.eligibleHitCount === 0) {
    return 'NO_TONE_EXACT_CANDIDATE';
  }
  return 'OTHER_REJECT';
}

export function compactLength1SqlHits(entries: readonly { id?: string; word?: string; pinyin?: string[]; tonePinyinKey?: string; enabled?: boolean; priorScore?: number }[]): Length1SqlHitTrace[] {
  return entries.slice(0, 8).map((h) => ({
    termId: h.id != null ? String(h.id) : '',
    surface: h.word ?? '',
    pinyin: Array.isArray(h.pinyin) ? h.pinyin.join('|') : '',
    tone: h.tonePinyinKey ?? null,
    enabled: h.enabled !== false,
    sourceTable: 'base_lexicon',
    priorScore: Number.isFinite(h.priorScore) ? Number(h.priorScore) : 0,
  }));
}

/** Hard-blocked 1-char windows never enter the collector. Observation-only. */
export function makeBlockedLength1WindowTrace(w: {
  windowId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  windowSource: string;
  windowText: string;
  windowPinyinKey: string;
}): Length1WindowTrace {
  const pinyinKey = w.windowPinyinKey || '';
  return {
    contract: SINGLE_CHAR_COLLECTOR_TRACE_V1,
    pinyinKey,
    windowText: w.windowText,
    windowTextCanonical: w.windowText,
    toneRecallReadiness: 'not_invoked',
    queryExecuted: false,
    querySource: 'live',
    sqlLimit: 8,
    sqlHitCount: 0,
    postLimitCount: 0,
    preLimitCount: 0,
    truncated: false,
    eligibleHitCount: 0,
    toneExactHitCount: 0,
    uniqueToneExact: false,
    surfaceExactHitCount: 0,
    chosenSource: null,
    selectedCandidate: null,
    candidateScore: null,
    minCandidateScore: 0,
    terminalReason: pinyinKey ? 'SQL_NOT_EXECUTED' : 'NO_QUERY_KEY',
    sqlHits: [],
    windowId: w.windowId,
    rawStart: w.rawStart,
    rawEnd: w.rawEnd,
    syllableStart: w.syllableStart,
    syllableEnd: w.syllableEnd,
    windowSource: w.windowSource,
    blocked: true,
    boundCandidateCount: 0,
    tonePattern: null,
    queryTonePinyinKey: null,
  };
}
