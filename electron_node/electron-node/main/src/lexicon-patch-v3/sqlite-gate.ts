import type Database from 'better-sqlite3';
import { V3_TABLE_THRESHOLDS } from './patch-types';

export function assertTableThresholds(db: Database.Database): void {
  const failures: string[] = [];
  for (const [table, min] of Object.entries(V3_TABLE_THRESHOLDS)) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
    const count = row.c ?? 0;
    if (count < min) {
      failures.push(`${table}=${count} < minimum ${min}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Lexicon V3 gate failed: ${failures.join('; ')}`);
  }
}
