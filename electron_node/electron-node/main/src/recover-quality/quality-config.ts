/**
 * Recover V3 质量优化 — 运行时配置（Q4 冻结，禁止 expansion/rerank 硬编码门限）。
 */

import { loadNodeConfig } from '../node-config';
import type { NodeConfig } from '../node-config-types';
import { DEFAULT_CONFIG } from '../node-config-defaults';

export type RecoverQualityConfig = {
  /** Q1.7 / V5 near pinyin：音节长度差上限（near 关闭时不使用） */
  recallFuzzyPinyinMaxSyllableDelta: number;
  recallMinPhoneticScore: number;
  expansionMinPhoneticScore: number;
  selectionMinPhoneticScore: number;
  /** 最终 apply 写回安全门：replacement 条数上限 */
  maxReplacements: number;
  maxSentenceCandidates: number;
  multiWindowScoreEpsilon: number;
  /** V5 冻结（Phase A stub，B–D 接线） */
  allowedWindowLengths: number[];
  diffContextLeft: number;
  diffContextRight: number;
  topKByTermLength: Record<string, number>;
  /** 句级组合：active diff windows 上限（windowSelector） */
  maxActiveWindows: number;
  minCandidateScore: number;
  kenlmBaselineTolerance: number;
  observedRecallEnabled: boolean;
  /** V5 默认 false：near 桶不参与 TopK */
  nearPinyinEnabled: boolean;
  /** V5 默认 false：禁止跨 segment 召回 */
  crossSegmentRecallEnabled: boolean;
};

/** 写入 result.extra / batch report 的 V5 配置快照 */
export type RecoverQualityConfigSnapshot = {
  allowedWindowLengths: number[];
  topKByTermLength: Record<string, number>;
  maxActiveWindows: number;
  maxSentenceCandidates: number;
  maxReplacements: number;
  nearPinyinEnabled: boolean;
  crossSegmentRecallEnabled: boolean;
  kenlmBaselineTolerance: number;
  observedRecallEnabled: boolean;
};

const DEFAULT_RECALL_MIN = 0.5;
const DEFAULT_FUZZY_PINYIN_SYLLABLE_DELTA = 2;
const DEFAULT_EXPANSION_MIN = 0.5;
const DEFAULT_SELECTION_MIN = 0.85;
const DEFAULT_MAX_SENTENCE_CANDIDATES = 32;
const DEFAULT_MULTI_WINDOW_EPSILON = 0.005;
const DEFAULT_ALLOWED_WINDOW_LENGTHS = [2, 3, 4, 5];
const DEFAULT_TOP_K_BY_TERM_LENGTH: Record<string, number> = {
  '2': 5,
  '3': 5,
  '4': 3,
  '5': 2,
};
const DEFAULT_KENLM_BASELINE_TOLERANCE = 0.15;

export function resolveRecoverQualityConfig(
  nodeConfig: NodeConfig | null | undefined = loadNodeConfig()
): RecoverQualityConfig {
  const lex = nodeConfig?.features?.lexiconRecall;
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
    maxSentenceCandidates: Math.max(
      lex?.maxSentenceCandidates ?? defaults?.maxSentenceCandidates ?? DEFAULT_MAX_SENTENCE_CANDIDATES,
      DEFAULT_MAX_SENTENCE_CANDIDATES
    ),
    multiWindowScoreEpsilon:
      lex?.multiWindowScoreEpsilon ?? defaults?.multiWindowScoreEpsilon ?? DEFAULT_MULTI_WINDOW_EPSILON,
    allowedWindowLengths:
      lex?.allowedWindowLengths ?? defaults?.allowedWindowLengths ?? DEFAULT_ALLOWED_WINDOW_LENGTHS,
    diffContextLeft: lex?.diffContextLeft ?? defaults?.diffContextLeft ?? 2,
    diffContextRight: lex?.diffContextRight ?? defaults?.diffContextRight ?? 2,
    topKByTermLength:
      lex?.topKByTermLength ?? defaults?.topKByTermLength ?? DEFAULT_TOP_K_BY_TERM_LENGTH,
    maxActiveWindows: lex?.maxActiveWindows ?? defaults?.maxActiveWindows ?? 2,
    minCandidateScore: lex?.minCandidateScore ?? defaults?.minCandidateScore ?? 0,
    kenlmBaselineTolerance:
      lex?.kenlmBaselineTolerance ?? defaults?.kenlmBaselineTolerance ?? DEFAULT_KENLM_BASELINE_TOLERANCE,
    observedRecallEnabled:
      lex?.observedRecallEnabled ?? defaults?.observedRecallEnabled ?? false,
    nearPinyinEnabled: lex?.nearPinyinEnabled ?? defaults?.nearPinyinEnabled ?? false,
    crossSegmentRecallEnabled:
      lex?.crossSegmentRecallEnabled ?? defaults?.crossSegmentRecallEnabled ?? false,
  };
}

export function getRecoverQualityConfig(): RecoverQualityConfig {
  return resolveRecoverQualityConfig(loadNodeConfig());
}

export function buildRecoverQualityConfigSnapshot(
  cfg: RecoverQualityConfig = getRecoverQualityConfig()
): RecoverQualityConfigSnapshot {
  return {
    allowedWindowLengths: [...cfg.allowedWindowLengths],
    topKByTermLength: { ...cfg.topKByTermLength },
    maxActiveWindows: cfg.maxActiveWindows,
    maxSentenceCandidates: cfg.maxSentenceCandidates,
    maxReplacements: cfg.maxReplacements,
    nearPinyinEnabled: cfg.nearPinyinEnabled,
    crossSegmentRecallEnabled: cfg.crossSegmentRecallEnabled,
    kenlmBaselineTolerance: cfg.kenlmBaselineTolerance,
    observedRecallEnabled: cfg.observedRecallEnabled,
  };
}
