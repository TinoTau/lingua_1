/**
 * Lexicon Pollution & Abnormal Candidate Origin Audit — READ ONLY.
 * Uses Electron ABI better-sqlite3 + existing candidate export / assembly traces.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repoRoot, 'electron_node/electron-node');
const Database = require(path.join(electronRoot, 'node_modules/better-sqlite3'));
const outDir = path.resolve(__dirname, 'lexicon_pollution_audit');
fs.mkdirSync(outDir, { recursive: true });

const FOCUS = [
  '科医',
  '生城',
  '计化',
  '后选生城',
  '候选生城',
  '候选生成',
  '上线计化',
  '上线计划',
  '作液室',
  '量检',
  '房监控调',
  '理服责',
  '钟点',
  '登机',
  '低脂',
  '地质',
  '议员',
  '议室',
  '医师',
  '接口文档',
  '收货地址',
  '订单中台',
  '翻译引擎',
  '会员系统',
  '血常规',
  '大床房',
  '机场高速',
  '软件园',
];

const COMPOUND_CHECK = [
  '上线计划',
  '候选生成',
  '接口文档',
  '收货地址',
  '订单中台',
  '翻译引擎',
  '会员系统',
  '血常规',
  '大床房',
  '机场高速',
  '软件园',
];

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function fileMeta(p) {
  if (!fs.existsSync(p)) return null;
  const st = fs.statSync(p);
  return {
    path: p,
    exists: true,
    size: st.size,
    mtime: st.mtime.toISOString(),
    ctime: st.ctime.toISOString(),
    sha256: sha256File(p),
  };
}

// --- Production path resolution (code contract) ---
const prodBundle = path.join(repoRoot, 'node_runtime/lexicon/v3');
const prodSqlite = path.join(prodBundle, 'lexicon.sqlite');
const prodManifest = path.join(prodBundle, 'manifest.json');
const prodChecksum = path.join(prodBundle, 'checksum.txt');

const allSqliteCandidates = [];
function walk(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, depth + 1);
    else if (/\.(sqlite|sqlite3|db)$/i.test(name)) {
      allSqliteCandidates.push({
        ...fileMeta(full),
        classification:
          full === prodSqlite
            ? 'PRODUCTION_ACTIVE'
            : full.includes(`${path.sep}v3${path.sep}`) && full.includes('backup')
              ? 'LEGACY'
              : full.includes('v2_shadow')
                ? 'GENERATED_SOURCE'
                : full.includes('current')
                  ? 'PRODUCTION_INACTIVE'
                  : full.includes('snapshot')
                    ? 'LEGACY'
                    : full.includes('test') || full.includes('fixture')
                      ? 'TEST_ONLY'
                      : 'UNKNOWN',
      });
    }
  }
}
walk(path.join(repoRoot, 'node_runtime/lexicon'));

const checksumTxt = fs.existsSync(prodChecksum)
  ? fs.readFileSync(prodChecksum, 'utf8').trim()
  : null;
const manifest = JSON.parse(fs.readFileSync(prodManifest, 'utf8'));
const actualHash = sha256File(prodSqlite);
const checksumOk =
  checksumTxt &&
  (checksumTxt === actualHash ||
    checksumTxt === `sha256:${actualHash}` ||
    (manifest.checksum || '').replace(/^sha256:/, '') === actualHash);

const db = new Database(prodSqlite, { readonly: true });

const tables = db
  .prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table','view','trigger') ORDER BY type, name`)
  .all();
const tableStats = {};
for (const t of tables.filter((x) => x.type === 'table')) {
  try {
    tableStats[t.name] = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c;
  } catch (e) {
    tableStats[t.name] = `ERR:${e.message}`;
  }
}

function queryWord(surface) {
  const out = {
    surface,
    base_lexicon: [],
    domain_lexicon: [],
    idiom_lexicon: [],
    term: [],
    term_domain_tags: [],
    term_pinyin_ngrams: [],
    industry_routing: [],
    like_base: [],
    like_domain: [],
    like_ngram: [],
  };
  const q = (sql, ...args) => {
    try {
      return db.prepare(sql).all(...args);
    } catch {
      return [];
    }
  };
  out.base_lexicon = q(
    `SELECT id, word, pinyin_key, tone_pinyin_key, source, is_alias, canonical_word, enabled, prior_score FROM base_lexicon WHERE word = ? OR canonical_word = ?`,
    surface,
    surface
  );
  out.domain_lexicon = q(
    `SELECT id, word, pinyin_key, domain_id, source, is_alias, canonical_word, enabled FROM domain_lexicon WHERE word = ? OR canonical_word = ?`,
    surface,
    surface
  );
  out.idiom_lexicon = q(
    `SELECT id, word, pinyin_key, source, enabled FROM idiom_lexicon WHERE word = ?`,
    surface
  );
  out.term = q(`SELECT id, word, pinyin_key, source FROM term WHERE word = ?`, surface);
  // tags via term id
  const termIds = [
    ...out.base_lexicon.map((r) => r.id),
    ...out.domain_lexicon.map((r) => r.id),
    ...out.term.map((r) => r.id),
  ].filter(Boolean);
  for (const id of [...new Set(termIds)]) {
    out.term_domain_tags.push(
      ...q(`SELECT term_id, domain_id, weight FROM term_domain_tags WHERE term_id = ?`, id)
    );
  }
  out.term_pinyin_ngrams = q(
    `SELECT id, parent_term_id, parent_word, fragment_text, ngram_pinyin_key, ngram_start, ngram_end, domain_id, source, enabled, prior
     FROM term_pinyin_ngrams
     WHERE fragment_text = ? OR parent_word = ?`,
    surface,
    surface
  );
  out.industry_routing = q(
    `SELECT keyword, pinyin_key, domain_id, weight FROM industry_routing_lexicon WHERE keyword = ?`,
    surface
  );
  out.like_base = q(
    `SELECT id, word, pinyin_key, source, is_alias FROM base_lexicon WHERE word LIKE ? LIMIT 20`,
    `%${surface}%`
  );
  out.like_domain = q(
    `SELECT id, word, pinyin_key, domain_id, source, is_alias FROM domain_lexicon WHERE word LIKE ? LIMIT 20`,
    `%${surface}%`
  );
  out.like_ngram = q(
    `SELECT id, parent_word, fragment_text, domain_id, source FROM term_pinyin_ngrams WHERE fragment_text LIKE ? OR parent_word LIKE ? LIMIT 30`,
    `%${surface}%`,
    `%${surface}%`
  );
  return out;
}

const focusResults = {};
for (const w of FOCUS) focusResults[w] = queryWord(w);

// Atomicity: 4+ char words in base/domain that look compound
const longBase = db
  .prepare(
    `SELECT id, word, length(word) AS len, source, is_alias, prior_score FROM base_lexicon WHERE length(word) >= 4 AND enabled = 1 ORDER BY length(word) DESC, word LIMIT 5000`
  )
  .all();
const longDomain = db
  .prepare(
    `SELECT id, word, length(word) AS len, domain_id, source, is_alias FROM domain_lexicon WHERE length(word) >= 4 AND enabled = 1 ORDER BY length(word) DESC, word LIMIT 5000`
  )
  .all();

function canBeSplitHeuristic(word) {
  // objective only: length>=4 CJK and not obvious proper-noun markers — flag for review
  if (!/^[\u4e00-\u9fff]+$/.test(word)) return { canBeSplit: 'UNKNOWN_NON_CJK', exceptionType: 'non_cjk' };
  if (word.length >= 6) return { canBeSplit: 'LIKELY', exceptionType: null };
  if (word.length === 5) return { canBeSplit: 'LIKELY', exceptionType: 'may_be_idiom_or_proper' };
  if (word.length === 4) return { canBeSplit: 'POSSIBLE', exceptionType: 'may_be_idiom_or_compound' };
  return { canBeSplit: 'NO', exceptionType: null };
}

const atomicityViolations = [];
const seenAtom = new Set();
for (const row of [...longBase.map((r) => ({ ...r, termType: 'base' })), ...longDomain.map((r) => ({ ...r, termType: 'domain' }))]) {
  const key = `${row.termType}:${row.word}`;
  if (seenAtom.has(key)) continue;
  seenAtom.add(key);
  const h = canBeSplitHeuristic(row.word);
  if (row.word.length >= 4 && /^[\u4e00-\u9fff]+$/.test(row.word)) {
    atomicityViolations.push({
      surface: row.word,
      length: row.len ?? row.word.length,
      termType: row.termType,
      termId: row.id,
      domain_id: row.domain_id ?? '',
      source: row.source ?? '',
      is_alias: row.is_alias ?? 0,
      canBeSplit: h.canBeSplit,
      componentTerms: '',
      exceptionType: h.exceptionType ?? '',
      active: 1,
    });
  }
}

// Compound phrase exact presence
const compoundAudit = {};
for (const w of COMPOUND_CHECK) {
  compoundAudit[w] = {
    focus: queryWord(w),
    inBase: focusResults[w]?.base_lexicon?.length > 0 || queryWord(w).base_lexicon.length > 0,
  };
  compoundAudit[w] = queryWord(w);
}

// --- Extract abnormal replacements from candidate export ---
const exportPath = path.join(
  __dirname,
  'dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.json'
);
const exportJson = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
const replacementFreq = new Map(); // surface -> {count, caseIds, examples}
const phraseFreq = new Map();

for (const c of exportJson.cases || []) {
  const raw = c.rawText || '';
  for (const b of c.assemblyByBucket || []) {
    for (const s of b.sentences || []) {
      if (s.text && s.text !== raw) {
        const k = s.text;
        if (!phraseFreq.has(k)) phraseFreq.set(k, { count: 0, caseIds: new Set(), raw });
        const e = phraseFreq.get(k);
        e.count += 1;
        e.caseIds.add(c.caseId);
      }
      for (const r of s.replacements || []) {
        if (!r.repairTarget) continue;
        const w = r.word;
        const spanText = r.spanText ?? raw.slice(r.rawRange?.[0] ?? 0, r.rawRange?.[1] ?? 0);
        if (w && w !== spanText) {
          if (!replacementFreq.has(w)) {
            replacementFreq.set(w, {
              count: 0,
              caseIds: new Set(),
              examples: [],
            });
          }
          const e = replacementFreq.get(w);
          e.count += 1;
          e.caseIds.add(c.caseId);
          if (e.examples.length < 5) {
            e.examples.push({
              caseId: c.caseId,
              spanText,
              rawRange: r.rawRange,
              source: r.source,
              pathId: b.pathId,
              bucketDomain: b.bucketDomain,
            });
          }
        }
      }
    }
  }
}

const abnormalReplacements = [...replacementFreq.entries()]
  .map(([surface, v]) => ({
    surface,
    count: v.count,
    caseIds: [...v.caseIds].sort(),
    examples: v.examples,
    db: queryWord(surface),
  }))
  .sort((a, b) => b.count - a.count);

// Special: 科医 / 生城 / 计化 deep
function classifyOrigin(dbHit) {
  if (dbHit.base_lexicon.length || dbHit.domain_lexicon.length || dbHit.term.length) {
    return dbHit.base_lexicon.some((r) => r.is_alias) || dbHit.domain_lexicon.some((r) => r.is_alias)
      ? 'LEXICON_ALIAS'
      : 'LEXICON_TERM';
  }
  if (dbHit.term_pinyin_ngrams.some((r) => r.fragment_text === dbHit.surface)) {
    return 'NGRAM_DERIVATION';
  }
  if (dbHit.term_pinyin_ngrams.some((r) => r.parent_word === dbHit.surface)) {
    return 'PARENT_TERM_FRAGMENT';
  }
  if (dbHit.like_ngram.length && !dbHit.base_lexicon.length) {
    return 'NGRAM_LIKE_ONLY';
  }
  return 'NOT_IN_ACTIVE_DB_AS_TERM';
}

// Trace from assembly JSON for 科医 cases
const traceDir = path.join(__dirname, 'sentence_assembly_trace');
function findCandidateMeta(caseId, word) {
  const num = String(parseInt(caseId.replace(/\D/g, ''), 10)).padStart(3, '0');
  const fp = path.join(traceDir, `${num}.json`);
  if (!fs.existsSync(fp)) return null;
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const hits = [];
  for (const p of j.paths || []) {
    for (const b of p.buckets || []) {
      for (const cand of b.candidates || []) {
        if (cand.word === word || cand.surface === word || cand.replacement === word) {
          hits.push({
            pathId: p.pathId,
            bucketDomain: b.bucketDomain,
            ...cand,
          });
        }
      }
      for (const s of b.sentences || []) {
        for (const r of s.replacements || []) {
          if (r.word === word) {
            hits.push({
              kind: 'sentence_replacement',
              pathId: p.pathId,
              bucketDomain: b.bucketDomain,
              sentenceId: s.sentenceId,
              ...r,
            });
          }
        }
      }
    }
  }
  return { rawText: j.rawText, hits: hits.slice(0, 40) };
}

const specialTraces = {};
for (const w of ['科医', '生城', '计化', '上线计划', '候选生成', '候选生城', '后选生城', '上线计化']) {
  const ab = abnormalReplacements.find((x) => x.surface === w);
  const cases = ab?.caseIds?.slice(0, 5) || [];
  // also search phrase texts
  const phraseCases = [];
  for (const c of exportJson.cases || []) {
    for (const b of c.assemblyByBucket || []) {
      for (const s of b.sentences || []) {
        if ((s.text || '').includes(w)) phraseCases.push(c.caseId);
      }
    }
  }
  const uniqCases = [...new Set([...cases, ...phraseCases])].slice(0, 8);
  specialTraces[w] = {
    dbClassification: classifyOrigin({ surface: w, ...queryWord(w) }),
    db: focusResults[w] || queryWord(w),
    asReplacementDiffFromSpan: ab || null,
    caseTraces: uniqCases.map((id) => ({ caseId: id, meta: findCandidateMeta(id, w) })),
  };
}

// Raw vs candidate analysis for 候选生城 / 上线计化
function analyzeComposition(caseId, targetPhrase) {
  const num = String(parseInt(caseId.replace(/\D/g, ''), 10)).padStart(3, '0');
  const fp = path.join(traceDir, `${num}.json`);
  if (!fs.existsSync(fp)) return null;
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const raw = j.rawText;
  const out = [];
  for (const p of j.paths || []) {
    for (const b of p.buckets || []) {
      for (const s of b.sentences || []) {
        if (!(s.finalText || '').includes(targetPhrase) && s.finalText !== targetPhrase) {
          // still analyze if final contains parts
        }
        if ((s.finalText || '').includes(targetPhrase) || targetPhrase.split('').every(() => true)) {
          if (!(s.finalText || '').includes(targetPhrase)) continue;
          const reps = (s.replacements || [])
            .filter((r) => r.repairTarget)
            .map((r) => ({
              word: r.word,
              spanText: r.spanText,
              rawRange: r.rawRange,
              source: r.source,
            }));
          // reconstruct which chars of phrase are from replacements vs raw
          const idx = s.finalText.indexOf(targetPhrase);
          out.push({
            sentenceId: s.sentenceId,
            finalText: s.finalText,
            phraseIndex: idx,
            repairReplacements: reps,
            rawText: raw,
            note:
              reps.some((r) => r.word === targetPhrase)
                ? 'FULL_PHRASE_AS_REPLACEMENT'
                : reps.some((r) => targetPhrase.includes(r.word))
                  ? 'PARTIAL_REPLACEMENTS_PLUS_RAW'
                  : 'PHRASE_MAY_BE_RAW_OR_CANONICAL_COMPOSITION',
          });
        }
      }
    }
  }
  return out.slice(0, 10);
}

const composition = {
  候选生城: [],
  上线计化: [],
  后选生城: [],
  上线计划: [],
};
for (const phrase of Object.keys(composition)) {
  for (const c of exportJson.cases || []) {
    if ((c.rawText || '').includes(phrase) || (c.kenlmInputs || []).some((k) => (k.text || '').includes(phrase))) {
      const a = analyzeComposition(c.caseId, phrase);
      if (a && a.length) composition[phrase].push({ caseId: c.caseId, analyses: a });
    }
  }
  composition[phrase] = composition[phrase].slice(0, 6);
}

// Pollution inventory rows
const pollutionRows = [];
for (const ab of abnormalReplacements) {
  const dbHit = ab.db;
  const cls = classifyOrigin({ surface: ab.surface, ...dbHit });
  let classification = 'UNKNOWN';
  let recommendedAction = 'INVESTIGATE';
  if (cls === 'LEXICON_TERM' || cls === 'LEXICON_ALIAS') {
    classification = 'P0_ACTIVE_LEXICON_POLLUTION_OR_LEGIT_TERM';
    recommendedAction = ab.surface.length >= 4 ? 'REVIEW_ATOMICITY_DELETE_OR_KEEP' : 'KEEP_IF_LEGITIMATE_ATOMIC';
  } else if (cls === 'NGRAM_DERIVATION' || cls === 'PARENT_TERM_FRAGMENT') {
    classification = 'P1_ALIAS_OR_NGRAM_BYPASS';
    recommendedAction = 'AUDIT_NGRAM_PARENT';
  } else if (cls === 'NOT_IN_ACTIVE_DB_AS_TERM') {
    // check if always equal to raw span in examples
    const allRawPreserve = (ab.examples || []).every((e) => e.spanText === ab.surface);
    classification = allRawPreserve ? 'P2_RAW_PRESERVATION' : 'P0_HIDDEN_SURFACE_GENERATION_OR_MISSING_TRACE';
    recommendedAction = allRawPreserve ? 'NO_LEXICON_ACTION' : 'TRACE_RUNTIME_SURFACE';
  }
  pollutionRows.push({
    surface: ab.surface,
    classification,
    activeInProduction: cls.startsWith('LEXICON') || cls.includes('NGRAM') ? 'YES' : 'NO',
    termId:
      dbHit.base_lexicon[0]?.id ||
      dbHit.domain_lexicon[0]?.id ||
      dbHit.term_pinyin_ngrams[0]?.id ||
      '',
    sourceTable: dbHit.base_lexicon.length
      ? 'base_lexicon'
      : dbHit.domain_lexicon.length
        ? 'domain_lexicon'
        : dbHit.term_pinyin_ngrams.length
          ? 'term_pinyin_ngrams'
          : '',
    sourceFile: prodSqlite,
    importBatch: manifest.lastPatchId || manifest.rebuild?.patchId || '',
    domains: [
      ...new Set([
        ...dbHit.term_domain_tags.map((t) => t.domain_id),
        ...dbHit.domain_lexicon.map((t) => t.domain_id),
        ...dbHit.term_pinyin_ngrams.map((t) => t.domain_id).filter(Boolean),
      ]),
    ].join('|'),
    caseIds: ab.caseIds.join('|'),
    recallSource: ab.examples[0]?.source || '',
    hitKind: '',
    recommendedAction,
    count: ab.count,
    dbClass: cls,
  });
}

// Add focus words even if not in replacement diff
for (const w of FOCUS) {
  if (pollutionRows.some((r) => r.surface === w)) continue;
  const dbHit = focusResults[w];
  const cls = classifyOrigin({ surface: w, ...dbHit });
  pollutionRows.push({
    surface: w,
    classification:
      cls === 'NOT_IN_ACTIVE_DB_AS_TERM' ? 'NOT_IN_DB_CHECK_RAW' : 'FOCUS_WORD_IN_DB',
    activeInProduction: cls.startsWith('LEXICON') || cls.includes('NGRAM') ? 'YES' : 'NO',
    termId:
      dbHit.base_lexicon[0]?.id ||
      dbHit.domain_lexicon[0]?.id ||
      dbHit.term_pinyin_ngrams[0]?.id ||
      '',
    sourceTable: dbHit.base_lexicon.length
      ? 'base_lexicon'
      : dbHit.domain_lexicon.length
        ? 'domain_lexicon'
        : dbHit.term_pinyin_ngrams.length
          ? 'term_pinyin_ngrams'
          : '',
    sourceFile: prodSqlite,
    importBatch: manifest.lastPatchId || '',
    domains: [
      ...new Set([
        ...dbHit.term_domain_tags.map((t) => t.domain_id),
        ...dbHit.domain_lexicon.map((t) => t.domain_id),
      ]),
    ].join('|'),
    caseIds: '',
    recallSource: '',
    hitKind: '',
    recommendedAction: 'REVIEW',
    count: 0,
    dbClass: cls,
  });
}

function toCsv(rows, cols) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

fs.writeFileSync(
  path.join(outDir, 'lexicon_pollution_inventory.csv'),
  toCsv(pollutionRows, [
    'surface',
    'classification',
    'activeInProduction',
    'termId',
    'sourceTable',
    'sourceFile',
    'importBatch',
    'domains',
    'caseIds',
    'recallSource',
    'hitKind',
    'recommendedAction',
    'count',
    'dbClass',
  ]),
  'utf8'
);

fs.writeFileSync(
  path.join(outDir, 'lexicon_atomicity_violations.csv'),
  toCsv(atomicityViolations, [
    'surface',
    'length',
    'termType',
    'canBeSplit',
    'componentTerms',
    'exceptionType',
    'source',
    'active',
    'termId',
    'domain_id',
    'is_alias',
  ]),
  'utf8'
);

const multiDomainSample = ['订单', '预订', '前台', '计划', '接口', '文档', '联调', '上线'];
const multiDomainAudit = {};
for (const w of multiDomainSample) {
  multiDomainAudit[w] = queryWord(w);
}

const result = {
  production: {
    bundleDir: prodBundle,
    sqlitePath: prodSqlite,
    ...fileMeta(prodSqlite),
    readonly: true,
    schemaVersion: manifest.schemaVersion,
    bundleVersion: manifest.bundleVersion,
    buildTime: manifest.buildTime,
    manifestChecksum: manifest.checksum,
    fileSha256: actualHash,
    checksumFile: checksumTxt,
    checksumMatch: Boolean(checksumOk),
    lastPatchId: manifest.lastPatchId,
    rebuild: manifest.rebuild || null,
    seedInputs: manifest.seedInputs || [],
  },
  allSqliteCandidates,
  tables,
  tableStats,
  focusResults,
  compoundAudit,
  specialTraces,
  composition,
  abnormalReplacementCount: abnormalReplacements.length,
  abnormalReplacementsTop: abnormalReplacements.slice(0, 80).map((a) => ({
    surface: a.surface,
    count: a.count,
    caseIds: a.caseIds,
    examples: a.examples,
    dbClass: classifyOrigin({ surface: a.surface, ...a.db }),
    inBase: a.db.base_lexicon.length,
    inDomain: a.db.domain_lexicon.length,
    inNgram: a.db.term_pinyin_ngrams.length,
  })),
  atomicityViolationCount: atomicityViolations.length,
  atomicitySample: atomicityViolations.filter((v) => COMPOUND_CHECK.includes(v.surface) || v.length >= 4).slice(0, 100),
  compoundInAtomicity: atomicityViolations.filter((v) => COMPOUND_CHECK.includes(v.surface)),
  multiDomainAudit,
  pollutionRowCount: pollutionRows.length,
};

fs.writeFileSync(path.join(outDir, '_probe_result.json'), JSON.stringify(result, null, 2), 'utf8');
console.error(
  JSON.stringify(
    {
      sqlite: prodSqlite,
      checksumMatch: checksumOk,
      tables: tables.length,
      focusInDb: FOCUS.map((w) => ({
        w,
        base: focusResults[w].base_lexicon.length,
        domain: focusResults[w].domain_lexicon.length,
        ngram: focusResults[w].term_pinyin_ngrams.length,
      })),
      abnormalReplacementCount: abnormalReplacements.length,
      atomicityViolationCount: atomicityViolations.length,
      compoundHits: COMPOUND_CHECK.map((w) => ({
        w,
        base: compoundAudit[w].base_lexicon.length,
        domain: compoundAudit[w].domain_lexicon.length,
        ngram: compoundAudit[w].term_pinyin_ngrams.length,
      })),
    },
    null,
    2
  )
);

db.close();
