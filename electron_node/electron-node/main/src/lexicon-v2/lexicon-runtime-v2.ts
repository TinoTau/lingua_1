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
  LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION,
  LEXICON_V2_SUPPORTED_SCHEMA_VERSIONS,
  isLexiconV3FiveTableV2Manifest,
  type IndustryRouteHit,
  type LexiconManifestV2,
  type LexiconRuntimeV2State,
  type ParentTermNgramRow,
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
      mapped.domains = [domainId];
      mapped.domain = domainId;
      byTermKey.set(termKey, mapped);
      continue;
    }
    const domains = new Set(existing.domains ?? []);
    domains.add(domainId);
    existing.domains = [...domains];
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
  private stmtBaseToneComposite: Database.Statement | null = null;
  private stmtIdiomToneComposite: Database.Statement | null = null;
  private stmtDomainToneComposite: Database.Statement | null = null;
  private hasToneColumn = false;
  private stmtRouting: Database.Statement | null = null;
  private stmtNgram: Database.Statement | null = null;
  private ngramSqlQueries = 0;
  private ngramCacheHits = 0;
  private ngramCacheMisses = 0;

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

      this.hasToneColumn = true;
      const toneSelect = 'tone_pinyin_key,';

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

      if (isLexiconV3FiveTableV2Manifest(manifest.schemaVersion)) {
        this.stmtBaseToneComposite = this.db.prepare(
          `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM base_lexicon
           WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
           ORDER BY prior_score DESC
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

      if (isLexiconV3FiveTableV2Manifest(manifest.schemaVersion)) {
        this.stmtNgram = this.db.prepare(
          `SELECT id, parent_term_id, parent_word, parent_pinyin_key, parent_tone_pinyin_key,
                  ngram_pinyin_key, ngram_tone_pinyin_key, ngram_start, ngram_end, fragment_text,
                  tier, domain_id, repair_target, prior, source, enabled
           FROM term_pinyin_ngrams
           WHERE ngram_pinyin_key = ? AND enabled = 1
           ORDER BY prior DESC
           LIMIT ?`
        );
      }

      const countTerm = isLexiconV3FiveTableV2Manifest(manifest.schemaVersion)
        ? ((this.db.prepare('SELECT COUNT(*) AS c FROM term').get() as { c: number }).c ?? 0)
        : undefined;
      const countTags = isLexiconV3FiveTableV2Manifest(manifest.schemaVersion)
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
      const countNgrams =
        isLexiconV3FiveTableV2Manifest(manifest.schemaVersion)
          ? ((this.db.prepare('SELECT COUNT(*) AS c FROM term_pinyin_ngrams').get() as { c: number }).c ?? 0)
          : undefined;

      this.state = {
        status: 'ok',
        manifestVersion: manifest.schemaVersion,
        bundleDir,
        tableCounts: {
          base: countBase,
          idiom: countIdiom,
          domain: countDomain,
          routing: countRouting,
          ngrams: countNgrams,
          ...(countTerm != null ? { term: countTerm } : {}),
          ...(countTags != null ? { termDomainTags: countTags } : {}),
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

  supportsToneFirstRecall(): boolean {
    return this.hasToneColumn && this.stmtBaseToneComposite != null;
  }

  lookupBaseByPinyinKey(key: string, termLength: number, sqlLimit?: number): HotwordEntry[] {
    const limit = sqlLimit ?? getLexiconRuntimeV2Config().maxBaseCandidates;
    return this.lookupTier('base', key, termLength, limit, () => {
      const rows = (this.stmtBase?.all(key, termLength, limit) ?? []) as TierRow[];
      return mapTierRows(rows);
    });
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
    return this.lookupTier(cacheKey, pinyinKey, termLength, limit, () => {
      const rows = (this.stmtBaseToneComposite!.all(
        pinyinKey,
        tonePinyinKey,
        termLength,
        limit
      ) ?? []) as TierRow[];
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
    if (!this.db || !this.stmtDomain || !domainIds.length) {
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
    this.tierSqlQueries += 1;
    const placeholders = sortedIds.map(() => '?').join(', ');
    const sql = `SELECT d.id, d.domain_id, d.pinyin_key, d.tone_pinyin_key, d.word, d.normalized, d.prior_score, d.repair_target, d.enabled, d.aliases, d.source, d.canonical_word, d.is_alias, tdt.weight AS tag_weight
      FROM domain_lexicon d
      INNER JOIN term t ON t.id = d.id
      INNER JOIN term_domain_tags tdt ON tdt.term_id = t.id AND tdt.domain_id = d.domain_id
      WHERE d.domain_id IN (${placeholders}) AND d.pinyin_key = ? AND d.enabled = 1 AND length(d.word) = ?
      ORDER BY tdt.weight DESC, d.prior_score DESC
      LIMIT ?`;
    const rows = this.db
      .prepare(sql)
      .all(...sortedIds, key, termLength, Math.max(limit, limit * sortedIds.length)) as TierRow[];
    const merged = mergeDomainTierRows(rows).slice(0, limit);
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
    if (
      !this.db ||
      !this.stmtDomainToneComposite ||
      !domainIds.length ||
      !tonePinyinKey.trim()
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
    this.tierSqlQueries += 1;
    const placeholders = sortedIds.map(() => '?').join(', ');
    const v2Sql = `SELECT d.id, d.domain_id, d.pinyin_key, d.tone_pinyin_key, d.word, d.normalized, d.prior_score, d.repair_target, d.enabled, d.aliases, d.source, d.canonical_word, d.is_alias, tdt.weight AS tag_weight
      FROM domain_lexicon d
      INNER JOIN term t ON t.id = d.id
      INNER JOIN term_domain_tags tdt ON tdt.term_id = t.id AND tdt.domain_id = d.domain_id
      WHERE d.domain_id IN (${placeholders}) AND d.pinyin_key = ? AND d.tone_pinyin_key = ? AND d.enabled = 1 AND length(d.word) = ?
      ORDER BY tdt.weight DESC, d.prior_score DESC
      LIMIT ?`;
    const rows = this.db
      .prepare(v2Sql)
      .all(
        ...sortedIds,
        pinyinKey,
        tonePinyinKey,
        termLength,
        Math.max(limit, limit * sortedIds.length)
      ) as TierRow[];
    const merged = mergeDomainTierRows(rows).slice(0, limit);
    this.bucketCache.set(cacheKey, merged);
    return merged;
  }

  lookupParentFragmentsByNgramKey(ngramKey: string, sqlLimit: number): ParentTermNgramRow[] {
    if (
      this.state.status !== 'ok' ||
      !this.stmtNgram ||
      !ngramKey.trim() ||
      sqlLimit <= 0
    ) {
      return [];
    }
    if (!isLexiconV3FiveTableV2Manifest(this.manifest?.schemaVersion)) {
      throw new Error(
        `[LEXICON_RUNTIME_V2] parent ngram requires ${LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION}, got ${this.manifest?.schemaVersion ?? 'unknown'}`
      );
    }

    const cacheKey = `ngram:${ngramKey}:${sqlLimit}`;
    const cached = this.bucketCache.get(cacheKey) as ParentTermNgramRow[] | undefined;
    if (cached) {
      this.ngramCacheHits += 1;
      return cached;
    }

    this.ngramCacheMisses += 1;
    this.ngramSqlQueries += 1;
    const rows = this.stmtNgram.all(ngramKey, sqlLimit) as Array<{
      id: number;
      parent_term_id: string;
      parent_word: string;
      parent_pinyin_key: string;
      parent_tone_pinyin_key: string | null;
      ngram_pinyin_key: string;
      ngram_tone_pinyin_key: string | null;
      ngram_start: number;
      ngram_end: number;
      fragment_text: string;
      tier: string;
      domain_id: string | null;
      repair_target: number;
      prior: number;
      source: string | null;
      enabled: number;
    }>;

    const mapped: ParentTermNgramRow[] = rows.map((row) => ({
      id: row.id,
      parentTermId: row.parent_term_id,
      parentWord: row.parent_word,
      parentPinyinKey: row.parent_pinyin_key,
      parentTonePinyinKey: row.parent_tone_pinyin_key?.trim() || undefined,
      ngramPinyinKey: row.ngram_pinyin_key,
      ngramTonePinyinKey: row.ngram_tone_pinyin_key?.trim() || undefined,
      ngramStart: row.ngram_start,
      ngramEnd: row.ngram_end,
      fragmentText: row.fragment_text,
      tier: row.tier as ParentTermNgramRow['tier'],
      domainId: row.domain_id?.trim() || undefined,
      repairTarget: row.repair_target === 1,
      prior: row.prior,
      source: row.source?.trim() || undefined,
      enabled: row.enabled === 1,
    }));

    this.bucketCache.set(cacheKey, mapped as unknown as HotwordEntry[]);
    return mapped;
  }

  getAndResetNgramQueryStats(): { sqlQueries: number; cacheHits: number; cacheMisses: number } {
    const stats = {
      sqlQueries: this.ngramSqlQueries,
      cacheHits: this.ngramCacheHits,
      cacheMisses: this.ngramCacheMisses,
    };
    this.ngramSqlQueries = 0;
    this.ngramCacheHits = 0;
    this.ngramCacheMisses = 0;
    return stats;
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
  }

  private closeDbOnly(): void {
    this.stmtBase = null;
    this.stmtIdiom = null;
    this.stmtDomain = null;
    this.stmtBaseToneComposite = null;
    this.stmtIdiomToneComposite = null;
    this.stmtDomainToneComposite = null;
    this.hasToneColumn = false;
    this.stmtRouting = null;
    this.stmtNgram = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export function markLexiconRuntimeV2Disabled(): LexiconRuntimeV2State {
  return { status: 'disabled' };
}
