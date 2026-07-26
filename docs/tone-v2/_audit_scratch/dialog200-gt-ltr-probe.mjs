/** Partition + LTR counts on dialog_200 GT texts (read-only audit evidence). */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');

const { partitionCoarseSpans } = require(path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js'));
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { textToPinyinStream } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { runLtrFineSpanGeneration, generateLocalOptionsAtCursor } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/ltr-fine-span-generator.js')
);
const { blockedFilter } = require(path.join(dist, 'fw-detector/span-assembly-v4/blocked-window-filter.js'));

const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});

const cases = [
  {
    caseId: 'd001',
    text: '你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？',
    note: 'normal cafe single-domain GT',
  },
  {
    caseId: 'd007',
    text: '师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。',
    note: 'taxi / 机场高速 overlap risk',
  },
  {
    caseId: 'd031',
    text: '我预订的是大床房，能安排安静一点的楼层吗？',
    note: 'hotel 预订 / overlap ambiguity',
  },
];

// resolve d031 from manifest if id differs
const manifest = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'),
    'utf8'
  )
);
const hotel = manifest.cases.find((c) => (c.text || '').includes('我预订的是大床房'));
if (hotel) {
  cases[2] = { caseId: hotel.id, text: hotel.text, note: 'hotel 预订 / overlap ambiguity' };
}

const out = [];
for (const c of cases) {
  const { syllables } = textToPinyinStream(c.text);
  const partition = partitionCoarseSpans({
    rawText: c.text,
    imeConfig,
    dict,
  });
  const coarseSpans = partition.coarseSpans;
  let rawWindowCount = 0;
  let blockedAtFilter = 0;
  let recallableCount = 0;
  const stepSnapshots = [];

  const result = runLtrFineSpanGeneration({
    rawText: c.text,
    globalSyllables: syllables,
    coarseSpans,
    domainPriors: [],
    recallForWindows: (windows) => {
      const filtered = blockedFilter({
        windows,
        rawText: c.text,
        coarseSpans,
        wordTimeSpans: [],
      });
      rawWindowCount += windows.length;
      for (const w of filtered) {
        if (w.blocked) blockedAtFilter += 1;
        else recallableCount += 1;
      }
      return [];
    },
  });

  // First-cursor option dump for readability
  const firstOpts = generateLocalOptionsAtCursor({
    cursor: 0,
    rawText: c.text,
    globalSyllables: syllables,
    coarseSpans,
  });

  const record = {
    caseId: c.caseId,
    note: c.note,
    asrText: c.text,
    syllableCount: syllables.length,
    coarseSpans: coarseSpans.map((s) => ({
      id: s.id,
      text: s.text,
      charRange: [s.rawStart, s.rawEnd],
      syllableRange: [s.syllableStart, s.syllableEnd],
      source: s.source,
      boundaryConfidence: s.boundaryConfidence,
    })),
    boundaryImport: partition.diagnostics,
    cursor0Options: firstOpts.map((o) => ({
      windowId: o.windowId,
      text: o.windowText,
      cross: o.boundaryCrossCount,
      source: o.windowSource,
      blocked: o.blocked,
      spanIds: o.spanIds,
    })),
    counts: {
      formalFineSpanCount: result.formalSpans.length,
      ltrSteps: result.trace.steps.length,
      rawOptionsPassedToRecallHook: rawWindowCount,
      blockedAfterBlockedFilter: blockedAtFilter,
      recallableAfterBlockedFilter: recallableCount,
      note: 'empty lexicon recall → mandatory 1-syl fallback commits; counts are generation-side not hit-side',
    },
    formalSpans: result.formalSpans.map((s) => ({
      spanId: s.spanId,
      text: c.text.slice(s.rawStart, s.rawEnd),
      syllableRange: [s.syllableStart, s.syllableEnd],
      coarseSpanIds: s.coarseSpanIds,
      boundaryCrossCount: s.boundaryCrossCount,
      windowSource: s.windowSource,
      selectionReason: s.selectionReason,
      candidateCount: s.candidates.length,
    })),
    stepsCompact: result.trace.steps.map((st) => ({
      cursor: st.cursor,
      selected: st.selectedSpan,
      optionDecisions: st.options.map((o) => `${o.windowId}:${o.decision}${o.rejectedReason ? '/' + o.rejectedReason : ''}`),
    })),
  };
  out.push(record);
  console.log(JSON.stringify(record, null, 2));
}

fs.writeFileSync(
  path.join(__dirname, 'dialog200_gt_ltr_partition_probe.json'),
  JSON.stringify(out, null, 2),
  'utf8'
);
console.log('wrote dialog200_gt_ltr_partition_probe.json');
