#!/usr/bin/env node
/** READONLY: simulate local raw-vs-IME diff proposal for pre-dev audit */
const fs = require('fs');
const path = require('path');

const repoRoot = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = repoRoot;

const distRoot = path.join(__dirname, '../../dist/main/electron-node/main/src/fw-detector/pinyin-ime-v2');
const distNorm = path.join(__dirname, '../../dist/main/electron-node/main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-span-normalizer.js');

const {
  loadPinyinImeV2Dictionaries,
  resolvePinyinImeV2DictDir,
} = require(path.join(distRoot, 'pinyin-ime-v2-dict-load.js'));
const { runPinyinImeV2SpanProposal } = require(path.join(distRoot, 'run-pinyin-ime-v2-span-proposal.js'));
const { buildCharSyllableRanges, textToPinyinStream } = require(path.join(distRoot, 'pinyin-ime-v2-pinyin-stream.js'));
const {
  syllableRangeToRawCharRange,
  selectTrustedTopKCandidates,
} = require(path.join(distRoot, 'pinyin-ime-v2-boundary-compatible-topk-diff.js'));
const { normalizeTraditionalChinese } = require(path.join(distRoot, 'normalize-for-ime-alignment.js'));
const { normalizePinyinImeV2Spans } = require(distNorm);
const { textToSyllables } = require(path.join(__dirname, '../../dist/main/electron-node/main/src/lexicon/phonetic/pinyin.js'));

const BATCH = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../lexicon-tone-dialog200-spanselector-batch-result.json'), 'utf8')
);
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir('node_runtime/pinyin-ime-v2/dict'));

const CONFIG = {
  minSpanChars: 2,
  maxSpanChars: 6,
  minSyllables: 2,
  maxSyllables: 5,
};

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

function normalizeCompare(a, b) {
  return normalizeTraditionalChinese(a) === normalizeTraditionalChinese(b);
}

function syllableCount(text) {
  return textToSyllables(text.trim()).length;
}

function buildLocalRawImeDiffSpans(rawText, proposal) {
  const { candidates, diagnostics } = proposal;
  const { trusted } = selectTrustedTopKCandidates(candidates, diagnostics.boundaryAlignmentScores);
  const charRanges = buildCharSyllableRanges(rawText);
  const { syllables } = textToPinyinStream(rawText);
  const byKey = new Map();

  for (const candidate of trusted) {
    for (const token of candidate.tokens ?? []) {
      const sc = token.syllableEnd - token.syllableStart;
      if (sc < CONFIG.minSyllables || sc > CONFIG.maxSyllables) continue;

      const rawPos = syllableRangeToRawCharRange(charRanges, token.syllableStart, token.syllableEnd);
      if (!rawPos || rawPos.end <= rawPos.start) continue;

      const rawSlice = rawText.slice(rawPos.start, rawPos.end);
      const imeWord = token.word;
      if (!rawSlice || !imeWord) continue;
      if (!CJK_RE.test(rawSlice)) continue;
      if (normalizeCompare(rawSlice, imeWord)) continue;

      const charLen = rawSlice.length;
      if (charLen < CONFIG.minSpanChars || charLen > CONFIG.maxSpanChars) continue;
      const syl = syllableCount(rawSlice);
      if (syl < CONFIG.minSyllables || syl > CONFIG.maxSyllables) continue;

      const key = `${rawPos.start}:${rawPos.end}:${rawSlice}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          rawSpan: rawSlice,
          start: rawPos.start,
          end: rawPos.end,
          syllableStart: token.syllableStart,
          syllableEnd: token.syllableEnd,
          supportCount: 0,
          ranks: new Set(),
          imeWords: new Set(),
          tokenSources: new Set(),
        });
      }
      const entry = byKey.get(key);
      entry.supportCount++;
      entry.ranks.add(candidate.rank);
      entry.imeWords.add(imeWord);
      entry.tokenSources.add(token.source);
    }
  }

  return {
    trustedCount: trusted.length,
    spans: [...byKey.values()].map((e) => ({
      rawSpan: e.rawSpan,
      start: e.start,
      end: e.end,
      syllableStart: e.syllableStart,
      syllableEnd: e.syllableEnd,
      supportCount: e.ranks.size,
      candidateRank: Math.min(...e.ranks),
      imeWords: [...e.imeWords],
      tokenSources: [...e.tokenSources],
      source: 'local_raw_ime_diff',
    })),
  };
}

function simulateNormalizer(rawText, proposal, localSpans) {
  const asDiff = localSpans.map((s) => ({
    rawSpan: s.rawSpan,
    start: s.start,
    end: s.end,
    candidateRank: s.candidateRank,
    supportCount: s.supportCount,
  }));

  const before = normalizePinyinImeV2Spans(
    rawText,
    proposal.diffSpans,
    proposal.instabilityRegions,
    proposal.boundaryCompatibleTopKSpans,
    CONFIG
  );

  const after = normalizePinyinImeV2Spans(
    rawText,
    [...proposal.diffSpans, ...asDiff],
    proposal.instabilityRegions,
    proposal.boundaryCompatibleTopKSpans,
    CONFIG
  );

  const localOnly = normalizePinyinImeV2Spans(rawText, asDiff, [], [], CONFIG);

  return { before, after, localOnly };
}

function auditCase(c) {
  const raw = c.extra.raw_asr_text;
  const proposal = runPinyinImeV2SpanProposal({ rawAsrText: raw, dict, config: { topK: 5 } });
  const local = buildLocalRawImeDiffSpans(raw, proposal);
  const norm = simulateNormalizer(raw, proposal, local.spans);
  const selBefore = c.extra.fw_detector?.pinyinImeV2?.selectedSpanCount ?? 0;
  const fw = c.fw_triggered;

  const singleCharLocal = local.spans.filter((s) => s.rawSpan.length === 1).length;
  const multiCharLocal = local.spans.filter((s) => s.rawSpan.length >= 2).length;

  return {
    id: c.id,
    scenario: c.scenario,
    fw,
    selBefore,
    alignFailed: proposal.diagnostics.alignFailedCount,
    diffSpanCount: proposal.diagnostics.diffSpanCount,
    boundaryCount: proposal.diagnostics.boundaryCompatibleTopKSpanCount,
    trustedCount: local.trustedCount,
    localSpanCount: local.spans.length,
    localMultiChar: multiCharLocal,
    localSingleChar: singleCharLocal,
    localPassNorm: norm.localOnly.spans.length,
    localDroppedNorm: norm.localOnly.dropped.length,
    normBefore: norm.before.spans.length,
    normAfter: norm.after.spans.length,
    normGain: norm.after.spans.length - norm.before.spans.length,
    localSpans: local.spans.slice(0, 8),
  };
}

// d001 detailed token trace
const d001Raw = BATCH.cases.find((c) => c.id === 'd001')?.extra.raw_asr_text;
const d001Proposal = runPinyinImeV2SpanProposal({ rawAsrText: d001Raw, dict, config: { topK: 5 } });
const charRanges = buildCharSyllableRanges(d001Raw);
const { trusted: d001Trusted } = selectTrustedTopKCandidates(
  d001Proposal.candidates,
  d001Proposal.diagnostics.boundaryAlignmentScores
);

const d001TokenRows = [];
const seenTok = new Set();
for (const cand of d001Trusted) {
  for (const token of cand.tokens ?? []) {
    const key = `${cand.rank}:${token.syllableStart}:${token.syllableEnd}:${token.word}`;
    if (seenTok.has(key)) continue;
    seenTok.add(key);
    const rawPos = syllableRangeToRawCharRange(charRanges, token.syllableStart, token.syllableEnd);
    const rawSlice = rawPos ? d001Raw.slice(rawPos.start, rawPos.end) : '';
    const sc = token.syllableEnd - token.syllableStart;
    const syl = rawSlice ? syllableCount(rawSlice) : 0;
    const normalizeEqual = normalizeCompare(rawSlice, token.word);
    const shouldCreate =
      rawSlice &&
      token.word &&
      CJK_RE.test(rawSlice) &&
      !normalizeEqual &&
      sc >= 2 &&
      sc <= 5 &&
      rawSlice.length >= 2 &&
      rawSlice.length <= 6 &&
      syl >= 2 &&
      syl <= 5;
    d001TokenRows.push({
      rank: cand.rank,
      token: token.word,
      syllableStart: token.syllableStart,
      syllableEnd: token.syllableEnd,
      rawSlice,
      imeWord: token.word,
      rawStart: rawPos?.start,
      rawEnd: rawPos?.end,
      normalizeEqual,
      shouldCreateSpan: shouldCreate,
      tokenSource: token.source,
    });
  }
}

const d001Targets = d001TokenRows.filter(
  (r) =>
    (r.rawSlice && r.rawSlice.includes('钟') && r.rawSlice.includes('贝')) ||
    (r.rawSlice && r.rawSlice.includes('蓝')) ||
    r.rawSlice === '钟贝' ||
    r.rawSlice === '蓝美马分'
);

const allCases = BATCH.cases.filter((c) => !c.skip).map(auditCase);

const stats = {
  total: allCases.length,
  withLocalSpans: allCases.filter((c) => c.localSpanCount > 0).length,
  withLocalPassNorm: allCases.filter((c) => c.localPassNorm > 0).length,
  fwFalseWithLocalPass: allCases.filter((c) => !c.fw && c.localPassNorm > 0).length,
  emptyNormBeforeWithLocalPass: allCases.filter((c) => c.normBefore === 0 && c.localPassNorm > 0).length,
  normGainPositive: allCases.filter((c) => c.normGain > 0).length,
  totalLocalSpans: allCases.reduce((s, c) => s + c.localSpanCount, 0),
  totalLocalMultiChar: allCases.reduce((s, c) => s + c.localMultiChar, 0),
  totalLocalSingleChar: allCases.reduce((s, c) => s + c.localSingleChar, 0),
  totalLocalDropped: allCases.reduce((s, c) => s + c.localDroppedNorm, 0),
  totalLocalPassNorm: allCases.reduce((s, c) => s + c.localPassNorm, 0),
  fwTriggered: allCases.filter((c) => c.fw).length,
};

const top20Gain = allCases
  .filter((c) => c.localPassNorm > 0)
  .sort((a, b) => b.localPassNorm - a.localPassNorm || b.normGain - a.normGain)
  .slice(0, 20)
  .map((c) => ({
    id: c.id,
    scenario: c.scenario,
    fw: c.fw,
    selBefore: c.selBefore,
    localPassNorm: c.localPassNorm,
    normGain: c.normGain,
    localSpans: c.localSpans.map((s) => ({
      rawSpan: s.rawSpan,
      imeWords: s.imeWords,
      supportCount: s.supportCount,
    })),
    rawPreview: BATCH.cases.find((x) => x.id === c.id)?.extra.raw_asr_text?.slice(0, 48),
  }));

const d001Local = buildLocalRawImeDiffSpans(d001Raw, d001Proposal);
const d001Norm = simulateNormalizer(d001Raw, d001Proposal, d001Local.spans);

const output = {
  stats,
  d001: {
    raw: d001Raw,
    trustedCount: d001Local.trustedCount,
    localSpans: d001Local.spans,
    localPassNorm: d001Norm.localOnly.spans,
    normBefore: d001Norm.before.spans.length,
    normAfter: d001Norm.after.spans.length,
    targetTokenRows: d001Targets,
    keySpans: d001Local.spans.filter((s) => s.rawSpan === '钟贝' || s.rawSpan === '蓝美马分'),
  },
  d001TokenTraceSample: d001TokenRows.filter((r) => r.shouldCreateSpan).slice(0, 30),
  top20Gain,
  regression: {
    d002: allCases.find((c) => c.id === 'd002'),
    d003: allCases.find((c) => c.id === 'd003'),
  },
};

const outPath = path.join(__dirname, '_local-raw-ime-diff-audit-output.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ stats, d001Key: output.d001.keySpans, outPath }, null, 2));
