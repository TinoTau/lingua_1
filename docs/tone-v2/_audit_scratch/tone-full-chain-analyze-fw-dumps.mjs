/**
 * Analyze FW-direct dumps: WordTimeSpan / Pattern / Readiness metrics.
 * TEMP diagnostic — no production Decision change.
 *
 * Usage: node tone-full-chain-analyze-fw-dumps.mjs <outDir>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repoRoot, 'electron_node/electron-node');
const DIST = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.resolve(process.argv[2] || path.join(__dirname, 'tone_full_chain_runtime_2026_07_29'));

const {
  normalizeAcousticSlices,
  buildWordTimeSpans,
  extractAcousticTonePatternByTime,
  selectSlicesByTimeOverlap,
} = require(path.join(DIST, 'fw-detector/tone-time-align.js'));
const { buildUtteranceSyllableCoordinate } = require(
  path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { resolveToneRecallReadiness } = require(
  path.join(DIST, 'lexicon-v2/tone-recall-readiness.js')
);
const { resolveTimestampToneState } = require(
  path.join(DIST, 'fw-detector/span-assembly-shared/tone-recall.js')
);

function argmaxTone(posterior) {
  if (!posterior) return null;
  const vals = [posterior.t1, posterior.t2, posterior.t3, posterior.t4, posterior.t5];
  if (vals.some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  let best = 0;
  for (let i = 1; i < 5; i += 1) if (vals[i] > vals[best]) best = i;
  return best + 1;
}

function rate(n, d) {
  return d > 0 ? Number(((n / d) * 100).toFixed(2)) : null;
}

function analyzeCase(row) {
  const rawText = (row.rawText || '').trim();
  const segments = row.segments || [];
  const tone = row.utterance_tone || {};
  const slices = normalizeAcousticSlices(tone.acousticToneSlices || []);
  const batchIndices = segments.map((_, i) => i);
  const spans = buildWordTimeSpans(rawText, segments, [0], [0], batchIndices);
  const toneState = resolveTimestampToneState(slices, true);

  // ASR word stats
  let asrWords = 0;
  let asrValid = 0;
  let asrInvalid = 0;
  let overlap = 0;
  let gap = 0;
  const ordered = [];
  for (const seg of segments) {
    for (const w of seg.words || []) {
      asrWords += 1;
      const token = (w.word || '').trim();
      const ok = token && typeof w.start === 'number' && typeof w.end === 'number' && w.end > w.start;
      if (ok) {
        asrValid += 1;
        ordered.push({ token, start: w.start, end: w.end });
      } else asrInvalid += 1;
    }
  }
  ordered.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].start < ordered[i - 1].end) overlap += 1;
    if (ordered[i].start - ordered[i - 1].end > 0.35) gap += 1;
  }

  // slice stats
  let invalidPosterior = 0;
  let invalidTone = 0;
  let sliceOverlap = 0;
  let sliceGap = 0;
  const sortedSlices = [...slices].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sortedSlices.length; i += 1) {
    const t = argmaxTone(sortedSlices[i].tonePosterior);
    if (t == null) invalidPosterior += 1;
    else if (t < 1 || t > 5) invalidTone += 1;
    if (i > 0) {
      if (sortedSlices[i].start < sortedSlices[i - 1].end) sliceOverlap += 1;
      if (sortedSlices[i].start - sortedSlices[i - 1].end > 0.05) sliceGap += 1;
    }
  }

  const multiCharTokens = spans.filter((s) => (s.rawEnd ?? 0) - (s.rawStart ?? 0) > 1).length;
  const coordinate = buildUtteranceSyllableCoordinate(rawText);
  const { buildLexicalWindowQueries } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/build-lexical-window-queries.js')
  );
  const lexicalWindows = buildLexicalWindowQueries({
    rawText,
    globalSyllables: coordinate.syllables || [],
    coarseSpans: [],
    charSyllableRanges: coordinate.ranges || [],
  });
  const byLen = {};
  for (let L = 1; L <= 5; L += 1) {
    byLen[L] = {
      windows: 0,
      ready: 0,
      no_pattern: 0,
      invalid_pattern: 0,
      caller_disabled: 0,
      runtime_unsupported: 0,
      char_eq_syl: 0,
      overlap_eq_char: 0,
      overlap_eq_syl: 0,
      time_range_ok: 0,
      pattern_ok: 0,
    };
  }
  const windows = [];
  const failureSamples = [];
  for (const lw of lexicalWindows) {
    const rawStart = lw.rawStart;
    const rawEnd = lw.rawEnd;
    const s = lw.syllableStart;
    const e = lw.syllableEnd;
    const windowPinyin = (coordinate.syllables || []).slice(s, e);
    const rawSpanLength = rawEnd - rawStart;
    const syllableSpanLength = e - s;
    const len = syllableSpanLength;
    if (len < 1 || len > 5) continue;
    const stats = byLen[len];
    stats.windows += 1;
    if (rawSpanLength === syllableSpanLength) stats.char_eq_syl += 1;

    const extracted = extractAcousticTonePatternByTime(
      rawStart,
      rawEnd,
      s,
      e,
      slices,
      spans
    );
    const wtr = extracted.windowTimeRange;
    const overlapSlices = wtr ? selectSlicesByTimeOverlap(slices, wtr) : [];
    if (wtr) stats.time_range_ok += 1;
    if (overlapSlices.length === rawSpanLength) stats.overlap_eq_char += 1;
    if (overlapSlices.length === syllableSpanLength) stats.overlap_eq_syl += 1;

    const pattern = extracted.pattern;
    const readiness = resolveToneRecallReadiness({
      syllables: windowPinyin,
      runtimeSupportsTone: true,
      acousticTonePattern: pattern ?? undefined,
      toneCallerEnabled: toneState.toneEnabled,
    });
    if (readiness.state === 'ready') stats.ready += 1;
    else if (readiness.state === 'no_pattern') stats.no_pattern += 1;
    else if (readiness.state === 'invalid_pattern') stats.invalid_pattern += 1;
    else if (readiness.state === 'caller_disabled') stats.caller_disabled += 1;
    else if (readiness.state === 'runtime_unsupported') stats.runtime_unsupported += 1;
    if (pattern) stats.pattern_ok += 1;

    const winRow = {
      utteranceId: row.utteranceId,
      windowId: lw.windowId || `w:${s}:${e}`,
      windowText: rawText.slice(rawStart, rawEnd),
      rawStart,
      rawEnd,
      rawSpanLength,
      syllableStart: s,
      syllableEnd: e,
      syllableSpanLength,
      windowPinyin,
      windowTimeStart: wtr?.start ?? null,
      windowTimeEnd: wtr?.end ?? null,
      overlapSliceCount: overlapSlices.length,
      overlapSlices: overlapSlices.map((sl) => ({
        start: sl.start,
        end: sl.end,
        tone: argmaxTone(sl.tonePosterior),
        confidence: sl.confidence,
      })),
      tonePattern: pattern,
      readiness: readiness.state,
      failureReason:
        readiness.state === 'ready'
          ? ''
          : !wtr
            ? 'no_window_time_range'
            : overlapSlices.length !== rawSpanLength
              ? `overlap=${overlapSlices.length} != charSpan=${rawSpanLength}; sylSpan=${syllableSpanLength}; multiCharTokensInUtterance=${multiCharTokens}`
              : readiness.state,
    };
    windows.push(winRow);
    if (readiness.state !== 'ready' && failureSamples.length < 8) {
      failureSamples.push({
        ...winRow,
        coveringSpans: spans
          .filter((sp) => (sp.rawEnd ?? 0) > rawStart && (sp.rawStart ?? 0) < rawEnd)
          .map((sp) => ({
            word: sp.word,
            rawStart: sp.rawStart,
            rawEnd: sp.rawEnd,
            charLen: (sp.rawEnd ?? 0) - (sp.rawStart ?? 0),
            start: sp.start,
            end: sp.end,
          })),
      });
    }
  }

  const totals = {
    total_window_count: windows.length,
    tone_ready_count: windows.filter((w) => w.readiness === 'ready').length,
    tone_no_pattern_count: windows.filter((w) => w.readiness === 'no_pattern').length,
    tone_invalid_pattern_count: windows.filter((w) => w.readiness === 'invalid_pattern').length,
    tone_caller_disabled_count: windows.filter((w) => w.readiness === 'caller_disabled').length,
    tone_runtime_unsupported_count: windows.filter((w) => w.readiness === 'runtime_unsupported').length,
    window_time_range_success_count: windows.filter((w) => w.windowTimeStart != null).length,
    pattern_ok_count: windows.filter((w) => Array.isArray(w.tonePattern)).length,
    char_eq_syl_count: windows.filter((w) => w.rawSpanLength === w.syllableSpanLength).length,
    overlap_eq_char_count: windows.filter((w) => w.overlapSliceCount === w.rawSpanLength).length,
    overlap_eq_syl_count: windows.filter((w) => w.overlapSliceCount === w.syllableSpanLength).length,
  };

  return {
    utteranceId: row.utteranceId,
    rawText,
    expectedText: row.expectedText,
    toneEnabled: row.toneEnabled,
    skippedReason: row.skippedReason,
    asr: {
      asr_word_count: asrWords,
      asr_word_timestamp_valid_count: asrValid,
      invalid_timestamp_count: asrInvalid,
      overlap_count: overlap,
      gap_count: gap,
      first_word_start: ordered[0]?.start ?? null,
      last_word_end: ordered[ordered.length - 1]?.end ?? null,
      audioDurationSec: row.audioDurationSec,
    },
    slices: {
      total_tone_slice_count: slices.length,
      invalid_posterior_count: invalidPosterior,
      invalid_tone_value_count: invalidTone,
      slice_overlap_count: sliceOverlap,
      slice_gap_count: sliceGap,
      sample: sortedSlices.slice(0, 8).map((s) => ({
        start: s.start,
        end: s.end,
        tone: argmaxTone(s.tonePosterior),
        confidence: s.confidence,
        posterior: s.tonePosterior,
      })),
    },
    wordTimeSpans: {
      count: spans.length,
      skipped: Math.max(0, asrValid - spans.length),
      multi_char_token_count: multiCharTokens,
      single_char_token_count: spans.filter((s) => (s.rawEnd ?? 0) - (s.rawStart ?? 0) === 1).length,
      samplePairs: spans.slice(0, 12).map((sp, i) => ({
        rawWord: sp.word,
        rawRange: [sp.rawStart, sp.rawEnd],
        charLen: (sp.rawEnd ?? 0) - (sp.rawStart ?? 0),
        wordStart: sp.start,
        wordEnd: sp.end,
        toneSlice: sortedSlices[i]
          ? {
              start: sortedSlices[i].start,
              end: sortedSlices[i].end,
              tone: argmaxTone(sortedSlices[i].tonePosterior),
            }
          : null,
      })),
      spans,
    },
    toneState,
    totals,
    byLen,
    failureSamples,
    grainNote:
      'AcousticToneSlice grain = one per ASR word token (after short-slice skip). WordTimeSpan raw span = token UTF-16 length. Pattern gate uses rawEnd-rawStart vs overlap slice count.',
  };
}

function main() {
  const indexPath = path.join(outDir, 'fw_index.json');
  if (!fs.existsSync(indexPath)) {
    console.error('missing', indexPath);
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const analyses = [];
  const global = {
    audio_count: 0,
    tone_inference_success_count: 0,
    tone_inference_failure_count: 0,
    total_tone_slice_count: 0,
    invalid_posterior_count: 0,
    asr_word_count: 0,
    asr_word_timestamp_valid_count: 0,
    word_time_span_count: 0,
    skipped_word_count: 0,
    multi_char_token_count: 0,
    total_window_count: 0,
    tone_ready_count: 0,
    tone_no_pattern_count: 0,
    tone_invalid_pattern_count: 0,
    tone_caller_disabled_count: 0,
    tone_runtime_unsupported_count: 0,
    window_time_range_success_count: 0,
    pattern_ok_count: 0,
    char_eq_syl_count: 0,
    overlap_eq_char_count: 0,
    overlap_eq_syl_count: 0,
    byLen: {},
  };
  for (let L = 1; L <= 5; L += 1) {
    global.byLen[L] = {
      windows: 0,
      ready: 0,
      no_pattern: 0,
      invalid_pattern: 0,
      caller_disabled: 0,
      runtime_unsupported: 0,
      char_eq_syl: 0,
      overlap_eq_char: 0,
      overlap_eq_syl: 0,
      time_range_ok: 0,
      pattern_ok: 0,
    };
  }

  for (const row of index.cases || []) {
    if (row.error) {
      global.tone_inference_failure_count += 1;
      analyses.push({ utteranceId: row.utteranceId, error: row.error });
      continue;
    }
    const a = analyzeCase(row);
    analyses.push(a);
    fs.writeFileSync(path.join(outDir, `${row.utteranceId}.analysis.json`), JSON.stringify(a, null, 2));

    global.audio_count += 1;
    if (a.toneEnabled && a.slices.total_tone_slice_count > 0) global.tone_inference_success_count += 1;
    else global.tone_inference_failure_count += 1;
    global.total_tone_slice_count += a.slices.total_tone_slice_count;
    global.invalid_posterior_count += a.slices.invalid_posterior_count;
    global.asr_word_count += a.asr.asr_word_count;
    global.asr_word_timestamp_valid_count += a.asr.asr_word_timestamp_valid_count;
    global.word_time_span_count += a.wordTimeSpans.count;
    global.skipped_word_count += a.wordTimeSpans.skipped;
    global.multi_char_token_count += a.wordTimeSpans.multi_char_token_count;
    global.total_window_count += a.totals.total_window_count;
    global.tone_ready_count += a.totals.tone_ready_count;
    global.tone_no_pattern_count += a.totals.tone_no_pattern_count;
    global.tone_invalid_pattern_count += a.totals.tone_invalid_pattern_count;
    global.tone_caller_disabled_count += a.totals.tone_caller_disabled_count;
    global.tone_runtime_unsupported_count += a.totals.tone_runtime_unsupported_count;
    global.window_time_range_success_count += a.totals.window_time_range_success_count;
    global.pattern_ok_count += a.totals.pattern_ok_count;
    global.char_eq_syl_count += a.totals.char_eq_syl_count;
    global.overlap_eq_char_count += a.totals.overlap_eq_char_count;
    global.overlap_eq_syl_count += a.totals.overlap_eq_syl_count;
    for (let L = 1; L <= 5; L += 1) {
      const s = a.byLen[L];
      const g = global.byLen[L];
      for (const k of Object.keys(s)) g[k] += s[k];
    }
  }

  // Optional lattice pass
  let latticeSummary = null;
  if (process.argv.includes('--with-lattice')) {
    try {
      process.chdir(electronRoot);
      process.env.PROJECT_ROOT = repoRoot;
      const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
      const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
      const { resolveRecallScope } = require(
        path.join(DIST, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
      );
      const { loadFwDetectorRuntimeConfig } = require(path.join(DIST, 'fw-detector/fw-config.js'));
      const { loadPinyinImeV2RuntimeConfig } = require(
        path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
      );
      const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
        path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
      );
      const { runPhase1WindowEdgeHarness } = require(
        path.join(DIST, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
      );
      const { runPhase2PathHarness } = require(
        path.join(DIST, 'fw-detector/span-assembly-v4/phase2-path-harness.js')
      );
      const runtime = new LexiconRuntimeV2();
      const loadState = runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
      if (loadState.status !== 'ok') throw new Error(JSON.stringify(loadState));
      const fwConfig = loadFwDetectorRuntimeConfig();
      const imeConfig = loadPinyinImeV2RuntimeConfig();
      const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
        enabledDomains: imeConfig.enabledDomains,
      });
      const profile = defaultGeneralProfile();
      const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

      latticeSummary = {
        utterances: 0,
        candidates: 0,
        lexicalEdges: 0,
        fallbackEdges: 0,
        retainedCompletePaths: 0,
        requiringFallback: 0,
        noCompletePath: 0,
        lexicalCompletePath: 0,
      };
      for (const a of analyses) {
        if (!a.rawText || !a.wordTimeSpans?.spans) continue;
        const slices = normalizeAcousticSlices(
          (index.cases.find((c) => c.utteranceId === a.utteranceId) || {}).utterance_tone
            ?.acousticToneSlices
        );
        const p1 = runPhase1WindowEdgeHarness({
          rawText: a.rawText,
          runtime,
          profile,
          domainIds,
          minPrior: fwConfig.minPrior,
          imeConfig,
          dict,
          wordTimeSpans: a.wordTimeSpans.spans,
          acousticSlices: slices,
          toneTimestampOnlyEnabled: true,
        });
        const p2 = runPhase2PathHarness({
          sentenceId: a.utteranceId,
          rawText: a.rawText,
          runtime,
          profile,
          domainIds,
          minPrior: fwConfig.minPrior,
          imeConfig,
          dict,
          wordTimeSpans: a.wordTimeSpans.spans,
          acousticSlices: slices,
        });
        latticeSummary.utterances += 1;
        latticeSummary.candidates += p1.diagnostics.candidateCount;
        latticeSummary.lexicalEdges += p1.diagnostics.edgeCount;
        latticeSummary.fallbackEdges += p2.fallbackEdgeCount;
        latticeSummary.retainedCompletePaths += p2.retainedCompletePathCount;
        if (p2.fallbackEdgeCount > 0) latticeSummary.requiringFallback += 1;
        if (p2.retainedCompletePathCount === 0) latticeSummary.noCompletePath += 1;
        if (p2.fallbackInjectionCount === 0 && p2.retainedCompletePathCount > 0) {
          latticeSummary.lexicalCompletePath += 1;
        }
        a.lattice = {
          phase1: p1.diagnostics,
          phase2: {
            lexicalEdgeCount: p2.lexicalEdgeCount,
            fallbackEdgeCount: p2.fallbackEdgeCount,
            retainedCompletePathCount: p2.retainedCompletePathCount,
            fallbackInjectionCount: p2.fallbackInjectionCount,
          },
        };
      }
    } catch (e) {
      latticeSummary = { error: e.message || String(e) };
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    outDir,
    source: 'FW /utterance direct (Electron ASR preference was false)',
    metrics: {
      ...global,
      avg_tone_slices_per_utterance: global.audio_count
        ? Number((global.total_tone_slice_count / global.audio_count).toFixed(2))
        : 0,
      asr_word_timestamp_valid_rate: rate(global.asr_word_timestamp_valid_count, global.asr_word_count),
      word_time_span_build_rate: rate(global.word_time_span_count, global.asr_word_timestamp_valid_count),
      skipped_word_rate: rate(global.skipped_word_count, global.asr_word_timestamp_valid_count),
      tone_readiness_rate: rate(global.tone_ready_count, global.total_window_count),
      window_time_range_success_rate: rate(
        global.window_time_range_success_count,
        global.total_window_count
      ),
      pattern_length_match_rate_vs_char: rate(global.overlap_eq_char_count, global.total_window_count),
      pattern_length_match_rate_vs_syl: rate(global.overlap_eq_syl_count, global.total_window_count),
      char_eq_syl_rate: rate(global.char_eq_syl_count, global.total_window_count),
      tone_pattern_valid_rate: rate(global.pattern_ok_count, global.total_window_count),
    },
    byLen: Object.fromEntries(
      Object.entries(global.byLen).map(([L, s]) => [
        L,
        {
          ...s,
          readiness_rate: rate(s.ready, s.windows),
          char_eq_syl_rate: rate(s.char_eq_syl, s.windows),
          overlap_eq_char_rate: rate(s.overlap_eq_char, s.windows),
          overlap_eq_syl_rate: rate(s.overlap_eq_syl, s.windows),
        },
      ])
    ),
    latticeSummary,
    cases: analyses.map((a) => ({
      utteranceId: a.utteranceId,
      error: a.error || null,
      sliceCount: a.slices?.total_tone_slice_count,
      spanCount: a.wordTimeSpans?.count,
      multiCharTokens: a.wordTimeSpans?.multi_char_token_count,
      readyWindows: a.totals?.tone_ready_count,
      totalWindows: a.totals?.total_window_count,
      readinessRate: rate(a.totals?.tone_ready_count || 0, a.totals?.total_window_count || 0),
      lattice: a.lattice || null,
    })),
  };

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('[analyze] DONE');
  console.log(JSON.stringify(summary.metrics, null, 2));
  console.log('byLen', JSON.stringify(summary.byLen, null, 2));
  if (latticeSummary) console.log('lattice', JSON.stringify(latticeSummary, null, 2));
}

main();
