/**
 * SingleCharDisambiguationContractV1 — Node/Model2 internal only (not JobResult).
 * Candidate-relative indices. No hanzi class ids. No expectedText.
 */

import { stableBucket } from './feature-hash-v1';

export const SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1 = 'SingleCharDisambiguationContractV1';
export const SINGLE_CHAR_CANDIDATE_SET_CAP_V1 = 8;
/** Inclusive UTF-16 code-unit window on existing rawText. Deterministic. */
export const SINGLE_CHAR_CONTEXT_CHARS_V1 = 16;
export const AMBIGUITY_HEAD_ARCH = 'AmbiguityHeadV1';

export type SingleCharLexicalSourceV1 = 'synthetic' | 'test_provider' | 'base_lexicon_internal';

export type SingleCharCandidateFeaturesV1 = {
  /** AUXILIARY only — must not be treated as a character-class lookup. */
  surface_hash_aux: number;
  pinyin_hash_aux: number;
  tone: number;
  relative_index: number;
  candidate_count: number;
};

export type SingleCharCandidateV1 = {
  candidate_index: number;
  term_id: string;
  surface: string;
  canonical_surface: string;
  pinyin: string;
  tone: number | null;
  origin_span_id: string;
  raw_start: number;
  raw_end: number;
  syllable_start: number;
  syllable_end: number;
  lexical_source: SingleCharLexicalSourceV1;
  candidate_features: SingleCharCandidateFeaturesV1;
};

export type SingleCharDisambiguationRequestV1 = {
  request_id: string;
  span_id: string;
  contract: typeof SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1;
  span_surface: string;
  span_canonical_surface: string;
  acoustic_pinyin: string;
  acoustic_tone_pinyin_key: string;
  left_context: string;
  right_context: string;
  candidates: SingleCharCandidateV1[];
  phonetic_bias?: Record<string, number>;
  long_term_domain_evidence?: Record<string, number>;
};

export type SingleCharAbstainReasonV1 =
  | 'N_LT_2_NOT_INVOKED'
  | 'HEAD_NOT_AVAILABLE'
  | 'INVALID_REQUEST'
  | 'INVALID_DECISION'
  | 'INDEX_OUT_OF_RANGE'
  | 'INFERENCE_ERROR'
  | 'TEST_ADAPTER_ABSTAIN'
  | 'MALFORMED_RESPONSE';

export type SingleCharDisambiguationDecisionV1 = {
  contract: typeof SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1;
  request_id: string;
  decision: 'SELECT' | 'ABSTAIN';
  selected_candidate_index: number | null;
  abstain_reason: SingleCharAbstainReasonV1 | null;
  model_head_available: boolean;
  ambiguity_invoked: boolean;
  candidate_count: number;
  latency_ms: number;
};

export type SingleCharAmbiguityTraceV1 = {
  singleCharAmbiguityInvoked: boolean;
  candidateCount: number;
  requestId: string | null;
  candidateIds: string[];
  surfaces: string[];
  decision: 'SELECT' | 'ABSTAIN' | 'SKIP';
  selectedIndex: number | null;
  abstainReason: SingleCharAbstainReasonV1 | null;
  modelHeadAvailable: boolean;
  latencyMs: number;
};

export function sliceSingleCharContextV1(
  rawText: string,
  rawStart: number,
  rawEnd: number,
  windowChars: number = SINGLE_CHAR_CONTEXT_CHARS_V1
): { left_context: string; right_context: string } {
  const text = (rawText || '').normalize('NFC');
  const start = Math.max(0, rawStart);
  const end = Math.max(start, rawEnd);
  const leftFrom = Math.max(0, start - windowChars);
  const rightTo = Math.min(text.length, end + windowChars);
  return {
    left_context: text.slice(leftFrom, start),
    right_context: text.slice(end, rightTo),
  };
}

export function auxiliarySurfaceHash(surface: string): number {
  return stableBucket(surface || '\uFFFD', 1024);
}

export function buildCandidateFeaturesV1(
  index: number,
  count: number,
  surface: string,
  pinyin: string,
  tone: number | null
): SingleCharCandidateFeaturesV1 {
  return {
    surface_hash_aux: auxiliarySurfaceHash(surface),
    pinyin_hash_aux: stableBucket(pinyin || 'unk', 256),
    tone: tone ?? -1,
    relative_index: index,
    candidate_count: count,
  };
}

function isFiniteIndex(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

export function validateDisambiguationRequestV1(
  req: SingleCharDisambiguationRequestV1 | null | undefined
): SingleCharAbstainReasonV1 | null {
  if (!req || req.contract !== SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1) {
    return 'INVALID_REQUEST';
  }
  if (!req.request_id || !req.span_id) return 'INVALID_REQUEST';
  const n = req.candidates?.length ?? 0;
  if (n < 2) return 'INVALID_REQUEST';
  if (n > SINGLE_CHAR_CANDIDATE_SET_CAP_V1) return 'INVALID_REQUEST';
  for (let i = 0; i < n; i += 1) {
    const c = req.candidates[i];
    if (!c) return 'INVALID_REQUEST';
    if (c.candidate_index !== i) return 'INVALID_REQUEST';
    if (!c.term_id || !c.surface) return 'INVALID_REQUEST';
  }
  return null;
}

export function failClosedAbstain(args: {
  request_id: string;
  reason: SingleCharAbstainReasonV1;
  candidate_count: number;
  invoked: boolean;
  latency_ms?: number;
}): SingleCharDisambiguationDecisionV1 {
  return {
    contract: SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1,
    request_id: args.request_id,
    decision: 'ABSTAIN',
    selected_candidate_index: null,
    abstain_reason: args.reason,
    model_head_available: false,
    ambiguity_invoked: args.invoked,
    candidate_count: args.candidate_count,
    latency_ms: args.latency_ms ?? 0,
  };
}

export function coerceDecisionV1(
  raw: unknown,
  candidateCount: number,
  requestId: string
): SingleCharDisambiguationDecisionV1 {
  if (!raw || typeof raw !== 'object') {
    return failClosedAbstain({
      request_id: requestId,
      reason: 'MALFORMED_RESPONSE',
      candidate_count: candidateCount,
      invoked: true,
    });
  }
  const obj = raw as Record<string, unknown>;
  const decision = obj.decision;
  if (decision === 'ABSTAIN') {
    return {
      contract: SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1,
      request_id: requestId,
      decision: 'ABSTAIN',
      selected_candidate_index: null,
      abstain_reason:
        typeof obj.abstain_reason === 'string'
          ? (obj.abstain_reason as SingleCharAbstainReasonV1)
          : 'HEAD_NOT_AVAILABLE',
      model_head_available: obj.model_head_available === true,
      ambiguity_invoked: true,
      candidate_count: candidateCount,
      latency_ms: typeof obj.latency_ms === 'number' ? obj.latency_ms : 0,
    };
  }
  if (decision !== 'SELECT') {
    return failClosedAbstain({
      request_id: requestId,
      reason: 'INVALID_DECISION',
      candidate_count: candidateCount,
      invoked: true,
    });
  }
  const idx = obj.selected_candidate_index;
  if (!isFiniteIndex(idx) || idx < 0 || idx >= candidateCount) {
    return failClosedAbstain({
      request_id: requestId,
      reason: 'INDEX_OUT_OF_RANGE',
      candidate_count: candidateCount,
      invoked: true,
    });
  }
  return {
    contract: SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1,
    request_id: requestId,
    decision: 'SELECT',
    selected_candidate_index: idx,
    abstain_reason: null,
    model_head_available: obj.model_head_available === true,
    ambiguity_invoked: true,
    candidate_count: candidateCount,
    latency_ms: typeof obj.latency_ms === 'number' ? obj.latency_ms : 0,
  };
}

export type SingleCharRouteResultV1 = {
  invocation_count: number;
  decision: SingleCharDisambiguationDecisionV1;
  selected: SingleCharCandidateV1 | null;
  trace: SingleCharAmbiguityTraceV1;
};

export type SingleCharAmbiguityDeciderV1 = (
  req: SingleCharDisambiguationRequestV1
) => SingleCharDisambiguationDecisionV1;

/** Production default: never SELECT without accepted ambiguity weights. */
export function productionAbstainDeciderV1(
  req: SingleCharDisambiguationRequestV1
): SingleCharDisambiguationDecisionV1 {
  return failClosedAbstain({
    request_id: req.request_id,
    reason: 'HEAD_NOT_AVAILABLE',
    candidate_count: req.candidates.length,
    invoked: true,
  });
}

/**
 * Test-only. SELECT by term_id so permutation of candidate[] still maps to the same lexical item.
 * Must not be wired as a production rule engine.
 */
export function createTestAmbiguityDeciderV1(
  spec: { type: 'ABSTAIN' } | { type: 'SELECT_TERM_ID'; term_id: string } | { type: 'SELECT_INDEX'; index: number }
): SingleCharAmbiguityDeciderV1 {
  return (req) => {
    if (spec.type === 'ABSTAIN') {
      return failClosedAbstain({
        request_id: req.request_id,
        reason: 'TEST_ADAPTER_ABSTAIN',
        candidate_count: req.candidates.length,
        invoked: true,
      });
    }
    if (spec.type === 'SELECT_INDEX') {
      return coerceDecisionV1(
        {
          decision: 'SELECT',
          selected_candidate_index: spec.index,
          model_head_available: false,
        },
        req.candidates.length,
        req.request_id
      );
    }
    const idx = req.candidates.findIndex((c) => c.term_id === spec.term_id);
    return coerceDecisionV1(
      {
        decision: 'SELECT',
        selected_candidate_index: idx,
        model_head_available: false,
      },
      req.candidates.length,
      req.request_id
    );
  };
}

export function routeSingleCharAmbiguityV1(args: {
  request: SingleCharDisambiguationRequestV1 | null;
  n_eligible: number;
  decider?: SingleCharAmbiguityDeciderV1;
}): SingleCharRouteResultV1 {
  const n = args.n_eligible;
  const emptyTrace = (decision: SingleCharAmbiguityTraceV1['decision'], reason: SingleCharAbstainReasonV1 | null): SingleCharAmbiguityTraceV1 => ({
    singleCharAmbiguityInvoked: false,
    candidateCount: n,
    requestId: args.request?.request_id ?? null,
    candidateIds: [],
    surfaces: [],
    decision,
    selectedIndex: null,
    abstainReason: reason,
    modelHeadAvailable: false,
    latencyMs: 0,
  });

  if (n <= 0) {
    const decision = failClosedAbstain({
      request_id: args.request?.request_id || 'n0',
      reason: 'N_LT_2_NOT_INVOKED',
      candidate_count: 0,
      invoked: false,
    });
    return { invocation_count: 0, decision, selected: null, trace: emptyTrace('SKIP', 'N_LT_2_NOT_INVOKED') };
  }
  if (n === 1) {
    const decision = failClosedAbstain({
      request_id: args.request?.request_id || 'n1',
      reason: 'N_LT_2_NOT_INVOKED',
      candidate_count: 1,
      invoked: false,
    });
    return { invocation_count: 0, decision, selected: null, trace: emptyTrace('SKIP', 'N_LT_2_NOT_INVOKED') };
  }

  const invalid = validateDisambiguationRequestV1(args.request);
  if (invalid || !args.request) {
    const decision = failClosedAbstain({
      request_id: args.request?.request_id || 'invalid',
      reason: invalid || 'INVALID_REQUEST',
      candidate_count: n,
      invoked: true,
    });
    return {
      invocation_count: 1,
      decision,
      selected: null,
      trace: {
        singleCharAmbiguityInvoked: true,
        candidateCount: n,
        requestId: decision.request_id,
        candidateIds: args.request?.candidates.map((c) => c.term_id) ?? [],
        surfaces: args.request?.candidates.map((c) => c.surface) ?? [],
        decision: 'ABSTAIN',
        selectedIndex: null,
        abstainReason: decision.abstain_reason,
        modelHeadAvailable: false,
        latencyMs: 0,
      },
    };
  }

  const t0 = Date.now();
  const decider = args.decider || productionAbstainDeciderV1;
  const raw = decider(args.request);
  const decision = coerceDecisionV1(raw, args.request.candidates.length, args.request.request_id);
  decision.latency_ms = Date.now() - t0;
  const selected =
    decision.decision === 'SELECT' && decision.selected_candidate_index != null
      ? args.request.candidates[decision.selected_candidate_index] ?? null
      : null;
  if (decision.decision === 'SELECT' && selected) {
    // Output must be a member of the supplied set (same object identity).
    if (!args.request.candidates.includes(selected)) {
      const abstain = failClosedAbstain({
        request_id: args.request.request_id,
        reason: 'INVALID_DECISION',
        candidate_count: n,
        invoked: true,
      });
      return {
        invocation_count: 1,
        decision: abstain,
        selected: null,
        trace: {
          singleCharAmbiguityInvoked: true,
          candidateCount: n,
          requestId: args.request.request_id,
          candidateIds: args.request.candidates.map((c) => c.term_id),
          surfaces: args.request.candidates.map((c) => c.surface),
          decision: 'ABSTAIN',
          selectedIndex: null,
          abstainReason: 'INVALID_DECISION',
          modelHeadAvailable: false,
          latencyMs: decision.latency_ms,
        },
      };
    }
  }

  return {
    invocation_count: 1,
    decision,
    selected,
    trace: {
      singleCharAmbiguityInvoked: true,
      candidateCount: n,
      requestId: args.request.request_id,
      candidateIds: args.request.candidates.map((c) => c.term_id),
      surfaces: args.request.candidates.map((c) => c.surface),
      decision: decision.decision,
      selectedIndex: decision.selected_candidate_index,
      abstainReason: decision.abstain_reason,
      modelHeadAvailable: decision.model_head_available,
      latencyMs: decision.latency_ms,
    },
  };
}
