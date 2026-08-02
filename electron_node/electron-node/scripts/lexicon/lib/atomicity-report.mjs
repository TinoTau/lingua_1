/**
 * Write atomicity_report.json + atomicity_report.csv for a build.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { toAuditRow } = require('./atomicity-validator.cjs');

/**
 * @param {object} opts
 * @param {string} opts.outDir
 * @param {'audit'|'enforce'} opts.mode
 * @param {Array<{ draft: object, result: object }>} opts.entries
 * @param {object} [opts.meta]
 */
export function writeAtomicityReports(opts) {
  const { outDir, mode, entries, meta = {} } = opts;
  fs.mkdirSync(outDir, { recursive: true });

  const rows = entries.map(({ draft, result }) => toAuditRow(result, draft));
  const summary = {
    ACCEPT: 0,
    ACCEPT_EXCEPTION: 0,
    REJECT_COMPOSITE: 0,
    UNRESOLVED: 0,
  };
  for (const r of rows) {
    if (summary[r.decision] != null) summary[r.decision] += 1;
  }

  const byReason = {};
  for (const r of rows) {
    const k = `${r.decision}:${r.reasonCode}`;
    byReason[k] = (byReason[k] || 0) + 1;
  }

  const report = {
    schemaVersion: 'lexicon-atomicity-report-v1',
    mode,
    generatedAt: new Date().toISOString(),
    total: rows.length,
    summary,
    byReason,
    meta,
    rows,
  };

  const jsonPath = path.join(outDir, 'atomicity_report.json');
  const csvPath = path.join(outDir, 'atomicity_report.csv');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const headers = [
    'surface',
    'termId',
    'sourceFile',
    'sourceRow',
    'sourceLabel',
    'length',
    'decision',
    'reasonCode',
    'segments',
    'termType',
    'exceptionReason',
    'domains',
    'detail',
  ];
  const esc = (v) => {
    const s = Array.isArray(v) ? v.join('|') : String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.surface,
        r.termId,
        r.sourceFile,
        r.sourceRow,
        r.sourceLabel,
        r.length,
        r.decision,
        r.reasonCode,
        r.segments,
        r.termType,
        r.exceptionReason,
        r.domains,
        r.detail,
      ]
        .map(esc)
        .join(',')
    );
  }
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`);

  return { jsonPath, csvPath, summary, total: rows.length, report };
}
