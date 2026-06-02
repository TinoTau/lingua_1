import type Database from 'better-sqlite3';
import { LEXICON_PATCH_HISTORY_TABLE } from './patch-types';

export function ensurePatchHistoryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${LEXICON_PATCH_HISTORY_TABLE} (
      patch_id TEXT PRIMARY KEY,
      base_version INTEGER NOT NULL,
      next_version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      patch_hash TEXT NOT NULL
    );
  `);
}

export function isPatchAlreadyApplied(db: Database.Database, patchId: string): boolean {
  const row = db
    .prepare(`SELECT patch_id FROM ${LEXICON_PATCH_HISTORY_TABLE} WHERE patch_id = ?`)
    .get(patchId) as { patch_id: string } | undefined;
  return Boolean(row);
}
