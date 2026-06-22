import * as fs from 'fs';
import type Database from 'better-sqlite3';
import { LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION } from '../lexicon-v2/lexicon-types-v2';

const SSOT_TABLES = ['term', 'term_domain_tags'] as const;

export function assertBundleSchemaV2(db: Database.Database, manifestPath: string): void {
  if (!fs.existsSync(manifestPath)) {
    throw new Error('schema_not_v2: manifest missing');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { schemaVersion?: string };
  if (manifest.schemaVersion !== LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION) {
    throw new Error(
      `schema_not_v2: expected ${LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION}, got ${manifest.schemaVersion ?? 'unknown'}`
    );
  }
  for (const table of SSOT_TABLES) {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table) as { c: number };
    if (!row.c) {
      throw new Error(`schema_not_v2: missing table ${table}`);
    }
  }
}
