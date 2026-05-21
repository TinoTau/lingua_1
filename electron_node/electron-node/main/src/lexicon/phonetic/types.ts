import type { LexiconRecallEvidence } from '../lexicon-types';

export type WindowPhoneticPreviewItem = {
  spanText: string;
  spanStart?: number;
  spanEnd?: number;
  candidateText: string;
  candidateSource: string;
  phoneticScore: number;
  spanPinyin?: string[];
  candidatePinyin?: string[];
  lexiconCandidate?: LexiconRecallEvidence;
};

export type BuildWindowPhoneticPreviewOptions = {
  maxItems?: number;
  minScore?: number;
  includePinyin?: boolean;
};

export const DEFAULT_WINDOW_PHONETIC_OPTIONS: Required<BuildWindowPhoneticPreviewOptions> = {
  maxItems: 32,
  minScore: 0.65,
  includePinyin: true,
};
