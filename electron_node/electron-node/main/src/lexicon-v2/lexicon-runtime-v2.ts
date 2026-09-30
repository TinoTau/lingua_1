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
  LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS,
  isLexiconV3RuntimeV3Manifest,
  type IndustryRouteHit,
  type LexiconManifestV2,
  type LexiconRuntimeV2State,
} from './lexicon-types-v2';
import {
  installRuntimeDomainRegistry,
  resetRuntimeDomainRegistryForTest,
} from './runtime-domain-registry';

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
  tag_weight?: number | null;
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

function mergeDomainTierRows(rows: TierRow[]): HotwordEntry[] {
  const byTermKey = new Map<string, HotwordEntry>();
  for (const row of rows) {
    const domainId = row.domain_id?.trim();
    if (!domainId) {
      continue;
    }
    if (row.tag_weight == null || row.tag_weight <= 0) {
      throw new Error(
        `Schema V2 violation: missing term_domain_tags.weight for ${row.word}|${row.pinyin_key} domain=${domainId}`
      );
    }
    const termKey = `${row.word}|${row.pinyin_key}`;
    const weight = row.tag_weight;
    const mapped = mapTierRowToHotword(row, domainId);
    mapped.domainWeights = { [domainId]: weight };
    const existing = byTermKey.get(termKey);
    if (!existing) {
      mapped.domains = [domainId].sort((a, b) => a.localeCompare(b));
      byTermKey.set(termKey, mapped);
      continue;
    }
    const domains = new Set(existing.domains ?? []);
    domains.add(domainId);
    existing.domains = [...domains].sort((a, b) => a.localeCompare(b));
    existing.domainWeights = {
      ...(existing.domainWeights ?? {}),
      [domainId]: weight,
    };
    if (row.prior_score > existing.priorScore) {
      existing.priorScore = row.prior_score;
    }
  }
  return [...byTermKey.values()].sort((a, b) => b.priorScore - a.priorScore);
}

function hashSortedDomainIds(domainIds: readonly string[]): string {
  return [...domainIds].sort().join(',');
}

/**
 * Domain multi-lookup with term-domain atomicity:
 * LIMIT selects terms, then all in-scope domain tags for those terms are loaded.
 * Never returns a term with only a partial subset of its in-scope tags.
 */
export function queryDomainMultiRowsAtomic(
  db: Database.Database,
  domainIds: readonly string[],
  pinyinKey: string,
  termLength: number,
  limit: number,
  tonePinyinKey?: string
): { termIds: string[]; rows: TierRow[]; statementCount: number } {
  if (!domainIds.length || limit <= 0) {
    return { termIds: [], rows: [], statementCount: 0 };
  }
  const sortedIds = [...domainIds].sort();
  const placeholders = sortedIds.map(() => '?').join(', ');
  const toneClause = tonePinyinKey ? ' AND d.tone_pinyin_key = ?' : '';
  const idSql = `SELECT d.id AS id, MAX(tdt.weight) AS max_weight, MAX(d.prior_score) AS max_prior
      FROM domain_lexicon d
      INNER JOIN term t ON t.id = d.id
      INNER JOIN term_domain_tags tdt ON tdt.term_id = t.id AND tdt.domain_id = d.domain_id
      WHERE d.domain_id IN (${placeholders}) AND d.pinyin_key = ?${toneClause}
        AND d.enabled = 1 AND length(d.word) = ?
      GROUP BY d.id
      ORDER BY max_weight DESC, max_prior DESC
      LIMIT ?`;
  const idParams: unknown[] = tonePinyinKey
    ? [...sortedIds, pinyinKey, tonePinyinKey, termLength, limit]
    : [...sortedIds, pinyinKey, termLength, limit];
  const idRows = db.prepare(idSql).all(...idParams) as Array<{ id: string }>;
  if (!idRows.length) {
    return { termIds: [], rows: [], statementCount: 1 };
  }
  const termIds = idRows.map((r) => r.id);
  const idPlaceholders = termIds.map(() => '?').join(', ');
  const rowSql = `SELECT d.id, d.domain_id, d.pinyin_key, d.tone_pinyin_key, d.word, d.normalized,
        d.prior_score, d.repair_target, d.enabled, d.aliases, d.source, d.canonical_word, d.is_alias,
        tdt.weight AS tag_weight
      FROM domain_lexicon d
      INNER JOIN term t ON t.id = d.id
      INNER JOIN term_domain_tags tdt ON tdt.term_id = t.id AND tdt.domain_id = d.domain_id
      WHERE d.id IN (${idPlaceholders}) AND d.domain_id IN (${placeholders}) AND d.enabled = 1
      ORDER BY tdt.weight DESC, d.prior_score DESC`;
  const rows = db.prepare(rowSql).all(...termIds, ...sortedIds) as TierRow[];
  return { termIds, rows, statementCount: 2 };
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

  private sqlitePath: string | null = null;
  private stmtBase: Database.Statement | null = null;
  private stmtIdiom: Database.Statement | null = null;
  private stmtDomain: Database.Statement | null = null;
  private stmtBaseToneComposite: Database.Statement | null = null;
  private stmtIdiomToneComposite: Database.Statement | null = null;
  private stmtDomainToneComposite: Database.Statement | null = null;
  /** Batch 1.1B — mechanical exact-surface point lookup (LIMIT 2 fixed). */
  private stmtBaseExactSurface: Database.Statement | null = null;
  private stmtBaseExactSurfaceTone: Database.Statement | null = null;
  private hasToneColumn = false;
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

  /** Absolute sqlite path for Model2 Stage-J sidecar index (identity only). */
  getSqlitePath(): string | null {
    return this.sqlitePath;
  }

  getCacheStats() {
    return this.bucketCache.stats();
  }

  /**
   * Clear Global LRU + tier counters. Harness/counterfactual only —
   * production utterance path must not call this mid-job.
   */
  clearLookupCaches(): void {
    this.bucketCache.clear();
    this.tierSqlQueries = 0;
    this.tierCacheHits = 0;
    this.tierCacheMisses = 0;
  }

  getAndResetTierQueryStats(): { sqlQueries: number; cacheHits: number; cacheMisses: number } {
    const stats = this.getTierQueryStats();
    this.tierSqlQueries = 0;
    this.tierCacheHits = 0;
    this.tierCacheMisses = 0;
    return stats;
  }

  /** Non-destructive peek for utterance-level physical SQL accounting. */
  getTierQueryStats(): { sqlQueries: number; cacheHits: number; cacheMisses: number } {
    return {
      sqlQueries: this.tierSqlQueries,
      cacheHits: this.tierCacheHits,
      cacheMisses: this.tierCacheMisses,
    };
  }

  /**
   * True physical statement executions observed by Runtime counters (tier lookups only).
   * Domain atomic multi counts both statements.
   */
  getPhysicalStatementStats(): {
    tierSqlQueries: number;
    total: number;
  } {
    return {
      tierSqlQueries: this.tierSqlQueries,
      total: this.tierSqlQueries,
    };
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
      this.sqlitePath = sqlitePath;

      this.hasToneColumn = true;
      const toneSelect = 'tone_pinyin_key,';

      this.stmtBase = this.db.prepare(
        `SELECT id, pinyin_key, ${toneSelect} word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
         FROM base_lexicon
         WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
         ORDER BY prior_score DESC
         LIMIT ?`
      );
      // Exact-surface point lookup (Batch 1.1B). Fixed LIMIT bound applied by caller (2).
      this.stmtBaseExactSurface = this.db.prepare(
        `SELECT id, pinyin_key, ${toneSelect} word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
         FROM base_lexicon
         WHERE pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = ?
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

      if (isLexiconV3RuntimeV3Manifest(manifest.schemaVersion)) {
        this.stmtBaseToneComposite = this.db.prepare(
          `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM base_lexicon
           WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
           ORDER BY prior_score DESC
           LIMIT ?`
        );
        this.stmtBaseExactSurfaceTone = this.db.prepare(
          `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM base_lexicon
           WHERE pinyin_key = ? AND tone_pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = ?
           LIMIT ?`
        );
        this.stmtIdiomToneComposite = this.db.prepare(
          `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM idiom_lexicon
           WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
           ORDER BY prior_score DESC
           LIMIT ?`
        );
        this.stmtDomainToneComposite = this.db.prepare(
          `SELECT id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM domain_lexicon
           WHERE domain_id = ? AND pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
           ORDER BY prior_score DESC
           LIMIT ?`
        );
      }

      const countTerm = isLexiconV3RuntimeV3Manifest(manifest.schemaVersion)
        ? ((this.db.prepare('SELECT COUNT(*) AS c FROM term').get() as { c: number }).c ?? 0)
        : undefined;
      const countTags = isLexiconV3RuntimeV3Manifest(manifest.schemaVersion)
        ? ((this.db.prepare('SELECT COUNT(*) AS c FROM term_domain_tags').get() as { c: number }).c ?? 0)
        : undefined;

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
          ...(countTerm != null ? { term: countTerm } : {}),
          ...(countTags != null ? { termDomainTags: countTags } : {}),
        },
        domainAvailability: manifest.domainAvailability,
        domainHierarchyVersion: manifest.domainHierarchyVersion,
      };

      if (isLexiconV3RuntimeV3Manifest(manifest.schemaVersion) && this.db) {
        installRuntimeDomainRegistry(this.db, manifest);
      }

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

  supportsToneFirstRecall(): boolean {
    return this.hasToneColumn && this.stmtBaseToneComposite != null;
  }

  lookupBaseByPinyinKey(key: string, termLength: number, sqlLimit?: number): HotwordEntry[] {
    const limit = sqlLimit ?? getLexiconRuntimeV2Config().maxBaseCandidates;
    // Base exact: termLength 1–5 (Batch 1.0C). Other tiers keep min=2 via their callers.
    return this.lookupTier('base', key, termLength, limit, () => {
      const rows = (this.stmtBase?.all(key, termLength, limit) ?? []) as TierRow[];
      return mapTierRows(rows);
    }, 1);
  }

  lookupBaseByPinyinAndToneKey(
    pinyinKey: string,
    tonePinyinKey: string,
    termLength: number,
    sqlLimit?: number
  ): HotwordEntry[] {
    if (!this.stmtBaseToneComposite || !tonePinyinKey.trim()) {
      return [];
    }
    const limit = sqlLimit ?? getLexiconRuntimeV2Config().maxBaseCandidates;
    const cacheKey = `base:tone:${pinyinKey}:${tonePinyinKey}:${termLength}:${limit}`;
    // Base tone exact: termLength 1–5 (Batch 1.0C).
    return this.lookupTier(cacheKey, pinyinKey, termLength, limit, () => {
      const rows = (this.stmtBaseToneComposite!.all(
        pinyinKey,
        tonePinyinKey,
        termLength,
        limit
      ) ?? []) as TierRow[];
      return mapTierRows(rows);
    }, 1);
  }

  /**
   * Mechanical exact-surface point lookup (Batch 1.1B).
   * Returns rows only — does not decide uniqueness or Candidate.
   * Internal LIMIT is fixed at 2 (0 / 1 / ≥2 detection). No open sqlLimit.
   */
  lookupBaseByExactSurfaceAndPinyin(
    pinyinKey: string,
    word: string,
    termLength: number = 1
  ): HotwordEntry[] {
    const key = pinyinKey.trim();
    const surface = word.trim();
    const limit = 2;
    if (!this.stmtBaseExactSurface || !key || !surface || termLength < 1) {
      return [];
    }
    const cacheTier = `base:exact_surface:${surface}`;
    return this.lookupTier(cacheTier, key, termLength, limit, () => {
      const rows = (this.stmtBaseExactSurface!.all(key, surface, termLength, limit) ??
        []) as TierRow[];
      return mapTierRows(rows);
    }, 1);
  }

  /**
   * Mechanical exact-surface + tone point lookup (Batch 1.1B).
   * Returns rows only — does not decide uniqueness or Candidate.
   * Internal LIMIT is fixed at 2. No open sqlLimit.
   */
  lookupBaseByExactSurfacePinyinAndTone(
    pinyinKey: string,
    tonePinyinKey: string,
    word: string,
    termLength: number = 1
  ): HotwordEntry[] {
    const key = pinyinKey.trim();
    const toneKey = tonePinyinKey.trim();
    const surface = word.trim();
    const limit = 2;
    if (
      !this.stmtBaseExactSurfaceTone ||
      !key ||
      !toneKey ||
      !surface ||
      termLength < 1
    ) {
      return [];
    }
    const cacheTier = `base:exact_surface:tone:${toneKey}:${surface}`;
    return this.lookupTier(cacheTier, key, termLength, limit, () => {
      const rows = (this.stmtBaseExactSurfaceTone!.all(
        key,
        toneKey,
        surface,
        termLength,
        limit
      ) ?? []) as TierRow[];
      return mapTierRows(rows);
    }, 1);
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
    }, 2);
  }

  lookupIdiomByPinyinAndToneKey(
    pinyinKey: string,
    tonePinyinKey: string,
    termLength: number,
    sqlLimit?: number
  ): HotwordEntry[] {
    if (!this.stmtIdiomToneComposite || !tonePinyinKey.trim()) {
      return [];
    }
    const cfgLimit = sqlLimit ?? getLexiconRuntimeV2Config().maxIdiomCandidates;
    if (cfgLimit <= 0) {
      return [];
    }
    const cacheKey = `idiom:tone:${pinyinKey}:${tonePinyinKey}:${termLength}:${cfgLimit}`;
    return this.lookupTier(cacheKey, pinyinKey, termLength, cfgLimit, () => {
      const rows = (this.stmtIdiomToneComposite!.all(
        pinyinKey,
        tonePinyinKey,
        termLength,
        cfgLimit
      ) ?? []) as TierRow[];
      return mapTierRows(rows);
    }, 2);
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
    return this.lookupDomainsByPinyinKeyMulti([domain], key, termLength, sqlLimit);
  }

  lookupDomainByPinyinAndToneKey(
    domainId: string,
    pinyinKey: string,
    tonePinyinKey: string,
    termLength: number,
    sqlLimit?: number
  ): HotwordEntry[] {
    const domain = domainId.trim();
    if (!domain || domain === 'general' || !tonePinyinKey.trim()) {
      return [];
    }
    return this.lookupDomainsByPinyinAndToneKeyMulti(
      [domain],
      pinyinKey,
      tonePinyinKey,
      termLength,
      sqlLimit
    );
  }

  lookupDomainsByPinyinKeyMulti(
    domainIds: readonly string[],
    key: string,
    termLength: number,
    sqlLimit?: number
  ): HotwordEntry[] {
    // Domain exact remains frozen at termLength 2–5 (does not use lookupTier).
    if (!this.db || !this.stmtDomain || !domainIds.length || termLength < 2) {
      return [];
    }
    const limit = sqlLimit ?? getLexiconRuntimeV2Config().maxDomainCandidates;
    const sortedIds = [...domainIds].sort();
    const domainHash = hashSortedDomainIds(sortedIds);
    const cacheKey = `domainmulti:${domainHash}:${key}:${termLength}:${limit}`;
    const cached = this.bucketCache.get(cacheKey);
    if (cached) {
      this.tierCacheHits += 1;
      return cached;
    }
    this.tierCacheMisses += 1;
    const { termIds, rows, statementCount } = queryDomainMultiRowsAtomic(
      this.db,
      sortedIds,
      key,
      termLength,
      limit
    );
    this.tierSqlQueries += statementCount;
    const mergedById = new Map(mergeDomainTierRows(rows).map((h) => [h.id, h]));
    const merged = termIds
      .map((id) => mergedById.get(id))
      .filter((h): h is HotwordEntry => Boolean(h))
      .slice(0, limit);
    this.bucketCache.set(cacheKey, merged);
    return merged;
  }

  lookupDomainsByPinyinAndToneKeyMulti(
    domainIds: readonly string[],
    pinyinKey: string,
    tonePinyinKey: string,
    termLength: number,
    sqlLimit?: number
  ): HotwordEntry[] {
    // Domain tone exact remains frozen at termLength 2–5 (does not use lookupTier).
    if (
      !this.db ||
      !this.stmtDomainToneComposite ||
      !domainIds.length ||
      !tonePinyinKey.trim() ||
      termLength < 2
    ) {
      return [];
    }
    const limit = sqlLimit ?? getLexiconRuntimeV2Config().maxDomainCandidates;
    const sortedIds = [...domainIds].sort();
    const domainHash = hashSortedDomainIds(sortedIds);
    const cacheKey = `domainmulti:${domainHash}:tone:${pinyinKey}:${tonePinyinKey}:${termLength}:${limit}`;
    const cached = this.bucketCache.get(cacheKey);
    if (cached) {
      this.tierCacheHits += 1;
      return cached;
    }
    this.tierCacheMisses += 1;
    const { termIds, rows, statementCount } = queryDomainMultiRowsAtomic(
      this.db,
      sortedIds,
      pinyinKey,
      termLength,
      limit,
      tonePinyinKey
    );
    this.tierSqlQueries += statementCount;
    const mergedById = new Map(mergeDomainTierRows(rows).map((h) => [h.id, h]));
    const merged = termIds
      .map((id) => mergedById.get(id))
      .filter((h): h is HotwordEntry => Boolean(h))
      .slice(0, limit);
    this.bucketCache.set(cacheKey, merged);
    return merged;
  }

  /** In-scope term_domain_tags for a term (exact-term domain enrichment). */
  lookupTermDomainTagsInScope(
    termId: string,
    domainIds: readonly string[]
  ): string[] {
    if (!this.db || !termId.trim() || !domainIds.length) {
      return [];
    }
    const sortedIds = [...domainIds].sort();
    const placeholders = sortedIds.map(() => '?').join(', ');
    this.tierSqlQueries += 1;
    const rows = this.db
      .prepare(
        `SELECT domain_id FROM term_domain_tags
         WHERE term_id = ? AND domain_id IN (${placeholders})
         ORDER BY domain_id`
      )
      .all(termId, ...sortedIds) as Array<{ domain_id: string }>;
    return rows.map((r) => r.domain_id.trim()).filter(Boolean);
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

  /**
   * Shared cache/SQL wrapper for base + idiom tier lookups.
   * Callers pass an explicit minTermLength (base=1, idiom=2). Do not default-open all tiers.
   */
  private lookupTier(
    tier: string,
    key: string,
    termLength: number,
    limit: number,
    queryFn: () => HotwordEntry[],
    minTermLength: number
  ): HotwordEntry[] {
    if (
      this.state.status !== 'ok' ||
      limit <= 0 ||
      !key.trim() ||
      termLength < minTermLength
    ) {
      return [];
    }
    const cacheKey = `${tier}:plain:${key}:${termLength}:${limit}`;
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
    resetRuntimeDomainRegistryForTest();
  }

  private closeDbOnly(): void {
    this.sqlitePath = null;
    this.stmtBase = null;
    this.stmtIdiom = null;
    this.stmtDomain = null;
    this.stmtBaseToneComposite = null;
    this.stmtIdiomToneComposite = null;
    this.stmtDomainToneComposite = null;
    this.stmtBaseExactSurface = null;
    this.stmtBaseExactSurfaceTone = null;
    this.hasToneColumn = false;
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
