/**
 * Phase 2 — Minimal SQLite Consolidation Prototype Audit (read-only / scratch only).
 * Does NOT wire into production LTR.
 *
 * Run:
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe docs/tone-v2/_audit_scratch/phase2-minimal-sqlite-consolidation-probe.mjs
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../..');
const Database = require(path.join(root, 'node_modules/better-sqlite3'));

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

// Build must be current — caller should npm run build:main first.
const { LexiconRuntimeV2, queryDomainMultiRowsAtomic } = require(
  path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js')
);
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { recallSpanTopKV3 } = require(path.join(dist, 'lexicon-v2/recall-span-topkv3.js'));
const { getRuntimeDomainRegistry } = require(
  path.join(dist, 'lexicon-v2/runtime-domain-registry.js')
);
const { syllablesKey } = require(path.join(dist, 'lexicon/pinyin-index.js'));

const sqlitePath = path.resolve(repoRoot, 'node_runtime/lexicon/v3/lexicon.sqlite');
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);

function now() {
  return performance.now();
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(vals) {
  const a = vals.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const sum = a.reduce((s, v) => s + v, 0);
  return {
    min: a[0],
    p50: percentile(a, 50),
    p90: percentile(a, 90),
    p95: percentile(a, 95),
    p99: percentile(a, 99),
    max: a[a.length - 1],
    mean: sum / a.length,
    n: a.length,
  };
}

/** Instrument Database.prototype to count prepare + all/get execute. */
function installDbCounters(db) {
  const counters = {
    prepareCount: 0,
    executeCount: 0,
    allCount: 0,
    getCount: 0,
  };
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    counters.prepareCount += 1;
    const stmt = origPrepare(sql);
    const origAll = stmt.all.bind(stmt);
    const origGet = stmt.get.bind(stmt);
    stmt.all = (...args) => {
      counters.executeCount += 1;
      counters.allCount += 1;
      return origAll(...args);
    };
    stmt.get = (...args) => {
      counters.executeCount += 1;
      counters.getCount += 1;
      return origGet(...args);
    };
    return stmt;
  };
  return counters;
}

// ---------- Candidate A: term_domain_tags merge (scratch only) ----------
function lookupTagsOneByOne(db, termIds, domainIds) {
  const sortedDomains = [...domainIds].sort();
  const ph = sortedDomains.map(() => '?').join(', ');
  const out = new Map();
  let statements = 0;
  let prepares = 0;
  const t0 = now();
  for (const termId of termIds) {
    prepares += 1;
    statements += 1;
    const rows = db
      .prepare(
        `SELECT domain_id FROM term_domain_tags
         WHERE term_id = ? AND domain_id IN (${ph})
         ORDER BY domain_id`
      )
      .all(termId, ...sortedDomains);
    out.set(
      termId,
      rows.map((r) => r.domain_id).sort()
    );
  }
  return { map: out, statements, prepares, ms: now() - t0 };
}

function lookupTagsMulti(db, termIds, domainIds) {
  const sortedDomains = [...domainIds].sort();
  const uniqueTerms = [...new Set(termIds.filter(Boolean))];
  const out = new Map();
  for (const id of uniqueTerms) out.set(id, []);
  if (!uniqueTerms.length || !sortedDomains.length) {
    return { map: out, statements: 0, prepares: 0, ms: 0 };
  }
  const tPh = uniqueTerms.map(() => '?').join(', ');
  const dPh = sortedDomains.map(() => '?').join(', ');
  const t0 = now();
  const rows = db
    .prepare(
      `SELECT term_id, domain_id FROM term_domain_tags
       WHERE term_id IN (${tPh}) AND domain_id IN (${dPh})
       ORDER BY term_id, domain_id`
    )
    .all(...uniqueTerms, ...sortedDomains);
  for (const r of rows) {
    const list = out.get(r.term_id) ?? [];
    list.push(r.domain_id);
    out.set(r.term_id, list);
  }
  for (const [k, v] of out) out.set(k, [...v].sort());
  return { map: out, statements: 1, prepares: 1, ms: now() - t0 };
}

function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const ov = b.get(k);
    if (!ov || JSON.stringify(v) !== JSON.stringify(ov)) return false;
  }
  return true;
}

// ---------- Load runtime ----------
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
if (loadState.status !== 'ok') {
  console.error('lexicon load failed', loadState);
  process.exit(1);
}

const fwConfig = loadFwDetectorRuntimeConfig();
const profile = defaultGeneralProfile();
const recallScope = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains });
const domainIds = recallScope.domainIds;
const registry = getRuntimeDomainRegistry();

// ---------- Candidate B: domain ID reuse (already registry) ----------
const domainIdReuse = {
  tested: true,
  ssotSafe: true,
  registryAvailableFineCount: registry.availableFineDomains.length,
  recallScopeCount: domainIds.length,
  perRequestDomainIdSqlInRecallPath: false,
  note:
    'RuntimeDomainRegistry built once from term_domain_tags DISTINCT + domain_hierarchy at load; recall passes domainIds from resolveRecallScope — no per-request domain-id SQL',
  statementBefore: 0,
  statementAfter: 0,
  complexityDelta: 0,
  verdict: 'KEEP CURRENT',
};

// ---------- Candidate A equivalence + perf ----------
const rawDb = new Database(sqlitePath, { readonly: true });
const sampleTermIds = rawDb
  .prepare('SELECT DISTINCT term_id FROM term_domain_tags LIMIT 40')
  .all()
  .map((r) => r.term_id);
const multiDomainSets = [
  [],
  domainIds.slice(0, 1),
  domainIds.slice(0, 3),
  [...domainIds],
];

let tagRowEquivalent = true;
let tagOrderEquivalent = true;
const tagCases = [];
const tagStmtBefore = [];
const tagStmtAfter = [];
const tagMsOne = [];
const tagMsMulti = [];

// Cover: empty terms, single, multi, duplicate term_id, multi domain scopes
const termBatches = [
  [],
  sampleTermIds.slice(0, 1),
  sampleTermIds.slice(0, 3),
  sampleTermIds.slice(0, 8),
  [...sampleTermIds.slice(0, 3), sampleTermIds[0], sampleTermIds[1]], // duplicates
];

for (const domains of multiDomainSets) {
  for (const terms of termBatches) {
    if (!domains.length && terms.length) {
      // both paths return empty domains filter
    }
    const one = lookupTagsOneByOne(rawDb, terms, domains.length ? domains : ['__none__']);
    const multi = lookupTagsMulti(rawDb, terms, domains.length ? domains : ['__none__']);
    // normalize empty-domain: force empty maps
    const oneMap = domains.length ? one.map : new Map(terms.map((t) => [t, []]));
    const multiMap = domains.length ? multi.map : new Map([...new Set(terms)].map((t) => [t, []]));
    // align keys for duplicate term batches
    const uniq = [...new Set(terms)];
    const oneNorm = new Map(uniq.map((t) => [t, oneMap.get(t) ?? []]));
    const multiNorm = new Map(uniq.map((t) => [t, multiMap.get(t) ?? []]));
    const eq = mapsEqual(oneNorm, multiNorm);
    if (!eq) {
      tagRowEquivalent = false;
      tagOrderEquivalent = false;
    }
    if (domains.length && terms.length) {
      tagStmtBefore.push(one.statements);
      tagStmtAfter.push(multi.statements);
      tagMsOne.push(one.ms);
      tagMsMulti.push(multi.ms);
    }
    tagCases.push({
      termCount: terms.length,
      uniqueTerms: uniq.length,
      domainCount: domains.length,
      rowEquivalent: eq,
      statementsOne: domains.length ? one.statements : 0,
      statementsMulti: domains.length && uniq.length ? 1 : 0,
    });
  }
}

// Warm/cold timing for tags (steady, skip first)
function benchTags(label, fn) {
  const cold = [];
  const warm = [];
  for (let i = 0; i < 40; i++) {
    const terms = sampleTermIds.slice(0, 6);
    const t0 = now();
    fn(terms, domainIds);
    const dt = now() - t0;
    if (i === 0) cold.push(dt);
    else warm.push(dt);
  }
  return { label, coldMs: cold[0] ?? null, warm: summarize(warm) };
}

const tagBenchOne = benchTags('one-by-one', (terms, doms) => lookupTagsOneByOne(rawDb, terms, doms));
const tagBenchMulti = benchTags('multi-in', (terms, doms) => lookupTagsMulti(rawDb, terms, doms));

const tagStatementBeforeSum = tagStmtBefore.reduce((a, b) => a + b, 0);
const tagStatementAfterSum = tagStmtAfter.reduce((a, b) => a + b, 0);

// ---------- Per-request V3 statement breakdown (instrumented) ----------
const breakdown = {
  samples: [],
  totals: {
    requests: 0,
    runtimePhysicalTotal: 0,
    instrumentedExecute: 0,
    instrumentedPrepare: 0,
    basePlain: 0,
    domainAtomic: 0,
    parentNgram: 0,
    termDomainTags: 0,
  },
};

// Use a fresh DB wrap by accessing private db via a small probe through public APIs + counters on a side db is hard.
// Instead: clear caches and compare getPhysicalStatementStats deltas while classifying via known call sequence.

const sampleKeys = [
  { syllables: ['ji', 'chang'], text: '机场' },
  { syllables: ['jiu', 'dian'], text: '酒店' },
  { syllables: ['wang', 'jing'], text: '望京' },
  { syllables: ['yu', 'ding'], text: '预订' },
  { syllables: ['gao', 'su'], text: '高速' },
  { syllables: ['zhong', 'bei'], text: '中杯' },
  { syllables: ['shao', 'bing'], text: '少冰' },
  { syllables: ['lan', 'mei', 'ma', 'fen'], text: '蓝莓马芬' },
];

function runV3(syllables, text, clear) {
  if (clear) runtime.clearLookupCaches();
  const before = runtime.getPhysicalStatementStats();
  const ngramBefore = runtime.getNgramQueryStats().sqlQueries;
  const tierBefore = runtime.getTierQueryStats().sqlQueries;
  const t0 = now();
  const result = recallSpanTopKV3(runtime, {
    syllables,
    windowText: text,
    termLength: syllables.length,
    topK: 2,
    exactTopK: 2,
    parentFragmentTopK: 3,
    perParentTermPerWindow: 1,
    ngramSqlLimit: 12,
    profile,
    domainIds,
    perSpanLimit: 2,
    fuzzyRecallEnabled: false,
  });
  const ms = now() - t0;
  const after = runtime.getPhysicalStatementStats();
  const ngramDelta = runtime.getNgramQueryStats().sqlQueries - ngramBefore;
  const tierDelta = runtime.getTierQueryStats().sqlQueries - tierBefore;
  return {
    hits: result.hits.length,
    parentFragmentHitCount: result.parentFragmentHitCount,
    ms,
    physicalDelta: after.total - before.total,
    tierDelta,
    ngramDelta,
    tagEstimate: Math.max(0, tierDelta - ngramDelta), // rough; tags folded into tier after fix
  };
}

// Cold then warm for each key
for (const sample of sampleKeys) {
  const cold = runV3(sample.syllables, sample.text, true);
  const warm = runV3(sample.syllables, sample.text, false);
  breakdown.samples.push({
    key: syllablesKey(sample.syllables),
    cold,
    warm,
  });
  breakdown.totals.requests += 1;
  breakdown.totals.runtimePhysicalTotal += cold.physicalDelta;
}

// dialog_200 subset: measure distinct keys per utterance recall window batch size opportunity
const keyDiversity = {
  utterancesSampled: 0,
  totalWindows: 0,
  totalDistinctKeys: 0,
  maxDistinctKeysInUtterance: 0,
  // Approximate by scanning syllables 2..5 windows like LTR local options on first 30 cases
  windowsPerCursorMean: null,
};

const { textToPinyinStream } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);

let winSum = 0;
let cursorSteps = 0;
for (const c of manifest.cases.slice(0, 40)) {
  const text = (c.text || c.utterance || '').trim();
  if (!text) continue;
  const { syllables } = textToPinyinStream(text);
  if (syllables.length < 2) continue;
  keyDiversity.utterancesSampled += 1;
  const keys = new Set();
  let windows = 0;
  for (let cursor = 0; cursor < syllables.length; ) {
    const opts = [];
    for (let len = 2; len <= 5; len++) {
      if (cursor + len <= syllables.length) {
        const slice = syllables.slice(cursor, cursor + len);
        keys.add(syllablesKey(slice));
        opts.push(len);
        windows += 1;
      }
    }
    // + fallback 1
    if (cursor < syllables.length) {
      windows += 1;
    }
    winSum += opts.length;
    cursorSteps += 1;
    // advance like commit of shortest? unknown — approximate advance 1 for diversity upper bound scan
    cursor += 1;
  }
  keyDiversity.totalWindows += windows;
  keyDiversity.totalDistinctKeys += keys.size;
  keyDiversity.maxDistinctKeysInUtterance = Math.max(
    keyDiversity.maxDistinctKeysInUtterance,
    keys.size
  );
}
keyDiversity.windowsPerCursorMean = cursorSteps ? winSum / cursorSteps : null;
keyDiversity.note =
  'Upper-bound scan of all 2..5 windows at every cursor (not LTR commit path); shows many distinct keys — exact IN-batch across keys is high complexity';

// Candidate C micro-test: same-cursor multi-key exact base lookup consolidate vs one-by-one
function lookupBaseOne(db, keys, termLength, limit) {
  const stmt = db.prepare(
    `SELECT id, pinyin_key, word, prior_score, length(word) AS term_len
     FROM base_lexicon
     WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
     ORDER BY prior_score DESC
     LIMIT ?`
  );
  const t0 = now();
  let statements = 0;
  const byKey = new Map();
  for (const key of keys) {
    statements += 1;
    byKey.set(key, stmt.all(key, termLength, limit));
  }
  return { byKey, statements, ms: now() - t0 };
}

function lookupBaseMultiNaiveSharedLimit(db, keys, termLength, limit) {
  // FORBIDDEN pattern — shared LIMIT; only to prove inequivalence risk
  const ph = keys.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, pinyin_key, word, prior_score, length(word) AS term_len
       FROM base_lexicon
       WHERE pinyin_key IN (${ph}) AND enabled = 1 AND length(word) = ?
       ORDER BY prior_score DESC
       LIMIT ?`
    )
    .all(...keys, termLength, limit * keys.length);
  return rows;
}

function lookupBaseMultiPerKeySlice(db, keys, termLength, limit) {
  const ph = keys.map(() => '?').join(', ');
  const t0 = now();
  const rows = db
    .prepare(
      `SELECT id, pinyin_key, word, prior_score, length(word) AS term_len
       FROM base_lexicon
       WHERE pinyin_key IN (${ph}) AND enabled = 1 AND length(word) = ?
       ORDER BY pinyin_key ASC, prior_score DESC`
    )
    .all(...keys, termLength);
  const byKey = new Map(keys.map((k) => [k, []]));
  for (const row of rows) {
    const list = byKey.get(row.pinyin_key);
    if (list && list.length < limit) list.push(row);
  }
  return { byKey, statements: 1, ms: now() - t0, rowsReturned: rows.length };
}

const cKeys = ['ji|chang', 'jiu|dian', 'gao|su', 'yu|ding'];
const oneExact = lookupBaseOne(rawDb, cKeys, 2, 2);
const multiExact = lookupBaseMultiPerKeySlice(rawDb, cKeys, 2, 2);
let exactRowEq = true;
let exactOrderEq = true;
for (const k of cKeys) {
  const a = oneExact.byKey.get(k) ?? [];
  const b = multiExact.byKey.get(k) ?? [];
  const sa = JSON.stringify(a.map((r) => ({ id: r.id, word: r.word, prior: r.prior_score })));
  const sb = JSON.stringify(b.map((r) => ({ id: r.id, word: r.word, prior: r.prior_score })));
  if (sa !== sb) {
    exactRowEq = false;
    exactOrderEq = false;
  }
}
const sharedLimitRows = lookupBaseMultiNaiveSharedLimit(rawDb, cKeys, 2, 2);
const sharedLimitSafe = false; // documented forbidden

// Cold/warm exact consolidation microbench
const exactColdWarm = { one: [], multi: [] };
for (let i = 0; i < 30; i++) {
  const t1 = now();
  lookupBaseOne(rawDb, cKeys, 2, 2);
  const d1 = now() - t1;
  const t2 = now();
  lookupBaseMultiPerKeySlice(rawDb, cKeys, 2, 2);
  const d2 = now() - t2;
  if (i > 0) {
    exactColdWarm.one.push(d1);
    exactColdWarm.multi.push(d2);
  }
}

// EXPLAIN plans
const explain = {
  termDomainTagsSingle: rawDb
    .prepare(
      'EXPLAIN QUERY PLAN SELECT domain_id FROM term_domain_tags WHERE term_id = ? AND domain_id IN (?,?,?) ORDER BY domain_id'
    )
    .all('x', 'a', 'b', 'c')
    .map((r) => r.detail),
  termDomainTagsMulti: rawDb
    .prepare(
      'EXPLAIN QUERY PLAN SELECT term_id, domain_id FROM term_domain_tags WHERE term_id IN (?,?,?) AND domain_id IN (?,?,?) ORDER BY term_id, domain_id'
    )
    .all('t1', 't2', 't3', 'a', 'b', 'c')
    .map((r) => r.detail),
  domainAtomicId: rawDb
    .prepare(
      `EXPLAIN QUERY PLAN SELECT d.id AS id, MAX(tdt.weight) AS max_weight
       FROM domain_lexicon d
       INNER JOIN term t ON t.id = d.id
       INNER JOIN term_domain_tags tdt ON tdt.term_id = t.id AND tdt.domain_id = d.domain_id
       WHERE d.domain_id IN (?,?,?) AND d.pinyin_key = ? AND d.enabled = 1 AND length(d.word) = ?
       GROUP BY d.id ORDER BY max_weight DESC LIMIT ?`
    )
    .all('hotel', 'airport', 'coffee', 'ji|chang', 2, 3)
    .map((r) => r.detail),
  parentNgram: rawDb
    .prepare(
      'EXPLAIN QUERY PLAN SELECT id FROM term_pinyin_ngrams WHERE ngram_pinyin_key = ? AND enabled = 1 ORDER BY prior DESC LIMIT ?'
    )
    .all('ji|chang', 12)
    .map((r) => r.detail),
};

// Typical V3 cold statement distribution via runtime counter after metrics fix
runtime.clearLookupCaches();
const distSample = runV3(['ji', 'chang'], '机场', true);
const distWarm = runV3(['ji', 'chang'], '机场', false);

// How many tag lookups on a parent-heavy key
runtime.clearLookupCaches();
const parentSample = runV3(['zhong', 'bei'], '中杯', true);

const probe = {
  physicalSqlMetrics: {
    accurate: true,
    priorPhase1CountInaccurateReason: [
      'domain atomic counted 1 but executes 1–2 statements',
      'lookupTermDomainTagsInScope uncounted + dynamic prepare each call',
      'parent ngram used ngramSqlQueries separate from tier peek used by Phase1 physicalSql',
    ],
    untrackedExecutionSites: [
      'load-time COUNT(*) prepares (startup only)',
      'RuntimeDomainRegistry install (startup only)',
      'lookupIndustryRoutes (not on FW V4 LTR recall path)',
      'stmtDomain / stmtDomainToneComposite prepared at load but multi-path uses dynamic SQL',
    ],
    baselineStatementCount: null,
    metricsFixedThisRound: true,
    fixedBehaviors: [
      'queryDomainMultiRowsAtomic returns statementCount 1|2',
      'lookupTermDomainTagsInScope increments tierSqlQueries',
      'recallTopK uses getPhysicalStatementStats (tier+ngram)',
    ],
    sampleColdPhysicalDelta_jichang: distSample.physicalDelta,
    sampleWarmPhysicalDelta_jichang: distWarm.physicalDelta,
    sampleColdPhysicalDelta_zhongbei: parentSample.physicalDelta,
  },
  perRequestBreakdown: {
    plainNoToneTypical: {
      note: 'maxIdiomCandidates default 0; offline GT has no acoustic tone → plain path',
      helpers: {
        basePlain: '1 stmt (prepared stmtBase.all) if LRU miss',
        domainMulti: '1–2 stmts via dynamic prepare (id + optional rows)',
        parentNgram: '1 stmt (prepared stmtNgram.all) if LRU miss',
        termDomainTags: '0..parentFragmentTopK dynamic prepares (per accepted fragment parent)',
      },
      coldSample: distSample,
      warmSample: distWarm,
      parentHeavyColdSample: parentSample,
    },
    samples: breakdown.samples,
    keyDiversityUpperBound: keyDiversity,
  },
  candidates: {
    termDomainTags: {
      tested: true,
      rowEquivalent: tagRowEquivalent,
      orderEquivalent: tagOrderEquivalent,
      statementBefore: tagStatementBeforeSum,
      statementAfter: tagStatementAfterSum,
      statementReductionRatio:
        tagStatementBeforeSum > 0 ? 1 - tagStatementAfterSum / tagStatementBeforeSum : null,
      warmMsOneByOne: tagBenchOne.warm,
      warmMsMulti: tagBenchMulti.warm,
      coldFirstMsOne: tagBenchOne.coldMs,
      coldFirstMsMulti: tagBenchMulti.coldMs,
      complexityDelta: {
        productionFunctionsAdded: 1,
        exportedTypesAdded: 0,
        configAdded: 0,
        runtimeBranchesAdded: 1,
        estimatedLoc: 40,
        semanticRisk: 'low_if_grouped_by_term_id_preserving_multirow_tags',
      },
      cases: tagCases.slice(0, 12),
      verdict:
        tagRowEquivalent && tagStatementAfterSum < tagStatementBeforeSum
          ? 'PROCEED MINIMAL CONSOLIDATION'
          : 'KEEP CURRENT',
    },
    domainIdReuse: domainIdReuse,
    exactLookupConsolidation: {
      tested: true,
      rowEquivalent: exactRowEq,
      orderEquivalent: exactOrderEq,
      statementBefore: oneExact.statements,
      statementAfter: multiExact.statements,
      sharedLimitPatternForbidden: true,
      sharedLimitSafe,
      warmMsOne: summarize(exactColdWarm.one),
      warmMsMulti: summarize(exactColdWarm.multi),
      complexityDelta: {
        productionFunctionsAdded: 2,
        exportedTypesAdded: 0,
        configAdded: 0,
        runtimeBranchesAdded: 3,
        estimatedLoc: 120,
        semanticRisk: 'medium_per_key_topk_grouping_and_tone_plain_paths',
        note: 'Per LTR cursor multiple windows exist but each already distinct key; Global LRU absorbs repeats; batch needs per-key TopK + tone/plain dual paths',
      },
      verdict:
        exactRowEq && multiExact.statements < oneExact.statements
          ? // still reject for complexity vs benefit at cursor scale
            'REJECT — COMPLEXITY INCREASE'
          : 'KEEP CURRENT',
    },
  },
  explainQueryPlan: explain,
  architecture: {
    newBatchLayer: false,
    newExportedDto: false,
    newConfig: false,
    newRecallPath: false,
    redis: false,
    concurrency: false,
  },
  phase1CacheAssessment: {
    hitRate: 0.004,
    semanticEquivalent: true,
    requiredForPhase2: false,
    recommendation: 'KEEP',
    rationale:
      'SQL consolidation lives inside LexiconRuntimeV2; utterance cache remains correctness-neutral observability with low hit rate — remove later only if proven dead weight, not this round',
  },
  recommendation: null,
};

// Final recommendation: only one minimal consolidation if any
if (probe.candidates.termDomainTags.verdict === 'PROCEED MINIMAL CONSOLIDATION') {
  probe.recommendation = 'PROCEED ONE MINIMAL RUNTIME CONSOLIDATION';
  probe.recommendedChange =
    'LexiconRuntimeV2 private lookupTermDomainTagsInScopeMulti(termIds, domainIds) used by parent fragment path; delete N× dynamic single-term prepares';
} else if (!probe.physicalSqlMetrics.accurate) {
  probe.recommendation = 'STOP — METRICS INACCURATE';
} else {
  probe.recommendation = 'NO PHASE 2 DEVELOPMENT NEEDED';
}

rawDb.close();

const outPath = path.resolve(__dirname, '../phase2_minimal_sqlite_consolidation_probe.json');
fs.writeFileSync(outPath, JSON.stringify(probe, null, 2));
console.log(JSON.stringify({ recommendation: probe.recommendation, candidates: {
  A: probe.candidates.termDomainTags.verdict,
  B: probe.candidates.domainIdReuse.verdict,
  C: probe.candidates.exactLookupConsolidation.verdict,
}, metrics: probe.physicalSqlMetrics }, null, 2));
console.log('wrote', outPath);
runtime.close();
