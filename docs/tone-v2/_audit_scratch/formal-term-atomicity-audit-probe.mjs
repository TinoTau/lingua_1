#!/usr/bin/env node
/**
 * READ ONLY — Formal Term Atomicity & Reproducible Rebuild Audit Probe
 * Electron ABI required for better-sqlite3.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.join(__dirname, 'formal_term_atomicity_audit');
const rootPkg = path.join(repoRoot, 'electron_node/electron-node/package.json');
const require = createRequire(rootPkg);
const Database = require('better-sqlite3');

fs.mkdirSync(outDir, { recursive: true });

/** Minimal CSV parser (header row, quoted fields). */
function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  function readRow() {
    const cells = [];
    let cell = '';
    let inQ = false;
    while (i < len) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQ = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        cells.push(cell);
        cell = '';
        i += 1;
        continue;
      }
      if (ch === '\n') {
        i += 1;
        cells.push(cell);
        return cells;
      }
      if (ch === '\r') {
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    if (cell.length || cells.length) {
      cells.push(cell);
      return cells;
    }
    return null;
  }
  const header = readRow();
  if (!header) return [];
  while (true) {
    const cells = readRow();
    if (!cells) break;
    if (cells.length === 1 && cells[0] === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? '';
    rows.push(obj);
  }
  return rows;
}

const KEY_SURFACES = [
  '上线计划',
  '接口文档',
  '订单中台',
  '候选生成',
  '翻译引擎',
  '会员系统',
  '收货地址',
  '血常规',
  '机场高速',
  '软件园',
  '蓝莓马芬',
  '内科医生',
  '大床房',
];

const ATOMIC_PAIRS = {
  上线计划: ['上线', '计划'],
  接口文档: ['接口', '文档'],
  订单中台: ['订单', '中台'],
  候选生成: ['候选', '生成'],
  翻译引擎: ['翻译', '引擎'],
  会员系统: ['会员', '系统'],
  收货地址: ['收货', '地址'],
  血常规: ['血', '常规'], // may INVESTIGATE — medical fixed term?
  机场高速: ['机场', '高速'],
  软件园: ['软件', '园'],
  蓝莓马芬: ['蓝莓', '马芬'],
  内科医生: ['内科', '医生'],
  大床房: ['大床', '房'], // or 大+床+房
};

const IDIOM_HINT = /一|二|三|四|五|六|七|八|九|十|百|千|万|不|无|有|之|而|以|为|所/;

function cjkLen(s) {
  return [...String(s)].length;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseCsv(text);
}

const bundleDir = path.join(repoRoot, 'node_runtime/lexicon/v3');
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });

const extractDir = path.join(repoRoot, 'tmp/lexicon_corrected_review_20260718_extract');
const reviewCsv = path.join(extractDir, 'lexicon_full_corrected_review.csv');
const tagsCsv = path.join(extractDir, 'term_domain_tags_corrected.csv');
const suppCsv = path.join(extractDir, 'supplemental_terms.csv');
const removeCsv = path.join(extractDir, 'terms_to_remove_or_rebuild.csv');

const reviewRows = readCsv(reviewCsv);
const tagRows = readCsv(tagsCsv);
const suppRows = readCsv(suppCsv);
const removeRows = readCsv(removeCsv);

console.error('[audit] csv counts', {
  review: reviewRows.length,
  tags: tagRows.length,
  supp: suppRows.length,
  remove: removeRows.length,
  reviewCols: reviewRows[0] ? Object.keys(reviewRows[0]) : [],
  suppCols: suppRows[0] ? Object.keys(suppRows[0]) : [],
});

// Index sources by word / surface
const reviewByWord = new Map();
for (let i = 0; i < reviewRows.length; i++) {
  const r = reviewRows[i];
  const word = (r.word || r.surface || r.term || '').trim();
  if (!word) continue;
  const list = reviewByWord.get(word) || [];
  list.push({ rowIndex: i + 2, ...r }); // +2 header
  reviewByWord.set(word, list);
}
const suppByWord = new Map();
for (let i = 0; i < suppRows.length; i++) {
  const r = suppRows[i];
  const word = (r.word || r.surface || '').trim();
  if (!word) continue;
  const list = suppByWord.get(word) || [];
  list.push({ rowIndex: i + 2, ...r });
  suppByWord.set(word, list);
}
const removeWords = new Set(
  removeRows.map((r) => (r.word || r.surface || r.term_id || '').trim()).filter(Boolean)
);

// Production terms
const terms = db
  .prepare(
    `SELECT id, word, pinyin_key, tone_pinyin_key, prior_score, repair_target, enabled, source, tier
     FROM term WHERE enabled = 1`
  )
  .all();

const tagMap = new Map();
for (const row of db.prepare(`SELECT term_id, domain_id, weight FROM term_domain_tags`).all()) {
  const list = tagMap.get(row.term_id) || [];
  list.push(row.domain_id);
  tagMap.set(row.term_id, list);
}

const baseWords = new Set(
  db.prepare(`SELECT word FROM base_lexicon WHERE enabled=1`).all().map((r) => r.word)
);
const domainWords = new Map();
for (const r of db.prepare(`SELECT word, domain_id FROM domain_lexicon WHERE enabled=1`).all()) {
  const list = domainWords.get(r.word) || [];
  list.push(r.domain_id);
  domainWords.set(r.word, list);
}
const idiomWords = new Set(
  db.prepare(`SELECT word FROM idiom_lexicon WHERE enabled=1`).all().map((r) => r.word)
);

const termWordSet = new Set(terms.map((t) => t.word));

function termExists(w) {
  return termWordSet.has(w) || baseWords.has(w) || domainWords.has(w);
}

function segmentBinary(surface) {
  const chars = [...surface];
  const n = chars.length;
  const segs = [];
  for (let i = 1; i < n; i++) {
    const a = chars.slice(0, i).join('');
    const b = chars.slice(i).join('');
    if (a.length >= 1 && b.length >= 1) {
      segs.push([a, b]);
    }
  }
  return segs;
}

function bestAtomicSplit(surface) {
  const preferred = ATOMIC_PAIRS[surface];
  if (preferred) {
    return {
      possibleSegments: [preferred],
      allExist: preferred.every(termExists),
      chosen: preferred,
    };
  }
  const bins = segmentBinary(surface);
  // Prefer 2+2 for len4, 2+3/3+2 for len5, both exist
  const scored = bins
    .map((seg) => ({
      seg,
      exist: seg.every(termExists),
      score:
        (seg.every(termExists) ? 100 : 0) +
        (seg.every((x) => x.length >= 2 && x.length <= 3) ? 10 : 0) +
        (seg[0].length === 2 && seg[1].length === 2 ? 5 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const good = scored.filter((s) => s.exist && s.seg.every((x) => x.length >= 2));
  const chosen = (good[0] || scored[0])?.seg || [];
  return {
    possibleSegments: scored.slice(0, 8).map((s) => s.seg),
    allExist: chosen.length > 0 && chosen.every(termExists),
    chosen,
  };
}

function classifyTerm(t) {
  const surface = t.word;
  const len = cjkLen(surface);
  const domains = tagMap.get(t.id) || [];
  const inIdiom = idiomWords.has(surface);
  const source = t.source || '';

  if (len <= 3) {
    return {
      classification: 'KEEP_ATOMIC',
      exceptionEvidence: len <= 3 ? 'length<=3 atomic preference' : '',
    };
  }

  if (inIdiom || t.tier === 'idiom') {
    return { classification: 'KEEP_IDIOM', exceptionEvidence: 'present in idiom_lexicon or tier=idiom' };
  }

  // Heuristic proper noun / place / brand (weak — INVESTIGATE if unsure)
  const properHints =
    /大学|医院|机场|高速|软件园|酒店|银行|公司|集团|公园|大道|广场|中心|系统|引擎|马芬|星巴克|麦当劳/.test(
      surface
    );

  const split = bestAtomicSplit(surface);

  // Medical fixed short compounds often 3 chars; 4-char medical like 内科医生
  if (surface === '血常规' || surface === '大床房') {
    return {
      classification: surface === '血常规' ? 'KEEP_FIXED_TECHNICAL_TERM' : 'INVESTIGATE',
      exceptionEvidence:
        surface === '血常规'
          ? 'common medical lab panel; splitting loses term identity'
          : 'hotel room type; may be fixed product SKU',
      split,
    };
  }

  if (surface === '蓝莓马芬') {
    return {
      classification: 'KEEP_FIXED_TECHNICAL_TERM',
      exceptionEvidence: 'product/menu item; bakery domain compound with established termId',
      split,
    };
  }

  if (surface === '机场高速' || surface === '软件园') {
    return {
      classification: 'INVESTIGATE',
      exceptionEvidence: 'place-like; may be proper noun OR segmentable',
      split,
    };
  }

  if (split.allExist && split.chosen.every((x) => x.length >= 2 && x.length <= 3)) {
    // Business phrase pattern: both segments exist as formal terms
    return {
      classification: 'DELETE_COMPOSITE',
      exceptionEvidence: `allSegmentsExistAsTerms: ${split.chosen.join('+')}`,
      split,
    };
  }

  if (properHints && !split.allExist) {
    return {
      classification: 'KEEP_PROPER_NOUN',
      exceptionEvidence: 'proper/place hint and not fully segmentable into existing atoms',
      split,
    };
  }

  if (properHints && split.allExist) {
    return {
      classification: 'INVESTIGATE',
      exceptionEvidence: 'proper/place hint BUT also fully segmentable',
      split,
    };
  }

  return {
    classification: 'INVESTIGATE',
    exceptionEvidence: split.allExist
      ? `segmentable ${split.chosen.join('+')} — review semantics`
      : 'no clean atomic split with existing terms',
    split,
  };
}

// Length / tier distribution
const lengthDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, '6+': 0 };
const tierDist = {};
const lengthByTier = {};
for (const t of terms) {
  const len = cjkLen(t.word);
  const bucket = len >= 6 ? '6+' : String(len);
  lengthDist[bucket] = (lengthDist[bucket] || 0) + 1;
  const tier = t.tier || 'other';
  tierDist[tier] = (tierDist[tier] || 0) + 1;
  const key = `${bucket}|${tier}`;
  lengthByTier[key] = (lengthByTier[key] || 0) + 1;
}

// Export all terms
const termExportPath = path.join(outDir, 'formal_terms_export.csv');
{
  const header = [
    'termId',
    'surface',
    'normalizedSurface',
    'length',
    'pinyin',
    'tones',
    'tier',
    'termType',
    'source',
    'status',
    'domains',
    'createdAt',
    'updatedAt',
    'importBatch',
    'inBase',
    'inDomain',
    'inIdiom',
    'inReviewCsv',
    'inSupplementalCsv',
  ];
  const lines = [header.join(',')];
  for (const t of terms) {
    const reviewHits = reviewByWord.get(t.word) || [];
    const suppHits = suppByWord.get(t.word) || [];
    let importBatch = '';
    if (suppHits.length) importBatch = 'supplemental_terms.csv';
    else if (reviewHits.length) importBatch = 'lexicon_full_corrected_review.csv';
    else importBatch = 'UNMAPPED';
    lines.push(
      [
        t.id,
        t.word,
        t.word,
        cjkLen(t.word),
        t.pinyin_key || '',
        t.tone_pinyin_key || '',
        t.tier || '',
        '', // termType column absent
        t.source || '',
        t.enabled ? 'enabled' : 'disabled',
        (tagMap.get(t.id) || []).join('|'),
        '',
        '',
        importBatch,
        baseWords.has(t.word) ? 1 : 0,
        domainWords.has(t.word) ? 1 : 0,
        idiomWords.has(t.word) ? 1 : 0,
        reviewHits.length,
        suppHits.length,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(termExportPath, lines.join('\n') + '\n', 'utf8');
}

// Atomicity candidates: 4+ non-idiom
const candidates = [];
const classCounts = {};
for (const t of terms) {
  const len = cjkLen(t.word);
  if (len < 4) continue;
  if (idiomWords.has(t.word)) {
    // still list but KEEP_IDIOM
  }
  const cls = classifyTerm(t);
  classCounts[cls.classification] = (classCounts[cls.classification] || 0) + 1;
  const split = cls.split || bestAtomicSplit(t.word);
  candidates.push({
    surface: t.word,
    length: len,
    termId: t.id,
    termType: '',
    source: t.source || '',
    domains: (tagMap.get(t.id) || []).join('|'),
    possibleSegments: JSON.stringify(split.possibleSegments || []),
    chosenSegments: (split.chosen || []).join('+'),
    allSegmentsExistAsTerms: split.allExist ? 1 : 0,
    exceptionEvidence: cls.exceptionEvidence || '',
    classification: cls.classification,
    inIdiom: idiomWords.has(t.word) ? 1 : 0,
    importBatch:
      (suppByWord.get(t.word) || []).length > 0
        ? 'supplemental_terms.csv'
        : (reviewByWord.get(t.word) || []).length > 0
          ? 'lexicon_full_corrected_review.csv'
          : 'UNMAPPED',
  });
}

const candPath = path.join(outDir, 'formal_term_atomicity_candidates.csv');
{
  const header = [
    'surface',
    'length',
    'termId',
    'termType',
    'source',
    'domains',
    'possibleSegments',
    'chosenSegments',
    'allSegmentsExistAsTerms',
    'exceptionEvidence',
    'classification',
    'inIdiom',
    'importBatch',
  ];
  const lines = [header.join(',')];
  for (const c of candidates.sort((a, b) => b.length - a.length || a.surface.localeCompare(b.surface))) {
    lines.push(header.map((h) => csvEscape(c[h])).join(','));
  }
  fs.writeFileSync(candPath, lines.join('\n') + '\n', 'utf8');
}

// Key compound traces
const keyTraces = {};
for (const surface of KEY_SURFACES) {
  const termRows = terms.filter((t) => t.word === surface);
  const reviewHits = reviewByWord.get(surface) || [];
  const suppHits = suppByWord.get(surface) || [];
  const split = bestAtomicSplit(surface);
  const cls = termRows[0] ? classifyTerm(termRows[0]) : { classification: 'ABSENT' };
  keyTraces[surface] = {
    isFormalTerm: termRows.length > 0,
    termRows: termRows.map((t) => ({
      termId: t.id,
      tier: t.tier,
      source: t.source,
      pinyin: t.pinyin_key,
      tone: t.tone_pinyin_key,
      domains: tagMap.get(t.id) || [],
      inBase: baseWords.has(t.word),
      inDomain: domainWords.has(t.word) || false,
      domainRows: domainWords.get(t.word) || [],
      inIdiom: idiomWords.has(t.word),
    })),
    reviewCsvRows: reviewHits.map((r) => ({
      rowIndex: r.rowIndex,
      source: r.source,
      domain_id: r.domain_id,
      action: r.action || r.decision || r.status,
      keys: Object.keys(r).filter((k) => k !== 'rowIndex'),
      sample: r,
    })),
    supplementalCsvRows: suppHits.map((r) => ({
      rowIndex: r.rowIndex,
      sample: r,
    })),
    atoms: split.chosen,
    allAtomsExist: split.allExist,
    atomDetails: (split.chosen || []).map((a) => {
      const tr = terms.find((t) => t.word === a);
      return {
        surface: a,
        asTerm: !!tr,
        termId: tr?.id,
        domains: tr ? tagMap.get(tr.id) || [] : [],
        inBase: baseWords.has(a),
        inDomain: domainWords.has(a),
        pinyin: tr?.pinyin_key,
        tone: tr?.tone_pinyin_key,
      };
    }),
    classification: cls.classification,
    exceptionEvidence: cls.exceptionEvidence,
  };
}

// Source-to-term reconciliation
let termsWithUniqueSource = 0;
let termsWithMultipleSources = 0;
let termsWithoutSourceFile = 0;
let termsOnlyFromSupplemental = 0;
let termsOnlyFromReview = 0;
const unmapped = [];
for (const t of terms) {
  const r = reviewByWord.has(t.word);
  const s = suppByWord.has(t.word);
  if (r && s) termsWithMultipleSources += 1;
  else if (r || s) termsWithUniqueSource += 1;
  else {
    termsWithoutSourceFile += 1;
    if (unmapped.length < 50) unmapped.push({ termId: t.id, word: t.word, source: t.source });
  }
  if (s && !r) termsOnlyFromSupplemental += 1;
  if (r && !s) termsOnlyFromReview += 1;
}

// Supplemental length stats
const suppLen4Plus = suppRows.filter((r) => cjkLen((r.word || '').trim()) >= 4);
const reviewLen4Plus = reviewRows.filter((r) => cjkLen((r.word || r.surface || '').trim()) >= 4);

// Mirror industry_pack rejectPhraseLike (same rules as reject-phrase-like.mjs) — READ ONLY check
const COMPOUND_BLOCK = /中选择|顺手|打包|堂食|点餐|菜单|收据|带走|外卖|排号|发票/;
const PHRASE_MARKERS = /[请吗呢吧啊]|确认|事件|怎么|什么|可以|需要|预订|改签|播放器|吗$|女$/;
const PHRASE_SUFFIX = /(服务|确认)$/;
const IDIOM_BLOCKLIST = new Set(['异口同声', '工作量', '媒体播放器', '珍珠港事件', '奶茶服务']);
const GENERIC_BLOCKLIST = new Set(['服务', '工作', '发布', '模型', '优化', '下文']);
function rejectPhraseLike(word) {
  const w = String(word).trim();
  if (!w) return true;
  if (GENERIC_BLOCKLIST.has(w)) return true;
  if (IDIOM_BLOCKLIST.has(w)) return true;
  if (COMPOUND_BLOCK.test(w)) return true;
  if (PHRASE_MARKERS.test(w)) return true;
  if (w.length >= 3 && PHRASE_SUFFIX.test(w)) return true;
  if (w.endsWith('的') || w.endsWith('了')) return true;
  return false;
}
const phraseLikeOnKey = Object.fromEntries(KEY_SURFACES.map((s) => [s, rejectPhraseLike(s)]));

// Shadow vs production
let shadowManifest = null;
const shadowManifestPath = path.join(repoRoot, 'node_runtime/lexicon/v2_shadow/manifest_v2.json');
if (fs.existsSync(shadowManifestPath)) {
  shadowManifest = JSON.parse(fs.readFileSync(shadowManifestPath, 'utf8'));
}

const summary = {
  productionIdentity: {
    schemaVersion: manifest.schemaVersion,
    bundleVersion: manifest.bundleVersion,
    checksum: manifest.checksum,
    tables: manifest.tables,
    lastPatchId: manifest.lastPatchId,
    rebuild: manifest.rebuild,
    seedInputs: manifest.seedInputs,
    sqlitePath,
    fileSize: fs.statSync(sqlitePath).size,
  },
  termCounts: {
    totalEnabledTerms: terms.length,
    lengthDist,
    tierDist,
    lengthByTier,
    idiomLexiconCount: idiomWords.size,
    baseLexiconCount: baseWords.size,
    domainLexiconDistinctWords: domainWords.size,
  },
  atomicity: {
    candidates4Plus: candidates.length,
    classCounts,
    deleteComposite: candidates.filter((c) => c.classification === 'DELETE_COMPOSITE').length,
    keepIdiom: candidates.filter((c) => c.classification === 'KEEP_IDIOM').length,
    keepProper: candidates.filter((c) => c.classification === 'KEEP_PROPER_NOUN').length,
    keepFixed: candidates.filter((c) => c.classification === 'KEEP_FIXED_TECHNICAL_TERM').length,
    investigate: candidates.filter((c) => c.classification === 'INVESTIGATE').length,
  },
  keyTraces,
  phraseLikeOnKey,
  sourceFiles: {
    reviewCsv: { path: reviewCsv, exists: fs.existsSync(reviewCsv), rows: reviewRows.length, len4Plus: reviewLen4Plus.length },
    tagsCsv: { path: tagsCsv, exists: fs.existsSync(tagsCsv), rows: tagRows.length },
    suppCsv: { path: suppCsv, exists: fs.existsSync(suppCsv), rows: suppRows.length, len4Plus: suppLen4Plus.length },
    removeCsv: { path: removeCsv, exists: fs.existsSync(removeCsv), rows: removeRows.length },
    fullRebuildScriptExists: fs.existsSync(
      path.join(repoRoot, 'electron_node/electron-node/scripts/lexicon/run-lexicon-full-rebuild.mjs')
    ),
  },
  reconciliation: {
    totalTerms: terms.length,
    termsWithUniqueSource,
    termsWithMultipleSources,
    termsWithoutSourceFile,
    termsOnlyFromSupplemental,
    termsOnlyFromReview,
    unmappedSample: unmapped,
    removeListSize: removeWords.size,
  },
  shadowVsProduction: {
    shadowTables: shadowManifest?.tables || null,
    productionTables: manifest.tables,
    note: 'seed-only shadow ≠ FULL_REBUILD production',
  },
  deleteCompositeSample: candidates
    .filter((c) => c.classification === 'DELETE_COMPOSITE')
    .slice(0, 80)
    .map((c) => ({
      surface: c.surface,
      segments: c.chosenSegments,
      source: c.source,
      domains: c.domains,
      importBatch: c.importBatch,
    })),
};

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  terms: terms.length,
  candidates4Plus: candidates.length,
  classCounts,
  reconciliation: summary.reconciliation,
  keyFormal: Object.fromEntries(
    Object.entries(keyTraces).map(([k, v]) => [k, { formal: v.isFormalTerm, cls: v.classification, atoms: v.atoms, allExist: v.allAtomsExist }])
  ),
  phraseLikeOnKey,
}, null, 2));

db.close();
