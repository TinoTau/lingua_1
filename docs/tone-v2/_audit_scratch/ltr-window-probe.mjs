/**
 * Read-only probe for Coarse→Fine LTR window behaviour (audit evidence).
 * Uses compiled dist if present; otherwise fails clearly.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');

function load() {
  const candidates = [
    path.join(root, 'dist/main/electron-node/main/src/fw-detector/span-assembly-v4/ltr-fine-span-generator.js'),
    path.join(root, 'dist/main/src/fw-detector/span-assembly-v4/ltr-fine-span-generator.js'),
  ];
  const streamCandidates = [
    path.join(root, 'dist/main/electron-node/main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js'),
    path.join(root, 'dist/main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js'),
  ];
  let gen;
  let stream;
  for (const p of candidates) {
    try {
      gen = require(p);
      break;
    } catch {
      /* continue */
    }
  }
  for (const p of streamCandidates) {
    try {
      stream = require(p);
      break;
    } catch {
      /* continue */
    }
  }
  if (!gen || !stream) {
    throw new Error('Compiled dist not found; run build:main first');
  }
  return { gen, stream };
}

function coarse(id, sylStart, sylEnd, rawStart, rawEnd, text) {
  return {
    id,
    text,
    rawStart,
    rawEnd,
    syllableStart: sylStart,
    syllableEnd: sylEnd,
    source: 'asr_word_boundary',
    boundaryConfidence: 0.5,
  };
}

function fmtOpts(opts) {
  return opts.map((o) => ({
    windowId: o.windowId,
    text: o.windowText,
    len: o.syllableEnd - o.syllableStart,
    cross: o.boundaryCrossCount,
    source: o.windowSource,
    blocked: o.blocked,
    spanIds: o.spanIds,
  }));
}

const { gen, stream } = load();
const { generateLocalOptionsAtCursor, runLtrFineSpanGeneration } = gen;
const { textToPinyinStream } = stream;

function runCase(name, rawText, coarseSpans, recallTexts) {
  const { syllables } = textToPinyinStream(rawText);
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify({ rawText, syllables, coarseSpans }, null, 2));
  const opts0 = generateLocalOptionsAtCursor({
    cursor: 0,
    rawText,
    globalSyllables: syllables,
    coarseSpans,
  });
  console.log('cursor=0 options:', JSON.stringify(fmtOpts(opts0), null, 2));

  const result = runLtrFineSpanGeneration({
    rawText,
    globalSyllables: syllables,
    coarseSpans,
    domainPriors: [],
    recallForWindows: (windows) => {
      const hits = [];
      for (const w of windows) {
        if (!recallTexts.includes(w.windowText)) continue;
        hits.push({
          candidateId: w.windowText,
          windowId: w.windowId,
          windowSource: w.windowSource,
          anchorCoarseSpanId: w.anchorCoarseSpanId,
          syllableStart: w.syllableStart,
          syllableEnd: w.syllableEnd,
          rawStart: w.rawStart,
          rawEnd: w.rawEnd,
          windowPinyinKey: w.windowPinyinKey,
          candidateScore: w.windowText.length,
          score: w.windowText.length,
          boundaryPenalty: w.windowSource === 'boundary_window' ? 0.85 : 1,
          candidateRank: 1,
          hitKind: 'exact_term',
          replacement: w.windowText,
          domains: ['probe'],
          source: 'domain_term',
          recallSource: 'exact',
          repairTarget: true,
        });
      }
      return hits;
    },
  });

  console.log(
    'formalSpans:',
    JSON.stringify(
      result.formalSpans.map((s) => ({
        spanId: s.spanId,
        text: rawText.slice(s.rawStart, s.rawEnd),
        syllable: [s.syllableStart, s.syllableEnd],
        cross: s.boundaryCrossCount,
        reason: s.selectionReason,
        source: s.windowSource,
        candidates: s.candidates.map((c) => c.replacement),
      })),
      null,
      2
    )
  );
  console.log(
    'steps:',
    JSON.stringify(
      result.trace.steps.map((st) => ({
        cursor: st.cursor,
        selected: st.selectedSpan,
        options: st.options.map((o) => ({
          windowId: o.windowId,
          decision: o.decision,
          lex: o.lexicalCompleteness,
          rejectedReason: o.rejectedReason,
          candidateCount: o.candidateCount,
        })),
      })),
      null,
      2
    )
  );
}

// Cross-boundary probes (forced wrong coarse splits)
runCase(
  'A_latte_coffee',
  '拿铁咖啡',
  [coarse('c0', 0, 2, 0, 2, '拿铁'), coarse('c1', 2, 4, 2, 4, '咖啡')],
  ['拿铁咖啡', '拿铁', '咖啡']
);

runCase(
  'B_booking_hotel',
  '我想预订酒店',
  [coarse('c0', 0, 3, 0, 3, '我想预'), coarse('c1', 3, 6, 3, 6, '订酒店')],
  ['预订', '预订酒店', '酒店']
);

runCase(
  'C_queenstown_airport',
  '去皇后镇机场',
  [coarse('c0', 0, 3, 0, 3, '去皇后'), coarse('c1', 3, 6, 3, 6, '镇机场')],
  ['皇后镇', '皇后镇机场', '机场']
);

// Overlap ambiguity at one cursor
{
  const rawText = '预订酒店';
  const { syllables } = textToPinyinStream(rawText);
  const coarseSpans = [coarse('c0', 0, 4, 0, 4, rawText)];
  console.log('\n===== D_overlap_booking =====');
  const opts = generateLocalOptionsAtCursor({
    cursor: 0,
    rawText,
    globalSyllables: syllables,
    coarseSpans,
  });
  console.log(JSON.stringify({ syllables, options: fmtOpts(opts) }, null, 2));
  const result = runLtrFineSpanGeneration({
    rawText,
    globalSyllables: syllables,
    coarseSpans,
    domainPriors: [],
    recallForWindows: (windows) => {
      const texts = new Set(['预订', '预订酒', '预订酒店', '酒店']);
      return windows
        .filter((w) => texts.has(w.windowText))
        .map((w) => ({
          candidateId: w.windowText,
          windowId: w.windowId,
          windowSource: w.windowSource,
          anchorCoarseSpanId: w.anchorCoarseSpanId,
          syllableStart: w.syllableStart,
          syllableEnd: w.syllableEnd,
          rawStart: w.rawStart,
          rawEnd: w.rawEnd,
          windowPinyinKey: w.windowPinyinKey,
          candidateScore: 1,
          score: 1,
          boundaryPenalty: 1,
          candidateRank: 1,
          hitKind: 'exact_term',
          replacement: w.windowText,
          domains: ['tourism_hotel'],
          source: 'domain_term',
          recallSource: 'exact',
          repairTarget: true,
        }));
    },
  });
  console.log(
    JSON.stringify(
      {
        formal: result.formalSpans.map((s) => ({
          id: s.spanId,
          text: rawText.slice(s.rawStart, s.rawEnd),
          reason: s.selectionReason,
        })),
        step0: result.trace.steps[0],
      },
      null,
      2
    )
  );
}

// dialog_d001 GT text — count raw options under forced single coarse
{
  const rawText = '你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？';
  const { syllables } = textToPinyinStream(rawText);
  console.log('\n===== E_dialog_d001_counts =====');
  console.log({ charLen: rawText.length, syllableCount: syllables.length });
  let cursor = 0;
  let rawWindowCount = 0;
  let stepCount = 0;
  // Approximate with empty recall → single-char fallback each step
  const coarseSpans = [coarse('c0', 0, syllables.length, 0, rawText.length, rawText)];
  const result = runLtrFineSpanGeneration({
    rawText,
    globalSyllables: syllables,
    coarseSpans,
    domainPriors: [],
    recallForWindows: (windows) => {
      rawWindowCount += windows.length;
      stepCount += 1;
      return [];
    },
  });
  console.log({
    formalSpanCount: result.formalSpans.length,
    steps: result.trace.steps.length,
    rawOptionsSeenByRecall: rawWindowCount,
    meanOptionsPerStep: rawWindowCount / Math.max(1, stepCount),
    note: 'empty-recall forces 1-syl fallback; upper-bound options ≈ steps×min(4, remaining)',
  });
}
