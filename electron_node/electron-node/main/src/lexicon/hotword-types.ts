/**
 * Hotword lexicon types (Recover V5).
 */

import type { CandidateScoreBreakdown } from './candidate-score';
import type { HotwordRecallPath, WindowCandidateSource } from './window-candidate-source';

export type { HotwordRecallPath, WindowCandidateSource } from './window-candidate-source';
export { isV3WindowCandidateSource, V3_WINDOW_CANDIDATE_SOURCES } from './window-candidate-source';

export type HotwordEntry = {
  id: string;
  word: string;
  normalized?: string;
  pinyin: string[];
  priorScore: number;
  frequency: number;
  domain?: string;
  domains?: string[];
  aliases?: string[];
  /** P1.2c: allows span to participate as FW replacement candidate (default false). */
  repairTarget?: boolean;
  source?: string;
  updatedAt?: number;
  enabled: boolean;
  tags?: string[];
  /** P4: materialized alias row from V2 sqlite. */
  isAlias?: boolean;
  /** P4: tone pinyin syllables with tone numbers, e.g. mei3|shi4 */
  tonePinyinKey?: string;
};

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
  matchedAlias?: string;
  evidence?: unknown[];
};

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
  matchedAlias?: string;
};
