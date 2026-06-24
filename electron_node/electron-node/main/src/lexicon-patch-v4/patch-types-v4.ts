/** Patch V4 — explicit operation contract (Importer V4 / V1.2 Addendum). */

export const PATCH_SCHEMA_VERSION_V4 = 'lexicon-patch-v4' as const;

export const EXPANSION_DENY_LIST = [
  '候选生成',
  '上线计划',
  '接口文档',
  '机场高速',
  '热巧克力',
  '酒店订单',
  '燕麦拿铁',
  '杭州西溪',
] as const;

export const MAX_EXPANSION_CJK_LEN = 5;

export type PatchOpV4 =
  | 'addTerm'
  | 'appendDomainTags'
  | 'addLegalAlias'
  | 'removeAlias'
  | 'removeDomainTag'
  | 'enableTerm'
  | 'disableTerm'
  | 'updateDomainWeights'
  | 'updateTermFields'
  | 'deleteTerm'
  | 'replaceDomainTagsDangerous';

export type AliasEntryV4 = {
  alias: string;
  alias_type: string;
};

export type PatchOperationV4 = {
  op: PatchOpV4;
  word: string;
  term_id?: string;
  pinyin_key?: string;
  pinyin?: string;
  tone_pinyin_key?: string;
  domain_tags?: string[];
  domain_weights?: Record<string, number>;
  prior_score?: number;
  repair_target?: boolean;
  enabled?: boolean;
  source?: string;
  alias?: string;
  alias_type?: string;
  alias_entries?: AliasEntryV4[];
  domain_id?: string;
  reason?: string;
  dangerous?: boolean;
  fields?: {
    prior_score?: number;
    repair_target?: boolean;
    enabled?: boolean;
    tone_pinyin_key?: string;
    source?: string;
  };
};

export type TableThresholdsV4 = Partial<{
  base_lexicon: number;
  idiom_lexicon: number;
  term: number;
  term_domain_tags: number;
  domain_lexicon: number;
  industry_routing_lexicon: number;
  term_pinyin_ngrams: number;
}>;

export type LexiconPatchV4 = {
  patchId: string;
  patchSchemaVersion: typeof PATCH_SCHEMA_VERSION_V4;
  baseVersion: number;
  nextVersion: number;
  hash: string;
  operations: PatchOperationV4[];
  /** Required when operations.length > 100 (large expansion packages). */
  tableThresholds?: TableThresholdsV4;
};

export type ApplyLexiconPatchV4Result = {
  ok: boolean;
  patchId: string;
  baseVersion: number;
  nextVersion: number;
  bundleVersion?: number;
  appliedAt: number;
  checksum?: string;
  errorCode?: string;
  message?: string;
  tables?: Record<string, number>;
};

export type PatchValidationErrorV4 = { code: string; message: string };

export const DEFAULT_PRIOR_SCORE_V4 = 0.85;
