/**
 * TEMPORARY diagnostic probe — Tone Full-Chain Node Runtime Investigation.
 * Does NOT change production Decision / Candidate / Recall behavior.
 * Outputs paired Tone+WordTimeSpan+Window pattern evidence for real wavs.
 *
 * Run:
 *   cd electron_node/electron-node
 *   node ../../docs/tone-v2/_audit_scratch/tone-full-chain-node-runtime-probe.mjs
 *
 * Optional lattice (Electron ABI + lexicon):
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\tone-full-chain-node-runtime-probe.mjs --with-lattice
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getTestServerPort, waitTestServerHealth, waitAsrReady, runPipelineWarmup } from '../../../electron_node/electron-node/tests/lib/wait-asr-ready.mjs';
import { loadDialog200Manifest } from '../../../electron_node/electron-node/tests/lib/load-dialog200-manifest.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repoRoot, 'electron_node/electron-node');
const DIST = path.join(electronRoot, 'dist/main/electron-node/main/src');
const OUT_DIR = path.join(__dirname, 'tone_full_chain_runtime_2026_07_29');
const DIALOG_DIR = path.join(repoRoot, 'test wav/dialog_200');
const WITH_LATTICE = process.argv.includes('--with-lattice');
const LIMIT = Number(process.env.PROBE_LIMIT || '20');

const {
  normalizeAcousticSlices,
  buildWordTimeSpans,
  extractAcousticTonePatternByTime,
  selectSlicesByTimeOverlap,
  charRangeToWindowTime,
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

let runPhase1 = null;
let runPhase2 = null;
let latticeDeps = null;

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function argmaxTone(posterior) {
  if (!posterior) return null;
  const vals = [posterior.t1, posterior.t2, posterior.t3, posterior.t4, posterior.t5];
  if (vals.some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  let best = 0;
  for (let i = 1; i < 5; i += 1) if (vals[i] > vals[best]) best = i;
  return best + 1;
}

function pickCases(manifest) {
  const byId = new Map((manifest.cases || []).map((c) => [c.id, c]));
  // Cover: plain zh, multi-char, numbers, english-ish, mixed scenarios, short/long
  const preferred = [
    'd001', 'd002', 'd003', 'd004', 'd005',
    'd010', 'd019', 'd025', 'd040', 'd055',
    'd064', 'd080', 'd100', 'd109', 'd120',
    'd140', 'd154', 'd170', 'd190', 'd199',
  ];
  const out = [];
  for (const id of preferred) {
    const c = byId.get(id);
    if (c) out.push(c);
    if (out.length >= LIMIT) break;
  }
  for (const c of manifest.cases || []) {
    if (out.length >= LIMIT) break;
    if (!out.find((x) => x.id === c.id)) out.push(c);
  }
  return out.slice(0, LIMIT);
}

function countAsrWords(segments) {
  let n = 0;
  let validTs = 0;
  let invalid = 0;
  let overlap = 0;
  let gap = 0;
  const words = [];
  for (const seg of segments || []) {
    for (const w of seg.words || []) {
      n += 1;
      const token = (w.word || '').trim();
      const start = w.start;
      const end = w.end;
      const ok = token && typeof start === 'number' && typeof end === 'number' && end > start;
      if (ok) validTs += 1;
      else invalid += 1;
      words.push({ token, start, end, ok });
    }
  }
  const ordered = words.filter((w) => w.ok).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].start < ordered[i - 1].end) overlap += 1;
    if (ordered[i].start - ordered[i - 1].end > 0.35) gap += 1;
  }
  return {
    asr_word_count: n,
    asr_word_timestamp_valid_count: validTs,
    invalid_timestamp_count: invalid,
    overlap_count: overlap,
    gap_count: gap,
    first_word_start: ordered[0]?.start ?? null,
    last_word_end: ordered[ordered.length - 1]?.end ?? null,
    words: ordered,
  };
}

function analyzeWordTimeSpans(rawText, segments) {
  // Probe approximates single-batch offsets (pipeline may multi-batch; compare against online if available)
  const batchIndices = (segments || []).map((_, i) => i);
  const spans = buildWordTimeSpans(rawText, segments || [], [0], [0], batchIndices);
  const asr = countAsrWords(segments);
  const skipped = Math.max(0, asr.asr_word_timestamp_valid_count - spans.length);
  // surface mismatch: valid-ts words whose token not found via sequential indexOf
  let searchFrom = 0;
  let surfaceMismatch = 0;
  let duplicateRisk = 0;
  const seen = new Map();
  for (const w of asr.words) {
    if (!w.ok) continue;
    const idx = rawText.indexOf(w.token, searchFrom);
    if (idx < 0) {
      surfaceMismatch += 1;
      continue;
    }
    const key = w.token;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) > 1) duplicateRisk += 1;
    searchFrom = idx + w.token.length;
  }
  return {
    spans,
    asr,
    word_time_span_count: spans.length,
    skipped_word_count: skipped,
    surface_mismatch_count: surfaceMismatch,
    duplicate_match_risk_count: duplicateRisk,
    multi_char_token_count: spans.filter((s) => (s.rawEnd ?? 0) - (s.rawStart ?? 0) > 1).length,
    single_char_token_count: spans.filter((s) => (s.rawEnd ?? 0) - (s.rawStart ?? 0) === 1).length,
  };
}

function generateWindows(rawText) {
  const coordinate = buildUtteranceSyllableCoordinate(rawText);
  const ranges = coordinate.ranges || [];
  const windows = [];
  const maxLen = 5;
  for (let len = 1; len <= maxLen; len += 1) {
    for (let s = 0; s + len <= ranges.length; s += 1) {
      const e = s + len;
      const rawStart = ranges[s].rawStart;
      const rawEnd = ranges[e - 1].rawEnd;
      const pinyin = ranges.slice(s, e).map((r) => r.syllable);
      windows.push({
        windowId: `w:${s}:${e}`,
        syllableStart: s,
        syllableEnd: e,
        rawStart,
        rawEnd,
        rawSpanLength: rawEnd - rawStart,
        syllableSpanLength: e - s,
        windowText: rawText.slice(rawStart, rawEnd),
        windowPinyin: pinyin,
        length: len,
      });
    }
  }
  return { coordinate, windows, syllableCount: ranges.length };
}

function analyzeWindows(rawText, acousticSlices, wordTimeSpans, supportsTone) {
  const { coordinate, windows, syllableCount } = generateWindows(rawText);
  const toneState = resolveTimestampToneState(acousticSlices, true);
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
      hit_candidates: 0, // filled later if lattice
    };
  }
  const windowRows = [];
  const failureSamples = [];

  for (const w of windows) {
    const stats = byLen[w.length];
    stats.windows += 1;
    if (w.rawSpanLength === w.syllableSpanLength) stats.char_eq_syl += 1;

    const extracted = extractAcousticTonePatternByTime(
      w.rawStart,
      w.rawEnd,
      w.syllableStart,
      w.syllableEnd,
      acousticSlices,
      wordTimeSpans
    );
    const windowTimeRange = extracted.windowTimeRange;
    const overlapSlices = windowTimeRange
      ? selectSlicesByTimeOverlap(acousticSlices, windowTimeRange)
      : [];
    if (windowTimeRange) stats.time_range_ok += 1;
    if (overlapSlices.length === w.rawSpanLength) stats.overlap_eq_char += 1;
    if (overlapSlices.length === w.syllableSpanLength) stats.overlap_eq_syl += 1;

    const pattern = extracted.pattern;
    const readiness = resolveToneRecallReadiness({
      syllables: w.windowPinyin,
      runtimeSupportsTone: supportsTone !== false,
      acousticTonePattern: pattern ?? undefined,
      toneCallerEnabled: toneState.toneEnabled,
    });

    if (readiness.state === 'ready') stats.ready += 1;
    else if (readiness.state === 'no_pattern') stats.no_pattern += 1;
    else if (readiness.state === 'invalid_pattern') stats.invalid_pattern += 1;
    else if (readiness.state === 'caller_disabled') stats.caller_disabled += 1;
    else if (readiness.state === 'runtime_unsupported') stats.runtime_unsupported += 1;
    if (pattern) stats.pattern_ok += 1;

    const row = {
      utteranceId: null,
      windowId: w.windowId,
      windowText: w.windowText,
      rawStart: w.rawStart,
      rawEnd: w.rawEnd,
      rawSpanLength: w.rawSpanLength,
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      syllableSpanLength: w.syllableSpanLength,
      windowPinyin: w.windowPinyin,
      windowTimeStart: windowTimeRange?.start ?? null,
      windowTimeEnd: windowTimeRange?.end ?? null,
      overlapSliceCount: overlapSlices.length,
      overlapSlices: overlapSlices.map((s) => ({
        start: s.start,
        end: s.end,
        tone: argmaxTone(s.tonePosterior),
        confidence: s.confidence,
      })),
      tonePattern: pattern,
      readiness: readiness.state,
      tonePinyinKey: readiness.tonePinyinKey || null,
      toneSqlRows: null,
      candidateCount: null,
      failureReason:
        readiness.state === 'ready'
          ? ''
          : readiness.state === 'no_pattern'
            ? overlapSlices.length !== w.rawSpanLength
              ? `overlap=${overlapSlices.length} != charSpan=${w.rawSpanLength} (code uses rawEnd-rawStart); sylSpan=${w.syllableSpanLength}`
              : !windowTimeRange
                ? 'no_window_time_range'
                : 'pattern_null_other'
            : readiness.state,
    };
    windowRows.push(row);

    if (readiness.state !== 'ready' && failureSamples.length < 40) {
      failureSamples.push({
        ...row,
        expectedSyllableCount: w.syllableSpanLength,
        wordTimeSpansCovering: wordTimeSpans
          .filter((s) => (s.rawEnd ?? 0) > w.rawStart && (s.rawStart ?? 0) < w.rawEnd)
          .map((s) => ({
            word: s.word,
            rawStart: s.rawStart,
            rawEnd: s.rawEnd,
            start: s.start,
            end: s.end,
            charLen: (s.rawEnd ?? 0) - (s.rawStart ?? 0),
          })),
      });
    }
  }

  return {
    syllableCount,
    coordinateSyllableCount: (coordinate.ranges || []).length,
    windows: windowRows,
    byLen,
    failureSamples,
    toneState,
    totals: {
      total_window_count: windowRows.length,
      tone_ready_count: windowRows.filter((r) => r.readiness === 'ready').length,
      tone_no_pattern_count: windowRows.filter((r) => r.readiness === 'no_pattern').length,
      tone_invalid_pattern_count: windowRows.filter((r) => r.readiness === 'invalid_pattern').length,
      tone_caller_disabled_count: windowRows.filter((r) => r.readiness === 'caller_disabled').length,
      tone_runtime_unsupported_count: windowRows.filter((r) => r.readiness === 'runtime_unsupported').length,
      window_time_range_success_count: windowRows.filter((r) => r.windowTimeStart != null).length,
      pattern_ok_count: windowRows.filter((r) => Array.isArray(r.tonePattern)).length,
      char_eq_syl_count: windowRows.filter((r) => r.rawSpanLength === r.syllableSpanLength).length,
      overlap_eq_char_count: windowRows.filter((r) => r.overlapSliceCount === r.rawSpanLength).length,
      overlap_eq_syl_count: windowRows.filter((r) => r.overlapSliceCount === r.syllableSpanLength).length,
    },
  };
}

function analyzeSlices(slices) {
  let invalidPosterior = 0;
  let invalidTone = 0;
  let overlap = 0;
  let gap = 0;
  let dup = 0;
  const sorted = [...(slices || [])].sort((a, b) => a.start - b.start);
  const seenKeys = new Set();
  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i];
    const tone = argmaxTone(s.tonePosterior);
    if (tone == null) invalidPosterior += 1;
    else if (tone < 1 || tone > 5) invalidTone += 1;
    const key = `${s.start}|${s.end}`;
    if (seenKeys.has(key)) dup += 1;
    seenKeys.add(key);
    if (i > 0) {
      if (s.start < sorted[i - 1].end) overlap += 1;
      if (s.start - sorted[i - 1].end > 0.05) gap += 1;
    }
  }
  return {
    total_tone_slice_count: sorted.length,
    invalid_posterior_count: invalidPosterior,
    invalid_tone_value_count: invalidTone,
    slice_overlap_count: overlap,
    slice_gap_count: gap,
    duplicate_slice_count: dup,
    slices_summary: sorted.map((s) => ({
      start: s.start,
      end: s.end,
      tone: argmaxTone(s.tonePosterior),
      confidence: s.confidence,
      posterior: s.tonePosterior,
    })),
  };
}

function loadLatticeDeps() {
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
  runPhase1 = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
  ).runPhase1WindowEdgeHarness;
  runPhase2 = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/phase2-path-harness.js')
  ).runPhase2PathHarness;

  const runtime = new LexiconRuntimeV2();
  const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
  const loadState = runtime.loadFromBundleDir(bundleDir);
  if (loadState.status !== 'ok') {
    throw new Error(`lexicon load failed: ${JSON.stringify(loadState)}`);
  }
  const fwConfig = loadFwDetectorRuntimeConfig();
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
    enabledDomains: imeConfig.enabledDomains,
  });
  const profile = defaultGeneralProfile();
  const recallScope = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains });
  return {
    runtime,
    profile,
    domainIds: recallScope.domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    fwConfig,
    supportsTone: runtime.supportsToneFirstRecall?.() !== false,
  };
}

async function main() {
  ensureOutDir();
  const port = getTestServerPort();
  console.log(`[probe] port=${port} limit=${LIMIT} withLattice=${WITH_LATTICE}`);

  if (!(await waitTestServerHealth(port, 120000))) {
    console.error('test server not ready');
    process.exit(1);
  }

  const { cases: allCases } = loadDialog200Manifest(path.join(DIALOG_DIR, 'cases.manifest.json'));
  const cases = pickCases({ cases: allCases });
  const warmupWav = path.join(DIALOG_DIR, cases[0].file || cases[0].audio);
  const asrReady = await waitAsrReady(port, {
    warmupWavPath: warmupWav,
    maxWaitMs: 420000,
    label: 'tone-full-chain-warmup',
  });
  if (!asrReady.ready) {
    console.error('ASR not ready', asrReady.lastError);
    process.exit(1);
  }
  console.log('[probe] ASR ready', asrReady);

  if (WITH_LATTICE) {
    try {
      latticeDeps = loadLatticeDeps();
      console.log('[probe] lattice deps loaded supportsTone=', latticeDeps.supportsTone);
    } catch (e) {
      console.error('[probe] lattice load failed — continuing without lattice', e.message || e);
      latticeDeps = null;
    }
  }

  const results = [];
  const global = {
    audio_count: 0,
    tone_inference_success_count: 0,
    tone_inference_failure_count: 0,
    total_tone_slice_count: 0,
    invalid_posterior_count: 0,
    model_error_count: 0,
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
    tone_candidate_count: 0,
    lexical_edge_count: 0,
    fallback_edge_count: 0,
    utterances_with_lexical_complete_path: 0,
    utterances_requiring_fallback: 0,
    utterances_without_complete_path: 0,
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
      candidate_windows: 0,
      candidate_count: 0,
    };
  }

  for (const c of cases) {
    const wavPath = path.join(DIALOG_DIR, c.file || c.audio);
    const utteranceId = c.id;
    console.log(`[probe] running ${utteranceId} ${path.basename(wavPath)}`);
    let data;
    try {
      data = await runPipelineWarmup(port, wavPath, `tone-full-chain-${utteranceId}-${Date.now()}`);
    } catch (e) {
      results.push({ utteranceId, error: e.message || String(e) });
      global.tone_inference_failure_count += 1;
      continue;
    }

    const extra = data.extra || {};
    const rawText = (extra.raw_asr_text || '').trim();
    const segments = data.segments || [];
    const utteranceTone = extra.utterance_tone || null;
    const fw = extra.fw_detector || {};
    const sa = fw.spanAssemblyV3 || fw.spanAssemblyV4 || {};
    const toneDiag = sa.tone || {};

    const slices = normalizeAcousticSlices(utteranceTone?.acousticToneSlices);
    const sliceStats = analyzeSlices(slices);
    const wts = analyzeWordTimeSpans(rawText, segments);
    const supportsTone = latticeDeps?.supportsTone !== false;
    const win = analyzeWindows(rawText, slices, wts.spans, supportsTone);

    let lattice = null;
    if (latticeDeps && rawText && slices.length) {
      try {
        const p1 = runPhase1({
          rawText,
          runtime: latticeDeps.runtime,
          profile: latticeDeps.profile,
          domainIds: latticeDeps.domainIds,
          minPrior: latticeDeps.minPrior,
          imeConfig: latticeDeps.imeConfig,
          dict: latticeDeps.dict,
          wordTimeSpans: wts.spans,
          acousticSlices: slices,
          toneTimestampOnlyEnabled: true,
          measureHeap: false,
        });
        const p2 = runPhase2({
          sentenceId: utteranceId,
          rawText,
          runtime: latticeDeps.runtime,
          profile: latticeDeps.profile,
          domainIds: latticeDeps.domainIds,
          minPrior: latticeDeps.minPrior,
          imeConfig: latticeDeps.imeConfig,
          dict: latticeDeps.dict,
          wordTimeSpans: wts.spans,
          acousticSlices: slices,
          measureHeap: false,
        });
        // Phase2 currently may not forward toneTimestampOnlyEnabled — note in evidence.
        lattice = {
          phase1: {
            windowCount: p1.diagnostics.windowCount,
            recallableWindowCount: p1.diagnostics.recallableWindowCount,
            candidateCount: p1.diagnostics.candidateCount,
            edgeCount: p1.diagnostics.edgeCount,
            windowNoCandidateCount: p1.diagnostics.windowNoCandidateCount,
            blockedWindowCount: p1.diagnostics.blockedWindowCount,
          },
          phase2: {
            lexicalEdgeCount: p2.lexicalEdgeCount,
            fallbackEdgeCount: p2.fallbackEdgeCount,
            completePathCountBeforePrune: p2.completePathCountBeforePrune,
            retainedCompletePathCount: p2.retainedCompletePathCount,
            fallbackInjectionCount: p2.fallbackInjectionCount,
          },
          note: 'phase1 uses toneTimestampOnlyEnabled=true; phase2 harness does not currently forward that flag',
        };
        global.tone_candidate_count += p1.diagnostics.candidateCount;
        global.lexical_edge_count += p1.diagnostics.edgeCount;
        global.fallback_edge_count += p2.fallbackEdgeCount;
        if (p2.fallbackEdgeCount > 0) global.utterances_requiring_fallback += 1;
        if (p2.retainedCompletePathCount > 0 && p2.lexicalEdgeCount > 0) {
          // approximate: lexical-only if fallbackInjection covers nothing — keep simple
        }
        const lexicalOnly = p2.fallbackInjectionCount === 0 && p2.retainedCompletePathCount > 0;
        if (lexicalOnly) global.utterances_with_lexical_complete_path += 1;
        if (p2.retainedCompletePathCount === 0) global.utterances_without_complete_path += 1;
      } catch (e) {
        lattice = { error: e.message || String(e) };
      }
    }

    const toneEnabled = Boolean(utteranceTone?.toneEnabled);
    if (toneEnabled && slices.length > 0) global.tone_inference_success_count += 1;
    else {
      global.tone_inference_failure_count += 1;
      if (utteranceTone?.skippedReason === 'model_error') global.model_error_count += 1;
    }

    global.audio_count += 1;
    global.total_tone_slice_count += sliceStats.total_tone_slice_count;
    global.invalid_posterior_count += sliceStats.invalid_posterior_count;
    global.asr_word_count += wts.asr.asr_word_count;
    global.asr_word_timestamp_valid_count += wts.asr.asr_word_timestamp_valid_count;
    global.word_time_span_count += wts.word_time_span_count;
    global.skipped_word_count += wts.skipped_word_count;
    global.multi_char_token_count += wts.multi_char_token_count;
    global.total_window_count += win.totals.total_window_count;
    global.tone_ready_count += win.totals.tone_ready_count;
    global.tone_no_pattern_count += win.totals.tone_no_pattern_count;
    global.tone_invalid_pattern_count += win.totals.tone_invalid_pattern_count;
    global.tone_caller_disabled_count += win.totals.tone_caller_disabled_count;
    global.tone_runtime_unsupported_count += win.totals.tone_runtime_unsupported_count;
    global.window_time_range_success_count += win.totals.window_time_range_success_count;
    global.pattern_ok_count += win.totals.pattern_ok_count;
    global.char_eq_syl_count += win.totals.char_eq_syl_count;
    global.overlap_eq_char_count += win.totals.overlap_eq_char_count;
    global.overlap_eq_syl_count += win.totals.overlap_eq_syl_count;
    for (let L = 1; L <= 5; L += 1) {
      const s = win.byLen[L];
      const g = global.byLen[L];
      for (const k of Object.keys(s)) g[k] += s[k];
    }

    const caseRow = {
      utteranceId,
      audioPath: wavPath,
      expectedText: c.utterance || c.text,
      rawText,
      asr_service_id: extra.asr_service_id,
      pipeline_ms: extra.pipeline_ms,
      utterance_tone: {
        toneEnabled: utteranceTone?.toneEnabled ?? null,
        sliceCount: utteranceTone?.sliceCount ?? slices.length,
        skippedReason: utteranceTone?.skippedReason ?? null,
        toneConfidenceAvg: utteranceTone?.toneConfidenceAvg ?? null,
      },
      productionToneDiag: {
        toneEnabled: toneDiag.toneEnabled,
        toneSkippedReason: toneDiag.toneSkippedReason,
        acousticSliceCount: toneDiag.acousticSliceCount,
        wordTimeSpanCount: toneDiag.wordTimeSpanCount,
      },
      sliceStats,
      wordTimeSpanStats: {
        ...wts,
        spans: wts.spans, // keep full for archive comparison
      },
      windowAnalysis: {
        totals: win.totals,
        byLen: win.byLen,
        toneState: win.toneState,
        failureSamples: win.failureSamples.slice(0, 8),
        // keep compact window dump (max 200)
        windows: win.windows.slice(0, 200),
      },
      lattice,
      grainEvidence: {
        asr_word_count: wts.asr.asr_word_count,
        tone_slice_count: slices.length,
        word_time_span_count: wts.spans.length,
        multi_char_token_count: wts.multi_char_token_count,
        note:
          'Tone slice grain = one per ASR word token with valid timestamps (after short-slice skip); WordTimeSpan raw range = token.length UTF-16 chars',
        samplePairs: wts.spans.slice(0, 12).map((span, i) => ({
          rawWord: span.word,
          rawRange: [span.rawStart, span.rawEnd],
          charLen: (span.rawEnd ?? 0) - (span.rawStart ?? 0),
          wordStart: span.start,
          wordEnd: span.end,
          toneSlice: sliceStats.slices_summary[i] || null,
        })),
      },
      onlineArchiveFieldsPresent: {
        segments_words_start_end: Boolean(segments?.[0]?.words?.[0]?.start != null),
        utterance_tone_acousticToneSlices: slices.length > 0,
        tonePosterior: Boolean(slices[0]?.tonePosterior?.t1 != null),
        wordTimeSpans_in_pipeline_response: false, // never in HTTP result; rebuilt here
      },
    };

    // Attach utteranceId into window rows for samples
    for (const fsamp of caseRow.windowAnalysis.failureSamples) fsamp.utteranceId = utteranceId;

    results.push(caseRow);
    fs.writeFileSync(
      path.join(OUT_DIR, `${utteranceId}.json`),
      JSON.stringify(caseRow, null, 2),
      'utf8'
    );
  }

  const rate = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : null);
  const summary = {
    generatedAt: new Date().toISOString(),
    probeLimit: LIMIT,
    withLattice: Boolean(latticeDeps),
    toneModelEnvHint: process.env.TONE_MODEL_PATH || null,
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
    cases: results.map((r) => ({
      utteranceId: r.utteranceId,
      error: r.error || null,
      rawText: r.rawText,
      sliceCount: r.sliceStats?.total_tone_slice_count,
      spanCount: r.wordTimeSpanStats?.word_time_span_count,
      multiCharTokens: r.wordTimeSpanStats?.multi_char_token_count,
      readyWindows: r.windowAnalysis?.totals?.tone_ready_count,
      totalWindows: r.windowAnalysis?.totals?.total_window_count,
      readinessRate: rate(
        r.windowAnalysis?.totals?.tone_ready_count || 0,
        r.windowAnalysis?.totals?.total_window_count || 0
      ),
      lattice: r.lattice,
    })),
  };

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('[probe] DONE');
  console.log(JSON.stringify(summary.metrics, null, 2));
  console.log('OUT', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
