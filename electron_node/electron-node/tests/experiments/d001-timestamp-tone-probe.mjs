#!/usr/bin/env node
/**
 * d001 Timestamp-Only tone probe — full trace for cafe homophone windows.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getTestServerPort, waitTestServerHealth, waitAsrReady, runPipelineWarmup } from '../lib/wait-asr-ready.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../dist/main/electron-node/main/src');

const DIALOG_DIR = path.resolve(__dirname, '../../../../test wav/dialog_200');
const D001_WAV = path.join(DIALOG_DIR, 'dialog_d001.wav');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIALOG_DIR, 'cases.manifest.json'), 'utf8'));
const D001_REF = MANIFEST.find((c) => c.id === 'd001')?.utterance || '';

const TARGET_PINYIN = ['zhong|bei', 'bei|shao', 'shao|tang', 'zhong|bei|shao', 'bei|shao|tang'];
const TARGET_TEXT = ['钟贝', '贝少', '少糖', '钟贝少', '贝少糖'];

function argmaxTone(posterior) {
  const entries = [
    [1, posterior.t1 ?? posterior[0]],
    [2, posterior.t2 ?? posterior[1]],
    [3, posterior.t3 ?? posterior[2]],
    [4, posterior.t4 ?? posterior[3]],
    [5, posterior.t5 ?? posterior[4]],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function summarizeAcousticSlices(slices) {
  return (slices || []).map((s) => ({
    start: s.start,
    end: s.end,
    argmax: argmaxTone(s.tonePosterior || {}),
    confidence: s.confidence,
  }));
}

function collectSpanCandidates(spans) {
  const out = [];
  for (const span of spans || []) {
    for (const c of span.candidates || []) {
      out.push({
        spanText: span.text,
        word: c.word,
        candidateSentence: c.candidateSentence,
        source: c.source,
        repairTarget: c.repairTarget,
        kenlmDelta: c.kenlmDelta,
      });
    }
  }
  return out;
}

function findTargetWindows(exampleWindows) {
  const windows = exampleWindows || [];
  return TARGET_PINYIN.map((key, i) => {
    const match = windows.find((w) => w.pinyinKey === key || w.text?.includes(TARGET_TEXT[i]?.slice(0, 1)));
    return {
      label: TARGET_TEXT[i],
      pinyinKey: key,
      found: Boolean(match),
      window: match || null,
    };
  });
}

function scanForBeiShao(candidates, sentences) {
  const hits = [];
  for (const c of candidates) {
    const text = `${c.word || ''} ${c.candidateSentence || ''}`;
    if (/焙烧|bei.*shao|贝少|钟焙/i.test(text)) {
      hits.push({ kind: 'span_candidate', ...c });
    }
  }
  for (const s of sentences || []) {
    if (/焙烧|钟焙/i.test(s)) {
      hits.push({ kind: 'sentence', text: s });
    }
  }
  return hits;
}

async function main() {
  const port = getTestServerPort();
  if (!(await waitTestServerHealth(port))) {
    console.error('test server not ready');
    process.exit(1);
  }

  const asrReady = await waitAsrReady(port, {
    warmupWavPath: D001_WAV,
    maxWaitMs: 300000,
    label: 'd001-probe-warmup',
  });
  if (!asrReady.ready) {
    console.error('ASR not ready:', asrReady.lastError);
    process.exit(1);
  }

  const data = await runPipelineWarmup(port, D001_WAV, `d001-probe-${Date.now()}`);
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const sa = fw.spanAssemblyV3 || {};
  const tone = sa.tone || {};
  const raw = (extra.raw_asr_text || '').trim();
  const segments = data.segments || [];
  const utteranceTone = extra.utterance_tone || null;

  let wordTimeSpans = [];
  let acousticSlices = [];
  let localTargetAnalysis = [];

  try {
    const {
      normalizeAcousticSlices,
      buildWordTimeSpans,
      extractAcousticTonePatternByTime,
    } = require(path.join(DIST, 'fw-detector/tone-time-align.js'));
    acousticSlices = normalizeAcousticSlices(utteranceTone?.acousticToneSlices);
    wordTimeSpans = buildWordTimeSpans(raw, segments, [0], [0], segments.map((_, i) => i));

    for (const label of TARGET_PINYIN) {
      const syllables = label.split('|');
      const win = tone.exampleToneWindows?.find((w) => w.pinyinKey === label);
      if (win?.windowTimeRange) {
        localTargetAnalysis.push({ pinyinKey: label, fromDiagnostics: win });
        continue;
      }
      // brute search char ranges matching pinyin length
      for (let i = 0; i <= raw.length - syllables.length; i++) {
        const extracted = extractAcousticTonePatternByTime(
          i,
          i + syllables.length,
          0,
          syllables.length,
          acousticSlices,
          wordTimeSpans
        );
        if (extracted.windowTimeRange) {
          localTargetAnalysis.push({
            pinyinKey: label,
            rawStart: i,
            rawEnd: i + syllables.length,
            text: raw.slice(i, i + syllables.length),
            ...extracted,
          });
          break;
        }
      }
    }
  } catch (e) {
    localTargetAnalysis = [{ error: e.message }];
  }

  const spanCandidates = collectSpanCandidates(fw.spans);
  const sentenceCandidates = (fw.sentenceRerank?.topCandidates || [])
    .map((c) => c.text)
    .filter(Boolean);
  const beiShaoScan = scanForBeiShao(spanCandidates, sentenceCandidates);

  const beiShaoWindow = findTargetWindows(tone.exampleToneWindows).find((w) => w.pinyinKey === 'bei|shao');

  const answers = {
    beiShao_hasWindowTimeRange: Boolean(
      beiShaoWindow?.window?.windowTimeRange || localTargetAnalysis.find((x) => x.pinyinKey === 'bei|shao')?.windowTimeRange
    ),
    beiShao_hasAcousticTonePattern: Boolean(
      beiShaoWindow?.window?.acousticTonePattern?.length ||
        localTargetAnalysis.find((x) => x.pinyinKey === 'bei|shao')?.pattern?.length
    ),
    beiShao_pattern: beiShaoWindow?.window?.acousticTonePattern ||
      localTargetAnalysis.find((x) => x.pinyinKey === 'bei|shao')?.pattern,
    peishao_in_span_candidates: beiShaoScan.filter((h) => h.kind === 'span_candidate' && /焙烧/.test(h.word || h.candidateSentence || '')),
    zhongBeiShao_sentence_candidates: sentenceCandidates.filter((s) => /钟焙|焙烧/.test(s)),
    recallToneIncompatibleCount: tone.recallToneIncompatibleCount,
    recallToneCompatibleCount: tone.recallToneCompatibleCount,
    compliance: {
      alignmentTextUsedCount: tone.alignmentTextUsedCount,
      tokenTextUsedForAlignmentCount: tone.tokenTextUsedForAlignmentCount,
      charScanFallbackCount: tone.charScanFallbackCount,
    },
  };

  const trace = {
    timestamp: new Date().toISOString(),
    reference: D001_REF,
    raw_asr: raw,
    asr_service_id: extra.asr_service_id,
    pipeline_ms: extra.pipeline_ms,
    segments: segments.map((s) => ({
      text: s.text,
      start: s.start,
      end: s.end,
      words: (s.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end, probability: w.probability })),
    })),
    utterance_tone: utteranceTone
      ? {
          toneEnabled: utteranceTone.toneEnabled,
          sliceCount: utteranceTone.sliceCount,
          toneConfidenceAvg: utteranceTone.toneConfidenceAvg,
          acousticToneSlices: summarizeAcousticSlices(utteranceTone.acousticToneSlices),
        }
      : null,
    acousticToneSlices: summarizeAcousticSlices(acousticSlices),
    wordTimeSpans,
    spanAssemblyV3_tone: tone,
    target_windows: findTargetWindows(tone.exampleToneWindows),
    local_target_analysis: localTargetAnalysis,
    graph_span_candidates: spanCandidates.slice(0, 80),
    sentence_candidates: sentenceCandidates.slice(0, 20),
    beiShao_scan: beiShaoScan,
    fw_toneModule_rerank: fw.toneModule || null,
    answers,
  };

  const outPath = path.join(__dirname, 'd001-timestamp-tone-probe-trace.json');
  fs.writeFileSync(outPath, JSON.stringify(trace, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log(JSON.stringify(answers, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
