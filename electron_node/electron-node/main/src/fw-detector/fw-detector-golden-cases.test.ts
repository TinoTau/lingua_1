import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

const ASSETS_ROOT = path.resolve(__dirname, '../../../../lexicon-assets/tests');

type GoldenRow = {
  id: string;
  raw: string;
  expected: string;
  shouldRepair: boolean;
};

function loadJsonl(fileName: string): GoldenRow[] {
  const filePath = path.join(ASSETS_ROOT, fileName);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => JSON.parse(line) as GoldenRow);
}

describe('FW detector golden cases', () => {
  it('restaurant_homophone 集结构有效', () => {
    const rows = loadJsonl('restaurant_homophone.jsonl');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.shouldRepair).toBe(true);
      expect(row.raw).not.toEqual(row.expected);
    }
  });

  it('false_repair_golden 禁止误修', () => {
    const rows = loadJsonl('false_repair_golden.jsonl');
    for (const row of rows) {
      expect(row.shouldRepair).toBe(false);
      expect(row.raw).toBe(row.expected);
    }
  });

  it('tech_ai_mixed 集结构有效', () => {
    const rows = loadJsonl('tech_ai_mixed.jsonl');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.raw.length).toBeGreaterThan(0);
    }
  });

  it('multi_candidate_conflict 集结构有效', () => {
    const rows = loadJsonl('multi_candidate_conflict.jsonl');
    expect(rows.length).toBeGreaterThan(0);
    const repairCases = rows.filter((r) => r.shouldRepair);
    expect(repairCases.length).toBeGreaterThan(0);
    for (const row of repairCases) {
      expect(row.raw).not.toEqual(row.expected);
    }
  });
});
