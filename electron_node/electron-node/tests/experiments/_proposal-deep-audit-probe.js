#!/usr/bin/env node
/** READONLY proposal deep audit probe */
const fs = require('fs');
const path = require('path');

const repoRoot = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = repoRoot;

const distRoot = path.join(__dirname, '../../dist/main/electron-node/main/src/fw-detector/pinyin-ime-v2');
const {
  loadPinyinImeV2Dictionaries,
  resolvePinyinImeV2DictDir,
} = require(path.join(distRoot, 'pinyin-ime-v2-dict-load.js'));
const { runPinyinImeV2SpanProposal } = require(path.join(distRoot, 'run-pinyin-ime-v2-span-proposal.js'));
const { diffReplacementSpans } = require(path.join(distRoot, 'pinyin-ime-v2-diff-spans.js'));
const {
  buildCharSyllableRanges,
  textToPinyinStream,
} = require(path.join(distRoot, 'pinyin-ime-v2-pinyin-stream.js'));
const {
  syllableRangeToRawCharRange,
  buildBoundaryCompatibleTopKDiff,
  selectTrustedTopKCandidates,
} = require(path.join(distRoot, 'pinyin-ime-v2-boundary-compatible-topk-diff.js'));

const BATCH = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../lexicon-tone-dialog200-spanselector-batch-result.json'), 'utf8')
);
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir('node_runtime/pinyin-ime-v2/dict'));

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function analyzeAlign(raw, cand) {
  const m = raw.length;
  const n = cand.length;
  const editDistance = levenshtein(raw, cand);
  const threshold = Math.max(m, n) * 0.6;
  const r = diffReplacementSpans(raw, cand);
  let alignFailedReason = 'ok';
  if (!raw.length || !cand.length) alignFailedReason = 'empty_input';
  else if (editDistance > threshold) alignFailedReason = 'editDistance_gt_0.6_maxLen';
  else if (r.alignFailed) alignFailedReason = 'backtrace_has_ins_or_del';
  return {
    editDistance,
    threshold: Math.round(threshold * 100) / 100,
    alignSuccess: !r.alignFailed,
    alignFailedReason,
    diffSpanCount: r.spans.length,
    diffSpans: r.spans,
  };
}

function findSubstring(raw, sub) {
  const idx = raw.indexOf(sub);
  if (idx < 0) return null;
  const end = idx + sub.length;
  const charRanges = buildCharSyllableRanges(raw);
  const { syllables } = textToPinyinStream(raw);
  for (const r of charRanges) {
    if (idx >= r.charStart && end <= r.charEnd) {
      const runLen = r.charEnd - r.charStart;
      const sc = r.syllableEnd - r.syllableStart;
      const relStart = idx - r.charStart;
      const relEnd = end - r.charStart;
      const cps = runLen / sc;
      const sylStart = r.syllableStart + Math.floor(relStart / cps);
      const sylEnd = r.syllableStart + Math.ceil(relEnd / cps);
      return {
        substring: sub,
        charStart: idx,
        charEnd: end,
        syllableStart: sylStart,
        syllableEnd: sylEnd,
        syllables: syllables.slice(sylStart, sylEnd),
        mappedRaw: syllableRangeToRawCharRange(charRanges, sylStart, sylEnd),
      };
    }
  }
  return { substring: sub, charStart: idx, charEnd: end };
}

function collectAllVariantIntervals(raw, candidates, alignmentScores) {
  const { syllables } = textToPinyinStream(raw);
  const charRanges = buildCharSyllableRanges(raw);
  const trusted = selectTrustedTopKCandidates(candidates, alignmentScores).trusted;
  const seen = new Set();
  const out = [];
  for (const c of trusted) {
    for (const t of c.tokens ?? []) {
      const key = `${t.syllableStart}:${t.syllableEnd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const variants = new Set();
      for (const c2 of trusted) {
        const parts = [];
        for (const tok of c2.tokens ?? []) {
          if (tok.syllableStart < t.syllableEnd && tok.syllableEnd > t.syllableStart) {
            parts.push(tok.word);
          }
        }
        const w = parts.join('');
        if (w) variants.add(w);
      }
      if (variants.size < 2) continue;
      const rawPos = syllableRangeToRawCharRange(charRanges, t.syllableStart, t.syllableEnd);
      out.push({
        syllableStart: t.syllableStart,
        syllableEnd: t.syllableEnd,
        variants: [...variants],
        rawPos,
        rawSpan: rawPos ? raw.slice(rawPos.start, rawPos.end) : null,
        isOutputSpan: false,
      });
    }
  }
  return out;
}

const d001c = BATCH.cases.find((c) => c.id === 'd001');
const raw = d001c.extra.raw_asr_text;
const proposal = runPinyinImeV2SpanProposal({ rawAsrText: raw, dict, config: { topK: 5 } });
const d001TopK = proposal.candidates.map((c) => ({
  rank: c.rank,
  text: c.text,
  score: c.score,
  ...analyzeAlign(raw, c.text),
}));

const { syllables } = textToPinyinStream(raw);
const allIntervals = collectAllVariantIntervals(
  raw,
  proposal.candidates,
  proposal.diagnostics.boundaryAlignmentScores
);
for (const s of proposal.boundaryCompatibleTopKSpans) {
  const hit = allIntervals.find(
    (i) => i.syllableStart === s.syllableStart && i.syllableEnd === s.syllableEnd
  );
  if (hit) hit.isOutputSpan = true;
}

// dialog200
const stats = {
  total: 0,
  alignFailedCountGt0: 0,
  diffSpanCount0: 0,
  diff0BoundaryPositive: 0,
  alignFailedAll5Diff0: 0,
  alignFailedAll5NoFw: 0,
  alignFailedAll5NoSelected: 0,
};
const top20 = [];

for (const c of BATCH.cases.filter((x) => !x.skip)) {
  stats.total++;
  const r = c.extra.raw_asr_text;
  const p = runPinyinImeV2SpanProposal({ rawAsrText: r, dict, config: { topK: 5 } });
  const d = p.diagnostics;
  const sel = c.extra.fw_detector?.pinyinImeV2?.selectedSpanCount ?? 0;
  if (d.alignFailedCount > 0) stats.alignFailedCountGt0++;
  if (d.diffSpanCount === 0) stats.diffSpanCount0++;
  if (d.diffSpanCount === 0 && d.diffZeroBoundaryPositive > 0) stats.diff0BoundaryPositive++;
  if (d.alignFailedCount === p.candidates.length && d.diffSpanCount === 0) {
    stats.alignFailedAll5Diff0++;
    if (!c.fw_triggered) stats.alignFailedAll5NoFw++;
    if (sel === 0) stats.alignFailedAll5NoSelected++;
    top20.push({
      id: c.id,
      scenario: c.scenario,
      alignFailedCount: d.alignFailedCount,
      boundaryTopK: d.boundaryCompatibleTopKSpanCount,
      diffZeroBoundaryPositive: d.diffZeroBoundaryPositive,
      selectedSpanCount: sel,
      fw_triggered: c.fw_triggered,
      rawPreview: r.slice(0, 50),
    });
  }
}

const cafeIds = ['d001', 'd002', 'd003', 'd046', 'd047', 'd091', 'd092', 'd181'];
const cafeCases = cafeIds.map((id) => {
  const c = BATCH.cases.find((x) => x.id === id);
  const r = c.extra.raw_asr_text;
  const p = runPinyinImeV2SpanProposal({ rawAsrText: r, dict, config: { topK: 5 } });
  const targets = {
    d001: ['钟贝', '蓝美马分'],
    d002: ['美食', '大悲'],
    d003: ['少病', '小背'],
    d046: ['中貝', '知识蛋糕'],
    d047: ['大背'],
    d091: ['中辈', '被裹'],
    d092: ['大背'],
    d181: ['中贝', '蓝没马分'],
  }[id] || [];
  const foundInDiff = p.diffSpans.filter((s) => targets.some((t) => s.rawSpan.includes(t) || t.includes(s.rawSpan)));
  const foundInBoundary = p.boundaryCompatibleTopKSpans.filter((s) =>
    targets.some((t) => s.rawSpan.includes(t) || t.includes(s.rawSpan))
  );
  return {
    id,
    targets,
    diffSpanCount: p.diffSpanCount,
    alignFailedCount: p.diagnostics.alignFailedCount,
    boundaryCount: p.diagnostics.boundaryCompatibleTopKSpanCount,
    foundInDiff,
    foundInBoundary,
    boundarySpans: p.boundaryCompatibleTopKSpans.map((s) => ({
      rawSpan: s.rawSpan,
      start: s.start,
      end: s.end,
      variants: s.variants,
    })),
    diffSpans: p.diffSpans,
    fw: c.fw_triggered,
    selected: c.extra.fw_detector?.pinyinImeV2?.selectedSpanCount ?? 0,
  };
});

console.log(
  JSON.stringify(
    {
      d001Raw: raw,
      d001TopK,
      zhongbei: findSubstring(raw, '钟贝'),
      lanmei: findSubstring(raw, '蓝美马分'),
      boundaryOutput: proposal.boundaryCompatibleTopKSpans,
      allVariantIntervals: allIntervals,
      charSyllableRanges: buildCharSyllableRanges(raw),
      dialog200: stats,
      top20: top20.slice(0, 20),
      cafeCases,
    },
    null,
    2
  )
);
