#!/usr/bin/env node
/**
 * Tone miss root-cause classification + span window stats (read-only runtime probe).
 * Uses Electron :5020; does not modify production code.
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const OUT = path.join(__dirname, 'mainchain_acceptance_2026_07_29');
const ROWS = path.join(OUT, 'rows.jsonl');
const PORT = 5020;
const MISS_LIMIT = process.env.MISS_PROBE_LIMIT ? parseInt(process.env.MISS_PROBE_LIMIT, 10) : 60;
const SPAN_SAMPLE = process.env.SPAN_SAMPLE_N ? parseInt(process.env.SPAN_SAMPLE_N, 10) : 30;

function argmax(post) {
  const keys = ['t1', 't2', 't3', 't4', 't5'];
  let best = 1;
  let bestV = -1;
  for (let i = 0; i < keys.length; i++) {
    const v = post?.[keys[i]] ?? 0;
    if (v > bestV) {
      bestV = v;
      best = i + 1;
    }
  }
  return best;
}

function buildWordTimeSpans(rawText, segments) {
  const spans = [];
  let searchFrom = 0;
  for (let segIdx = 0; segIdx < (segments || []).length; segIdx++) {
    const segment = segments[segIdx];
    for (const word of segment.words || []) {
      const token = (word.word || '').trim();
      if (!token || word.start == null || word.end == null) continue;
      const idx = rawText.indexOf(token, searchFrom);
      if (idx < 0) {
        spans.push({
          word: token,
          rawStart: null,
          rawEnd: null,
          start: word.start,
          end: word.end,
          indexOfFailed: true,
        });
        continue;
      }
      searchFrom = idx + token.length;
      spans.push({
        word: token,
        rawStart: idx,
        rawEnd: idx + token.length,
        start: word.start,
        end: word.end,
        indexOfFailed: false,
      });
    }
  }
  return spans;
}

function normalizeSlices(tone) {
  const slices = tone?.acousticToneSlices || tone?.slices || [];
  return slices.map((s) => ({
    start: s.start,
    end: s.end,
    tonePosterior: s.tonePosterior,
  }));
}

function mapToneEvidenceForRecall(rawStart, rawEnd, syllableStart, syllableEnd, slices, wordTimeSpans) {
  const coveringAll = wordTimeSpans.filter(
    (span) => (span.rawEnd ?? -1) > rawStart && (span.rawStart ?? -1) < rawEnd && span.rawStart != null
  );
  if (!coveringAll.length) {
    return { pattern: null, fail: 'NO_WORDTIMESPAN_COVERING_WINDOW', windowTimeRange: null, detail: {} };
  }
  const windowTimeRange = {
    start: coveringAll[0].start,
    end: coveringAll[coveringAll.length - 1].end,
  };
  const syllableCount = Math.max(0, Math.floor(syllableEnd) - Math.floor(syllableStart));
  const charLen = Math.max(0, Math.floor(rawEnd) - Math.floor(rawStart));
  if (syllableCount <= 0 || charLen <= 0) {
    return { pattern: null, fail: 'EMPTY_SYLLABLE_OR_CHAR_RANGE', windowTimeRange, detail: { syllableCount, charLen } };
  }
  if (!slices.length) {
    return { pattern: null, fail: 'NO_ACOUSTIC_SLICES', windowTimeRange, detail: {} };
  }

  const pattern = [];
  for (let i = 0; i < syllableCount; i++) {
    const charOffset =
      syllableCount === charLen ? i : Math.min(charLen - 1, Math.floor((i * charLen) / syllableCount));
    const charStart = Math.floor(rawStart) + charOffset;
    const charEnd = charStart + 1;
    const covering = wordTimeSpans.filter(
      (span) => (span.rawEnd ?? -1) > charStart && (span.rawStart ?? -1) < charEnd && span.rawStart != null
    );
    if (!covering.length) {
      return {
        pattern: null,
        fail: 'NO_WORDTIMESPAN_FOR_SYLLABLE_CHAR',
        windowTimeRange,
        detail: { i, charStart, charEnd, rawWindow: [rawStart, rawEnd], syllableCount, charLen },
      };
    }
    covering.sort(
      (a, b) => (a.rawEnd ?? 0) - (a.rawStart ?? 0) - ((b.rawEnd ?? 0) - (b.rawStart ?? 0))
    );
    const span = covering[0];
    const hits = slices
      .filter((slice) => slice.end > span.start && slice.start < span.end)
      .sort((a, b) => a.start - b.start);
    if (!hits.length) {
      return {
        pattern: null,
        fail: 'NO_SLICE_OVERLAP_WORD_TIME',
        windowTimeRange,
        detail: {
          i,
          word: span.word,
          wordTime: [span.start, span.end],
          sliceCount: slices.length,
          nearestSlices: slices
            .map((s) => ({ start: s.start, end: s.end, dist: Math.min(Math.abs(s.start - span.start), Math.abs(s.end - span.end)) }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 3),
        },
      };
    }
    pattern.push(argmax(hits[0].tonePosterior));
  }
  return { pattern, fail: null, windowTimeRange, detail: {} };
}

function estimateSyllableWindows(rawText) {
  // Approximate: CJK chars as syllables (matches common Chinese ASR path for span counts)
  const chars = [...rawText].filter((c) => /[\u4e00-\u9fff]/.test(c));
  const n = chars.length;
  let theoretical = 0;
  for (let start = 0; start < n; start++) {
    for (let len = 2; len <= Math.min(5, n - start); len++) theoretical++;
  }
  let theoretical1to5 = 0;
  for (let start = 0; start < n; start++) {
    theoretical1to5 += Math.min(5, n - start);
  }
  return { cjkCount: n, theoreticalWindows2to5: theoretical, theoreticalWindows1to5: theoretical1to5 };
}

async function runCase(caseId, file) {
  const wavPath = path.join(PROJECT_ROOT, 'test wav', 'dialog_200', file);
  const res = await fetch(`http://127.0.0.1:${PORT}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      session_id: `miss-rc-${caseId}-${Date.now()}`,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function analyzeCase(caseId, data) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const spanV4 = fw.spanAssemblyV4 || {};
  const tone = spanV4.tone || fw.tone || {};
  const raw = (extra.raw_asr_text || data.text_asr || '').trim();
  const segments = data.segments || extra.asr_segments || [];
  // utterance tone payload — SSOT (must equal Mapping slice count)
  const utteranceTone = extra.utterance_tone || {};
  const slices = normalizeSlices(utteranceTone);
  const wts = buildWordTimeSpans(raw, segments);
  const indexOfFailed = wts.filter((w) => w.indexOfFailed).length;
  const mappedWts = wts.filter((w) => !w.indexOfFailed);

  const examples = tone.exampleToneWindows || [];
  const windowClassifications = [];
  for (const ex of examples) {
    if (ex.acousticTonePattern?.length) {
      windowClassifications.push({ text: ex.text, pinyinKey: ex.pinyinKey, result: 'HIT', fail: null });
      continue;
    }
    // Recover raw range by locating window text in raw
    const text = ex.text || '';
    let rawStart = raw.indexOf(text);
    let rawEnd = rawStart >= 0 ? rawStart + text.length : -1;
    // Traditional/simplified mismatch: try normalized search
    if (rawStart < 0 && text) {
      rawStart = [...raw].findIndex((_, i) => raw.slice(i, i + text.length) === text);
      if (rawStart >= 0) rawEnd = rawStart + text.length;
    }
    const sylCount = (ex.pinyinKey || '').split('|').filter(Boolean).length || Math.max(1, [...text].length);
    if (rawStart < 0) {
      windowClassifications.push({
        text,
        pinyinKey: ex.pinyinKey,
        result: 'MISS',
        fail: 'WINDOW_TEXT_NOT_IN_RAW',
        detail: { rawPreview: raw.slice(0, 80) },
      });
      continue;
    }
    const mapped = mapToneEvidenceForRecall(rawStart, rawEnd, 0, sylCount, slices, mappedWts);
    windowClassifications.push({
      text,
      pinyinKey: ex.pinyinKey,
      result: mapped.pattern ? 'HIT_REPLAY' : 'MISS',
      fail: mapped.fail,
      detail: mapped.detail,
      pattern: mapped.pattern,
      hasWindowTimeInDiag: !!ex.windowTimeRange,
      diagWindowTime: ex.windowTimeRange,
      replayWindowTime: mapped.windowTimeRange,
      mappingMissReason: ex.mappingMissReason,
      mappingMissAttribution: ex.mappingMissAttribution,
    });
  }

  const spanStats = estimateSyllableWindows(raw);
  const summary = fw.summary || {};

  return {
    id: caseId,
    raw,
    toneEvidenceSliceCount: tone.toneSliceCount ?? slices.length,
    apiToneSliceCount: slices.length,
    wordTimeSpanBuilt: wts.length,
    wordTimeSpanMapped: mappedWts.length,
    indexOfFailed,
    evidenceProductionStatusCounts: tone.evidenceProductionStatusCounts || {},
    mappingMissReasonCounts: tone.mappingMissReasonCounts || {},
    mappingMissAttributionCounts: tone.mappingMissAttributionCounts || {},
    toneDiag: {
      attempt: tone.ngramTonePatternAttemptCount,
      hit: tone.ngramTonePatternHitCount,
      miss: tone.ngramTonePatternMissCount,
      overlapMiss: tone.toneOverlapMissCount,
      tonePatternMappingMiss: tone.tonePatternMappingMissCount,
      windowTimeAttempt: tone.windowTimeAttemptCount,
      windowTimeHit: tone.windowTimeHitCount,
    },
    windowClassifications,
    spanApprox: spanStats,
    summary: {
      spanCount: summary.spanCount,
      candidateCount: summary.candidateCount,
    },
    ltrTrace: spanV4.ltr || spanV4.fineSpan || null,
    windowsFromDiag: spanV4.windows || spanV4.globalWindows || null,
  };
}

async function main() {
  const rows = fs
    .readFileSync(ROWS, 'utf8')
    .trim()
    .split(/\n/)
    .map((l) => JSON.parse(l));
  const missRows = rows.filter((r) => r.ok && r.tone.patternMiss > 0);
  const hitRows = rows.filter((r) => r.ok && r.tone.patternMiss === 0 && r.tone.patternAttempt > 0);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'test wav', 'dialog_200', 'cases.manifest.json'), 'utf8')
  );
  const cases = manifest.cases || manifest;
  const byId = Object.fromEntries(cases.map((c) => [c.id, c]));

  // Probe miss cases (cap)
  const missProbeIds = missRows.slice(0, MISS_LIMIT).map((r) => r.id);
  const missAnalyses = [];
  for (let i = 0; i < missProbeIds.length; i++) {
    const id = missProbeIds[i];
    const file = byId[id]?.file || `dialog_${id}.wav`;
    process.stdout.write(`[miss-rc] ${i + 1}/${missProbeIds.length} ${id} ... `);
    try {
      const data = await runCase(id, file);
      const a = analyzeCase(id, data);
      missAnalyses.push(a);
      const fails = a.windowClassifications.filter((w) => w.result === 'MISS').map((w) => w.fail);
      console.log('diagMiss', a.toneDiag.miss, 'fails', [...new Set(fails)].join(',') || 'none');
      fs.writeFileSync(path.join(OUT, `miss_rc_${id}.json`), JSON.stringify(a, null, 2));
    } catch (e) {
      console.log('ERR', e.message);
      missAnalyses.push({ id, error: e.message });
    }
  }

  // Random 30 span samples from all 200
  const rng = (seed) => {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  };
  const rand = rng(20260729);
  const shuffled = [...rows].sort(() => rand() - 0.5);
  const spanSampleIds = shuffled.slice(0, SPAN_SAMPLE).map((r) => r.id);
  const spanSamples = [];
  for (let i = 0; i < spanSampleIds.length; i++) {
    const id = spanSampleIds[i];
    // Prefer already probed miss analyses
    let a = missAnalyses.find((x) => x.id === id && !x.error);
    if (!a) {
      const file = byId[id]?.file || `dialog_${id}.wav`;
      process.stdout.write(`[span] ${i + 1}/${spanSampleIds.length} ${id} ... `);
      try {
        const data = await runCase(id, file);
        a = analyzeCase(id, data);
        console.log('ok cjk', a.spanApprox.cjkCount, 'win2-5', a.spanApprox.theoreticalWindows2to5);
      } catch (e) {
        console.log('ERR', e.message);
        a = { id, error: e.message };
      }
    }
    spanSamples.push(a);
  }

  // Aggregate fail reasons from window classifications + diag counters
  const failCounts = {};
  let classifiedWindows = 0;
  for (const a of missAnalyses) {
    if (a.error) continue;
    for (const w of a.windowClassifications) {
      if (w.result !== 'MISS') continue;
      classifiedWindows += 1;
      failCounts[w.fail || 'UNKNOWN'] = (failCounts[w.fail || 'UNKNOWN'] || 0) + 1;
    }
  }

  // Aggregate diag-level miss split for ALL miss rows from original batch (no re-run)
  let sumOverlapMiss = 0;
  let sumMismatch = 0;
  // Re-read from miss analyses only for overlap split; for full 72 use proportional from probed
  for (const a of missAnalyses) {
    if (a.error) continue;
    sumOverlapMiss += a.toneDiag.overlapMiss || 0;
    sumMismatch += a.toneDiag.overlapMismatch || 0;
  }

  const aggregate = {
    originalBatch: {
      attempt: 288,
      hit: 216,
      miss: 72,
      missCases: missRows.length,
      hitAllCases: hitRows.length,
    },
    missProbe: {
      probedCases: missAnalyses.filter((a) => !a.error).length,
      failCounts,
      classifiedMissWindows: classifiedWindows,
      diagOverlapMissSum: sumOverlapMiss,
      diagMismatchSum: sumMismatch,
    },
    meaningOf288:
      'Sum of ngramTonePatternAttemptCount over 200 utterances = count of recallable windows that entered recallTopKForWindows with toneActive (after blockedFilter). NOT total Fine Spans / not all generated sliding windows.',
    spanSamples: spanSampleIds,
  };

  fs.writeFileSync(path.join(OUT, 'miss_rootcause_aggregate.json'), JSON.stringify(aggregate, null, 2));
  fs.writeFileSync(path.join(OUT, 'miss_rootcause_cases.json'), JSON.stringify(missAnalyses, null, 2));
  fs.writeFileSync(path.join(OUT, 'span_random30.json'), JSON.stringify(spanSamples, null, 2));
  console.log(JSON.stringify(aggregate, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
