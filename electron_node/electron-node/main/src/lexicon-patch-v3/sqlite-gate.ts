import type Database from 'better-sqlite3';
import { V3_TABLE_THRESHOLDS_V2 } from './patch-types';

export function assertTableThresholds(db: Database.Database): void {
  if (process.env.LEXICON_PATCH_E2E_GATE_FAIL === '1') {
    throw new Error('gate_fail_test');
  }
  const failures: string[] = [];
  for (const [table, min] of Object.entries(V3_TABLE_THRESHOLDS_V2)) {
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
