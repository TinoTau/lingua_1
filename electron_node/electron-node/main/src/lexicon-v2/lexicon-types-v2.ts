/**
 * Schema V2 runtime — lexicon-v3-five-table-v2 only.
 */

export const LEXICON_V2_SHADOW_SCHEMA_VERSION = 'lexicon-v2-shadow-v2';

export const LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION = 'lexicon-v3-five-table-v2';

export const LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS = [
  LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION,
] as const;

export function isLexiconV3FiveTableManifest(version: string | undefined): boolean {
  return version === LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION;
}

export function isLexiconV3FiveTableV2Manifest(version: string | undefined): boolean {
  return version === LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION;
}

export type LexiconRuntimeV2Status = 'ok' | 'missing' | 'disabled' | 'error';

export type LexiconManifestV2 = {
  schemaVersion: string;
  buildTime?: number | string;
  bundle_tag?: string;
  bundleTag?: string;
  bundleVersion?: number;
  checksum: string;
  createdAt?: string;
  backend?: string;
  seed_path?: string;
  seed_inputs?: string[];
  seedInputs?: string[];
  tables?: Record<string, unknown>;
  lastPatchId?: string | null;
  lastAppliedAt?: string | null;
  rejectedCount?: number;
  rejectStats?: Record<string, number>;
  domainAvailability?: Record<string, number>;
  domainHierarchyVersion?: string;
};

export type LexiconRuntimeV2State = {
  status: LexiconRuntimeV2Status;
  manifestVersion?: string;
  bundleDir?: string | null;
  errorMessage?: string;
  tableCounts?: {
    base: number;
    idiom: number;
    domain: number;
    routing: number;
    ngrams?: number;
    term?: number;
    termDomainTags?: number;
  };
  domainAvailability?: Record<string, number>;
  domainHierarchyVersion?: string;
};

export type ParentTermNgramRow = {
  id: number;
  parentTermId: string;
  parentWord: string;
  parentPinyinKey: string;
  parentTonePinyinKey?: string;
  ngramPinyinKey: string;
  ngramTonePinyinKey?: string;
  ngramStart: number;
  ngramEnd: number;
  fragmentText: string;
  tier: 'base' | 'domain' | 'idiom';
  domainId?: string;
  repairTarget: boolean;
  prior: number;
  source?: string;
  enabled: boolean;
};

export type IndustryRouteHit = {
  pinyinKey: string;
  keyword: string;
  domainId: string;
  weight: number;
};
