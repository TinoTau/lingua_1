import type Database from 'better-sqlite3';
import type { LexiconPatchV4 } from './patch-types-v4';
import { V3_TABLE_THRESHOLDS_V2 } from '../lexicon-patch-v3/patch-types';

export function resolveTableThresholds(patch: LexiconPatchV4): Record<string, number> {
  const base: Record<string, number> = { ...V3_TABLE_THRESHOLDS_V2 };
  if (patch.tableThresholds) {
    for (const [table, min] of Object.entries(patch.tableThresholds)) {
      if (min != null && min >= 0) {
        base[table] = min;
      }
    }
  }
  return base;
}

export function assertTableThresholdsV4(db: Database.Database, patch: LexiconPatchV4): void {
  if (process.env.LEXICON_PATCH_E2E_GATE_FAIL === '1') {
    throw new Error('gate_fail_test');
  }
  const thresholds = resolveTableThresholds(patch);
  const failures: string[] = [];
  for (const [table, min] of Object.entries(thresholds)) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
    const count = row.c ?? 0;
    if (count < min) {
      failures.push(`${table}=${count} < minimum ${min}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Lexicon V4 gate failed: ${failures.join('; ')}`);
  }
}
