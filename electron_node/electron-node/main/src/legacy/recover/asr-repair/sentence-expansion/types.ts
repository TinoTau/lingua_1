import type { WindowCandidate } from '../../../../lexicon/hotword-types';
import type { CandidateSource } from '../candidate-source';

export type SentenceCandidate = {
  text: string;
  hypothesisIndex: number;
  baseText: string;
  replacements: WindowCandidate[];
  candidateSource: CandidateSource;
  acousticScore?: number;
  phoneticScore: number;
  hotwordPrior: number;
  kenlmScore?: number;
  kenlmNormalizedScore?: number;
  kenlmBaselineDelta?: number;
  combinedScore?: number;
};

export type SentenceExpansionLimits = {
  /** windowSelector：active diff windows 上限（= maxActiveWindows） */
  maxActiveWindowsPerSentence: number;
  maxSentenceCandidates: number;
};

export const DEFAULT_SENTENCE_EXPANSION_LIMITS: SentenceExpansionLimits = {
  maxActiveWindowsPerSentence: 2,
  maxSentenceCandidates: 32,
};
