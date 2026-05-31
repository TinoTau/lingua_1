import * as fs from 'fs';
import Database = require('better-sqlite3');
import logger from '../logger';
import {
  LEXICON_RUNTIME_PROJECT_ROOT_MSG,
  lexiconBundleFileNames,
  resolveLexiconBundleDir,
} from './lexicon-bundle-path';
import { readManifest, verifySqliteChecksum } from './lexicon-manifest';
import { buildHotwordPinyinIndex, syllablesKey, type HotwordPinyinIndex } from './pinyin-index';
import {
  buildAliasIndexes,
  lookupAliasExact,
  lookupAliasPinyin,
  type AliasExactIndex,
  type AliasPinyinIndex,
} from './alias-index';
import {
  assertLexiconManifestReady,
  countMixedTokens,
  isIndexableHotwordEntry,
  parseAliasesField,
  parseTagsField,
  LEXICON_SCHEMA_VERSION,
} from './scored-lexicon';
import { buildExactWordIndex, lookupExactWord, type ExactWordIndex } from './exact-index';
import type { HotwordEntry } from './hotword-types';
import { LexiconManifest, LexiconRuntimeState } from './lexicon-types';

type HotwordRow = {
  id: string;
  word: string;
  normalized?: string | null;
  pinyin: string;
  prior_score: number | null;
  frequency: number | null;
  domain: string | null;
  domains: string | null;
  aliases?: string | null;
  source?: string | null;
  updated_at?: number | null;
  tags: string | null;
  enabled: number;
  repair_target?: number | null;
};

function parsePinyinField(raw: string | null): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(/[\s,/|]+/)
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
}

function assertLexiconTermsSchema(db: Database.Database): void {
  const cols = db.prepare('PRAGMA table_info(lexicon_terms)').all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('prior_score')) {
    throw new Error(
      '[LEXICON_RUNTIME] lexicon.sqlite missing prior_score column; rebuild with build-lexicon-bundle'
    );
  }
  if (!names.has('normalized')) {
    throw new Error(
      '[LEXICON_RUNTIME] lexicon.sqlite missing normalized column; rebuild with build-lexicon-bundle (final-v1)'
    );
  }
}

function mapHotwordRow(row: HotwordRow): HotwordEntry {
  let domains: string[] = ['general'];
  if (row.domains?.trim()) {
    try {
      const parsed = JSON.parse(row.domains) as unknown;
      if (Array.isArray(parsed)) {
        domains = parsed.filter((d): d is string => typeof d === 'string' && d.length > 0);
      }
    } catch {
      domains = [row.domains.trim()];
    }
  } else if (row.domain?.trim()) {
    domains = [row.domain.trim()];
  }
  return {
    id: row.id,
    word: row.word,
    normalized: row.normalized?.trim() || row.word.trim(),
    pinyin: parsePinyinField(row.pinyin),
    priorScore: row.prior_score ?? Number.NaN,
    frequency: row.frequency ?? 1,
    domain: domains[0],
    domains,
    aliases: parseAliasesField(row.aliases),
    source: row.source?.trim() || undefined,
    updatedAt: row.updated_at ?? undefined,
    enabled: row.enabled === 1,
    tags: parseTagsField(row.tags),
    repairTarget: row.repair_target === 1,
  };
}

export class LexiconRuntime {
  private db: Database.Database | null = null;
  private manifest: LexiconManifest | null = null;
  private state: LexiconRuntimeState = { status: 'missing' };
  private pinyinIndex: HotwordPinyinIndex = new Map();
  private aliasExactIndex: AliasExactIndex = new Map();
  private aliasPinyinIndex: AliasPinyinIndex = new Map();
  private exactWordIndex: ExactWordIndex = new Map();
  private hotwordsById: Map<string, HotwordEntry> = new Map();

  getState(): LexiconRuntimeState {
    return { ...this.state };
  }

  getManifestVersion(): string | undefined {
    return this.manifest?.version;
  }

  getPinyinIndexSize(): number {
    return this.pinyinIndex.size;
  }

  getExactIndexSize(): number {
    return this.exactWordIndex.size;
  }

  load(): LexiconRuntimeState {
    this.close();
    this.pinyinIndex = new Map();
    this.aliasExactIndex = new Map();
    this.aliasPinyinIndex = new Map();
    this.exactWordIndex = new Map();
    this.hotwordsById = new Map();

    if (!process.env.LEXICON_BUNDLE_PATH?.trim() && !process.env.PROJECT_ROOT?.trim()) {
      this.state = { status: 'error', errorMessage: LEXICON_RUNTIME_PROJECT_ROOT_MSG };
      logger.error({}, LEXICON_RUNTIME_PROJECT_ROOT_MSG);
      return this.getState();
    }
    const bundleDir = resolveLexiconBundleDir();
    if (!bundleDir) {
      const hint = process.env.PROJECT_ROOT
        ? `bundle missing under PROJECT_ROOT=${process.env.PROJECT_ROOT}`
        : LEXICON_RUNTIME_PROJECT_ROOT_MSG;
      this.state = { status: 'missing', errorMessage: hint };
      logger.error({ PROJECT_ROOT: process.env.PROJECT_ROOT }, '[LEXICON_RUNTIME] bundle directory not found');
      return this.getState();
    }
    const { manifestPath, sqlitePath, checksumPath } = lexiconBundleFileNames(bundleDir);
    if (!fs.existsSync(manifestPath) || !fs.existsSync(sqlitePath)) {
      this.state = { status: 'missing' };
      logger.info({ bundleDir }, 'Lexicon manifest or sqlite missing');
      return this.getState();
    }
    try {
      const manifest = readManifest(manifestPath);
      verifySqliteChecksum(sqlitePath, manifest, checksumPath);
      this.db = new Database(sqlitePath, { readonly: true });
      this.manifest = manifest;
      assertLexiconTermsSchema(this.db);
      assertLexiconManifestReady(manifest);

      const colNames = new Set(
        (this.db.prepare('PRAGMA table_info(lexicon_terms)').all() as { name: string }[]).map(
          (c) => c.name
        )
      );
      const optionalCols = [
        colNames.has('normalized') ? 'normalized' : 'word AS normalized',
        colNames.has('aliases') ? 'aliases' : "NULL AS aliases",
        colNames.has('source') ? 'source' : 'NULL AS source',
        colNames.has('updated_at') ? 'updated_at' : 'NULL AS updated_at',
        colNames.has('repair_target') ? 'repair_target' : '0 AS repair_target',
      ].join(', ');
      const domainCols = colNames.has('domains')
        ? 'domain, domains'
        : 'domain, NULL as domains';

      const hotwordRows = this.db
        .prepare(
          `SELECT id, word, ${optionalCols}, pinyin, prior_score, frequency, ${domainCols}, tags, enabled
           FROM lexicon_terms`
        )
        .all() as HotwordRow[];

      const allEntries: HotwordEntry[] = [];
      const indexable: HotwordEntry[] = [];
      let termsWithoutPriorSkipped = 0;

      for (const row of hotwordRows) {
        const entry = mapHotwordRow(row);
        if (!entry.word.trim()) {
          continue;
        }
        allEntries.push(entry);
        if (!entry.enabled) {
          continue;
        }
        this.hotwordsById.set(entry.id, entry);
        if (!isIndexableHotwordEntry(entry)) {
          if (!Number.isFinite(entry.priorScore) || entry.priorScore <= 0) {
            termsWithoutPriorSkipped += 1;
          }
          continue;
        }
        indexable.push(entry);
      }

      this.pinyinIndex = buildHotwordPinyinIndex(indexable);
      this.exactWordIndex = buildExactWordIndex(indexable);
      const aliasIndexes = buildAliasIndexes(indexable);
      this.aliasExactIndex = aliasIndexes.exactIndex;
      this.aliasPinyinIndex = aliasIndexes.pinyinIndex;

      const scoredLexicon = {
        termCount: allEntries.length,
        enabledTermCount: allEntries.filter((e) => e.enabled).length,
        termsWithPriorCount: indexable.length,
        termsWithoutPriorSkipped,
        pinyinIndexCount: this.pinyinIndex.size,
        exactIndexCount: this.exactWordIndex.size,
        mixedTokenCount: countMixedTokens(allEntries),
      };

      this.state = {
        status: 'ok',
        manifestVersion: manifest.version,
        scoredLexicon,
        manifestReady: true,
        manifestChecksum: manifest.checksum,
        lexiconCount: manifest.term_count ?? allEntries.length,
        scoredCount: manifest.terms_with_prior_count ?? indexable.length,
      };
      logger.info(
        {
          bundleDir,
          schemaVersion: manifest.schemaVersion ?? LEXICON_SCHEMA_VERSION,
          version: manifest.version,
          scored_lexicon_version: manifest.scored_lexicon_version ?? LEXICON_SCHEMA_VERSION,
          pinyin_index_size: this.pinyinIndex.size,
          exact_index_size: this.exactWordIndex.size,
          hotword_count: indexable.length,
          terms_without_prior_skipped: termsWithoutPriorSkipped,
        },
        `[LEXICON_RUNTIME] loaded hotwords=${indexable.length} pinyin_index_size=${this.pinyinIndex.size}`
      );
      return this.getState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = { status: 'error', errorMessage: message };
      this.pinyinIndex = new Map();
      this.aliasExactIndex = new Map();
      this.aliasPinyinIndex = new Map();
      this.exactWordIndex = new Map();
      this.hotwordsById = new Map();
      logger.error({ bundleDir, error: message }, 'Lexicon runtime load failed');
      return this.getState();
    }
  }

  recallHotwordsByPinyin(syllables: string[], maxCandidates = 16): HotwordEntry[] {
    if (this.state.status !== 'ok' || !syllables.length) {
      return [];
    }
    const key = syllablesKey(syllables);
    return this.getPinyinBucket(key).slice(0, maxCandidates);
  }

  getPinyinBucket(key: string): HotwordEntry[] {
    if (this.state.status !== 'ok') {
      return [];
    }
    return this.pinyinIndex.get(key) ?? [];
  }

  forEachPinyinBucket(fn: (key: string, bucket: readonly HotwordEntry[]) => void): void {
    if (this.state.status !== 'ok') {
      return;
    }
    for (const [key, bucket] of this.pinyinIndex) {
      fn(key, bucket);
    }
  }

  lookupHotwordsByExactWord(word: string): HotwordEntry[] {
    if (this.state.status !== 'ok') {
      return [];
    }
    return lookupExactWord(this.exactWordIndex, word);
  }

  lookupAliasExactMatches(text: string) {
    if (this.state.status !== 'ok') {
      return [];
    }
    return lookupAliasExact(this.aliasExactIndex, text.trim());
  }

  listAliasExactKeys(): string[] {
    if (this.state.status !== 'ok') {
      return [];
    }
    return [...this.aliasExactIndex.keys()];
  }

  lookupAliasPinyinMatches(key: string) {
    if (this.state.status !== 'ok') {
      return [];
    }
    return lookupAliasPinyin(this.aliasPinyinIndex, key);
  }


  getEnabledHotwords(): HotwordEntry[] {
    if (this.state.status !== 'ok') {
      return [];
    }
    return [...this.hotwordsById.values()].filter((h) => h.enabled && h.word.trim());
  }


  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.manifest = null;
    this.pinyinIndex = new Map();
    this.aliasExactIndex = new Map();
    this.aliasPinyinIndex = new Map();
    this.exactWordIndex = new Map();
    this.hotwordsById = new Map();
  }
}

export function markLexiconDisabled(): LexiconRuntimeState {
  return { status: 'disabled' };
}
