/**
 * Batch 1.0B/1.0C — real temporary SQLite + LexiconRuntimeV2 test helper.
 *
 * File suffix `.test.helpers.ts` is excluded from tsconfig.main (no dist/main pollution).
 * Uses file-backed SQLite (not :memory:) and formal LexiconRuntimeV2.loadFromBundleDir.
 * Batch 1.0C reuses this helper; do not create a second bundle builder.
 */
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { copyV3BundleToTemp } from '../../lexicon-patch-v3/bundle-snapshot';
import { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { sha256File } from '../../lexicon/lexicon-manifest';
import {
  LEXICON_RUNTIME_CHECKSUM,
  LEXICON_RUNTIME_MANIFEST,
  LEXICON_RUNTIME_SQLITE,
} from '../../lexicon-v2/lexicon-v2-bundle-path';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../');
export const BATCH10B_V3_SOURCE_DIR = path.join(REPO_ROOT, 'node_runtime', 'lexicon', 'v3');

export type Length1BaseSeedRow = {
  id: string;
  pinyinKey: string;
  tonePinyinKey: string | null;
  word: string;
  priorScore: number;
  repairTarget?: boolean;
  enabled?: boolean;
  isAlias?: boolean;
  source?: string;
  aliases?: string | null;
};

export type Length1DomainSeedRow = {
  id: string;
  domainId: string;
  pinyinKey: string;
  tonePinyinKey: string | null;
  word: string;
  priorScore: number;
  repairTarget?: boolean;
  enabled?: boolean;
  isAlias?: boolean;
  source?: string;
};

export type Length1TempBundle = {
  bundleDir: string;
  sqlitePath: string;
  cleanup: () => void;
  loadRuntime: () => LexiconRuntimeV2;
};

function assertBundleSource(): void {
  const sqlite = path.join(BATCH10B_V3_SOURCE_DIR, LEXICON_RUNTIME_SQLITE);
  const manifest = path.join(BATCH10B_V3_SOURCE_DIR, LEXICON_RUNTIME_MANIFEST);
  if (!fs.existsSync(sqlite) || !fs.existsSync(manifest)) {
    throw new Error(
      `[BATCH1_0B] operational v3 bundle missing under ${BATCH10B_V3_SOURCE_DIR}`
    );
  }
}

function rewriteChecksum(bundleDir: string): void {
  const sqlitePath = path.join(bundleDir, LEXICON_RUNTIME_SQLITE);
  const manifestPath = path.join(bundleDir, LEXICON_RUNTIME_MANIFEST);
  const checksumPath = path.join(bundleDir, LEXICON_RUNTIME_CHECKSUM);
  const digest = sha256File(sqlitePath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  manifest.checksum = `sha256:${digest}`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(checksumPath, `sha256:${digest}\n`, 'utf-8');
}

function insertBaseRows(db: Database.Database, rows: readonly Length1BaseSeedRow[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO base_lexicon (
      id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
      repair_target, enabled, aliases, source, canonical_word, is_alias
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((list: readonly Length1BaseSeedRow[]) => {
    for (const r of list) {
      stmt.run(
        r.id,
        r.pinyinKey,
        r.tonePinyinKey,
        r.word,
        r.word,
        r.priorScore,
        r.repairTarget === true ? 1 : 0,
        r.enabled === false ? 0 : 1,
        r.aliases ?? null,
        r.source ?? 'batch1_0b_test',
        r.word,
        r.isAlias === true ? 1 : 0
      );
    }
  });
  tx(rows);
}

function insertDomainRows(db: Database.Database, rows: readonly Length1DomainSeedRow[]): void {
  if (!rows.length) {
    return;
  }
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO domain_lexicon (
      id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
      repair_target, enabled, aliases, source, canonical_word, is_alias
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((list: readonly Length1DomainSeedRow[]) => {
    for (const r of list) {
      stmt.run(
        r.id,
        r.domainId,
        r.pinyinKey,
        r.tonePinyinKey,
        r.word,
        r.word,
        r.priorScore,
        r.repairTarget === true ? 1 : 0,
        r.enabled === false ? 0 : 1,
        null,
        r.source ?? 'batch1_0b_domain_guard',
        r.word,
        r.isAlias === true ? 1 : 0
      );
    }
  });
  tx(rows);
}

/**
 * Copy operational v3 schema/bundle, seed base(+optional domain) rows, resign checksum.
 * Returns a loader for formal LexiconRuntimeV2 (readonly open).
 */
export function createLength1TempSqliteBundle(input: {
  baseRows: readonly Length1BaseSeedRow[];
  domainRows?: readonly Length1DomainSeedRow[];
  prefix?: string;
}): Length1TempBundle {
  assertBundleSource();
  const bundleDir = copyV3BundleToTemp(BATCH10B_V3_SOURCE_DIR, input.prefix ?? 'batch1-0b-');
  const sqlitePath = path.join(bundleDir, LEXICON_RUNTIME_SQLITE);

  const db = new Database(sqlitePath);
  try {
    insertBaseRows(db, input.baseRows);
    insertDomainRows(db, input.domainRows ?? []);
  } finally {
    db.close();
  }
  rewriteChecksum(bundleDir);

  return {
    bundleDir,
    sqlitePath,
    cleanup: () => {
      try {
        fs.rmSync(bundleDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
    loadRuntime: () => {
      const runtime = new LexiconRuntimeV2();
      const state = runtime.loadFromBundleDir(bundleDir);
      if (state.status !== 'ok') {
        runtime.close();
        throw new Error(
          `[BATCH1_0B] LexiconRuntimeV2 load failed: ${state.errorMessage ?? state.status}`
        );
      }
      return runtime;
    },
  };
}

/** Standard seed set for Batch 1.0B functional coverage (not operational import). */
export function batch10bStandardBaseRows(): Length1BaseSeedRow[] {
  return [
    { id: 'b0b_dian', pinyinKey: 'dian', tonePinyinKey: 'dian3', word: '点', priorScore: 0.9 },
    { id: 'b0b_wo', pinyinKey: 'wo', tonePinyinKey: 'wo3', word: '我', priorScore: 0.9 },
    { id: 'b0b_na', pinyinKey: 'na', tonePinyinKey: 'na2', word: '拿', priorScore: 0.9 },
    { id: 'b0b_na3', pinyinKey: 'na', tonePinyinKey: 'na3', word: '哪', priorScore: 0.88 },
    { id: 'b0b_na4', pinyinKey: 'na', tonePinyinKey: 'na4', word: '那', priorScore: 0.87 },
    { id: 'b0b_ta_he', pinyinKey: 'ta', tonePinyinKey: 'ta1', word: '他', priorScore: 0.9 },
    { id: 'b0b_ta_she', pinyinKey: 'ta', tonePinyinKey: 'ta1', word: '她', priorScore: 0.89 },
    { id: 'b0b_ta_it', pinyinKey: 'ta', tonePinyinKey: 'ta1', word: '它', priorScore: 0.88 },
    { id: 'b0b_ma', pinyinKey: 'ma', tonePinyinKey: 'ma5', word: '吗', priorScore: 0.9 },
    { id: 'b0b_ba', pinyinKey: 'ba', tonePinyinKey: 'ba5', word: '吧', priorScore: 0.9 },
    {
      id: 'b0b_alias_dian',
      pinyinKey: 'dian',
      tonePinyinKey: 'dian3',
      word: '惦',
      priorScore: 0.99,
      isAlias: true,
    },
    {
      id: 'b0b_disabled',
      pinyinKey: 'ce',
      tonePinyinKey: 'ce4',
      word: '测',
      priorScore: 0.95,
      enabled: false,
    },
    {
      id: 'b0b_repair',
      pinyinKey: 'xiu',
      tonePinyinKey: 'xiu1',
      word: '修',
      priorScore: 0.9,
      repairTarget: true,
    },
    // Path bridge bigrams
    { id: 'b0b_jia_yi', pinyinKey: 'jia|yi', tonePinyinKey: 'jia3|yi3', word: '甲乙', priorScore: 0.9 },
    { id: 'b0b_bing', pinyinKey: 'bing', tonePinyinKey: 'bing3', word: '丙', priorScore: 0.9 },
    {
      id: 'b0b_ding_wu',
      pinyinKey: 'ding|wu',
      tonePinyinKey: 'ding1|wu4',
      word: '丁戊',
      priorScore: 0.9,
    },
  ];
}

export function batch10bDomainGuardRows(): Length1DomainSeedRow[] {
  return [
    {
      id: 'b0b_dom_dian',
      domainId: 'coffee',
      pinyinKey: 'dian',
      tonePinyinKey: 'dian3',
      word: '店',
      priorScore: 0.99,
      repairTarget: true,
    },
  ];
}

/** 9 same plain pinyin for LIMIT=8 characterization (priors descending). */
export function batch10bLimit8Rows(): Length1BaseSeedRow[] {
  const words = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  return words.map((word, i) => ({
    id: `b0b_lim8_${i}`,
    pinyinKey: 'lim',
    tonePinyinKey: 'lim1',
    word,
    // Higher prior first; 玖 is position 9 (lowest prior)
    priorScore: 0.99 - i * 0.01,
    isAlias: i < 7, // first 7 aliases → after LIMIT 8 + filter, residual singleton among top8
  }));
}

/**
 * Batch 1.1A — build N same-key rows for truncation / uniqueness scenarios.
 * Caller controls alias/disabled placement; no production dependency on these shapes.
 */
export function buildSameKeyLength1Rows(input: {
  pinyinKey: string;
  tonePinyinKey: string;
  words: readonly string[];
  /** Indices treated as is_alias=1 (0-based in words). */
  aliasIndices?: readonly number[];
  /** Indices treated as enabled=0. */
  disabledIndices?: readonly number[];
  idPrefix?: string;
}): Length1BaseSeedRow[] {
  const alias = new Set(input.aliasIndices ?? []);
  const disabled = new Set(input.disabledIndices ?? []);
  const prefix = input.idPrefix ?? 'b11a';
  return input.words.map((word, i) => ({
    id: `${prefix}_${input.pinyinKey}_${i}`,
    pinyinKey: input.pinyinKey,
    tonePinyinKey: input.tonePinyinKey,
    word,
    priorScore: 0.99 - i * 0.01,
    isAlias: alias.has(i),
    enabled: !disabled.has(i),
  }));
}
