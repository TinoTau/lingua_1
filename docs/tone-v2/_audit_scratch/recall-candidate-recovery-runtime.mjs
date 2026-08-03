/**
 * Recall Candidate Recovery — RUNTIME verification (development, not audit-only).
 * Uses promoted node_runtime/lexicon/v3 after Full Rebuild.
 * Provides ASR acoustic tone payload required by frozen Mandatory Tone Recall contract
 * (does NOT change Tone/Recall contracts).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(repo, 'docs/acceptance/Freeze/recall_candidate_recovery_2026_08_03');
const scratchOut = path.join(__dirname, 'recall_candidate_recovery_2026_08_03');
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
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);
const { runLatticeFineSpanGeneration } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);
const { createKenlmBatchScorer } = require(
  path.join(dist, 'asr-repair/sentence-rerank/kenlm-scorer.js')
);
const { runFwSentenceRerankFromPrefilled } = require(
  path.join(dist, 'fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.js')
);
const {
  resolveCharLmModelPath,
  resolveKenlmQueryPath,
  isKenlmSubprocessRunnable,
} = require(path.join(dist, 'phonetic-correction/lm-scorer.js'));

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
  console.error(`[recovery] ${m}`);
}

const bundleDir = path.join(repo, 'node_runtime/lexicon/v3');
const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true });
const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
const checksum = fs.readFileSync(path.join(bundleDir, 'checksum.txt'), 'utf8').trim();

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

const toneStmt = db.prepare(
  `SELECT id, pinyin_key, tone_pinyin_key FROM term WHERE word=? AND enabled=1 LIMIT 1`
);
const toneStmtBase = db.prepare(
  `SELECT id, pinyin_key, tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1 LIMIT 1`
);

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

function lookupWord(word) {
  return toneStmt.get(word) || toneStmtBase.get(word) || null;
}

// --- Task 4: Runtime Exact Recall for target surfaces ---
const TARGET_SURFACES = ['我们', '正在', '中心', '小食', '已经', '同步', '触发', '阈值'];
const selfRecallRows = [];
const selfRecallOk = {};
for (const surface of TARGET_SURFACES) {
  const row = lookupWord(surface);
  if (!row) {
    selfRecallOk[surface] = false;
    selfRecallRows.push({
      caseId: 'SELF',
      span: surface,
      candidate: '',
      termId: '',
      rank: '',
      score: '',
      selected: false,
      note: 'TERM_MISSING_AFTER_REBUILD',
    });
    continue;
  }
  const syllables = String(row.pinyin_key).split('|').filter(Boolean);
  const tones = tonesFromKey(row.tone_pinyin_key, syllables.length);
  const result = recallSpanTopKV2(runtime, {
    syllables,
    windowText: surface,
    topK: 8,
    domainIds,
    acousticTonePattern: tones,
    toneCallerEnabled: true,
  });
  const rank = result.hits.findIndex((h) => h.hotword.word === surface) + 1;
  const ok = rank > 0;
  selfRecallOk[surface] = ok;
  result.hits.forEach((h, i) => {
    selfRecallRows.push({
      caseId: 'SELF',
      span: `${surface}@${row.pinyin_key}`,
      candidate: h.hotword.word,
      termId: h.hotword.id,
      rank: i + 1,
      score: h.candidateScore,
      selected: h.hotword.word === surface,
      note: ok ? 'SELF_RECALL' : 'SELF_RECALL_MISS',
    });
  });
  if (!result.hits.length) {
    selfRecallRows.push({
      caseId: 'SELF',
      span: `${surface}@${row.pinyin_key}`,
      candidate: '',
      termId: row.id,
      rank: '',
      score: '',
      selected: false,
      note: `EMPTY_HITS tone=${row.tone_pinyin_key}`,
    });
  }
  log(`SELF ${surface} ok=${ok} rank=${rank || 'MISS'} tpk=${row.tone_pinyin_key}`);
}

// --- Cases ---
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

const CJK = /[\u4e00-\u9fff]/;

/** Production-like ASR + acoustic tone (tonePosterior slices) from lexicon tones. */
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
  const words = chars.map((ch, i) => ({
    word: ch,
    start: i * 0.1,
    end: i * 0.1 + 0.09,
    probability: 0.99,
  }));
  const asrSegments = [
    {
      text: sentence,
      start: 0,
      end: Math.max(0.09, (chars.length - 1) * 0.1 + 0.09),
      words,
    },
  ];
  return {
    asrSegments,
    acousticSlices: fix.acousticSlices,
    wordTimeSpans: fix.wordTimeSpans,
    segmentTimeOffsetsSec: [0],
    segmentCharOffsets: [0],
    asrSegmentNodeBatchIndices: [0],
    tones,
  };
}

const recallCandRows = [...selfRecallRows];
const assemblyRows = [];
const crossPathRows = [];
const kenlmInputRows = [];
const diffRows = [];
const caseResults = [];

const beforeByCase = Object.fromEntries(
  summaries.map((s) => [
    s.caseId,
    {
      texts: [s.rawText],
      candidateCount: Number(s.candidateCount) || 1,
    },
  ])
);

let anyCorrectInCrossPath = false;
let casesWithRepair = 0;
let casesWithCorrect = 0;
const firstFailures = [];

for (const inv of inventory) {
  const caseId = inv.caseId;
  const sum = sumById.get(caseId);
  const rawText = sum.rawText;
  const expectedText = sum.expectedText;
  const correctSurface = inv.correctSurface;
  log(`CASE ${caseId}`);

  const toneAsr = sentenceAsrAndTone(rawText);
  const { asrSegments, acousticSlices, wordTimeSpans } = toneAsr;

  // Phase1 for recall candidates export
  const phase1 = runPhase1WindowEdgeHarness({
    rawText,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    acousticSlices,
    wordTimeSpans,
    toneTimestampOnlyEnabled: true,
    fuzzyRecallEnabled: false,
  });

  for (const w of phase1.recalledWindows) {
    for (const c of w.candidates) {
      recallCandRows.push({
        caseId,
        span: `${c.rawStart}:${c.rawEnd}:${rawText.slice(c.rawStart, c.rawEnd)}`,
        candidate: c.replacement,
        termId: c.termId || '',
        rank: c.candidateRank,
        score: c.candidateScore,
        selected: false,
        note: 'CASE_WINDOW_RECALL',
      });
    }
  }

  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const lattice = runLatticeFineSpanGeneration({
    rawText,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    coarseSpans: partition.coarseSpans,
    acousticSlices,
    wordTimeSpans,
    toneTimestampOnlyEnabled: true,
    fuzzyRecallEnabled: false,
  });
  if (!lattice.ok) throw new Error(`${caseId} lattice ${lattice.code} ${lattice.message}`);

  const orch = runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    asrSegments,
    acousticSlices,
    segmentTimeOffsetsSec: toneAsr.segmentTimeOffsetsSec,
    segmentCharOffsets: toneAsr.segmentCharOffsets,
    asrSegmentNodeBatchIndices: toneAsr.asrSegmentNodeBatchIndices,
    domainPriors: [],
    traceCaseId: caseId,
  });

  // Assembly export
  for (const pr of orch.pathAssemblyResults || []) {
    for (const bucket of pr.perBucketGenerated || []) {
      for (const c of bucket) {
        assemblyRows.push({
          caseId,
          sentence: c.text,
          path: pr.pathId || '',
          edges: (c.replacements || [])
            .map((r) => `${r.span?.start}:${r.span?.end}:${r.word}`)
            .join('|'),
          bucket: c.bucketDomain || c.domain || '',
          selected: false,
        });
      }
    }
  }

  const combos = orch.kenlmSentenceCandidates?.combinations || [];
  const distinct = [...new Set(combos.map((c) => c.text))];
  const hasNonRaw = distinct.some((t) => t !== rawText);
  const hasCorrect =
    distinct.includes(expectedText) ||
    distinct.some((t) => t.includes(correctSurface) && t !== rawText);
  const hasAllAtomsHint =
    caseId === 'sync-01'
      ? distinct.some((t) => t.includes('已经') && t.includes('同步'))
      : caseId === 'nn-train-01'
        ? distinct.some((t) => t.includes('我们') && t.includes('正在'))
        : hasCorrect;

  if (hasNonRaw) casesWithRepair += 1;
  if (hasCorrect || hasAllAtomsHint) {
    casesWithCorrect += 1;
    anyCorrectInCrossPath = true;
  }

  // FIRST FAILURE for this case if correct missing
  let firstFailure = null;
  const expectedAtoms =
    caseId === 'nn-train-01'
      ? ['我们', '正在']
      : caseId === 'sync-01'
        ? ['已经', '同步']
        : [correctSurface];
  const recallHas = expectedAtoms.every((a) =>
    phase1.recalledWindows.some((w) => w.candidates.some((c) => c.replacement === a))
  );
  const edgeHas = (phase1.edges || []).some((e) =>
    (e.candidates || []).some((c) => expectedAtoms.includes(c.replacement))
  );
  if (!recallHas) firstFailure = 'RecallCandidate';
  else if (!edgeHas) firstFailure = 'LexicalEdge';
  else if (!hasAllAtomsHint && !hasCorrect) {
    // path/assembly/crosspath
    const pathHas = (lattice.pathFineSpanViews || []).some((v) =>
      (v.pathFineSpans || [])
        .flatMap((s) => s.candidates || [])
        .some((c) => expectedAtoms.includes(c.replacement))
    );
    if (!pathHas) firstFailure = 'SegmentationPath';
    else if (!assemblyRows.some((r) => r.caseId === caseId && (r.sentence === expectedText || expectedAtoms.every((a) => r.sentence.includes(a)))))
      firstFailure = 'Assembly';
    else firstFailure = 'CrossPath';
  }
  if (firstFailure) firstFailures.push({ caseId, firstFailure });

  combos.forEach((c, i) => {
    crossPathRows.push({
      caseId,
      candidateText: c.text,
      candidateId: c.candidateId || `crosspath:${i}`,
      isRaw: c.text === rawText,
      sourcePath: c.sourcePath || c.pathId || '',
      bucket: c.bucketDomain || c.domain || '',
      selected: false,
    });
  });

  // Kenlm input only if CrossPath has multiple candidates (raw + repair)
  const kenlmEligible = combos.length >= 1 && hasNonRaw;
  if (kenlmEligible) {
    const modelPath = resolveCharLmModelPath();
    const queryPath = resolveKenlmQueryPath();
    const runnable = modelPath && isKenlmSubprocessRunnable(modelPath, queryPath);
    if (runnable) {
      const scorer = createKenlmBatchScorer();
      const sentences = [rawText, ...combos.map((c) => c.text)];
      // dedupe display
      const uniq = [];
      const seen = new Set();
      for (const t of sentences) {
        if (seen.has(t)) continue;
        seen.add(t);
        uniq.push(t);
      }
      for (const t of uniq) {
        kenlmInputRows.push({
          caseId,
          sentence: t,
          isRaw: t === rawText,
          isExpected: t === expectedText,
          eligible: true,
        });
      }
      try {
        const batch = await scorer.scoreBatch(uniq);
        uniq.forEach((t, i) => {
          const row = kenlmInputRows.find((r) => r.caseId === caseId && r.sentence === t);
          if (row) row.kenlmScore = batch.scores[i]?.score;
        });
      } catch (e) {
        log(`kenlm score fail ${caseId}: ${e.message || e}`);
      }
    } else {
      for (const c of combos) {
        kenlmInputRows.push({
          caseId,
          sentence: c.text,
          isRaw: c.text === rawText,
          isExpected: c.text === expectedText,
          eligible: true,
          kenlmScore: 'SCORER_UNAVAILABLE',
        });
      }
    }
  } else {
    kenlmInputRows.push({
      caseId,
      sentence: rawText,
      isRaw: true,
      isExpected: false,
      eligible: false,
      kenlmScore: 'SKIPPED_NO_REPAIR_CANDIDATE_IN_CROSSPATH',
      firstFailure: firstFailure || 'NONE',
    });
  }

  const beforeTexts = beforeByCase[caseId]?.texts || [rawText];
  const added = distinct.filter((t) => !beforeTexts.includes(t));
  diffRows.push({
    caseId,
    beforeCount: beforeTexts.length,
    afterCount: distinct.length,
    beforeTexts: beforeTexts.join(' || '),
    afterTexts: distinct.join(' || '),
    addedCandidates: added.join(' || '),
    hasNonRaw,
    hasCorrectExact: distinct.includes(expectedText),
    hasCorrectSurface: distinct.some((t) => t.includes(correctSurface)),
    firstFailure: firstFailure || '',
  });

  caseResults.push({
    caseId,
    noiseSurface: inv.noiseSurface,
    correctSurface,
    rawText,
    expectedText,
    recallCandidateCount: phase1.diagnostics?.candidateCount ?? phase1.recalledWindows.reduce((n, w) => n + w.candidates.length, 0),
    edgeCount: phase1.edges.length,
    crossPathCount: combos.length,
    distinctTexts: distinct,
    hasNonRaw,
    hasCorrectExact: distinct.includes(expectedText),
    hasCorrectOrAtoms: hasCorrect || hasAllAtomsHint,
    firstFailure,
    kenlmEligible,
  });
}

// lexicon_repairs.csv
const pending = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_lexicon_repairs_pending.json'), 'utf8')
);
const repairRows = pending.repairs.map((r) => ({
  surface: r.surface,
  termId: r.termId,
  old: r.old,
  new: r.new,
  reason: r.reason,
}));

const bundleInfo = {
  bundleVersion: manifest.bundleVersion,
  checksum,
  contentHash: manifest.contentHash || null,
  termCount: loadState.tableCounts?.term,
  domainTagCount: loadState.tableCounts?.termDomainTags,
  baseCount: loadState.tableCounts?.base,
  schemaVersion: manifest.schemaVersion,
  selfRecallOk,
  casesWithRepair,
  casesWithCorrect,
  anyCorrectInCrossPath,
  firstFailures,
  caseResults,
};

const verdict =
  casesWithCorrect >= 4 && TARGET_SURFACES.every((s) => selfRecallOk[s])
    ? 'DEVELOPMENT_COMPLETE'
    : TARGET_SURFACES.every((s) => selfRecallOk[s]) && casesWithRepair > 0
      ? 'DEVELOPMENT_PARTIAL'
      : TARGET_SURFACES.every((s) => selfRecallOk[s])
        ? 'DEVELOPMENT_PARTIAL'
        : 'DEVELOPMENT_BLOCKED';

bundleInfo.verdict = verdict;

for (const dir of [outDir, scratchOut]) {
  writeCsv(path.join(dir, 'lexicon_repairs.csv'), repairRows, [
    'surface',
    'termId',
    'old',
    'new',
    'reason',
  ]);
  writeCsv(path.join(dir, 'runtime_recall_candidates.csv'), recallCandRows, [
    'caseId',
    'span',
    'candidate',
    'termId',
    'rank',
    'score',
    'selected',
    'note',
  ]);
  writeCsv(path.join(dir, 'runtime_assembly_candidates.csv'), assemblyRows, [
    'caseId',
    'sentence',
    'path',
    'edges',
    'bucket',
    'selected',
  ]);
  writeCsv(path.join(dir, 'runtime_crosspath_candidates.csv'), crossPathRows, [
    'caseId',
    'candidateText',
    'candidateId',
    'isRaw',
    'sourcePath',
    'bucket',
    'selected',
  ]);
  writeCsv(path.join(dir, 'runtime_kenlm_input.csv'), kenlmInputRows, [
    'caseId',
    'sentence',
    'isRaw',
    'isExpected',
    'eligible',
    'kenlmScore',
    'firstFailure',
  ]);
  writeCsv(path.join(dir, 'runtime_candidate_diff.csv'), diffRows, [
    'caseId',
    'beforeCount',
    'afterCount',
    'beforeTexts',
    'afterTexts',
    'addedCandidates',
    'hasNonRaw',
    'hasCorrectExact',
    'hasCorrectSurface',
    'firstFailure',
  ]);
  fs.writeFileSync(path.join(dir, 'bundle_and_results.json'), JSON.stringify(bundleInfo, null, 2));
}

console.log(
  JSON.stringify(
    {
      verdict,
      selfRecallOk,
      casesWithRepair,
      casesWithCorrect,
      firstFailures,
      bundleVersion: manifest.bundleVersion,
      checksum,
      termCount: loadState.tableCounts?.term,
      domainTagCount: loadState.tableCounts?.termDomainTags,
    },
    null,
    2
  )
);
