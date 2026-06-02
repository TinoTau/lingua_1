import * as fs from 'fs';
import Database = require('better-sqlite3');
import logger from '../logger';
import type { HotwordEntry } from '../lexicon/hotword-types';
import { parseAliasesField } from '../lexicon/scored-lexicon';
import { normalizeManifestChecksum, sha256File } from '../lexicon/lexicon-manifest';
import { lexiconV2BundleFileNames, resolveLexiconV2BundleDir } from './lexicon-v2-bundle-path';
import { getLexiconRuntimeV2Config } from './lexicon-runtime-v2-config';
import { LruBucketCache } from './lru-bucket-cache';
import {
  LEXICON_V2_SHADOW_SCHEMA_VERSION,
  LEXICON_V3_RUNTIME_SCHEMA_VERSION,
  LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS,
  type IndustryRouteHit,
  type LexiconManifestV2,
  type LexiconRuntimeV2State,
} from './lexicon-types-v2';

type TierRow = {
  id: string;
  pinyin_key: string;
  word: string;
  normalized: string | null;
  prior_score: number;
  repair_target: number;
  enabled: number;
  aliases: string | null;
  source: string | null;
  canonical_word: string | null;
  is_alias: number;
  tone_pinyin_key?: string | null;
  domain_id?: string | null;
};

function parsePinyinKeyToSyllables(pinyinKey: string): string[] {
  return pinyinKey.split('|').filter(Boolean);
}

function mapTierRowToHotword(row: TierRow, domainId?: string): HotwordEntry {
  const domains = domainId ? [domainId] : [];
  return {
    id: row.id,
    word: row.word,
    normalized: row.normalized?.trim() || row.word,
    pinyin: parsePinyinKeyToSyllables(row.pinyin_key),
    priorScore: row.prior_score,
    frequency: 1,
    domain: domainId,
    domains,
    aliases: parseAliasesField(row.aliases),
    source: row.source?.trim() || undefined,
    enabled: row.enabled === 1,
    repairTarget: row.repair_target === 1,
    isAlias: row.is_alias === 1,
    tonePinyinKey: row.tone_pinyin_key?.trim() || undefined,
  };
}

function mapTierRows(rows: TierRow[], domainId?: string): HotwordEntry[] {
  return rows.map((row) => mapTierRowToHotword(row, domainId));
}

function readManifestV2(manifestPath: string): LexiconManifestV2 {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as LexiconManifestV2;
  if (!parsed.checksum || !parsed.schemaVersion) {
    throw new Error(`Invalid manifest.json: ${manifestPath}`);
  }
  return parsed;
}

function verifyV2Checksum(sqlitePath: string, manifest: LexiconManifestV2, checksumPath?: string): void {
  const actual = sha256File(sqlitePath);
  const expected = normalizeManifestChecksum(manifest.checksum);
  if (actual !== expected) {
    throw new Error(`Lexicon V2 sqlite checksum mismatch: manifest=${expected} actual=${actual}`);
  }
  if (checksumPath && fs.existsSync(checksumPath)) {
    const fromFile = normalizeManifestChecksum(fs.readFileSync(checksumPath, 'utf-8'));
    if (fromFile && fromFile !== expected) {
      throw new Error('Lexicon checksum.txt does not match manifest.json');
    }
  }
}

export class LexiconRuntimeV2 {
  private db: Database.Database | null = null;
  private manifest: LexiconManifestV2 | null = null;
  private state: LexiconRuntimeV2State = { status: 'missing' };
  private bucketCache: LruBucketCache<HotwordEntry[]>;
  private tierSqlQueries = 0;
  private tierCacheHits = 0;
  private tierCacheMisses = 0;

  private stmtBase: Database.Statement | null = null;
  private stmtIdiom: Database.Statement | null = null;
  private stmtDomain: Database.Statement | null = null;
  private stmtRouting: Database.Statement | null = null;

  constructor() {
    const cfg = getLexiconRuntimeV2Config();
    this.bucketCache = new LruBucketCache<HotwordEntry[]>(cfg.lruBucketCacheSize);
  }

  getState(): LexiconRuntimeV2State {
    return { ...this.state };
  }

  getManifestVersion(): string | undefined {
    return this.manifest?.schemaVersion;
  }

  getCacheStats() {
    return this.bucketCache.stats();
  }

  getAndResetTierQueryStats(): { sqlQueries: number; cacheHits: number; cacheMisses: number } {
    const stats = {
      sqlQueries: this.tierSqlQueries,
      cacheHits: this.tierCacheHits,
      cacheMisses: this.tierCacheMisses,
    };
    this.tierSqlQueries = 0;
    this.tierCacheHits = 0;
    this.tierCacheMisses = 0;
    return stats;
  }

  load(): LexiconRuntimeV2State {
    const bundleDir = resolveLexiconV2BundleDir();
    if (!bundleDir) {
      this.close();
      this.state = {
        status: 'missing',
        errorMessage: 'Lexicon V2 bundle directory not found',
        bundleDir: null,
      };
      return this.getState();
    }
    return this.loadFromBundleDir(bundleDir);
  }

  /** Load readonly runtime from an explicit bundle directory (Patch E2E / smoke). */
  loadFromBundleDir(bundleDir: string): LexiconRuntimeV2State {
    this.close();
    this.bucketCache.clear();
    this.tierSqlQueries = 0;
    this.tierCacheHits = 0;
    this.tierCacheMisses = 0;

    const { manifestPath, sqlitePath, checksumPath } = lexiconV2BundleFileNames(bundleDir);
    if (!fs.existsSync(manifestPath) || !fs.existsSync(sqlitePath)) {
      this.state = { status: 'missing', bundleDir, errorMessage: 'manifest.json or lexicon.sqlite missing' };
      return this.getState();
    }

    try {
      const manifest = readManifestV2(manifestPath);
      if (!LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion as (typeof LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS)[number])) {
        throw new Error(
          `[LEXICON_RUNTIME_V2] unsupported schemaVersion=${manifest.schemaVersion}, expected one of ${LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS.join(', ')}`
        );
      }
      verifyV2Checksum(sqlitePath, manifest, checksumPath);

      this.db = new Database(sqlitePath, { readonly: true });
      this.manifest = manifest;

      const hasToneColumn =
        manifest.schemaVersion === LEXICON_V2_SHADOW_SCHEMA_VERSION ||
        manifest.schemaVersion === LEXICON_V3_RUNTIME_SCHEMA_VERSION;
      const toneSelect = hasToneColumn ? 'tone_pinyin_key,' : '';

      this.stmtBase = this.db.prepare(
        `SELECT id, pinyin_key, ${toneSelect} word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
         FROM base_lexicon
         WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
         ORDER BY prior_score DESC
         LIMIT ?`
      );
      this.stmtIdiom = this.db.prepare(
        `SELECT id, pinyin_key, ${toneSelect} word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
         FROM idiom_lexicon
         WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
         ORDER BY prior_score DESC
         LIMIT ?`
      );
      this.stmtDomain = this.db.prepare(
        `SELECT id, domain_id, pinyin_key, ${toneSelect} word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
         FROM domain_lexicon
         WHERE domain_id = ? AND pinyin_key = ? AND enabled = 1 AND length(word) = ?
         ORDER BY prior_score DESC
         LIMIT ?`
      );
      this.stmtRouting = this.db.prepare(
        `SELECT pinyin_key, keyword, domain_id, weight
         FROM industry_routing_lexicon WHERE pinyin_key = ?`
      );

      const countBase =
        (this.db.prepare('SELECT COUNT(*) AS c FROM base_lexicon').get() as { c: number }).c ?? 0;
      const countIdiom =
        (this.db.prepare('SELECT COUNT(*) AS c FROM idiom_lexicon').get() as { c: number }).c ?? 0;
      const countDomain =
        (this.db.prepare('SELECT COUNT(*) AS c FROM domain_lexicon').get() as { c: number }).c ?? 0;
      const countRouting =
        (this.db.prepare('SELECT COUNT(*) AS c FROM industry_routing_lexicon').get() as { c: number })
          .c ?? 0;

      this.state = {
        status: 'ok',
        manifestVersion: manifest.schemaVersion,
        bundleDir,
        tableCounts: {
          base: countBase,
          idiom: countIdiom,
          domain: countDomain,
          routing: countRouting,
        },
      };

      logger.info(
        {
          bundleDir,
          schemaVersion: manifest.schemaVersion,
          tableCounts: this.state.tableCounts,
        },
        '[LEXICON_RUNTIME_V2] loaded'
      );
      return this.getState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = { status: 'error', bundleDir, errorMessage: message };
      logger.error({ bundleDir, error: message }, '[LEXICON_RUNTIME_V2] load failed');
      this.closeDbOnly();
      return this.getState();
    }
  }

  lookupBaseByPinyinKey(key: string, termLength: number, sqlLimit?: number): HotwordEntry[] {
    const limit = sqlLimit ?? getLexiconRuntimeV2Config().maxBaseCandidates;
    return this.lookupTier('base', key, termLength, limit, () => {
      const rows = (this.stmtBase?.all(key, termLength, limit) ?? []) as TierRow[];
      return mapTierRows(rows);
    });
  }

  lookupIdiomByPinyinKey(key: string, termLength: number, sqlLimit?: number): HotwordEntry[] {
    const cfgLimit = sqlLimit ?? getLexiconRuntimeV2Config().maxIdiomCandidates;
    const limit = cfgLimit;
    if (limit <= 0) {
      return [];
    }
    return this.lookupTier('idiom', key, termLength, limit, () => {
      const rows = (this.stmtIdiom?.all(key, termLength, limit) ?? []) as TierRow[];
      return mapTierRows(rows);
    });
  }

  lookupDomainByPinyinKey(
    domainId: string,
    key: string,
    termLength: number,
    sqlLimit?: number
  ): HotwordEntry[] {
    const domain = domainId.trim();
    if (!domain || domain === 'general') {
      return [];
    }
    const limit = sqlLimit ?? getLexiconRuntimeV2Config().maxDomainCandidates;
    return this.lookupTier(`domain:${domain}`, key, termLength, limit, () => {
      const rows = (this.stmtDomain?.all(domain, key, termLength, limit) ?? []) as TierRow[];
      return mapTierRows(rows, domain);
    });
  }

  lookupIndustryRoutes(pinyinKeys: readonly string[]): IndustryRouteHit[] {
    if (this.state.status !== 'ok' || !this.stmtRouting) {
      return [];
    }
    const hits: IndustryRouteHit[] = [];
    const seen = new Set<string>();
    for (const rawKey of pinyinKeys) {
      const key = rawKey.trim();
      if (!key) {
        continue;
      }
      const rows = this.stmtRouting.all(key) as Array<{
        pinyin_key: string;
        keyword: string;
        domain_id: string;
        weight: number;
      }>;
      for (const row of rows) {
        const dedupe = `${row.pinyin_key}|${row.keyword}|${row.domain_id}`;
        if (seen.has(dedupe)) {
          continue;
        }
        seen.add(dedupe);
        hits.push({
          pinyinKey: row.pinyin_key,
          keyword: row.keyword,
          domainId: row.domain_id,
          weight: row.weight,
        });
      }
    }
    return hits.sort((a, b) => b.weight - a.weight);
  }

  private lookupTier(
    tier: string,
    key: string,
    termLength: number,
    limit: number,
    queryFn: () => HotwordEntry[]
  ): HotwordEntry[] {
    if (this.state.status !== 'ok' || limit <= 0 || !key.trim() || termLength < 2) {
      return [];
    }
    const cacheKey = `${tier}:${key}:${termLength}:${limit}`;
    const cached = this.bucketCache.get(cacheKey);
    if (cached) {
      this.tierCacheHits += 1;
      return cached;
    }
    this.tierCacheMisses += 1;
    this.tierSqlQueries += 1;
    const rows = queryFn();
    this.bucketCache.set(cacheKey, rows);
    return rows;
  }

  close(): void {
    this.closeDbOnly();
    this.bucketCache.clear();
    this.manifest = null;
    this.state = { status: 'missing' };
  }

  private closeDbOnly(): void {
    this.stmtBase = null;
    this.stmtIdiom = null;
    this.stmtDomain = null;
    this.stmtRouting = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export function markLexiconRuntimeV2Disabled(): LexiconRuntimeV2State {
  return { status: 'disabled' };
}
