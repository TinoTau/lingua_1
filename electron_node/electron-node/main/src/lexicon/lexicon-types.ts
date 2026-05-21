/**
 * Lexicon runtime types — candidate evidence only (no writeback).
 */

export type LexiconCandidateSource = 'term' | 'phrase' | 'confusion' | 'phonetic';

export type LexiconRecallPath = 'term' | 'pinyin';

/** Pinyin index / SQLite row shape. */
export type PinyinIndexRow = {
  id: string;
  term: string;
  replacement: string;
  pinyin?: string | null;
  source: LexiconCandidateSource;
  priority: number;
  enabled: number;
};

export type AsrWindow = {
  windowId: string;
  text: string;
  start: number;
  end: number;
  syllables: string[];
};

/** P1 recall output — evidence, not final replacement. */
export type LexiconRecallEvidence = {
  term: string;
  replacement: string;
  source: LexiconCandidateSource;
  priority: number;
  raw: unknown;

  recallPath: LexiconRecallPath;
  pinyinKey: string;

  windowId: string;
  windowText: string;
  windowStart: number;
  windowEnd: number;
  windowPinyin: string[];
  /** Legacy coordinate aliases for JobResult / resolve-span. */
  start?: number;
  end?: number;
};

/** Bounded candidate for P2/P3 — span owned by ASR window. */
export type BoundedReplacement = {
  windowId: string;
  from: string;
  to: string;
  start: number;
  end: number;
  evidences: LexiconRecallEvidence[];
  bestEvidence: LexiconRecallEvidence;
  phoneticScore: number;
  priority: number;
  source: string;
};

/** @deprecated Alias — use LexiconRecallEvidence; kept for JobResult / tests. */
export type LexiconRecallCandidate = LexiconRecallEvidence & {
  /** Legacy coordinate aliases (= windowStart/windowEnd). */
  start?: number;
  end?: number;
  score?: number;
  windowText?: string;
  windowId?: string;
  recallPath?: LexiconRecallPath;
};

export type LexiconRuntimeStatus = 'ok' | 'missing' | 'disabled' | 'error';

export type LexiconManifest = {
  version: string;
  checksum: string;
  createdAt: string;
  backend: string;
};

export type LexiconRuntimeState = {
  status: LexiconRuntimeStatus;
  manifestVersion?: string;
  errorMessage?: string;
};
