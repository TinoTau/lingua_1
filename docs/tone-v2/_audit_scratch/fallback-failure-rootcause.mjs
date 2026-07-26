/**
 * Phase 0: reproduce LTR fallback failure for d009/d099/d189.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');

const { textToPinyinStream, buildCharSyllableRanges } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { syllableRangeToRawCharRange } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const {
  generateLocalOptionsAtCursor,
  runLtrFineSpanGeneration,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/ltr-fine-span-generator.js'));
const {
  collectDistinctCoarseSpanIds,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/collect-distinct-coarse-span-ids.js'));

const cases = [
  { caseId: 'd009', text: '去望京SOHO，不走四环可以吗？那边现在堵不堵？', failCursor: 18 },
  { caseId: 'd099', text: '去望京SOHO，不走机场高速可以吗？那边现在堵不堵？', failCursor: 20 },
  { caseId: 'd189', text: '去望京SOHO，不走四环可以吗？那边现在堵不堵？', failCursor: 18 },
];

const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});

function diagnose(c) {
  const rawText = c.text;
  const stream = textToPinyinStream(rawText);
  const ranges = buildCharSyllableRanges(rawText);
  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const coarseSpans = partition.coarseSpans;
  const cursor = c.failCursor;

  const covering = ranges.filter(
    (r) => cursor >= r.syllableStart && cursor < r.syllableEnd
  );
  const charAt = (i) => {
    const ch = rawText[i];
    return {
      i,
      ch,
      code: ch ? ch.codePointAt(0)?.toString(16) : null,
    };
  };

  const whyNull = [];
  for (const len of [1, 2, 3, 4, 5]) {
    const syllableEnd = cursor + len;
    if (syllableEnd > stream.syllables.length) {
      whyNull.push({ len, reason: 'beyond_syllable_count' });
      continue;
    }
    const spanIds = collectDistinctCoarseSpanIds(cursor, syllableEnd, coarseSpans);
    if (!spanIds.length) {
      whyNull.push({ len, reason: 'no_coarse_span_ids', spanIds });
      continue;
    }
    const charRange = syllableRangeToRawCharRange(ranges, cursor, syllableEnd);
    if (!charRange) {
      whyNull.push({ len, reason: 'syllableRangeToRawCharRange_null', spanIds });
      continue;
    }
    whyNull.push({
      len,
      reason: 'ok',
      spanIds,
      charRange,
      text: rawText.slice(charRange.start, charRange.end),
      pinyin: stream.syllables.slice(cursor, syllableEnd).join('|'),
    });
  }

  let options = [];
  try {
    options = generateLocalOptionsAtCursor({
      cursor,
      rawText,
      globalSyllables: stream.syllables,
      coarseSpans,
    });
  } catch (e) {
    options = { error: String(e) };
  }

  let ltrError = null;
  let formalCount = null;
  try {
    const r = runLtrFineSpanGeneration({
      rawText,
      globalSyllables: stream.syllables,
      coarseSpans,
      domainPriors: [],
      recallForWindows: () => [],
    });
    formalCount = r.formalSpans.length;
  } catch (e) {
    ltrError = e instanceof Error ? e.message : String(e);
  }

  // Find which syllable index maps to Latin "S" in SOHO
  const sohoIdx = rawText.indexOf('SOHO');
  const syllableAtChars = [];
  for (let i = sohoIdx; i < sohoIdx + 4 && i >= 0; i++) {
    const hit = ranges.find((r) => i >= r.charStart && i < r.charEnd);
    syllableAtChars.push({
      char: charAt(i),
      range: hit ?? null,
    });
  }

  return {
    caseId: c.caseId,
    rawText,
    rawTextLength: rawText.length,
    syllableCount: stream.syllables.length,
    hasCjk: stream.hasCjk,
    syllables: stream.syllables,
    failCursor: cursor,
    syllableAtFailCursor: stream.syllables[cursor] ?? null,
    coveringRangesAtCursor: covering,
    ranges,
    coarseSpans: coarseSpans.map((s) => ({
      id: s.id,
      text: s.text,
      syl: [s.syllableStart, s.syllableEnd],
      raw: [s.rawStart, s.rawEnd],
      source: s.source,
    })),
    coverageCheck: (() => {
      const covered = new Array(stream.syllables.length).fill(false);
      for (const s of coarseSpans) {
        for (let i = s.syllableStart; i < s.syllableEnd; i++) covered[i] = true;
      }
      return {
        uncoveredSyllableIndices: covered
          .map((ok, i) => (ok ? -1 : i))
          .filter((i) => i >= 0),
        allCovered: covered.every(Boolean),
      };
    })(),
    sohoCharMapping: syllableAtChars,
    whyBuildWindowAt: whyNull,
    optionsAtFailCursor: options,
    ltrError,
    formalCount,
  };
}

const out = cases.map(diagnose);
const outPath = path.join(__dirname, 'fallback_failure_rootcause.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out.map((o) => ({
  caseId: o.caseId,
  failCursor: o.failCursor,
  syllableAtFailCursor: o.syllableAtFailCursor,
  syllableCount: o.syllableCount,
  uncovered: o.coverageCheck.uncoveredSyllableIndices,
  why: o.whyBuildWindowAt,
  ltrError: o.ltrError,
  covering: o.coveringRangesAtCursor,
  soho: o.sohoCharMapping,
})), null, 2));
console.log('wrote', outPath);
