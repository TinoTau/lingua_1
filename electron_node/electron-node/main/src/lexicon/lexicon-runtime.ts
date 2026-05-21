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
import { textToSyllables } from './phonetic/pinyin';
import { normalizeSegmentTextForMatch } from './segment-text-normalize';
import type { HotwordEntry } from './hotword-types';
import { LexiconManifest, LexiconRuntimeState } from './lexicon-types';

type HotwordRow = {
  id: string;
  word: string;
  pinyin: string;
  frequency: number | null;
  domain: string | null;
  enabled: number;
};

type ConfusionRow = {
  id: string;
  observed: string;
  hotword_id: string;
  enabled: number;
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

function mapHotwordRow(row: HotwordRow): HotwordEntry {
  const pinyin = parsePinyinField(row.pinyin);
  return {
    id: row.id,
    word: row.word,
    pinyin: pinyin.length > 0 ? pinyin : textToSyllables(row.word),
    frequency: row.frequency ?? 1,
    domain: row.domain ?? undefined,
    enabled: row.enabled === 1,
  };
}

export class LexiconRuntime {
  private db: Database.Database | null = null;
  private manifest: LexiconManifest | null = null;
  private state: LexiconRuntimeState = { status: 'missing' };
  private pinyinIndex: HotwordPinyinIndex = new Map();
  private hotwordsById: Map<string, HotwordEntry> = new Map();
  private observedToHotwordIds: Map<string, string[]> = new Map();
  /** normalized observed → original observed keys */
  private normalizedObservedIndex: Map<string, string[]> = new Map();

  getState(): LexiconRuntimeState {
    return { ...this.state };
  }

  getManifestVersion(): string | undefined {
    return this.manifest?.version;
  }

  getPinyinIndexSize(): number {
    return this.pinyinIndex.size;
  }

  load(): LexiconRuntimeState {
    this.close();
    this.pinyinIndex = new Map();
    this.hotwordsById = new Map();
    this.observedToHotwordIds = new Map();
    this.normalizedObservedIndex = new Map();

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

      const hotwordRows = this.db
        .prepare(
          `SELECT id, word, pinyin, frequency, domain, enabled
           FROM lexicon_terms
           WHERE enabled = 1`
        )
        .all() as HotwordRow[];

      const entries: HotwordEntry[] = [];
      for (const row of hotwordRows) {
        const entry = mapHotwordRow(row);
        if (!entry.word.trim()) {
          continue;
        }
        entries.push(entry);
        this.hotwordsById.set(entry.id, entry);
      }

      this.pinyinIndex = buildHotwordPinyinIndex(entries);

      if (this.tableExists('lexicon_confusions')) {
        const confusionRows = this.db
          .prepare(
            `SELECT id, observed, hotword_id, enabled
             FROM lexicon_confusions
             WHERE enabled = 1`
          )
          .all() as ConfusionRow[];
        for (const row of confusionRows) {
          const observed = row.observed.trim();
          if (!observed || !this.hotwordsById.has(row.hotword_id)) {
            continue;
          }
          const bucket = this.observedToHotwordIds.get(observed) ?? [];
          if (!bucket.includes(row.hotword_id)) {
            bucket.push(row.hotword_id);
          }
          this.observedToHotwordIds.set(observed, bucket);
          const normKey = normalizeSegmentTextForMatch(observed);
          if (normKey.length >= 2) {
            const normBucket = this.normalizedObservedIndex.get(normKey) ?? [];
            if (!normBucket.includes(observed)) {
              normBucket.push(observed);
            }
            this.normalizedObservedIndex.set(normKey, normBucket);
          }
        }
      }

      this.state = { status: 'ok', manifestVersion: manifest.version };
      logger.info(
        {
          bundleDir,
          version: manifest.version,
          pinyin_index_size: this.pinyinIndex.size,
          hotword_count: entries.length,
        },
        `[LEXICON_RUNTIME] loaded hotwords=${entries.length} pinyin_index_size=${this.pinyinIndex.size}`
      );
      return this.getState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = { status: 'error', errorMessage: message };
      this.pinyinIndex = new Map();
      this.hotwordsById = new Map();
      this.observedToHotwordIds = new Map();
      logger.error({ bundleDir, error: message }, 'Lexicon runtime load failed');
      return this.getState();
    }
  }

  recallHotwordsByPinyin(syllables: string[], maxCandidates = 16): HotwordEntry[] {
    if (this.state.status !== 'ok' || !syllables.length) {
      return [];
    }
    const key = syllablesKey(syllables);
    return (this.pinyinIndex.get(key) ?? []).slice(0, maxCandidates);
  }

  getConfusionObservedStrings(): string[] {
    if (this.state.status !== 'ok') {
      return [];
    }
    return [...this.observedToHotwordIds.keys()];
  }

  getEnabledHotwords(): HotwordEntry[] {
    if (this.state.status !== 'ok') {
      return [];
    }
    return [...this.hotwordsById.values()].filter((h) => h.enabled && h.word.trim());
  }

  recallHotwordsByObserved(
    observed: string,
    maxCandidates = 16
  ): { hotword: HotwordEntry; recallPath: 'exact' | 'confusion_evidence' }[] {
    if (this.state.status !== 'ok') {
      return [];
    }
    const trimmed = observed.trim();
    const out: { hotword: HotwordEntry; recallPath: 'exact' | 'confusion_evidence' }[] = [];
    const seen = new Set<string>();

    for (const hotword of this.hotwordsById.values()) {
      if (hotword.word === trimmed && !seen.has(hotword.id)) {
        seen.add(hotword.id);
        out.push({ hotword, recallPath: 'exact' });
      }
    }

    const ids = this.observedToHotwordIds.get(trimmed) ?? [];
    for (const id of ids) {
      if (seen.has(id)) {
        continue;
      }
      const hotword = this.hotwordsById.get(id);
      if (hotword) {
        seen.add(id);
        out.push({ hotword, recallPath: 'confusion_evidence' });
      }
    }

    return out.slice(0, maxCandidates);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.manifest = null;
    this.pinyinIndex = new Map();
    this.hotwordsById = new Map();
    this.observedToHotwordIds = new Map();
    this.normalizedObservedIndex = new Map();
  }

  /**
   * exact observed 优先；其次 normalized key 命中 confusion 表。
   */
  recallHotwordsByObservedLoose(
    observedText: string,
    maxCandidates = 16
  ): { hotword: HotwordEntry; recallPath: 'exact' | 'confusion_evidence' }[] {
    const direct = this.recallHotwordsByObserved(observedText, maxCandidates);
    if (direct.length > 0) {
      return direct;
    }
    const norm = normalizeSegmentTextForMatch(observedText);
    if (norm.length < 2) {
      return [];
    }
    const originals = this.normalizedObservedIndex.get(norm) ?? [];
    const out: { hotword: HotwordEntry; recallPath: 'exact' | 'confusion_evidence' }[] = [];
    const seen = new Set<string>();
    for (const orig of originals) {
      for (const hit of this.recallHotwordsByObserved(orig, maxCandidates)) {
        if (seen.has(hit.hotword.id)) {
          continue;
        }
        seen.add(hit.hotword.id);
        out.push(hit);
        if (out.length >= maxCandidates) {
          return out;
        }
      }
    }
    return out;
  }

  private tableExists(name: string): boolean {
    if (!this.db) {
      return false;
    }
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name) as { name: string } | undefined;
    return Boolean(row);
  }
}

export function markLexiconDisabled(): LexiconRuntimeState {
  return { status: 'disabled' };
}
