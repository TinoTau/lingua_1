export type LexiconTierTable = 'base' | 'idiom' | 'term';

export type PatchOpKind = 'add' | 'update' | 'enable' | 'disable' | 'delete';

/** base / idiom tier patch entry */
export interface TierPatchEntry {
  id: string;
  word: string;
  pinyinKey: string;
  tonePinyinKey?: string;
  priorScore: number;
  aliases?: string[];
  repairTarget?: boolean;
  enabled?: boolean;
  source?: string;
}

/** Schema V2 domain SSOT patch entry */
export interface TermPatchEntry {
  termId?: string;
  word: string;
  pinyinKey: string;
  tonePinyinKey?: string;
  priorScore: number;
  aliases?: string[];
  repairTarget?: boolean;
  enabled?: boolean;
  source?: string;
  domainTags: string[];
  domainWeights?: Record<string, number>;
}

export interface PatchOperation {
  op: PatchOpKind;
  table: LexiconTierTable;
  word: string;
  termId?: string;
  pinyinKey?: string;
  /** delete-tag: remove one domain tag from term */
  domainId?: string;
  entry?: TierPatchEntry | TermPatchEntry;
  fields?: Partial<TierPatchEntry> | Partial<TermPatchEntry>;
}

export interface LexiconPatchV3 {
  patchId: string;
  baseVersion: number;
  nextVersion: number;
  hash: string;
  signature?: string;
  operations: PatchOperation[];
}

export type PatchBundleTableCounts = {
  base: number;
  idiom: number;
  domain: number;
  routing: number;
  term: number;
  termDomainTags: number;
  ngrams: number;
};

export type ApplyLexiconPatchV3Result = {
  ok: boolean;
  patchId: string;
  baseVersion: number;
  nextVersion: number;
  bundleVersion?: number;
  appliedAt: number;
  tables?: PatchBundleTableCounts;
  checksum?: string;
  errorCode?: string;
  message?: string;
  /** @deprecated use message */
  error?: string;
};

export const LEXICON_PATCH_HISTORY_TABLE = 'lexicon_patch_history';

export const V3_TABLE_THRESHOLDS_V2 = {
  base_lexicon: 47500,
  idiom_lexicon: 21000,
  term: 107,
  term_domain_tags: 190,
  domain_lexicon: 190,
  industry_routing_lexicon: 9,
  term_pinyin_ngrams: 80000,
} as const;

export function isTermPatchEntry(entry: TierPatchEntry | TermPatchEntry): entry is TermPatchEntry {
  return Array.isArray((entry as TermPatchEntry).domainTags);
}
