/**
 * Recover V3 质量优化 — 运行时配置（Q4 冻结，禁止 expansion/rerank 硬编码门限）。
 */

import { loadNodeConfig } from '../node-config';
import { DEFAULT_CONFIG } from '../node-config-defaults';

export type RecoverQualityConfig = {
  /** Q1.7：fuzzy pinyin 音节长度差上限（默认 2，仅 recall） */
  recallFuzzyPinyinMaxSyllableDelta: number;
  recallMinPhoneticScore: number;
  /** WindowCandidate → SentenceCandidate（禁止用 selectionMin） */
  expansionMinPhoneticScore: number;
  selectionMinPhoneticScore: number;
  maxReplacements: number;
  maxSentenceCandidates: number;
  multiWindowScoreEpsilon: number;
};

const DEFAULT_RECALL_MIN = 0.5;
const DEFAULT_FUZZY_PINYIN_SYLLABLE_DELTA = 2;
const DEFAULT_EXPANSION_MIN = 0.5;
const DEFAULT_SELECTION_MIN = 0.85;
const DEFAULT_MAX_SENTENCE_CANDIDATES = 16;
const DEFAULT_MULTI_WINDOW_EPSILON = 0.005;

export function getRecoverQualityConfig(): RecoverQualityConfig {
  const lex = loadNodeConfig().features?.lexiconRecall;
  const defaults = DEFAULT_CONFIG.features?.lexiconRecall;
  const maxReplacements = lex?.maxReplacements ?? defaults?.maxReplacements ?? 2;
  const recallMinPhoneticScore =
    lex?.recallMinPhoneticScore ?? defaults?.recallMinPhoneticScore ?? DEFAULT_RECALL_MIN;
  const expansionMinPhoneticScore =
    lex?.expansionMinPhoneticScore ??
    defaults?.expansionMinPhoneticScore ??
    recallMinPhoneticScore;
  const selectionMinPhoneticScore =
    lex?.selectionMinPhoneticScore ??
    lex?.minPhoneticScore ??
    defaults?.selectionMinPhoneticScore ??
    defaults?.minPhoneticScore ??
    DEFAULT_SELECTION_MIN;

  return {
    recallFuzzyPinyinMaxSyllableDelta:
      lex?.recallFuzzyPinyinMaxSyllableDelta ??
      defaults?.recallFuzzyPinyinMaxSyllableDelta ??
      DEFAULT_FUZZY_PINYIN_SYLLABLE_DELTA,
    recallMinPhoneticScore,
    expansionMinPhoneticScore,
    selectionMinPhoneticScore,
    maxReplacements: maxReplacements < 1 ? 1 : maxReplacements,
    maxSentenceCandidates:
      lex?.maxSentenceCandidates ?? defaults?.maxSentenceCandidates ?? DEFAULT_MAX_SENTENCE_CANDIDATES,
    multiWindowScoreEpsilon:
      lex?.multiWindowScoreEpsilon ?? defaults?.multiWindowScoreEpsilon ?? DEFAULT_MULTI_WINDOW_EPSILON,
  };
}
