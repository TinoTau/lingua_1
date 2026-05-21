import type { WindowCandidate } from '../../lexicon/hotword-types';
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
  combinedScore?: number;
};

export type SentenceExpansionLimits = {
  /** windowSelector maxReplacements 上限（1=single … 4=multi） */
  maxWindowsPerSentence: number;
  maxSentenceCandidates: number;
};

export const DEFAULT_SENTENCE_EXPANSION_LIMITS: SentenceExpansionLimits = {
  maxWindowsPerSentence: 4,
  maxSentenceCandidates: 16,
};
