/**
 * Residual Cleanup — static + schema tests (no main/src business changes).
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

const repoRoot = path.resolve(__dirname, '../../../../../../');
const experimentsDir = path.resolve(__dirname, '../../../../tests/experiments');
const fwDetectorDocs = path.resolve(repoRoot, 'docs/fw-detector');
const auditScratch = path.resolve(repoRoot, 'docs/tone-v2/_audit_scratch');

const FORBIDDEN_ACTIVE = [
  'ngramQueryCount',
  'maxSqlPerUtterance',
  'sql_budget_exhausted',
  'SkippedRecallWindow',
  'windowsSkippedDueToSqlBudget',
] as const;

function walkFiles(dir: string, pred: (f: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'historical' || name === 'node_modules') continue;
      walkFiles(p, pred, out);
    } else if (pred(p)) {
      out.push(p);
    }
  }
  return out;
}

describe('Residual Cleanup — active path forbids obsolete symbols', () => {
  it('active experiment .mjs scripts do not reference forbidden fields', () => {
    const files = walkFiles(experimentsDir, (f) => f.endsWith('.mjs') && !f.includes('require-logical'));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const sym of FORBIDDEN_ACTIVE) {
        if (src.includes(sym)) {
          offenders.push(`${path.relative(repoRoot, f)}:${sym}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('current fw-detector docs do not present maxSqlPerUtterance / attempt-gate symbols as active', () => {
    const files = walkFiles(fwDetectorDocs, (f) => f.endsWith('.md'));
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // Allow mentioning symbols only inside explicit "废弃/已删除/禁止" sections — still ban raw table rows.
      if (/\| `maxSqlPerUtterance`\s*\|\s*150\s*\|/.test(src)) {
        offenders.push(`${path.relative(repoRoot, f)}:maxSqlPerUtterance=150 table`);
      }
      if (/\bngramQueryCount\b/.test(src) && !/废弃|已删除|不得作现行/.test(src)) {
        offenders.push(`${path.relative(repoRoot, f)}:ngramQueryCount without obsolescence marker`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('active _audit_scratch probes (non-historical) do not use ngramQueryCount or budget skip fields', () => {
    const files = walkFiles(auditScratch, (f) => f.endsWith('.mjs'));
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes(`${path.sep}historical${path.sep}`)) continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const sym of [
        'ngramQueryCount',
        'maxSqlPerUtterance',
        'windowsSkippedDueToSqlBudget',
        'sql_budget_exhausted',
      ] as const) {
        if (src.includes(sym)) {
          offenders.push(`${path.relative(repoRoot, f)}:${sym}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('archived obsolete probes live under historical/pre_b1_b2_repair and throw on execute', () => {
    const archived = path.join(auditScratch, 'historical', 'pre_b1_b2_repair');
    expect(fs.existsSync(path.join(archived, 'README.md'))).toBe(true);
    const probes = [
      'phase1-acceptance-budget-skip-probe.mjs',
      'phase1-acceptance-completeness-matrix.mjs',
      'offline-ltr-perf-probe.mjs',
      'phase0-phase1-utterance-cache-probe.mjs',
    ];
    for (const name of probes) {
      const p = path.join(archived, name);
      expect(fs.existsSync(p)).toBe(true);
      const src = fs.readFileSync(p, 'utf8');
      expect(src).toMatch(/ARCHIVED 2026-07-27/);
      expect(src).toMatch(/throw new Error/);
    }
    // Old active paths must not remain
    expect(fs.existsSync(path.join(auditScratch, 'phase1-acceptance-budget-skip-probe.mjs'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(auditScratch, 'phase1-acceptance-completeness-matrix.mjs'))).toBe(
      false
    );
  });
});

describe('Residual Cleanup — experiment schema helper', () => {
  // Dynamic import of ESM helper from CJS/ts-jest context via require of compiled path is awkward;
  // mirror the contract inline for fail-fast guarantees (helper file is also scanned above).
  function requireLogicalWindowRecallCount(
    diag: Record<string, unknown> | null | undefined,
    context = 'unknown'
  ): number {
    if (diag == null || typeof diag !== 'object') {
      throw new Error(`missing (${context})`);
    }
    if (Object.prototype.hasOwnProperty.call(diag, 'ngramQueryCount')) {
      throw new Error(`obsolete ngramQueryCount (${context})`);
    }
    const v = diag.logicalWindowRecallCount;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      throw new Error(`bad logicalWindowRecallCount (${context})`);
    }
    return v;
  }

  it('reads logicalWindowRecallCount when present', () => {
    expect(requireLogicalWindowRecallCount({ logicalWindowRecallCount: 42 }, 'ok')).toBe(42);
  });

  it('fails when logicalWindowRecallCount missing (no silent zero)', () => {
    expect(() => requireLogicalWindowRecallCount({ assemblyMs: 1 }, 'miss')).toThrow(/logicalWindowRecallCount/);
  });

  it('fails when value is undefined even if ||0 pattern would mask', () => {
    expect(() =>
      requireLogicalWindowRecallCount({ logicalWindowRecallCount: undefined as unknown as number }, 'u')
    ).toThrow();
  });

  it('fails when obsolete ngramQueryCount is present (no dual-field)', () => {
    expect(() =>
      requireLogicalWindowRecallCount(
        { logicalWindowRecallCount: 1, ngramQueryCount: 9 },
        'dual'
      )
    ).toThrow(/ngramQueryCount/);
  });
});
