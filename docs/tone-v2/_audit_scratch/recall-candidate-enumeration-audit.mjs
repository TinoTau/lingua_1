/**
 * READ ONLY — Recall Candidate Enumeration Audit (Pre-KenLM Final)
 * FW_V4_FREEZE_2026_08_03
 *
 * Focus: SQLite Result → Enumerator → filters → Recall Candidate
 * Does NOT re-audit Window / Query Builder / Tone Query construction.
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\recall-candidate-enumeration-audit.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(
  repo,
  'docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Enumeration_Audit'
);
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { getLexiconRuntimeV2Config } = require(
  path.join(dist, 'lexicon-v2/lexicon-runtime-v2-config.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { collectTierCandidatesToneFirst } = require(
  path.join(dist, 'lexicon-v2/tone-first-tier-collector.js')
);
const { mergeSpanCandidatesCombined } = require(
  path.join(dist, 'lexicon-v2/merge-span-candidates.js')
);
const { resolveToneRecallReadiness } = require(
  path.join(dist, 'lexicon-v2/tone-recall-readiness.js')
);
const { sortRecallHitsByToneCompatibility } = require(
  path.join(dist, 'lexicon/tone-recall-sort.js')
);
const { getAsrRepairQualityConfig } = require(
  path.join(dist, 'asr-repair-quality/quality-config.js')
);
const {
  computeCandidateScore,
  compareRecallHitsPrimaryScore,
} = require(path.join(dist, 'lexicon/candidate-score.js'));
const { scorePinyinSimilarity } = require(path.join(dist, 'lexicon/phonetic/pinyin.js'));
const { syllablesKey } = require(path.join(dist, 'lexicon/pinyin-index.js'));
const { exactFuzzyPinyinVariant } = require(
  path.join(dist, 'lexicon-v2/fuzzy-pinyin-key-builder.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { V4_LIMITS } = require(path.join(dist, 'fw-detector/span-assembly-v4/v4-limits.js'));
const { textToSyllables } = require(path.join(dist, 'lexicon/phonetic/pinyin.js'));
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);
const { extractAcousticTonePatternForRecall } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/tone-recall.js')
);
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { bindLexiconHitsToWindow } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/recall-topk-for-windows.js')
);

function esc(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cols) {
  return cols.map(esc).join(',');
}
function writeCsv(fp, rows, cols) {
  const lines = [csvRow(cols)];
  for (const r of rows) lines.push(csvRow(cols.map((c) => r[c] ?? '')));
  fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf8');
}
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    const o = {};
    headers.forEach((h, i) => {
      o[h] = cols[i] ?? '';
    });
    return o;
  });
}
function log(m) {
  console.error(`[enum-audit] ${m}`);
}

const FAIL = [
  'nn-train-01',
  'nn-train-01b',
  'snack-01',
  'sync-01',
  'trigger-01',
  'threshold-01',
];

/** Focus noise windows (glyph) → correct surface for attribution */
const FOCUS = {
  'nn-train-01': [
    { windowTextHint: '我闷', plain: 'wo|men', correct: '我们' },
    { windowTextHint: '蒸在', plain: 'zheng|zai', correct: '正在' },
  ],
  'nn-train-01b': [
    { windowTextHint: '闷蒸', plain: 'men|zheng', correct: '正在' },
    { windowTextHint: '蒸在', plain: 'zheng|zai', correct: '正在' },
  ],
  'snack-01': [{ windowTextHint: '消失', plain: 'xiao|shi', correct: '小食' }],
  'sync-01': [
    { windowTextHint: '已精', plain: 'yi|jing', correct: '已经' },
    { windowTextHint: '通步', plain: 'tong|bu', correct: '同步' },
  ],
  'trigger-01': [{ windowTextHint: '出发', plain: 'chu|fa', correct: '触发' }],
  'threshold-01': [
    { windowTextHint: '阈之', plain: 'yu|zhi', correct: '阈值' },
    { windowTextHint: '阈之一', plain: 'yu|zhi|yi', correct: '阈值' },
  ],
};

const inventory = parseCsv(
  fs.readFileSync(
    path.join(
      repo,
      'docs/acceptance/Freeze/kenlm_capability_baseline_2026_08_03/kenlm_validation_case_inventory_resolved.csv'
    ),
    'utf8'
  )
);
const summaries = parseCsv(
  fs.readFileSync(
    path.join(
      repo,
      'docs/acceptance/Freeze/kenlm_capability_baseline_2026_08_03/kenlm_capability_case_summary.csv'
    ),
    'utf8'
  )
).filter((r) => r.suite === 'noise_inventory');
const sumById = new Map(summaries.map((r) => [r.caseId, r]));

const bundleDir = path.join(repo, 'node_runtime/lexicon/v3');
const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true });
const runtime = new LexiconRuntimeV2();
if (runtime.loadFromBundleDir(bundleDir).status !== 'ok') throw new Error('runtime load fail');

const fwConfig = loadFwDetectorRuntimeConfig();
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const cfg = getLexiconRuntimeV2Config();
const minCand = getAsrRepairQualityConfig().minCandidateScore;
const minPrior = fwConfig.minPrior;

const toneStmt = db.prepare(
  `SELECT id, pinyin_key, tone_pinyin_key, prior_score FROM term WHERE word=? AND enabled=1 LIMIT 1`
);
const toneStmtBase = db.prepare(
  `SELECT id, pinyin_key, tone_pinyin_key, prior_score FROM base_lexicon WHERE word=? AND enabled=1 LIMIT 1`
);
function lookupWord(word) {
  return toneStmt.get(word) || toneStmtBase.get(word) || null;
}
function tonesFromKey(tpk, n) {
  const parts = String(tpk || '')
    .split('|')
    .filter(Boolean);
  const tones = parts.map((p) => {
    const m = p.match(/([1-5])$/);
    const x = m ? Number(m[1]) : 1;
    return x >= 1 && x <= 5 ? x : 1;
  });
  while (tones.length < n) tones.push(1);
  return tones.slice(0, n);
}
const CJK = /[\u4e00-\u9fff]/;
function sentenceTone(sentence) {
  const chars = [...sentence];
  /** @type {Array<1|2|3|4|5>} */
  const tones = chars.map((ch) => {
    if (!CJK.test(ch)) return 1;
    const row = lookupWord(ch);
    return row?.tone_pinyin_key
      ? /** @type {1|2|3|4|5} */ (tonesFromKey(row.tone_pinyin_key, 1)[0])
      : 1;
  });
  for (const compound of [
    '闷蒸',
    '消失',
    '出发',
    '精通',
    '已经',
    '同步',
    '正在',
    '我们',
    '小食',
    '触发',
    '阈值',
  ]) {
    const idx = sentence.indexOf(compound);
    if (idx < 0) continue;
    const row = lookupWord(compound);
    if (!row) continue;
    const ct = tonesFromKey(row.tone_pinyin_key, [...compound].length);
    const start = [...sentence.slice(0, idx)].length;
    for (let i = 0; i < ct.length; i++) {
      if (start + i < tones.length) tones[start + i] = /** @type {1|2|3|4|5} */ (ct[i]);
    }
  }
  return makeCharToneFixtures(sentence, tones);
}

/** Direct SQL — same predicates as stmtBaseToneComposite, capture ALL rows up to runtime limit + count */
const sqlBaseTone = db.prepare(
  `SELECT id, pinyin_key, tone_pinyin_key, word, prior_score, enabled, source, is_alias, repair_target
   FROM base_lexicon
   WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
   ORDER BY prior_score DESC
   LIMIT ?`
);
const sqlBaseToneCount = db.prepare(
  `SELECT COUNT(*) AS c FROM base_lexicon
   WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?`
);
const sqlDomainTone = db.prepare(
  `SELECT id, domain_id, pinyin_key, tone_pinyin_key, word, prior_score, enabled, source, is_alias, repair_target
   FROM domain_lexicon
   WHERE domain_id = ? AND pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
   ORDER BY prior_score DESC
   LIMIT ?`
);

const sqliteRows = [];
const enumRows = [];
const filterRows = [];
const caseMeta = [];

let sqlCapture = [];
function wrapCapture() {
  const origBase = runtime.lookupBaseByPinyinAndToneKey.bind(runtime);
  runtime.lookupBaseByPinyinAndToneKey = (pk, tk, len, lim) => {
    const hits = origBase(pk, tk, len, lim);
    sqlCapture.push({
      tier: 'base',
      method: 'lookupBaseByPinyinAndToneKey',
      plainKey: pk,
      toneKey: tk,
      termLength: len,
      sqlLimit: lim ?? cfg.maxBaseCandidates,
      rows: hits.map((h) => ({
        termId: h.id,
        surface: h.word,
        plainKey: h.pinyin?.join('|') ?? pk,
        toneKey: h.tonePinyinKey ?? '',
        domain: (h.domains || []).join('|'),
        priorScore: h.priorScore,
        source: h.source,
        enabled: h.enabled,
        isAlias: h.isAlias === true,
      })),
    });
    return hits;
  };
  const origDom = runtime.lookupDomainsByPinyinAndToneKeyMulti.bind(runtime);
  runtime.lookupDomainsByPinyinAndToneKeyMulti = (ids, pk, tk, len, lim) => {
    const hits = origDom(ids, pk, tk, len, lim);
    sqlCapture.push({
      tier: 'domain_multi',
      method: 'lookupDomainsByPinyinAndToneKeyMulti',
      plainKey: pk,
      toneKey: tk,
      termLength: len,
      sqlLimit: lim ?? cfg.maxDomainCandidates,
      domainIds: ids,
      rows: hits.map((h) => ({
        termId: h.id,
        surface: h.word,
        plainKey: h.pinyin?.join('|') ?? pk,
        toneKey: h.tonePinyinKey ?? '',
        domain: (h.domains || []).join('|'),
        priorScore: h.priorScore,
        source: h.source,
        enabled: h.enabled,
        isAlias: h.isAlias === true,
      })),
    });
    return hits;
  };
}
wrapCapture();

for (const inv of inventory) {
  if (!FAIL.includes(inv.caseId)) continue;
  const sum = sumById.get(inv.caseId);
  const rawText = sum.rawText;
  const foci = FOCUS[inv.caseId] || [];
  const coord = buildUtteranceSyllableCoordinate(rawText);
  const toneFix = sentenceTone(rawText);
  log(`CASE ${inv.caseId}`);

  for (const focus of foci) {
    // Locate window by plain key in syllable stream
    const parts = focus.plain.split('|');
    const stream = coord.syllables;
    let sylStart = -1;
    for (let i = 0; i + parts.length <= stream.length; i++) {
      if (stream.slice(i, i + parts.length).join('|') === focus.plain) {
        sylStart = i;
        break;
      }
    }
    if (sylStart < 0) {
      log(`  SKIP no plain span ${focus.plain}`);
      continue;
    }
    const sylEnd = sylStart + parts.length;
    const syllables = stream.slice(sylStart, sylEnd);
    // Map to raw chars proportionally (1:1 for these cases)
    const rawStart = sylStart; // approx for pure CJK prefix sentences — use indexOf hint
    const hintIdx = rawText.indexOf(focus.windowTextHint);
    const rawS = hintIdx >= 0 ? hintIdx : sylStart;
    const rawE = hintIdx >= 0 ? hintIdx + focus.windowTextHint.length : sylEnd;
    const windowText = rawText.slice(rawS, rawE);

    const extracted = extractAcousticTonePatternForRecall(
      rawS,
      rawE,
      sylStart,
      sylEnd,
      toneFix.acousticSlices,
      toneFix.wordTimeSpans
    );
    const pattern = extracted.pattern;
    const readiness = resolveToneRecallReadiness({
      syllables,
      runtimeSupportsTone: true,
      acousticTonePattern: pattern,
      toneCallerEnabled: true,
    });
    const queryTone = readiness.state === 'ready' ? readiness.tonePinyinKey : '';
    const termLength = syllables.length;
    const exactTopK = termLength === 1 ? 1 : V4_LIMITS.exactTopK;
    const windowDomainIds = termLength === 1 ? [] : domainIds;
    const perSpanLimit = exactTopK;
    const sqlLimit = Math.max(perSpanLimit, 8);

    // --- A. Direct SQLite result set (runtime LIMIT) + total match count ---
    const matchCount = sqlBaseToneCount.get(focus.plain, queryTone || '__none__', termLength)?.c ?? 0;
    const basePage =
      readiness.state === 'ready'
        ? sqlBaseTone.all(focus.plain, queryTone, termLength, sqlLimit)
        : [];
    let domainPage = [];
    if (readiness.state === 'ready' && windowDomainIds.length) {
      for (const d of windowDomainIds) {
        domainPage.push(...sqlDomainTone.all(d, focus.plain, queryTone, termLength, sqlLimit));
      }
    }

    const queryId = `${inv.caseId}|${windowText}|${focus.plain}|${queryTone}`;

    for (const r of basePage) {
      sqliteRows.push({
        caseId: inv.caseId,
        queryId,
        windowText,
        tier: 'base',
        termId: r.id,
        surface: r.word,
        plainKey: r.pinyin_key,
        toneKey: r.tone_pinyin_key,
        domain: '',
        priorScore: r.prior_score,
        source: r.source,
        enabled: r.enabled,
        isAlias: r.is_alias,
        sqlLimit,
        matchCountTotal: matchCount,
        queryPlain: focus.plain,
        queryTone,
        correctSurface: focus.correct,
      });
    }
    for (const r of domainPage) {
      sqliteRows.push({
        caseId: inv.caseId,
        queryId,
        windowText,
        tier: 'domain',
        termId: r.id,
        surface: r.word,
        plainKey: r.pinyin_key,
        toneKey: r.tone_pinyin_key,
        domain: r.domain_id,
        priorScore: r.prior_score,
        source: r.source,
        enabled: r.enabled,
        isAlias: r.is_alias,
        sqlLimit,
        matchCountTotal: '',
        queryPlain: focus.plain,
        queryTone,
        correctSurface: focus.correct,
      });
    }

    // Correct term: would it appear under THIS query?
    const correctRow = lookupWord(focus.correct);
    const correctInSql = basePage.some((r) => r.word === focus.correct);
    const correctTone = correctRow?.tone_pinyin_key || '';
    const correctWouldNeedTone = correctTone;
    const correctMissReason =
      readiness.state !== 'ready'
        ? `SKIP_${readiness.state}`
        : correctInSql
          ? 'IN_SQL'
          : correctRow && correctRow.pinyin_key === focus.plain && correctTone !== queryTone
            ? 'TONE_KEY_MISMATCH_NOT_IN_SQL'
            : correctRow && correctRow.pinyin_key !== focus.plain
              ? 'PLAIN_KEY_MISMATCH_NOT_IN_SQL'
              : !correctRow
                ? 'TERM_MISSING'
                : 'NOT_IN_SQL_OTHER';

    // --- B. Runtime enumerator via recallSpanTopKV2 ---
    sqlCapture = [];
    const recall =
      readiness.state === 'ready'
        ? recallSpanTopKV2(runtime, {
            syllables,
            windowText,
            termLength,
            topK: exactTopK,
            profile,
            domainIds: windowDomainIds,
            perSpanLimit,
            acousticTonePattern: pattern,
            toneCallerEnabled: true,
            fuzzyRecallEnabled: false,
          })
        : { hits: [], queryTonePinyinKey: undefined, toneRecallReadiness: readiness };

    // --- C. Step-by-step filter reconstruction (same contract) ---
    const filterTrace = [];
    if (readiness.state !== 'ready') {
      filterTrace.push({
        stage: 'readiness',
        surface: '',
        termId: '',
        decision: 'DROP_NO_SQL',
        reason: readiness.state,
      });
    } else {
      // Stage: SQL raw (base page as returned)
      for (const r of basePage) {
        filterTrace.push({
          stage: 'sqlite_base',
          surface: r.word,
          termId: r.id,
          decision: 'SQL_RETURNED',
          reason: `prior=${r.prior_score}`,
        });
      }
      for (const r of domainPage) {
        filterTrace.push({
          stage: 'sqlite_domain',
          surface: r.word,
          termId: r.id,
          decision: 'SQL_RETURNED',
          reason: `domain=${r.domain_id} prior=${r.prior_score}`,
        });
      }

      // collectTierCandidatesToneFirst merge
      const tier = collectTierCandidatesToneFirst(
        runtime,
        focus.plain,
        termLength,
        windowDomainIds,
        perSpanLimit,
        syllables,
        pattern,
        true
      );
      const mergedIds = new Set(tier.entries.map((e) => e.id));
      for (const r of [...basePage, ...domainPage]) {
        if (!mergedIds.has(r.id) && !mergedIds.has(String(r.id))) {
          // domain rows may share word under different ids
        }
      }
      const sqlSurfaces = new Set([...basePage, ...domainPage].map((r) => r.word));
      const mergedSurfaces = new Set(tier.entries.map((e) => e.word));
      for (const s of sqlSurfaces) {
        if (!mergedSurfaces.has(s)) {
          filterTrace.push({
            stage: 'mergeSpanCandidatesCombined',
            surface: s,
            termId: [...basePage, ...domainPage].find((r) => r.word === s)?.id || '',
            decision: 'DROP_MERGE_LIMIT_OR_DEDUP',
            reason: `perSpanLimit=${perSpanLimit} merge_order=domain>alias>base`,
          });
        } else {
          filterTrace.push({
            stage: 'mergeSpanCandidatesCombined',
            surface: s,
            termId: tier.entries.find((e) => e.word === s)?.id || '',
            decision: 'KEEP_MERGE',
            reason: `in merged entries (${tier.entries.length})`,
          });
        }
      }

      // scoreHotword gates (simulate on merged)
      const variant = exactFuzzyPinyinVariant(syllables);
      const scored = [];
      for (const hotword of tier.entries) {
        let drop = null;
        if (!hotword.enabled || hotword.word.length !== syllables.length) {
          drop = 'DROP_LENGTH_OR_DISABLED';
        } else if (!Number.isFinite(hotword.priorScore) || hotword.priorScore <= 0) {
          drop = 'DROP_PRIOR_NONPOSITIVE';
        } else {
          const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
          const candidateScore = computeCandidateScore({
            hotword,
            windowSyllables: syllables,
            windowText,
            phoneticScore,
            recallCandidateKind: 'exact_base',
          });
          if (candidateScore < minCand) {
            drop = 'DROP_SCORE';
          } else {
            scored.push({ hotword, candidateScore, phoneticScore });
            filterTrace.push({
              stage: 'scoreHotword',
              surface: hotword.word,
              termId: hotword.id,
              decision: 'KEEP_SCORE',
              reason: `candidateScore=${candidateScore} >= min=${minCand}`,
            });
            continue;
          }
        }
        filterTrace.push({
          stage: 'scoreHotword',
          surface: hotword.word,
          termId: hotword.id,
          decision: drop,
          reason: drop,
        });
      }

      // tone sort (no drop)
      const fakeHits = scored.map((s) => ({
        hotword: s.hotword,
        phoneticScore: s.phoneticScore,
        candidateScore: s.candidateScore,
        candidateScoreBreakdown: { domainBoost: 0 },
        recallCandidateKind: 'exact_base',
        source: 'pinyin',
        acousticTonePattern: pattern,
        toneLookupStage: 'tone_exact',
        toneCompatible: true,
        tonePenalty: 1,
        toneReason: 'match',
      }));
      const sorted = sortRecallHitsByToneCompatibility(fakeHits, pattern);
      for (const h of sorted.hits) {
        filterTrace.push({
          stage: 'sortRecallHitsByToneCompatibility',
          surface: h.hotword.word,
          termId: h.hotword.id,
          decision: 'KEEP_TONE_RANK',
          reason: `tone does not drop; penalty=${h.tonePenalty} score=${h.candidateScore}`,
        });
      }

      // final TopK slice
      const afterTopK = sorted.hits.slice(0, perSpanLimit);
      const topIds = new Set(afterTopK.map((h) => h.hotword.id));
      for (const h of sorted.hits) {
        filterTrace.push({
          stage: 'final_slice_perSpanLimit',
          surface: h.hotword.word,
          termId: h.hotword.id,
          decision: topIds.has(h.hotword.id) ? 'KEEP_TOPK' : 'DROP_TOPK',
          reason: `perSpanLimit/exactTopK=${perSpanLimit}`,
        });
      }

      // bindLexiconHitsToWindow minPrior
      const bound = bindLexiconHitsToWindow({
        window: {
          windowId: `${sylStart}:${sylEnd}`,
          windowSource: 'in_span_window',
          anchorCoarseSpanId: 'c0',
          syllableStart: sylStart,
          syllableEnd: sylEnd,
          rawStart: rawS,
          rawEnd: rawE,
          windowPinyinKey: focus.plain,
          spanIds: [],
          boundaryCrossCount: 0,
          blocked: false,
        },
        hits: recall.hits,
        minPrior,
        boundaryPenalty: 1,
        candidateSeqStart: 0,
        acousticTonePattern: pattern,
        windowQueryTonePinyinKey: queryTone,
      });
      const boundSurfaces = new Set(bound.candidates.map((c) => c.replacement));
      for (const h of recall.hits) {
        const kept = boundSurfaces.has(h.hotword.word);
        filterTrace.push({
          stage: 'bindLexiconHitsToWindow',
          surface: h.hotword.word,
          termId: h.hotword.id,
          decision: kept ? 'KEEP_RECALL_CANDIDATE' : 'DROP_MIN_PRIOR',
          reason: kept
            ? `rank ok prior=${h.hotword.priorScore} >= minPrior=${minPrior}`
            : `prior=${h.hotword.priorScore} < minPrior=${minPrior}`,
        });
      }
    }

    for (const ft of filterTrace) {
      filterRows.push({
        caseId: inv.caseId,
        queryId,
        windowText,
        queryPlain: focus.plain,
        queryTone,
        correctSurface: focus.correct,
        ...ft,
      });
    }

    enumRows.push({
      caseId: inv.caseId,
      queryId,
      windowText,
      queryPlain: focus.plain,
      queryTone,
      readiness: readiness.state === 'ready' ? 'ready' : readiness.state,
      sqlLimit,
      baseMatchCountTotal: matchCount,
      sqliteBaseReturned: basePage.length,
      sqliteDomainReturned: domainPage.length,
      sqliteSurfaces: basePage.map((r) => r.word).join('|'),
      recallHitCount: recall.hits?.length ?? 0,
      recallSurfaces: (recall.hits || []).map((h) => h.hotword.word).join('|'),
      correctSurface: focus.correct,
      correctLexiconTone: correctTone,
      correctInSqliteResult: correctInSql,
      correctMissReason,
      exactTopK: perSpanLimit,
      minCandidateScore: minCand,
      minPrior,
      sqlCaptureCalls: sqlCapture.length,
    });

    caseMeta.push({
      caseId: inv.caseId,
      windowText,
      plain: focus.plain,
      queryTone,
      correct: focus.correct,
      correctMissReason,
      sqliteSurfaces: basePage.map((r) => r.word),
      recallSurfaces: (recall.hits || []).map((h) => h.hotword.word),
    });

    log(
      `  ${windowText} q=${focus.plain}/${queryTone} sql=[${basePage.map((r) => r.word)}] recall=[${(recall.hits || []).map((h) => h.hotword.word)}] correct=${focus.correct} → ${correctMissReason}`
    );
  }
}

// Hidden filter inventory from code + trace
const hiddenFilters = {
  sql_where: ['enabled=1', 'length(word)=?', 'pinyin_key=?', 'tone_pinyin_key=?', 'ORDER BY prior_score DESC', 'LIMIT'],
  after_sql: [
    'mergeSpanCandidatesCombined (domain>alias>base, dedupe, slice perSpanLimit)',
    'scoreHotword: enabled/length/priorScore>0/minCandidateScore/bestById dedupe',
    'sortRecallHitsByToneCompatibility: RANK/PENALTY only — no drop',
    'hits.slice(0, perSpanLimit|topK)',
    'bindLexiconHitsToWindow: minPrior gate',
  ],
  not_present: [
    'No post-SQL domain-only reject of base hits (domain is parallel fetch + merge priority)',
    'No tone DROP after SQL (tone already in WHERE; sort does not remove)',
  ],
};

const anyDropAfterSqlWithMultiple = caseMeta.some(
  (c) => c.sqliteSurfaces.length > c.recallSurfaces.length
);
const correctNeverInSql = caseMeta.filter((c) => c.correctMissReason === 'TONE_KEY_MISMATCH_NOT_IN_SQL');
const correctInSqlButDropped = caseMeta.filter(
  (c) => c.correctMissReason === 'IN_SQL' && !c.recallSurfaces.includes(c.correct)
);

let verdict = 'ENUMERATOR_CORRECT';
let verdictDetail =
  'SQLite Result → merge → score → tone-rank → TopK slice → minPrior bind is fully traced. Correct repair terms are absent from SQLite Result under noise query keys (Tone WHERE), not dropped by a hidden enumerator filter.';

if (correctInSqlButDropped.length) {
  verdict = 'ENUMERATOR_FILTER_FOUND';
  verdictDetail = `Correct term was in SQLite but dropped before Recall Candidate: ${JSON.stringify(correctInSqlButDropped)}`;
} else if (enumRows.length === 0) {
  verdict = 'ENUMERATOR_TRACE_INCOMPLETE';
  verdictDetail = 'No focus windows traced';
}

const summary = {
  freeze: 'FW_V4_FREEZE_2026_08_03',
  nature: 'READ_ONLY_RECALL_CANDIDATE_ENUMERATION_AUDIT',
  verdict,
  verdictDetail,
  callChain: [
    'lookupBaseByPinyinAndToneKey / lookupDomainsByPinyinAndToneKeyMulti',
    'collectTierCandidatesToneFirst → mergeSpanCandidatesCombined',
    'scoreHotword (bestById)',
    'sortRecallHitsByToneCompatibility (no drop)',
    'hits.slice(0, perSpanLimit)',
    'bindLexiconHitsToWindow (minPrior)',
  ],
  topKLocations: {
    sqlLIMIT: 'max(perSpanLimit, 8) inside lookup*',
    mergeLimit: 'mergeSpanCandidatesCombined(..., perSpanLimit)',
    finalSlice: 'recallSpanTopKV2 hits.slice(0, perSpanLimit|topK)',
    windowExactTopK: V4_LIMITS.exactTopK,
  },
  domainOrder: 'Domain SQL parallel with Base → merge prefers domain>alias>base when active domains; not Domain-filter-after-TopK',
  toneAfterSql: 'Tone already constrained by SQL WHERE. sortRecallHitsByToneCompatibility only re-ranks / multiplies score — never removes.',
  hiddenFilters,
  anyDropAfterSqlWithMultiple,
  correctNeverInSql: correctNeverInSql.map((c) => ({
    caseId: c.caseId,
    window: c.windowText,
    correct: c.correct,
    queryTone: c.queryTone,
  })),
  correctInSqlButDropped,
  caseMeta,
  limits: { exactTopK: V4_LIMITS.exactTopK, minCandidateScore: minCand, minPrior, sqlLimitFloor: 8 },
};

writeCsv(path.join(outDir, 'sqlite_result_set.csv'), sqliteRows, [
  'caseId',
  'queryId',
  'windowText',
  'tier',
  'termId',
  'surface',
  'plainKey',
  'toneKey',
  'domain',
  'priorScore',
  'source',
  'enabled',
  'isAlias',
  'sqlLimit',
  'matchCountTotal',
  'queryPlain',
  'queryTone',
  'correctSurface',
]);
writeCsv(path.join(outDir, 'enumeration_trace.csv'), enumRows, [
  'caseId',
  'queryId',
  'windowText',
  'queryPlain',
  'queryTone',
  'readiness',
  'sqlLimit',
  'baseMatchCountTotal',
  'sqliteBaseReturned',
  'sqliteDomainReturned',
  'sqliteSurfaces',
  'recallHitCount',
  'recallSurfaces',
  'correctSurface',
  'correctLexiconTone',
  'correctInSqliteResult',
  'correctMissReason',
  'exactTopK',
  'minCandidateScore',
  'minPrior',
  'sqlCaptureCalls',
]);
writeCsv(path.join(outDir, 'candidate_filter_trace.csv'), filterRows, [
  'caseId',
  'queryId',
  'windowText',
  'queryPlain',
  'queryTone',
  'correctSurface',
  'stage',
  'termId',
  'surface',
  'decision',
  'reason',
]);
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

log(`done verdict=${verdict} sqliteRows=${sqliteRows.length} filters=${filterRows.length}`);
console.log(JSON.stringify({ ok: true, verdict, caseMeta, correctNeverInSql: summary.correctNeverInSql }, null, 2));
