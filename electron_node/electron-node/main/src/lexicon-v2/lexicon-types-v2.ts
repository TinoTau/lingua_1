/**
 * Lexicon Runtime V2 — types (shadow bundle + SQL query runtime).
 */

export const LEXICON_V2_SHADOW_SCHEMA_V1 = 'lexicon-v2-shadow-v1';
export const LEXICON_V2_SHADOW_SCHEMA_VERSION = 'lexicon-v2-shadow-v2';

export const LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS = [
  LEXICON_V2_SHADOW_SCHEMA_V1,
  LEXICON_V2_SHADOW_SCHEMA_VERSION,
] as const;

export type LexiconRuntimeV2Status = 'ok' | 'missing' | 'disabled' | 'error';

export type LexiconManifestV2 = {
  schemaVersion: string;
  buildTime?: number;
  bundle_tag?: string;
  checksum: string;
  createdAt?: string;
  backend?: string;
  seed_path?: string;
  seed_inputs?: string[];
  tables?: Record<string, unknown>;
  rejectedCount?: number;
  rejectStats?: Record<string, number>;
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
  };
};

export type IndustryRouteHit = {
  pinyinKey: string;
  keyword: string;
  domainId: string;
  weight: number;
};
