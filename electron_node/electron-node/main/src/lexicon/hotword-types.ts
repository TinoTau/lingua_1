/**
 * Hotword lexicon types (Recover V5).
 */

import type { CandidateScoreBreakdown } from './candidate-score';

export type HotwordEntry = {
  id: string;
  word: string;
  pinyin: string[];
  /** V5：运营/build 维护，runtime 索引必填 */
  priorScore: number;
  frequency: number;
  domain?: string;
  enabled: boolean;
  tags?: string[];
};

export type HotwordRecallPath =
  | 'lexicon_pinyin_topk'
  | 'pinyin'
  | 'exact'
  | 'confusion_evidence'
  | 'fuzzy_observed';

export type HotwordRecallHit = {
  hotword: HotwordEntry;
  windowId: string;
  recallPath: HotwordRecallPath;
  phoneticScore: number;
  priorScore: number;
  candidateScore?: number;
  candidateScoreBreakdown?: CandidateScoreBreakdown;
  rankInTopK?: number;
  termLength?: number;
  matchType?: 'exact' | 'near';
  evidence?: unknown[];
};

export type WindowCandidateSource =
  | 'lexicon_pinyin_topk'
  | 'hotword'
  | 'exact'
  | 'confusion_evidence'
  | 'fuzzy_observed';

export type WindowCandidate = {
  windowId: string;
  hypothesisIndex: number;
  from: string;
  to: string;
  start: number;
  end: number;
  hotwordId: string;
  phoneticScore: number;
  priorScore: number;
  candidateScore?: number;
  rankInTopK?: number;
  termLength?: number;
  source: WindowCandidateSource;
  matchType?: 'exact' | 'near';
  windowPinyin?: string[];
  candidatePinyin?: string[];
  diffSpanId?: string;
  windowTrigger?: string;
  sourceHypothesisRank?: number;
  candidateScoreBreakdown?: CandidateScoreBreakdown;
};
