#!/usr/bin/env node
/**
 * SQL validation — illegal alias rows must be 0 after cleanup.
 */
import path from 'path';
import { createRequire } from 'module';
import { v3RuntimeDir } from './lib/paths.mjs';

const require = createRequire(import.meta.url);
const sqlitePath = path.join(v3RuntimeDir(), 'lexicon.sqlite');

const ILLEGAL_ALIAS_WORDS = [
  '像蔡',
  '告诉',
  '钟贝',
  '鐘貝',
  '少病',
  '后选',
  '生城',
  '声城',
  '生陈',
  '计化',
  '借口',
  '截口',
  '大悲',
  '小悲',
  '小碑',
  '蓝美马分',
  '高路',
  '高诉',
  '身边',
  '深便',
  '机厂',
  '机常',
  '文当',
  '文當',
  '上限',
  '商线',
  '巧可力',
  '巧克莉',
  '连调',
  '联掉',
];

function main() {
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  const placeholders = ILLEGAL_ALIAS_WORDS.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT word, canonical_word, is_alias, source FROM domain_lexicon
       WHERE is_alias = 1 AND word IN (${placeholders})`
    )
    .all(...ILLEGAL_ALIAS_WORDS);
  const homophone = db
    .prepare(
      `SELECT word, source FROM domain_lexicon
       WHERE source = 'domain_seed_v1_homophone_variant' OR word IN (${placeholders})`
    )
    .all(...ILLEGAL_ALIAS_WORDS);
  db.close();

  console.log(JSON.stringify({ illegalAliasRows: rows.length, homophoneRows: homophone.length, rows, homophone }, null, 2));
  if (rows.length > 0 || homophone.some((r) => r.source === 'domain_seed_v1_homophone_variant')) {
    process.exit(1);
  }
  console.log('[validate-illegal-alias-sql] PASS — 0 illegal alias rows');
}

main();
