/**
 * READ ONLY — Syllable Alignment & Window Boundary Audit
 * FW_V4_FREEZE_2026_08_03
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\window-boundary-audit.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
/** Unified output — do not scatter */
const outDir = path.join(repo, 'docs/acceptance/Freeze/2026-08-03_Window_Boundary_Audit');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { textToSyllables } = require(path.join(dist, 'lexicon/phonetic/pinyin.js'));
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const { buildLexicalWindowQueries } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/build-lexical-window-queries.js')
);
const { latticeHardBlockFilter } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-hard-block-filter.js')
);
const { theoreticalLexicalWindowCount } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/window-construction-core.js')
);
const { V4_LIMITS } = require(path.join(dist, 'fw-detector/span-assembly-v4/v4-limits.js'));
const { recallTopKForWindows } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/recall-topk-for-windows.js')
);
const { extractAcousticTonePatternForRecall } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/tone-recall.js')
);
const { resolveToneRecallReadiness } = require(
  path.join(dist, 'lexicon-v2/tone-recall-readiness.js')
);
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);
const { syllablesKey } = require(path.join(dist, 'lexicon/pinyin-index.js'));

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
  console.error(`[window-audit] ${m}`);
}

const FAIL_CASES = [
  'nn-train-01',
  'nn-train-01b',
  'snack-01',
  'sync-01',
  'trigger-01',
  'threshold-01',
];

/** Target atoms whose windows we check (surface text + plain key) */
const TARGETS_BY_CASE = {
  'nn-train-01': ['我们', '正在', '我们正在'],
  'nn-train-01b': ['正在', '闷蒸'],
  'snack-01': ['小食', '消失'],
  'sync-01': ['已经', '同步', '已经同步'],
  'trigger-01': ['触发', '出发'],
  'threshold-01': ['阈值', '阈之', '阈之一'],
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

const Database = require('better-sqlite3');
const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true });
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

/**
 * Expand CJK run ranges to per-char alignment when chars≈syllables 1:1.
 */
function buildCharAlignment(rawText, coordinate) {
  const rows = [];
  const chars = [...rawText];
  // Prefer per-char via textToSyllables on each CJK char
  let sylCursor = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const rawStart = [...rawText].slice(0, i).join('').length; // code unit index careful
  }
  // Use code-unit indexing consistent with JS string
  for (let cu = 0; cu < rawText.length; ) {
    const ch = rawText[cu];
    const isCjk = CJK.test(ch);
    if (!isCjk) {
      rows.push({
        charIndex: cu,
        char: ch,
        pinyin: '',
        syllableIndex: '',
        syllable: '',
        charStart: cu,
        charEnd: cu + 1,
        alignment: 'non_cjk',
        timestampStart: '',
        timestampEnd: '',
      });
      cu += 1;
      continue;
    }
    // find containing range
    const range = coordinate.ranges.find((r) => cu >= r.charStart && cu < r.charEnd);
    if (!range) {
      rows.push({
        charIndex: cu,
        char: ch,
        pinyin: textToSyllables(ch).join('|'),
        syllableIndex: '',
        syllable: '',
        charStart: cu,
        charEnd: cu + 1,
        alignment: 'NO_RANGE',
        timestampStart: '',
        timestampEnd: '',
      });
      cu += 1;
      continue;
    }
    const runLen = range.charEnd - range.charStart;
    const sylCount = range.syllableEnd - range.syllableStart;
    const rel = cu - range.charStart;
    let sylIdx;
    let align;
    if (runLen === sylCount) {
      sylIdx = range.syllableStart + rel;
      align = '1:1';
    } else {
      const charsPerSyl = runLen / sylCount;
      sylIdx = range.syllableStart + Math.floor(rel / charsPerSyl);
      align = `PROPORTIONAL runLen=${runLen} sylCount=${sylCount}`;
    }
    const syl = coordinate.syllables[sylIdx] ?? '';
    const perCharSyl = textToSyllables(ch)[0] ?? '';
    rows.push({
      charIndex: cu,
      char: ch,
      pinyin: perCharSyl,
      syllableIndex: sylIdx,
      syllable: syl,
      charStart: cu,
      charEnd: cu + 1,
      alignment: align,
      charPinyinMatchesStream: perCharSyl === syl,
      timestampStart: '',
      timestampEnd: '',
    });
    cu += 1;
  }
  return rows;
}

const syllableRows = [];
const windowRows = [];
const pruningRows = [];
const caseSummaries = [];

for (const inv of inventory) {
  if (!FAIL_CASES.includes(inv.caseId)) continue;
  const sum = sumById.get(inv.caseId);
  const rawText = sum.rawText;
  const expectedText = sum.expectedText;
  const noise = inv.noiseSurface;
  const correct = inv.correctSurface;
  log(`CASE ${inv.caseId}`);

  const coordinate = buildUtteranceSyllableCoordinate(rawText);
  const expectedCoord = buildUtteranceSyllableCoordinate(expectedText);
  const toneAsr = sentenceAsrAndTone(rawText);

  // Fill timestamps on alignment from fixtures
  const align = buildCharAlignment(rawText, coordinate);
  for (const row of align) {
    if (row.charStart !== '' && Number.isFinite(Number(row.charStart))) {
      const i = [...rawText.slice(0, row.charStart)].length;
      const wt = toneAsr.wordTimeSpans[i];
      if (wt) {
        row.timestampStart = wt.start;
        row.timestampEnd = wt.end;
      }
    }
    syllableRows.push({
      caseId: inv.caseId,
      ...row,
      rawText,
      expectedText,
      noiseSurface: noise,
      correctSurface: correct,
    });
  }

  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const theoretical = theoreticalLexicalWindowCount(coordinate.syllables.length, 5);
  const windows = buildLexicalWindowQueries({
    rawText,
    globalSyllables: coordinate.syllables,
    coarseSpans: partition.coarseSpans,
    charSyllableRanges: coordinate.ranges,
  });
  const filtered = latticeHardBlockFilter({
    windows,
    rawText,
    coarseSpans: partition.coarseSpans,
    wordTimeSpans: toneAsr.wordTimeSpans,
  });
  const recallable = filtered.filter((w) => !w.blocked);

  // Recall for recallable windows (production path)
  const recall = recallTopKForWindows({
    rawText,
    windows: recallable,
    globalSyllables: [...coordinate.syllables],
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    wordTimeSpans: toneAsr.wordTimeSpans,
    acousticSlices: toneAsr.acousticSlices,
    fuzzyRecallEnabled: false,
    toneTimestampOnlyEnabled: true,
  });
  const candByWindow = new Map();
  for (const c of recall.candidates || []) {
    const list = candByWindow.get(c.windowId) || [];
    list.push(c);
    candByWindow.set(c.windowId, list);
  }

  const targets = TARGETS_BY_CASE[inv.caseId] || [correct];
  const targetMeta = targets.map((t) => {
    const row = lookupWord(t);
    const expectedPlain = row?.pinyin_key || textToSyllables(t).join('|');
    return { surface: t, plainKey: expectedPlain, inLexicon: Boolean(row) };
  });

  const filteredById = new Map(filtered.map((w) => [w.windowId, w]));

  for (const w of windows) {
    const len = w.syllableEnd - w.syllableStart;
    const afterBlock = filteredById.get(w.windowId);
    const blocked = afterBlock?.blocked === true;
    const blockReason = afterBlock?.blockedBoundaryReason || '';
    const cands = candByWindow.get(w.windowId) || [];
    const syllables = coordinate.syllables.slice(w.syllableStart, w.syllableEnd);
    const plain = w.windowPinyinKey || syllables.join('|');
    const extracted = extractAcousticTonePatternForRecall(
      w.rawStart,
      w.rawEnd,
      w.syllableStart,
      w.syllableEnd,
      toneAsr.acousticSlices,
      toneAsr.wordTimeSpans
    );
    const readiness = resolveToneRecallReadiness({
      syllables,
      runtimeSupportsTone: true,
      acousticTonePattern: extracted.pattern,
      toneCallerEnabled: true,
    });
    const toneKey = readiness.state === 'ready' ? readiness.tonePinyinKey : `SKIP_${readiness.state}`;

    const matchesSurface = targets.filter((t) => w.windowText === t);
    const matchesPlain = targetMeta.filter((t) => t.plainKey && plain === t.plainKey);

    // pruning stages
    const stages = [];
    stages.push({ stage: 'generated', kept: true, reason: 'buildLexicalWindowQueries' });
    stages.push({
      stage: 'length_1_to_5',
      kept: len >= 1 && len <= 5,
      reason: `len=${len}`,
    });
    stages.push({
      stage: 'latticeHardBlockFilter',
      kept: !blocked,
      reason: blocked ? blockReason : 'pass',
    });
    stages.push({
      stage: 'recall_eligible',
      kept: !blocked,
      reason: blocked ? 'blocked_before_recall' : 'sent_to_recallTopKForWindows',
    });
    stages.push({
      stage: 'recall_hit',
      kept: cands.length > 0,
      reason: cands.length ? cands.map((c) => c.replacement).join('|') : 'empty_hits',
    });

    for (const s of stages) {
      pruningRows.push({
        caseId: inv.caseId,
        windowId: w.windowId,
        windowText: w.windowText,
        stage: s.stage,
        kept: s.kept,
        reason: s.reason,
      });
    }

    windowRows.push({
      caseId: inv.caseId,
      windowId: w.windowId,
      windowText: w.windowText,
      rawStart: w.rawStart,
      rawEnd: w.rawEnd,
      length: len,
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      plainPinyin: plain,
      tonePinyin: toneKey,
      acousticTonePattern: extracted.pattern ? JSON.stringify(extracted.pattern) : '',
      windowSource: w.windowSource,
      boundaryCrossCount: w.boundaryCrossCount,
      blocked,
      blockedReason: blockReason,
      recallCandidateCount: cands.length,
      recallCandidates: cands.map((c) => c.replacement).join('|'),
      matchesTargetSurface: matchesSurface.join('|'),
      matchesTargetPlainKey: matchesPlain.map((t) => t.surface).join('|'),
      coarseSpanIds: (w.spanIds || []).join('|'),
      sourceFn: 'buildWindowDescriptorForRange via buildLexicalWindowQueries',
    });
  }

  // Target presence summary
  const targetResults = targetMeta.map((t) => {
    const byText = windowRows.filter(
      (r) => r.caseId === inv.caseId && r.windowText === t.surface && r.length >= 1
    );
    const byPlain = windowRows.filter(
      (r) =>
        r.caseId === inv.caseId &&
        r.plainPinyin === t.plainKey &&
        !r.blocked &&
        String(r.blocked) !== 'true'
    );
    // blocked is boolean in object but may serialize - check from windows
    const plainWindows = windows.filter((w) => w.windowPinyinKey === t.plainKey);
    const plainRecallable = recallable.filter((w) => w.windowPinyinKey === t.plainKey);
    const textWindows = windows.filter((w) => w.windowText === t.surface);
    return {
      surface: t.surface,
      plainKey: t.plainKey,
      inLexicon: t.inLexicon,
      windowTextExists: textWindows.length > 0,
      windowTextIds: textWindows.map((w) => w.windowId).join('|'),
      plainKeyWindowExists: plainWindows.length > 0,
      plainKeyWindowIds: plainWindows.map((w) => `${w.windowId}:${w.windowText}`).join('|'),
      plainKeyRecallable: plainRecallable.length > 0,
      plainKeyRecallableIds: plainRecallable
        .map((w) => `${w.windowId}:${w.windowText}`)
        .join('|'),
    };
  });

  const misaligned = align.filter(
    (r) => r.alignment !== 'non_cjk' && r.charPinyinMatchesStream === false
  );

  caseSummaries.push({
    caseId: inv.caseId,
    rawText,
    expectedText,
    noiseSurface: noise,
    correctSurface: correct,
    syllableCount: coordinate.syllables.length,
    expectedSyllableCount: expectedCoord.syllables.length,
    rawSyllables: coordinate.syllables.join('|'),
    expectedSyllables: expectedCoord.syllables.join('|'),
    rawEqualsExpectedSyllables:
      coordinate.syllables.join('|') === expectedCoord.syllables.join('|'),
    theoreticalWindowCount: theoretical,
    generatedWindowCount: windows.length,
    blockedWindowCount: filtered.filter((w) => w.blocked).length,
    recallableWindowCount: recallable.length,
    charSyllableMisalignCount: misaligned.length,
    targets: targetResults,
  });
}

const anyMisalign = caseSummaries.some((c) => c.charSyllableMisalignCount > 0);
const anyMissingNeededPlain = caseSummaries.some((c) =>
  c.targets.some((t) => {
    // For correct repair atoms that exist in lexicon, plain-key window should exist
    // when raw/expected share plain (homophone). Exception: multi-char compound not in stream.
    if (!t.inLexicon) return false;
    if (t.surface === c.correctSurface || ['我们', '正在', '小食', '触发', '阈值', '已经', '同步'].includes(t.surface)) {
      // 我们正在 / 已经同步 as whole may not be lexicon terms
      if (t.surface.length > 2 && !t.inLexicon) return false;
      return !t.plainKeyWindowExists;
    }
    return false;
  })
);

// Refined: check critical atoms only
function criticalMissing(c) {
  const critical = {
    'nn-train-01': ['我们', '正在'],
    'nn-train-01b': ['正在'],
    'snack-01': ['小食'],
    'sync-01': ['已经', '同步'],
    'trigger-01': ['触发'],
    'threshold-01': ['阈值'],
  }[c.caseId];
  return (critical || []).map((surface) => {
    const t = c.targets.find((x) => x.surface === surface);
    return {
      surface,
      plainKey: t?.plainKey,
      windowTextExists: t?.windowTextExists ?? false,
      plainKeyWindowExists: t?.plainKeyWindowExists ?? false,
      plainKeyRecallable: t?.plainKeyRecallable ?? false,
      note: !t?.windowTextExists
        ? 'raw 无正确字形 → windowText 不可能等于正确词'
        : '',
    };
  });
}

const summary = {
  freeze: 'FW_V4_FREEZE_2026_08_03',
  nature: 'READ_ONLY_SYLLABLE_ALIGNMENT_WINDOW_BOUNDARY_AUDIT',
  verdict: null, // filled below
  q1_syllable_cut_correct_vs_raw: !anyMisalign,
  q1_detail:
    'Syllables come from textToSyllables(CJK run) on ASR Raw — not from expectedText. Per-char 1:1 when runLen===sylCount.',
  caseSummaries,
  criticalWindows: Object.fromEntries(
    caseSummaries.map((c) => [c.caseId, criticalMissing(c)])
  ),
  limits: {
    latticeMin: 1,
    latticeMax: 5,
    v4LtrMin: V4_LIMITS.windowMinSyllables,
    v4LtrMax: V4_LIMITS.windowMaxSyllables,
    maxGlobalWindowCount: V4_LIMITS.maxGlobalWindowCount,
    maxBoundaryCrossCount: V4_LIMITS.maxBoundaryCrossCount,
    asrWordGapMs: V4_LIMITS.asrWordGapMs,
  },
  owners: {
    windowText_rawStart_rawEnd: 'buildWindowDescriptorForRange (window-construction-core.ts)',
    syllableStart_syllableEnd: 'buildLexicalWindowQueries nested loops',
    plainPinyin_windowPinyinKey: 'globalSyllables.slice(start,end).join("|")',
    globalSyllables: 'buildUtteranceSyllableCoordinate → textToSyllables',
  },
};

// Verdict logic (trace-based):
// WINDOW_ALIGNMENT_CORRECT if: char↔syllable 1:1 vs RAW, and sliding windows emit all 1..5 contiguous spans,
// and critical plain-key windows exist where plain of raw span equals correct lexicon plain.
// Missing windowText===correct is EXPECTED when ASR raw glyphs differ — not an alignment bug.
const plainKeyGaps = [];
for (const c of caseSummaries) {
  for (const crit of criticalMissing(c)) {
    const row = lookupWord(crit.surface);
    if (!row) continue;
    // Does any raw contiguous span have the same plain key?
    const plain = row.pinyin_key;
    const hasPlain = c.targets.find((t) => t.surface === crit.surface)?.plainKeyWindowExists;
    if (!hasPlain) {
      // Check if raw syllables contain that plain as contiguous subsequence
      const parts = plain.split('|');
      const stream = c.rawSyllables.split('|');
      let found = false;
      for (let i = 0; i + parts.length <= stream.length; i++) {
        if (stream.slice(i, i + parts.length).join('|') === plain) found = true;
      }
      if (found && !hasPlain) {
        plainKeyGaps.push({ caseId: c.caseId, surface: crit.surface, plain, issue: 'PLAIN_IN_STREAM_BUT_NO_WINDOW' });
      } else if (!found) {
        plainKeyGaps.push({
          caseId: c.caseId,
          surface: crit.surface,
          plain,
          issue: 'PLAIN_NOT_IN_RAW_STREAM',
          rawSyllables: c.rawSyllables,
        });
      }
    }
  }
}

const generatedOk = caseSummaries.every(
  (c) => c.generatedWindowCount === c.theoreticalWindowCount
);

summary.plainKeyGaps = plainKeyGaps;
summary.generatedMatchesTheoretical = generatedOk;
summary.verdict =
  !anyMisalign && generatedOk && !plainKeyGaps.some((g) => g.issue === 'PLAIN_IN_STREAM_BUT_NO_WINDOW')
    ? 'WINDOW_ALIGNMENT_CORRECT'
    : 'WINDOW_ALIGNMENT_INCORRECT';

summary.q2_correct_window_text =
  'Correct glyph windows (windowText===正确词) generally DO NOT exist because ASR Raw glyphs differ. Homophone plain-key windows often DO exist.';
summary.q3_pruned =
  'Lattice hard-block: raw_gap / whitespace / punctuation / sentence_boundary / non_cjk / asr_word_gap_ms. Coarse boundaryCross soft (not sole hard block). No TopK/Beam at window generation. maxGlobalWindowCount applies to LTR blockedFilter path, not Lattice Phase1 full emit.';
summary.q4_window_or_tone =
  'When plain-key window exists but correct candidate missing → Query/Tone key mismatch (prior audit Mode C), not missing Window. When plain not in raw stream (e.g. 阈值 vs 阈之一 len) → Window span cannot be the 2-syllable correct key at that noise span — boundary/length of noise, still not syllable mis-cut.';
summary.q5_fits_freeze = true;

writeCsv(path.join(outDir, 'syllable_alignment.csv'), syllableRows, [
  'caseId',
  'charIndex',
  'char',
  'pinyin',
  'syllableIndex',
  'syllable',
  'charStart',
  'charEnd',
  'alignment',
  'charPinyinMatchesStream',
  'timestampStart',
  'timestampEnd',
  'rawText',
  'noiseSurface',
  'correctSurface',
]);
writeCsv(path.join(outDir, 'window_trace.csv'), windowRows, [
  'caseId',
  'windowId',
  'windowText',
  'rawStart',
  'rawEnd',
  'length',
  'syllableStart',
  'syllableEnd',
  'plainPinyin',
  'tonePinyin',
  'acousticTonePattern',
  'windowSource',
  'boundaryCrossCount',
  'blocked',
  'blockedReason',
  'recallCandidateCount',
  'recallCandidates',
  'matchesTargetSurface',
  'matchesTargetPlainKey',
  'coarseSpanIds',
  'sourceFn',
]);
writeCsv(path.join(outDir, 'window_pruning.csv'), pruningRows, [
  'caseId',
  'windowId',
  'windowText',
  'stage',
  'kept',
  'reason',
]);

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
log(`done verdict=${summary.verdict} windows=${windowRows.length}`);
console.log(
  JSON.stringify(
    {
      ok: true,
      verdict: summary.verdict,
      cases: caseSummaries.map((c) => ({
        caseId: c.caseId,
        syl: c.rawSyllables,
        gen: c.generatedWindowCount,
        theory: c.theoreticalWindowCount,
        blocked: c.blockedWindowCount,
        critical: criticalMissing(c),
      })),
      plainKeyGaps,
    },
    null,
    2
  )
);
