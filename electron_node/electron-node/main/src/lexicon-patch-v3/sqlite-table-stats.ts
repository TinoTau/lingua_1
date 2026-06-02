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

export function collectBundleTableStats(db: Database.Database): BundleTableStats {
  const routingCount =
    (
      db.prepare('SELECT COUNT(*) AS c FROM industry_routing_lexicon').get() as { c: number }
    ).c ?? 0;

  return {
    base_lexicon: tierStats(db, 'base_lexicon'),
    idiom_lexicon: tierStats(db, 'idiom_lexicon'),
    domain_lexicon: tierStats(db, 'domain_lexicon'),
    industry_routing_lexicon: { rowCount: routingCount },
  };
}
