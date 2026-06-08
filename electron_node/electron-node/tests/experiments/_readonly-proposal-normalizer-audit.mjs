#!/usr/bin/env node
/** READONLY audit probe — not part of product code */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = repoRoot;

const distRoot = path.join(__dirname, '../../dist/main/electron-node/main/src/fw-detector/pinyin-ime-v2');
const {
  loadPinyinImeV2Dictionaries,
  resolvePinyinImeV2DictDir,
} = require(path.join(distRoot, 'pinyin-ime-v2-dict-load.js'));
const { runPinyinImeV2SpanProposal } = require(path.join(distRoot, 'run-pinyin-ime-v2-span-proposal.js'));
const { normalizePinyinImeV2Spans } = require(path.join(distRoot, 'pinyin-ime-v2-span-normalizer.js'));
const { DEFAULT_PINYIN_IME_V2 } = require(path.join(distRoot, 'pinyin-ime-v2-config.js'));

const BATCH = path.join(__dirname, '../lexicon-tone-dialog200-spanselector-batch-result.json');
const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const dictDir = resolvePinyinImeV2DictDir('node_runtime/pinyin-ime-v2/dict');
const dict = loadPinyinImeV2Dictionaries(dictDir);
const normConfig = {
  minSpanChars: DEFAULT_PINYIN_IME_V2.minSpanChars,
  maxSpanChars: DEFAULT_PINYIN_IME_V2.maxSpanChars,
  minSyllables: DEFAULT_PINYIN_IME_V2.minSyllables,
  maxSyllables: DEFAULT_PINYIN_IME_V2.maxSyllables,
};

function auditCase(rawAsrText) {
  const proposal = runPinyinImeV2SpanProposal({ rawAsrText, dict, config: { topK: 5 } });
  const normalized = normalizePinyinImeV2Spans(
    rawAsrText,
    proposal.diffSpans,
    proposal.instabilityRegions,
    proposal.boundaryCompatibleTopKSpans,
    normConfig
  );

  const intervalsBeforeFilter = [];
  const merged = normalized.spans.length + normalized.dropped.length;

  return { proposal, normalized, mergedIntervalCount: merged };
}

function sourceLabel(span) {
  if (span.fromBoundaryTopKDiff) return 'boundaryTopK';
  if (span.fromInstability) return 'instability';
  return 'diff';
}

const d001Raw = batch.cases.find((c) => c.id === 'd001')?.extra?.raw_asr_text;
const d001 = auditCase(d001Raw);

const ruleCounts = {
  single_char: 0,
  too_long: 0,
  syllable_out_of_range: 0,
  intervalMerge: 0,
  kept: 0,
};
const inputSpanCounts = { diff: 0, instability: 0, boundaryTopK: 0 };
let casesWithDrops = 0;

for (const c of batch.cases.filter((x) => !x.skip)) {
  const raw = c.extra?.raw_asr_text || '';
  if (!raw) continue;
  const { proposal, normalized } = auditCase(raw);
  inputSpanCounts.diff += proposal.diffSpans.length;
  inputSpanCounts.instability += proposal.instabilityRegions.length;
  inputSpanCounts.boundaryTopK += proposal.boundaryCompatibleTopKSpans.length;

  const inputTotal =
    proposal.diffSpans.length +
    proposal.instabilityRegions.length +
    proposal.boundaryCompatibleTopKSpans.length;
  const mergedTotal = normalized.spans.length + normalized.dropped.length;
  if (mergedTotal < inputTotal) {
    ruleCounts.intervalMerge += inputTotal - mergedTotal;
  }

  for (const d of normalized.dropped) {
    ruleCounts[d.reason] = (ruleCounts[d.reason] || 0) + 1;
  }
  ruleCounts.kept += normalized.spans.length;
  if (normalized.dropped.length > 0) casesWithDrops++;
}

// d001 detailed trace
const d001Intervals = [];
for (const d of d001.normalized.dropped) {
  d001Intervals.push({
    rawSpan: d.span.rawSpan,
    start: d.span.start,
    end: d.span.end,
    source: sourceLabel(d.span),
    action: 'dropped',
    reason: d.reason,
  });
}
for (const s of d001.normalized.spans) {
  d001Intervals.push({
    rawSpan: s.rawSpan,
    start: s.start,
    end: s.end,
    source: sourceLabel(s),
    action: 'kept',
    reason: null,
  });
}

// Simulate relax rules for d001
function simulateRelax(rawAsrText, skipRules = []) {
  const proposal = runPinyinImeV2SpanProposal({ rawAsrText, dict, config: { topK: 5 } });
  const intervals = [];
  for (const s of proposal.diffSpans) {
    intervals.push({ start: s.start, end: s.end, supportCount: s.supportCount, fromInstability: false, fromBoundaryTopKDiff: false });
  }
  for (const s of proposal.instabilityRegions) {
    intervals.push({ start: s.start, end: s.end, supportCount: s.supportCount, fromInstability: true, fromBoundaryTopKDiff: false });
  }
  for (const s of proposal.boundaryCompatibleTopKSpans) {
    intervals.push({ start: s.start, end: s.end, supportCount: s.supportCount, fromInstability: false, fromBoundaryTopKDiff: true, variants: s.variants });
  }
  // merge adjacent (always)
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const cur of intervals) {
    const last = merged[merged.length - 1];
    if (last && (cur.start <= last.end || cur.start <= last.end + 1)) {
      last.end = Math.max(last.end, cur.end);
      last.fromInstability = last.fromInstability || cur.fromInstability;
      last.fromBoundaryTopKDiff = last.fromBoundaryTopKDiff || cur.fromBoundaryTopKDiff;
    } else merged.push({ ...cur });
  }
  const kept = [];
  for (const interval of merged) {
    const rawSpan = rawAsrText.slice(interval.start, interval.end);
    const charLen = rawSpan.length;
    if (!skipRules.includes('single_char') && charLen < normConfig.minSpanChars) continue;
    if (!skipRules.includes('too_long') && charLen > normConfig.maxSpanChars) continue;
    if (!skipRules.includes('syllable_out_of_range')) {
      const { textToSyllables } = require(path.join(__dirname, '../../dist/main/electron-node/main/src/lexicon/phonetic/pinyin.js'));
      const sc = textToSyllables(rawSpan.trim()).length;
      if (sc < normConfig.minSyllables || sc > normConfig.maxSyllables) continue;
    }
    kept.push({ rawSpan, start: interval.start, end: interval.end, fromBoundaryTopKDiff: interval.fromBoundaryTopKDiff });
  }
  return { kept, merged, proposal };
}

const relaxScenarios = [
  { name: 'baseline', skip: [] },
  { name: 'skip_syllable_gate', skip: ['syllable_out_of_range'] },
  { name: 'skip_merge', skip: [] /* handled separately */ },
  { name: 'skip_maxSpanChars', skip: ['too_long'] },
  { name: 'skip_single_char', skip: ['single_char'] },
];

const sims = {};
for (const sc of relaxScenarios) {
  sims[sc.name] = simulateRelax(d001Raw, sc.skip);
}

// What if no merge - process each input span separately
function noMerge(rawAsrText) {
  const proposal = runPinyinImeV2SpanProposal({ rawAsrText, dict, config: { topK: 5 } });
  const all = [
    ...proposal.boundaryCompatibleTopKSpans.map((s) => ({ ...s, src: 'boundaryTopK' })),
    ...proposal.diffSpans.map((s) => ({ ...s, src: 'diff' })),
  ];
  const results = [];
  for (const s of all) {
    const n = normalizePinyinImeV2Spans(rawAsrText, s.src === 'diff' ? [s] : [], [], s.src === 'boundaryTopK' ? [s] : [], normConfig);
    results.push({ input: s, kept: n.spans, dropped: n.dropped });
  }
  return { proposal, results };
}

const out = {
  d001Raw,
  d001Proposal: {
    diffSpans: d001.proposal.diffSpans,
    instabilityRegions: d001.proposal.instabilityRegions,
    boundaryCompatibleTopKSpans: d001.proposal.boundaryCompatibleTopKSpans,
    diagnostics: d001.proposal.diagnostics,
    candidates: d001.proposal.candidates.map((c) => ({ rank: c.rank, text: c.text, score: c.score })),
  },
  d001Normalizer: {
    dropped: d001.normalized.dropped.map((d) => ({
      rawSpan: d.span.rawSpan,
      start: d.span.start,
      end: d.span.end,
      source: sourceLabel(d.span),
      reason: d.reason,
      charLen: d.span.rawSpan.length,
    })),
    kept: d001.normalized.spans,
    mergedIntervalCount: d001.mergedIntervalCount,
  },
  d001NoMergePerSpan: noMerge(d001Raw),
  relaxSimulations: sims,
  dialog200RuleCounts: ruleCounts,
  casesWithDrops,
  inputSpanCounts,
};

process.stdout.write(JSON.stringify(out, null, 2));
