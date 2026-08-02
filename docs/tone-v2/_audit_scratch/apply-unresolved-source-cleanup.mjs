/**
 * Second-pass Source cleanup: delete all UNRESOLVED_NEEDS_EXCEPTION from enforce report.
 * KEEP only ACCEPT / ACCEPT_EXCEPTION (incl. proven domain_atomic).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const srcDir = path.join(repo, 'electron_node/docs/lexicon-assets/full_rebuild_v1');
const docsTone = path.join(repo, 'docs/tone-v2');
const reportPath = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate/atomicity_report.json');

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function loadCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });
  return { header, rows };
}

function esc(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => esc(r[h])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const unresolved = report.rows.filter((r) => r.decision === 'UNRESOLVED');
const deleteWords = new Set(unresolved.map((r) => r.surface));
const deleteIds = new Set(unresolved.map((r) => r.termId).filter(Boolean));

const prevActions = loadCsv(path.join(docsTone, 'atomicity_final_source_actions.csv'));
const actions = [...prevActions.rows];

const reviewPath = path.join(srcDir, 'lexicon_full_corrected_review.csv');
const review = loadCsv(reviewPath);
const reviewKept = [];
let reviewDeleted = 0;
for (const r of review.rows) {
  if (deleteWords.has(r.word) || deleteIds.has(r.term_id)) {
    reviewDeleted += 1;
    actions.push({
      surface: r.word,
      termId: r.term_id,
      sourceFile: 'lexicon_full_corrected_review.csv',
      action: 'DELETE_SOURCE_ROW',
      classification: 'DELETE_SURFACE_ATOMIC_UNRESOLVED',
      reason: 'UNRESOLVED_NEEDS_EXCEPTION under enforce; no proven domain_atomic/exception metadata',
    });
    continue;
  }
  reviewKept.push(r);
}
writeCsv(reviewPath, review.header, reviewKept);

const suppPath = path.join(srcDir, 'supplemental_terms.csv');
const supp = loadCsv(suppPath);
const suppKept = [];
let suppDeleted = 0;
for (const r of supp.rows) {
  if (deleteWords.has(r.word)) {
    suppDeleted += 1;
    actions.push({
      surface: r.word,
      termId: '',
      sourceFile: 'supplemental_terms.csv',
      action: 'DELETE_SOURCE_ROW',
      classification: 'DELETE_SURFACE_ATOMIC_UNRESOLVED',
      reason: 'UNRESOLVED_NEEDS_EXCEPTION under enforce; no proven domain_atomic/exception metadata',
    });
    continue;
  }
  suppKept.push(r);
}
writeCsv(suppPath, supp.header, suppKept);

const tagsPath = path.join(srcDir, 'term_domain_tags_corrected.csv');
const tags = loadCsv(tagsPath);
const tagsKept = tags.rows.filter((r) => !deleteIds.has(r.term_id) && !deleteWords.has(r.word));
writeCsv(tagsPath, tags.header, tagsKept);

writeCsv(path.join(docsTone, 'atomicity_final_source_actions.csv'), prevActions.header, actions);

// refresh hashes
function sha(p) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`;
}
function count(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length).length - 1;
}
const manPath = path.join(srcDir, 'sources.manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
man.contentBundleVersion = 12;
for (const s of man.termSources) {
  const p = path.join(srcDir, s.file);
  s.sha256 = sha(p);
  s.recordCount = count(p);
  s.matchesTmpExtract = false;
}
man.notes = [
  'ATOMICITY CONTENT CLEANUP EXECUTED 2026-08-02.',
  'Deleted DELETE_CONFIRMED / DELETE_DOMAIN_SAFE / all UNRESOLVED_NEEDS_EXCEPTION without proven exception.',
  'KEEP domain_atomic exceptions: 神经网络/单元测试/回归测试/测试数据/特征工程/配置文件/集成测试/迷你吧.',
  'Full Rebuild defaults to atomicityMode=enforce.',
];
fs.writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`, 'utf8');

// enforce report CSV for docs
const enforceRows = unresolved.map((r) => ({
  surface: r.surface,
  termId: r.termId || '',
  decision: r.decision,
  reasonCode: r.reasonCode,
  domains: Array.isArray(r.domains) ? r.domains.join('|') : String(r.domains || ''),
  sourceAction: 'DELETE_SOURCE_ROW',
}));
writeCsv(
  path.join(docsTone, 'atomicity_enforce_report.csv'),
  ['surface', 'termId', 'decision', 'reasonCode', 'domains', 'sourceAction'],
  enforceRows
);

console.log(
  JSON.stringify(
    {
      unresolvedDeleted: deleteWords.size,
      reviewDeleted,
      reviewRemaining: reviewKept.length,
      suppDeleted,
      suppRemaining: suppKept.length,
      tagsRemaining: tagsKept.length,
      hashes: man.termSources.map((s) => ({ file: s.file, n: s.recordCount, sha: s.sha256.slice(0, 20) })),
    },
    null,
    2
  )
);
