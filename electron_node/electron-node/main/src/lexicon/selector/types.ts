import type { WindowPhoneticPreviewItem } from '../phonetic/types';

export type LexiconBoundCandidate = {
  originalText: string;
  candidateText: string;
  replacement: {
    start: number;
    end: number;
    from: string;
    to: string;
    source: string;
    phoneticScore?: number;
  };
  sourceEvidence: {
    lexicon?: unknown;
    phonetic?: WindowPhoneticPreviewItem;
  };
};

export type SpanWindowRejectedReason =
  | 'no_candidate'
  | 'score_below_threshold'
  | 'overlap'
  | 'max_replacements_reached';

export type SpanWindow = {
  windowId: string;
  span: { start: number; end: number; text: string };
  previews: WindowPhoneticPreviewItem[];
  boundCandidates: LexiconBoundCandidate[];
  selectedCandidate?: LexiconBoundCandidate;
  rejectedReason?: SpanWindowRejectedReason;
};

export type ActiveSelectorReason =
  | 'original_selected'
  | 'phonetic_candidate_selected'
  | 'multi_phonetic_candidates_selected'
  | 'multi_window_candidates_selected'
  | 'no_candidate'
  | 'score_below_threshold'
  | 'unsafe_candidate';

export type ActiveSelectorDecision = {
  selectedText: string;
  applied: boolean;
  selectedReason: ActiveSelectorReason;
  /** Legacy: first selected span (=== selectedCandidates[0] when applied). */
  selectedCandidate?: LexiconBoundCandidate;
  selectedCandidates?: LexiconBoundCandidate[];
  windows?: SpanWindow[];
};

export type AsrLexiconSelectionReplacement = {
  from: string;
  to: string;
  phoneticScore?: number;
  start?: number;
  end?: number;
};

export type AsrLexiconWindowExtra = {
  windowId: string;
  span: { start: number; end: number; text: string };
  candidateCount: number;
  selected: boolean;
  rejectedReason?: SpanWindowRejectedReason;
  selectedReplacement?: AsrLexiconSelectionReplacement;
};

export type AsrLexiconSelectionExtra = {
  applied: boolean;
  selectedReason: ActiveSelectorReason;
  selectedText: string;
  /** Legacy: first replacement (=== selections[0] when applied). */
  replacement?: AsrLexiconSelectionReplacement;
  selections?: AsrLexiconSelectionReplacement[];
  windows?: AsrLexiconWindowExtra[];
};
