/**
 * Apply Atomicity Source Cleanup to full_rebuild_v1 CSVs.
 * - Remove DELETE_SOURCE_ROW terms from review + supplemental
 * - Add term_type/exception_reason for KEEP domain_atomic
 * Writes atomicity_final_source_actions.csv
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const srcDir = path.join(repo, 'electron_node/docs/lexicon-assets/full_rebuild_v1');
const docsTone = path.join(repo, 'docs/tone-v2');

const DOMAIN_ATOMIC_REASON =
  '表面可由原子词覆盖，但有效 fine-domain presence 仅由完整词承担；原子词补同域标签会造成过宽或歧义。';

/** Final KEEP after Forced Activation + prior domain audit */
const KEEP_DOMAIN_ATOMIC = new Set([
  '神经网络',
  '单元测试',
  '回归测试',
  '测试数据',
  '特征工程',
  '配置文件',
  '集成测试',
  '迷你吧', // tourism_hotel compound-only; tone0 fixed in Source; atoms too broad
]);

/** 14 DELETE_DOMAIN_SAFE from domain reconciliation (迷你吧 removed → KEEP) */
const DELETE_DOMAIN_SAFE = new Set([
  '专家系统',
  '安检通道',
  '循环网络',
  '正则策略',
  '注册中心',
  '流量镜像',
  '熔断策略',
  '联系电话',
  '视频会议',
  '训练数据',
  '迁移学习',
  '邀请函',
  '配置中心',
  '降级策略',
]);

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
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, idx) => {
    const cols = parseCsvLine(line);
    const obj = { __line: line, __rowNum: idx + 2 };
    header.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });
  return { header, rows, text };
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

// Load batch1 DELETE_CONFIRMED list
const batch1 = loadCsv(path.join(docsTone, 'atomicity_batch1_revalidated.csv'));
const batch1Deletes = new Set();
for (const r of batch1.rows) {
  const surface = r.surface;
  const action = r.sourceAction;
  const reval = r.revalidatedRecommendation;
  if (KEEP_DOMAIN_ATOMIC.has(surface)) continue;
  if (action === 'DELETE_SOURCE_ROW' || reval === 'DELETE_CONFIRMED') {
    batch1Deletes.add(surface);
  }
  // 休息时间: was REQUIRES_ATOM_RECALL_FIX; 休息 tone fixed → now deletable compound
  if (surface === '休息时间') batch1Deletes.add(surface);
}

// 是否: VALIDATOR_FALSE_POSITIVE — keep (now ACCEPT via validator fix)
batch1Deletes.delete('是否');
batch1Deletes.delete('邀请函'); // wait - 邀请函 is DELETE_DOMAIN_SAFE
// re-add 邀请函
batch1Deletes.add('邀请函');

const deleteWords = new Set([...DELETE_DOMAIN_SAFE, ...batch1Deletes]);
for (const k of KEEP_DOMAIN_ATOMIC) deleteWords.delete(k);

const actions = [];

// --- review.csv ---
const reviewPath = path.join(srcDir, 'lexicon_full_corrected_review.csv');
const review = loadCsv(reviewPath);
if (!review.header.includes('term_type')) {
  review.header.push('term_type', 'exception_reason');
}
const reviewKept = [];
let reviewDeleted = 0;
for (const r of review.rows) {
  const word = r.word;
  if (deleteWords.has(word)) {
    reviewDeleted += 1;
    actions.push({
      surface: word,
      termId: r.term_id,
      sourceFile: 'lexicon_full_corrected_review.csv',
      action: 'DELETE_SOURCE_ROW',
      classification: DELETE_DOMAIN_SAFE.has(word) ? 'DELETE_DOMAIN_SAFE' : 'DELETE_CONFIRMED',
      reason: DELETE_DOMAIN_SAFE.has(word)
        ? 'Domain Vote not compound-dependent or empty compoundDomains'
        : 'Batch1 DELETE_CONFIRMED / composite phrase',
    });
    continue;
  }
  if (KEEP_DOMAIN_ATOMIC.has(word)) {
    r.term_type = 'domain_atomic';
    r.exception_reason = DOMAIN_ATOMIC_REASON;
    actions.push({
      surface: word,
      termId: r.term_id,
      sourceFile: 'lexicon_full_corrected_review.csv',
      action: 'KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION',
      classification: 'KEEP_DOMAIN_ATOMIC',
      reason: DOMAIN_ATOMIC_REASON,
    });
  }
  // ensure keys exist
  r.term_type = r.term_type || '';
  r.exception_reason = r.exception_reason || '';
  reviewKept.push(r);
}
writeCsv(reviewPath, review.header, reviewKept);

// --- supplemental ---
const suppPath = path.join(srcDir, 'supplemental_terms.csv');
const supp = loadCsv(suppPath);
if (!supp.header.includes('term_type')) {
  supp.header.push('term_type', 'exception_reason');
}
const suppKept = [];
let suppDeleted = 0;
for (const r of supp.rows) {
  const word = r.word;
  if (deleteWords.has(word)) {
    suppDeleted += 1;
    actions.push({
      surface: word,
      termId: '',
      sourceFile: 'supplemental_terms.csv',
      action: 'DELETE_SOURCE_ROW',
      classification: DELETE_DOMAIN_SAFE.has(word) ? 'DELETE_DOMAIN_SAFE' : 'DELETE_CONFIRMED',
      reason: 'Source cleanup delete',
    });
    continue;
  }
  if (KEEP_DOMAIN_ATOMIC.has(word)) {
    r.term_type = 'domain_atomic';
    r.exception_reason = DOMAIN_ATOMIC_REASON;
    actions.push({
      surface: word,
      termId: '',
      sourceFile: 'supplemental_terms.csv',
      action: 'KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION',
      classification: 'KEEP_DOMAIN_ATOMIC',
      reason: DOMAIN_ATOMIC_REASON,
    });
  }
  r.term_type = r.term_type || '';
  r.exception_reason = r.exception_reason || '';
  suppKept.push(r);
}
writeCsv(suppPath, supp.header, suppKept);

// --- domain tags: drop tags for deleted term_ids ---
const tagsPath = path.join(srcDir, 'term_domain_tags_corrected.csv');
const tags = loadCsv(tagsPath);
const deletedIds = new Set(
  actions.filter((a) => a.action === 'DELETE_SOURCE_ROW' && a.termId).map((a) => a.termId)
);
// Also map word→id from original review for deletes
for (const r of review.rows) {
  if (deleteWords.has(r.word) && r.term_id) deletedIds.add(r.term_id);
}
const tagsKept = tags.rows.filter((r) => !deletedIds.has(r.term_id));
writeCsv(tagsPath, tags.header, tagsKept);

// Final actions CSV
const actionHeader = [
  'surface',
  'termId',
  'sourceFile',
  'action',
  'classification',
  'reason',
];
writeCsv(path.join(docsTone, 'atomicity_final_source_actions.csv'), actionHeader, actions);

// Update forced activation closure CSV for 迷你吧
const faPath = path.join(docsTone, 'forced_activation_six_closure.csv');
if (fs.existsSync(faPath)) {
  let fa = fs.readFileSync(faPath, 'utf8');
  fa = fa.replace(
    /^迷你吧,DELETE_DOMAIN_SAFE,.*/m,
    `迷你吧,KEEP_DOMAIN_ATOMIC,tourism_hotel,,,,"true",,"Forced activation blocked by tone0 (fixed in Source); compound-only tourism_hotel; atoms too broad → KEEP_DOMAIN_ATOMIC"`
  );
  fs.writeFileSync(faPath, fa, 'utf8');
}

console.log(
  JSON.stringify(
    {
      reviewDeleted,
      reviewRemaining: reviewKept.length,
      suppDeleted,
      suppRemaining: suppKept.length,
      tagsRemaining: tagsKept.length,
      tagsDropped: tags.rows.length - tagsKept.length,
      keepAtomic: [...KEEP_DOMAIN_ATOMIC],
      deleteCount: actions.filter((a) => a.action === 'DELETE_SOURCE_ROW').length,
      keepCount: actions.filter((a) => a.action === 'KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION').length,
    },
    null,
    2
  )
);
