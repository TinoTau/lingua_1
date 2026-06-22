import type Database from 'better-sqlite3';

export type TierTableStats = {
  rowCount: number;
  canonicalCount: number;
  aliasCount: number;
  pinyinKeyCount: number;
  maxBucketSize: number;
  maxBucketKey: string;
};

export type BundleTableStats = {
  base_lexicon: TierTableStats;
  idiom_lexicon: TierTableStats;
  domain_lexicon: TierTableStats;
  industry_routing_lexicon: { rowCount: number };
  term: { rowCount: number };
  term_domain_tags: { rowCount: number };
  term_pinyin_ngrams: { rowCount: number };
};

function tierStats(db: Database.Database, table: string): TierTableStats {
  const rowCount =
    (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c ?? 0;
  const canonicalCount =
    (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE is_alias = 0`).get() as { c: number })
      .c ?? 0;
  const aliasCount =
    (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE is_alias = 1`).get() as { c: number })
      .c ?? 0;
  const pinyinKeyCount =
    (
      db.prepare(`SELECT COUNT(DISTINCT pinyin_key) AS c FROM ${table}`).get() as { c: number }
    ).c ?? 0;

  const bucket = db
    .prepare(
      `SELECT pinyin_key, COUNT(*) AS bucket_size FROM ${table} GROUP BY pinyin_key ORDER BY bucket_size DESC LIMIT 1`
    )
    .get() as { pinyin_key: string; bucket_size: number } | undefined;

  return {
    rowCount,
    canonicalCount,
    aliasCount,
    pinyinKeyCount,
    maxBucketSize: bucket?.bucket_size ?? 0,
    maxBucketKey: bucket?.pinyin_key ?? '',
  };
}

function simpleCount(db: Database.Database, table: string): { rowCount: number } {
  return {
    rowCount: (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c ?? 0,
  };
}

export function collectBundleTableStats(db: Database.Database): BundleTableStats {
  return {
    base_lexicon: tierStats(db, 'base_lexicon'),
    idiom_lexicon: tierStats(db, 'idiom_lexicon'),
    domain_lexicon: tierStats(db, 'domain_lexicon'),
    industry_routing_lexicon: simpleCount(db, 'industry_routing_lexicon'),
    term: simpleCount(db, 'term'),
    term_domain_tags: simpleCount(db, 'term_domain_tags'),
    term_pinyin_ngrams: simpleCount(db, 'term_pinyin_ngrams'),
  };
}
