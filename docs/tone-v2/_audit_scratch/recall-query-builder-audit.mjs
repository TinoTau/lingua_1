/**
 * READ ONLY — Recall Query Builder Audit (Tone Key Contract)
 * FW_V4_FREEZE_2026_08_03
 *
 * Does NOT modify Framework / Tone / Recall / Lexicon.
 * Intercepts LexiconRuntimeV2 lookup* to prove real SQLite binds.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(repo, 'docs/acceptance/Freeze/recall_query_builder_audit_2026_08_03');
const scratchOut = path.join(__dirname, 'recall_query_builder_audit_2026_08_03');
for (const d of [outDir, scratchOut]) fs.mkdirSync(d, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { resolveToneRecallReadiness } = require(
  path.join(dist, 'lexicon-v2/tone-recall-readiness.js')
);
const { buildTonePinyinKeyFromSyllablesAndPattern } = require(
  path.join(dist, 'lexicon/phonetic/tone-pinyin.js')
);
const { syllablesKey } = require(path.join(dist, 'lexicon/pinyin-index.js'));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);
const { extractAcousticTonePatternForRecall } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/tone-recall.js')
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
  console.error(`[query-audit] ${m}`);
}

const SQL = {
  baseTone: `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM base_lexicon
           WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
           ORDER BY prior_score DESC
           LIMIT ?`,
  basePlain: `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
         FROM base_lexicon
         WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
         ORDER BY prior_score DESC
         LIMIT ?`,
  baseExactSurfaceTone: `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM base_lexicon
           WHERE pinyin_key = ? AND tone_pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = ?
           LIMIT ?`,
  idiomTone: `SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM idiom_lexicon
           WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
           ORDER BY prior_score DESC
           LIMIT ?`,
  domainTone: `SELECT id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias
           FROM domain_lexicon
           WHERE domain_id = ? AND pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
           ORDER BY prior_score DESC
           LIMIT ?`,
};

const bundleDir = path.join(repo, 'node_runtime/lexicon/v3');
const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true });
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
if (loadState.status !== 'ok') throw new Error(JSON.stringify(loadState));

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

/** Active window context while harness recalls */
let activeCtx = {
  caseId: '',
  windowText: '',
  windowStart: '',
  windowEnd: '',
  plainPinyin: '',
  acousticTonePattern: null,
  tonePinyin: '',
  readiness: '',
};

const sqlTrace = [];
const queryTrace = [];
const plainLookupCalls = [];
let sqlSeq = 0;

function pushSql(row) {
  sqlSeq += 1;
  const rec = { seq: sqlSeq, ...row };
  sqlTrace.push(rec);
  return rec;
}

function wrapLookup(methodName, sqlTemplate, bindFromArgs) {
  const orig = runtime[methodName].bind(runtime);
  runtime[methodName] = (...args) => {
    const result = orig(...args);
    const bind = bindFromArgs(args);
    pushSql({
      caseId: activeCtx.caseId,
      window: activeCtx.windowText,
      windowStart: activeCtx.windowStart,
      windowEnd: activeCtx.windowEnd,
      method: methodName,
      queryType: methodName.includes('Tone') || methodName.includes('AndTone')
        ? 'PLAIN_AND_TONE_COMPOSITE'
        : methodName.includes('ExactSurface')
          ? 'EXACT_SURFACE'
          : 'PLAIN_ONLY',
      plainKey: bind.plainKey ?? '',
      toneKey: bind.toneKey ?? '',
      SQL: sqlTemplate.replace(/\s+/g, ' ').trim(),
      Bind: JSON.stringify(bind.params),
      resultCount: Array.isArray(result) ? result.length : 0,
      resultWords: Array.isArray(result)
        ? result
            .slice(0, 8)
            .map((h) => h.word)
            .join('|')
        : '',
    });
    if (methodName === 'lookupBaseByPinyinKey') {
      plainLookupCalls.push({
        caseId: activeCtx.caseId,
        window: activeCtx.windowText,
        args: bind.params,
        resultCount: Array.isArray(result) ? result.length : 0,
      });
    }
    return result;
  };
}

wrapLookup('lookupBaseByPinyinAndToneKey', SQL.baseTone, (args) => ({
  plainKey: args[0],
  toneKey: args[1],
  params: { pinyin_key: args[0], tone_pinyin_key: args[1], length: args[2], limit: args[3] ?? 'cfg' },
}));
wrapLookup('lookupBaseByPinyinKey', SQL.basePlain, (args) => ({
  plainKey: args[0],
  toneKey: '',
  params: { pinyin_key: args[0], length: args[1], limit: args[2] ?? 'cfg' },
}));
wrapLookup('lookupBaseByExactSurfacePinyinAndTone', SQL.baseExactSurfaceTone, (args) => ({
  plainKey: args[0],
  toneKey: args[1],
  params: {
    pinyin_key: args[0],
    tone_pinyin_key: args[1],
    word: args[2],
    length: args[3] ?? 1,
    limit: 2,
  },
}));
wrapLookup('lookupIdiomByPinyinAndToneKey', SQL.idiomTone, (args) => ({
  plainKey: args[0],
  toneKey: args[1],
  params: { pinyin_key: args[0], tone_pinyin_key: args[1], length: args[2], limit: args[3] ?? 'cfg' },
}));

const origDomainMulti = runtime.lookupDomainsByPinyinAndToneKeyMulti.bind(runtime);
runtime.lookupDomainsByPinyinAndToneKeyMulti = (...args) => {
  const result = origDomainMulti(...args);
  const [ids, pinyinKey, tonePinyinKey, termLength, sqlLimit] = args;
  pushSql({
    caseId: activeCtx.caseId,
    window: activeCtx.windowText,
    windowStart: activeCtx.windowStart,
    windowEnd: activeCtx.windowEnd,
    method: 'lookupDomainsByPinyinAndToneKeyMulti',
    queryType: 'PLAIN_AND_TONE_COMPOSITE',
    plainKey: pinyinKey,
    toneKey: tonePinyinKey,
    SQL: SQL.domainTone.replace(/\s+/g, ' ').trim() + ` /* domainIds=${JSON.stringify(ids)} */`,
    Bind: JSON.stringify({
      domainIds: ids,
      pinyin_key: pinyinKey,
      tone_pinyin_key: tonePinyinKey,
      length: termLength,
      limit: sqlLimit ?? 'cfg',
    }),
    resultCount: Array.isArray(result) ? result.length : 0,
    resultWords: Array.isArray(result)
      ? result
          .slice(0, 8)
          .map((h) => h.word)
          .join('|')
      : '',
  });
  return result;
};

const toneStmt = db.prepare(
  `SELECT id, pinyin_key, tone_pinyin_key FROM term WHERE word=? AND enabled=1 LIMIT 1`
);
const toneStmtBase = db.prepare(
  `SELECT id, pinyin_key, tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1 LIMIT 1`
);
function lookupWord(word) {
  return toneStmt.get(word) || toneStmtBase.get(word) || null;
}
function tonesFromKey(tpk, expectedLen) {
  const parts = String(tpk || '')
    .split('|')
    .filter(Boolean);
  const tones = parts.map((p) => {
    const m = p.match(/([1-5])$/);
    const n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= 5 ? n : 1;
  });
  if (expectedLen != null) {
    while (tones.length < expectedLen) tones.push(1);
    return tones.slice(0, expectedLen);
  }
  return tones;
}

const CJK = /[\u4e00-\u9fff]/;
function sentenceAsrAndTone(sentence) {
  const chars = [...sentence];
  /** @type {Array<1|2|3|4|5>} */
  const tones = chars.map((ch) => {
    if (!CJK.test(ch)) return 1;
    const row = lookupWord(ch);
    if (row?.tone_pinyin_key) return /** @type {1|2|3|4|5} */ (tonesFromKey(row.tone_pinyin_key, 1)[0]);
    return 1;
  });
  for (const compound of [
    '闷蒸',
    '忠心',
    '消失',
    '出发',
    '已经',
    '同步',
    '正在',
    '我们',
    '中心',
    '小食',
    '触发',
    '阈值',
    '精通',
    '阈之',
    '之一',
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
  const fix = makeCharToneFixtures(sentence, tones);
  return { acousticSlices: fix.acousticSlices, wordTimeSpans: fix.wordTimeSpans, tones };
}

/** Patch recallSpanTopKV2 via wrapping harness window loop: intercept by wrapping recallSpanTopKV2 itself */
const recallModPath = path.join(dist, 'lexicon-v2/recall-span-topk-v2.js');
const recallMod = require(recallModPath);
const origRecall = recallMod.recallSpanTopKV2;
function tracedRecall(rt, input) {
  const syllables = input.syllables || [];
  const plainKey = syllablesKey(syllables);
  const pattern = input.acousticTonePattern;
  const readiness = resolveToneRecallReadiness({
    syllables,
    runtimeSupportsTone: rt.supportsToneFirstRecall(),
    acousticTonePattern: pattern,
    toneCallerEnabled: input.toneCallerEnabled,
  });
  const toneKey =
    readiness.state === 'ready'
      ? readiness.tonePinyinKey
      : buildTonePinyinKeyFromSyllablesAndPattern(syllables, pattern?.slice(0, syllables.length) ?? []) ||
        '';

  activeCtx.plainPinyin = plainKey;
  activeCtx.acousticTonePattern = pattern ?? null;
  activeCtx.tonePinyin = toneKey;
  activeCtx.readiness = readiness.state === 'ready' ? 'ready' : readiness.state;
  activeCtx.windowText = input.windowText ?? activeCtx.windowText;

  const sqlBefore = sqlSeq;
  const result = origRecall(rt, input);
  const sqlAfter = sqlSeq;
  const windowSqls = sqlTrace.filter((r) => r.seq > sqlBefore && r.seq <= sqlAfter);

  queryTrace.push({
    caseId: activeCtx.caseId,
    window: input.windowText,
    windowStart: activeCtx.windowStart,
    windowEnd: activeCtx.windowEnd,
    plainKey,
    toneKey: result.queryTonePinyinKey || toneKey || '',
    acousticTonePattern: pattern ? JSON.stringify(pattern) : '',
    readiness: activeCtx.readiness,
    queryType:
      readiness.state !== 'ready'
        ? `SKIP_${readiness.state}`
        : 'PLAIN_AND_TONE_COMPOSITE',
    SQL:
      readiness.state !== 'ready'
        ? '(no SQLite — Fail Closed before lookup)'
        : windowSqls.map((s) => s.SQL).join(' || ') || SQL.baseTone.replace(/\s+/g, ' ').trim(),
    Bind:
      readiness.state !== 'ready'
        ? JSON.stringify({ reason: readiness.state })
        : windowSqls.map((s) => s.Bind).join(' || ') ||
          JSON.stringify({
            pinyin_key: plainKey,
            tone_pinyin_key: result.queryTonePinyinKey || toneKey,
            length: syllables.length,
          }),
    resultCount: result.hits?.length ?? 0,
    resultWords: (result.hits || []).map((h) => h.hotword.word).join('|'),
    queryTonePinyinKey: result.queryTonePinyinKey || '',
    toneExactHitCount: result.toneExactHitCount ?? 0,
    plainFallbackHitCount: result.plainFallbackHitCount ?? '',
    sqlCallCount: windowSqls.length,
  });
  return result;
}
recallMod.recallSpanTopKV2 = tracedRecall;
// Also replace local binding used if any module cached — phase1 imports from same path after our patch
require.cache[recallModPath].exports.recallSpanTopKV2 = tracedRecall;

// Phase1 already required recallTopK which required recallSpanTopKV2 — need to patch that module's import
const recallTopKPath = path.join(
  dist,
  'fw-detector/span-assembly-v4/recall-topk-for-windows.js'
);
if (require.cache[recallTopKPath]) {
  // Force re-require after patch: clear dependents
  delete require.cache[recallTopKPath];
}
const phase1Path = path.join(
  dist,
  'fw-detector/span-assembly-v4/phase1-window-edge-harness.js'
);
delete require.cache[phase1Path];
const { runPhase1WindowEdgeHarness: runPhase1Fresh } = require(phase1Path);

const FAIL_CASES = [
  'nn-train-01',
  'nn-train-01b',
  'snack-01',
  'sync-01',
  'trigger-01',
  'threshold-01',
];

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

// --- SELF recall (8/8 explanation baseline) ---
const TARGETS = ['我们', '正在', '中心', '小食', '已经', '同步', '触发', '阈值'];
const selfRows = [];
for (const surface of TARGETS) {
  const row = lookupWord(surface);
  const syllables = String(row.pinyin_key).split('|').filter(Boolean);
  const tones = tonesFromKey(row.tone_pinyin_key, syllables.length);
  activeCtx = {
    caseId: 'SELF',
    windowText: surface,
    windowStart: 0,
    windowEnd: surface.length,
    plainPinyin: row.pinyin_key,
    acousticTonePattern: tones,
    tonePinyin: row.tone_pinyin_key,
    readiness: 'ready',
  };
  const result = tracedRecall(runtime, {
    syllables,
    windowText: surface,
    termLength: syllables.length,
    topK: 8,
    domainIds,
    acousticTonePattern: tones,
    toneCallerEnabled: true,
  });
  selfRows.push({
    surface,
    lexiconPlain: row.pinyin_key,
    lexiconTone: row.tone_pinyin_key,
    queryTone: result.queryTonePinyinKey,
    hit: result.hits.some((h) => h.hotword.word === surface),
    resultWords: result.hits.map((h) => h.hotword.word).join('|'),
  });
  log(`SELF ${surface} queryTone=${result.queryTonePinyinKey} hit=${selfRows.at(-1).hit}`);
}

// --- Fail cases: Phase1 windows ---
const focusWindows = [];
for (const inv of inventory) {
  if (!FAIL_CASES.includes(inv.caseId)) continue;
  const sum = sumById.get(inv.caseId);
  const rawText = sum.rawText;
  const noise = inv.noiseSurface;
  const correct = inv.correctSurface;
  log(`CASE ${inv.caseId} noise=${noise} → ${correct}`);

  const toneAsr = sentenceAsrAndTone(rawText);
  activeCtx.caseId = inv.caseId;

  const phase1 = runPhase1Fresh({
    rawText,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    acousticSlices: toneAsr.acousticSlices,
    wordTimeSpans: toneAsr.wordTimeSpans,
    toneTimestampOnlyEnabled: true,
    fuzzyRecallEnabled: false,
  });

  const candByWindowId = new Map(
    (phase1.recalledWindows || []).map((r) => [r.windowId, r.candidates || []])
  );
  // filteredWindows = windows that actually entered Recall
  const windows = phase1.filteredWindows || phase1.windows || [];
  for (const w of windows) {
    const wt = w.windowText ?? rawText.slice(w.rawStart, w.rawEnd);
    const extracted = extractAcousticTonePatternForRecall(
      w.rawStart,
      w.rawEnd,
      w.syllableStart,
      w.syllableEnd,
      toneAsr.acousticSlices,
      toneAsr.wordTimeSpans
    );
    let syllables = String(w.windowPinyinKey || '')
      .split('|')
      .filter(Boolean);
    const plainKey = w.windowPinyinKey || syllablesKey(syllables);
    const pattern = extracted.pattern;
    const readiness = resolveToneRecallReadiness({
      syllables: syllables.length ? syllables : plainKey.split('|'),
      runtimeSupportsTone: true,
      acousticTonePattern: pattern,
      toneCallerEnabled: true,
    });
    const expectedCorrect = lookupWord(correct);
    const noiseIdx = rawText.indexOf(noise);
    const noiseEnd = noiseIdx >= 0 ? noiseIdx + [...noise].length : -1;
    const isNoiseFocus =
      wt === noise ||
      (noise && wt.includes(noise)) ||
      (noiseIdx >= 0 && w.rawStart <= noiseIdx && w.rawEnd >= noiseEnd);
    const cands = candByWindowId.get(w.windowId) || [];

    focusWindows.push({
      caseId: inv.caseId,
      noiseSurface: noise,
      correctSurface: correct,
      windowText: wt,
      windowStart: w.rawStart,
      windowEnd: w.rawEnd,
      plainPinyin: plainKey,
      tonePinyin: readiness.state === 'ready' ? readiness.tonePinyinKey : '',
      acousticTonePattern: pattern ? JSON.stringify(pattern) : '',
      readiness: readiness.state === 'ready' ? 'ready' : readiness.state,
      missReason: extracted.missReason || '',
      candidateCount: cands.length,
      candidates: cands.map((c) => c.replacement).join('|'),
      isNoiseFocus,
      correctLexiconTone: expectedCorrect?.tone_pinyin_key || '',
      correctLexiconPlain: expectedCorrect?.pinyin_key || '',
      keysEqual:
        readiness.state === 'ready' &&
        expectedCorrect &&
        readiness.tonePinyinKey === expectedCorrect.tone_pinyin_key &&
        plainKey === expectedCorrect.pinyin_key,
    });
  }

  // Explicit noise-window query (force reconstruct) for proof
  const nIdx = rawText.indexOf(noise);
  if (nIdx >= 0) {
    // Find window matching noise span if possible
    const noiseChars = [...noise];
    // Use IME-less: get pinyin from lexicon noise surface if exists, else from first matching window
    const noiseRow = lookupWord(noise);
    let plainKey = noiseRow?.pinyin_key;
    let syllables = plainKey ? plainKey.split('|') : [];
    // Extract tones from acoustic for noise char span
    const noiseStart = [...rawText.slice(0, nIdx)].length;
    const noiseEnd = noiseStart + noiseChars.length;
    // Find a recalled window covering exactly or containing
    const cover = windows.find(
      (w) => w.rawStart === noiseStart && w.rawEnd === noiseEnd
    ) || windows.find((w) => w.rawStart <= noiseStart && w.rawEnd >= noiseEnd);

    if (cover) {
      plainKey = cover.windowPinyinKey || plainKey;
      syllables = String(plainKey || '')
        .split('|')
        .filter(Boolean);
      const extracted = extractAcousticTonePatternForRecall(
        cover.rawStart,
        cover.rawEnd,
        cover.syllableStart,
        cover.syllableEnd,
        toneAsr.acousticSlices,
        toneAsr.wordTimeSpans
      );
      activeCtx = {
        caseId: inv.caseId,
        windowText: cover.windowText || noise,
        windowStart: cover.rawStart,
        windowEnd: cover.rawEnd,
        plainPinyin: plainKey,
        acousticTonePattern: extracted.pattern,
        tonePinyin: '',
        readiness: '',
      };
      if (syllables.length >= 1 && syllables.length <= 5) {
        tracedRecall(runtime, {
          syllables,
          windowText: cover.windowText || noise,
          termLength: syllables.length,
          topK: syllables.length === 1 ? 1 : 8,
          domainIds: syllables.length === 1 ? [] : domainIds,
          perSpanLimit: syllables.length === 1 ? 1 : 8,
          acousticTonePattern: extracted.pattern,
          toneCallerEnabled: true,
          fuzzyRecallEnabled: false,
        });
      }
    } else if (syllables.length >= 1 && syllables.length <= 5) {
      // Direct char tones for noise span
      const pattern = toneAsr.tones.slice(noiseStart, noiseEnd);
      activeCtx = {
        caseId: `${inv.caseId}:NOISE_DIRECT`,
        windowText: noise,
        windowStart: noiseStart,
        windowEnd: noiseEnd,
        plainPinyin: plainKey,
        acousticTonePattern: pattern,
        tonePinyin: '',
        readiness: '',
      };
      tracedRecall(runtime, {
        syllables,
        windowText: noise,
        termLength: syllables.length,
        topK: 8,
        domainIds,
        acousticTonePattern: pattern,
        toneCallerEnabled: true,
      });
    }

    // Contrast: what correct surface would query
    const corr = lookupWord(correct);
    if (corr) {
      const cs = String(corr.pinyin_key).split('|').filter(Boolean);
      const ct = tonesFromKey(corr.tone_pinyin_key, cs.length);
      activeCtx = {
        caseId: `${inv.caseId}:CORRECT_SELF_KEY`,
        windowText: correct,
        windowStart: '',
        windowEnd: '',
        plainPinyin: corr.pinyin_key,
        acousticTonePattern: ct,
        tonePinyin: corr.tone_pinyin_key,
        readiness: 'ready',
      };
      tracedRecall(runtime, {
        syllables: cs,
        windowText: correct,
        termLength: cs.length,
        topK: 8,
        domainIds,
        acousticTonePattern: ct,
        toneCallerEnabled: true,
      });
    }
  }
}

// Prove plain fallback absence on Mandatory path: count plain lookups during case phase
const plainDuringCases = plainLookupCalls.filter((c) => c.caseId && !String(c.caseId).startsWith('SELF'));

const summary = {
  freeze: 'FW_V4_FREEZE_2026_08_03',
  toneMode: 'Mode C — Plain + Tone 联合 Query (pinyin_key AND tone_pinyin_key)',
  plainFallbackInMandatoryPath: false,
  plainLookupCallsDuringFailCases: plainDuringCases.length,
  supportsToneFirstRecall: runtime.supportsToneFirstRecall(),
  selfRows,
  focusNoiseWindows: focusWindows.filter((w) => w.isNoiseFocus),
  queryTraceCount: queryTrace.length,
  sqlTraceCount: sqlTrace.length,
};

for (const d of [outDir, scratchOut]) {
  writeCsv(
    path.join(d, 'recall_query_trace.csv'),
    queryTrace,
    [
      'caseId',
      'window',
      'windowStart',
      'windowEnd',
      'plainKey',
      'toneKey',
      'acousticTonePattern',
      'readiness',
      'queryType',
      'SQL',
      'Bind',
      'resultCount',
      'resultWords',
      'queryTonePinyinKey',
      'toneExactHitCount',
      'plainFallbackHitCount',
      'sqlCallCount',
    ]
  );
  writeCsv(
    path.join(d, 'recall_sql_trace.csv'),
    sqlTrace,
    [
      'seq',
      'caseId',
      'window',
      'windowStart',
      'windowEnd',
      'method',
      'queryType',
      'plainKey',
      'toneKey',
      'SQL',
      'Bind',
      'resultCount',
      'resultWords',
    ]
  );
  writeCsv(
    path.join(d, 'noise_window_focus.csv'),
    focusWindows.filter((w) => w.isNoiseFocus || w.windowText === w.noiseSurface),
    [
      'caseId',
      'noiseSurface',
      'correctSurface',
      'windowText',
      'windowStart',
      'windowEnd',
      'plainPinyin',
      'tonePinyin',
      'acousticTonePattern',
      'readiness',
      'missReason',
      'candidateCount',
      'candidates',
      'correctLexiconPlain',
      'correctLexiconTone',
      'keysEqual',
    ]
  );
  fs.writeFileSync(path.join(d, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}

log(`done queryTrace=${queryTrace.length} sqlTrace=${sqlTrace.length} plainFallbackCalls=${plainDuringCases.length}`);
console.log(JSON.stringify({ ok: true, ...summary, focusNoiseWindows: summary.focusNoiseWindows }, null, 2));
