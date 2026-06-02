export type LexiconTierTable = 'base' | 'domain' | 'idiom';

export type PatchOpKind = 'add' | 'update' | 'enable' | 'disable' | 'delete';

export interface LexiconEntryV3 {
  id: string;
  word: string;
  pinyinKey: string;
  tonePinyinKey?: string;
  priorScore: number;
  aliases?: string[];
  repairTarget?: boolean;
  enabled?: boolean;
  domainId?: string;
  source?: string;
}

export interface PatchOperation {
  op: PatchOpKind;
  table: LexiconTierTable;
  word: string;
  pinyinKey?: string;
  domainId?: string;
  id?: string;
  entry?: LexiconEntryV3;
  fields?: Partial<LexiconEntryV3>;
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

export const V3_TABLE_THRESHOLDS = {
  base_lexicon: 47500,
  idiom_lexicon: 21000,
  domain_lexicon: 25,
  industry_routing_lexicon: 9,
} as const;
