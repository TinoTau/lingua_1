/**
 * Hotword lexicon types (recover v1).
 */

export type HotwordEntry = {
  id: string;
  word: string;
  pinyin: string[];
  frequency: number;
  domain?: string;
  enabled: boolean;
};

export type HotwordRecallPath = 'pinyin' | 'exact' | 'confusion_evidence' | 'fuzzy_observed';

export type HotwordRecallHit = {
  hotword: HotwordEntry;
  windowId: string;
  recallPath: HotwordRecallPath;
  phoneticScore: number;
  priorScore: number;
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
  source: 'hotword' | 'exact' | 'confusion_evidence' | 'fuzzy_observed';
};
