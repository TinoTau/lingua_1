/**
 * @deprecated Archived legacy span detector config — not used by active FW mainline.
 */

import type { FwDetectorSignal } from '../../../fw-detector/types';

export type FinalScoreWeights = {
  pinyin: number;
  prior: number;
  domain: number;
  kenlm: number;
};

export type LegacyFwDetectorRuntimeConfig = {
  maxSpans: number;
  spanDetectBudget: number;
  topK: number;
  minPrior: number;
  minRiskScore: number;
  windowChars: number;
  minSpanChars: number;
  maxSpanChars: number;
  noSpeechProbThreshold: number;
  signalWeights: Record<FwDetectorSignal, number>;
  domainAnchors: Record<string, string[]>;
  finalScoreWeights: FinalScoreWeights;
};

export const DEFAULT_LEGACY_FW_DETECTOR_CONFIG: LegacyFwDetectorRuntimeConfig = {
  maxSpans: 4,
  spanDetectBudget: 12,
  topK: 3,
  minPrior: 0.5,
  minRiskScore: 2,
  windowChars: 8,
  minSpanChars: 2,
  maxSpanChars: 4,
  noSpeechProbThreshold: 0.5,
  signalWeights: {
    domain_anchor_nearby: 2,
    detector_pinyin_hint: 2,
    pinyin_proximity: 2,
    mixed_language_anomaly: 1,
    low_no_speech_prob: 1,
    kenlm_local_low_prob: 0,
    alias_exact_hit: 0,
    low_word_probability: 0,
    low_segment_avg_logprob: 0,
    high_compression_ratio: 0,
    ime_v2_diff_hint: 0,
    ime_v2_instability_hint: 0,
  },
  domainAnchors: {},
  finalScoreWeights: { pinyin: 0.4, prior: 0.3, domain: 0.2, kenlm: 0.1 },
};
