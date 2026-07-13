#!/usr/bin/env node
/**
 * P10 Runtime Business Effect Acceptance Audit (read-only).
 * Counterfactual A/B via live pipeline; C/D via offline penalty replay on captured traces.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from '../lib/wait-asr-ready.mjs';
import { loadDialog200Manifest } from '../lib/load-dialog200-manifest.mjs';
import { getFwFrozenPort, resolveProjectRoot } from '../lib/fw-port-ssot.mjs';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || resolveProjectRoot(__dirname);
const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav/dialog_200');
const OUT_ROOT = path.join(PROJECT_ROOT, 'tmp/tone_p10_business_acceptance');
const FW_PORT = getFwFrozenPort(PROJECT_ROOT);
const CONFIG_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'lingua-electron-node',
  'electron-node-config.json'
);

const UNIFORM_POSTERIOR = { t1: 0.2, t2: 0.2, t3: 0.2, t4: 0.2, t5: 0.2 };
const TONE_MATCH = 1.0;
const TONE_MISMATCH = 0.8;

function argmaxTone(p) {
  const entries = [
    [1, p.t1 ?? 0],
    [2, p.t2 ?? 0],
    [3, p.t3 ?? 0],
    [4, p.t4 ?? 0],
    [5, p.t5 ?? 0],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function isToneSensitive(caseDef) {
  const s = caseDef.scenario || '';
  const u = caseDef.utterance || caseDef.text || '';
  return (
    caseDef.id === 'd001' ||
    s === 'lexicon_homophone' ||
    s === 'cafe' ||
    /少糖|马芬|问一下|中杯|蓝莓/.test(u)
  );
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function patchFwConfig({ toneEnabled, traceIds }) {
  const cfg = readConfig();
  cfg.features = cfg.features ?? {};
  cfg.features.fwDetector = cfg.features.fwDetector ?? {};
  cfg.features.fwDetector.spanAssemblyV4Enabled = true;
  cfg.features.fwDetector.toneTimestampOnlyEnabled = toneEnabled;
  cfg.features.fwDetector.spanAssemblyV4DiagnosticsEnabled = true;
  cfg.features.fwDetector.spanAssemblyV4DiagnosticsLevel = 'trace';
  cfg.features.fwDetector.spanAssemblyV4DiagnosticsTargetIds = traceIds;
  writeConfig(cfg);
}

function wavToPcm16(wavPath) {
  const buf = fs.readFileSync(wavPath);
  let off = 12;
  let sampleRate = 16000;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sampleRate = buf.readUInt32LE(off + 12);
    if (id === 'data') {
      return { pcm: buf.subarray(off + 8, off + 8 + sz), sampleRate };
    }
    off += 8 + sz;
  }
  throw new Error(`bad wav ${wavPath}`);
}

async function postFwUtterance(wavPath, traceId) {
  const { pcm, sampleRate } = wavToPcm16(wavPath);
  const res = await fetch(`http://127.0.0.1:${FW_PORT}/utterance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: traceId,
      trace_id: traceId,
      src_lang: 'zh',
      audio: pcm.toString('base64'),
      audio_format: 'pcm16',
      sample_rate: sampleRate,
      task: 'transcribe',
      beam_size: 1,
      temperature: 0,
      condition_on_previous_text: false,
      use_context_buffer: false,
      skip_text_dedup: true,
    }),
    signal: AbortSignal.timeout(180000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function postNodePipeline(wavPath, fixtureId, variant) {
  const port = getTestServerPort();
  const sessionId = `p10-biz-${variant}-${fixtureId}-${Date.now()}`;
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath: path.resolve(wavPath),
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      enableKenLMGate: true,
      session_id: sessionId,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, sessionId };
}

function countWords(segments) {
  let n = 0;
  for (const seg of segments || []) {
    for (const w of seg.words || []) {
      if (w.word && w.start != null) n += 1;
    }
  }
  return n;
}

function extractSliceCounts(fwData, nodeBody) {
  const fwTone = fwData?.tone || {};
  const fwSlices = fwTone.acousticToneSlices || [];
  const nodeUtterance = nodeBody?.extra?.utterance_tone || {};
  const nodeSlices = nodeUtterance.acousticToneSlices || [];
  const fwDiag = fwData?.diagnostics?.toneModule?.toneSliceCount ?? fwSlices.length;
  const sa = nodeBody?.extra?.fw_detector?.spanAssemblyV4 || {};
  const recallTone = sa.tone || {};
  return {
    fwHttp: fwSlices.length,
    fwDiag,
    nodeUtteranceTone: nodeSlices.length,
    recallToneSliceCount: recallTone.toneSliceCount ?? null,
    nodeWordCount: countWords(nodeBody?.segments),
    fwWordCount: countWords(fwData?.segments),
  };
}

function buildInfluenceTrace(nodeBody, variant) {
  const extra = nodeBody?.extra || {};
  const fw = extra.fw_detector || {};
  const sa = fw.spanAssemblyV4 || {};
  const tone = sa.tone || {};
  const trace = sa.trace || {};
  const utteranceTone = extra.utterance_tone || {};
  const slices = (utteranceTone.acousticToneSlices || []).map((s) => ({
    start: s.start,
    end: s.end,
    argmax: argmaxTone(s.tonePosterior || {}),
    confidence: s.confidence,
    posterior: s.tonePosterior,
  }));

  const exampleWindows = (tone.exampleToneWindows || []).map((w) => ({
    text: w.text,
    pinyinKey: w.pinyinKey,
    acousticTonePattern: w.acousticTonePattern,
    windowTimeRange: w.windowTimeRange,
  }));

  const recallPre = (trace.recallHitsPreFilter || []).map((h) => ({
    windowId: h.windowId,
    windowPinyinKey: h.windowPinyinKey,
    replacement: h.replacement,
    candidateScoreBeforeTone: h.candidateScore / (h.tonePenalty ?? 1),
    candidateScoreAfterTone: h.candidateScore,
    tonePenalty: h.tonePenalty,
    toneReason: h.toneReason,
    toneLookupStage: h.toneLookupStage,
    queryTonePinyinKey: h.queryTonePinyinKey,
    filterStage: h.filterStage,
  }));

  const recallPost = (trace.recallHits || []).slice(0, 10).map((h, i) => ({
    rank: i + 1,
    replacement: h.replacement,
    candidateScore: h.candidateScore,
    tonePenalty: h.tonePenalty,
    toneReason: h.toneReason,
    repairTarget: h.repairTarget,
  }));

  const kenlm = fw.sentenceRerank || {};
  const topKenlm = (kenlm.topCandidates || trace.sentenceCandidates || []).slice(0, 5).map((c, i) => ({
    rank: i + 1,
    text: c.text || c.sentence || c.candidateSentence,
    kenlmDelta: c.kenlmDelta ?? c.raw_log_delta,
    selected: c.selected,
  }));

  const replacements = (fw.replacements || []).map((r) => ({
    spanText: r.spanText || r.text,
    replacement: r.replacement,
    approved: r.approved,
  }));

  return {
    variant,
    toneEnabled: tone.toneEnabled,
    toneSkippedReason: tone.toneSkippedReason,
    sliceCount: slices.length,
    posteriorSummary: slices.slice(0, 8),
    exampleWindows,
    recallPreFilterSample: recallPre.slice(0, 15),
    rankingBeforeKenLM: recallPost,
    kenlmTop: topKenlm,
    kenlmPickedIsRaw: kenlm.pickedIsRaw,
    kenlmMaxDelta: kenlm.maxDelta,
    replacements,
    finalCandidate: nodeBody?.text_asr,
    rawAsrText: extra.raw_asr_text,
    appliedCount: fw.summary?.appliedCount,
    triggered: fw.triggered,
  };
}

function compareVariants(a, b) {
  return {
    finalCandidateChanged: a.finalCandidate !== b.finalCandidate,
    rawAsrTextChanged: a.rawAsrText !== b.rawAsrText,
    appliedCountDelta: (b.appliedCount ?? 0) - (a.appliedCount ?? 0),
    toneEnabledA: a.toneEnabled,
    toneEnabledB: b.toneEnabled,
    toneSkippedB: b.toneSkippedReason,
    rankingTop1A: a.rankingBeforeKenLM[0]?.replacement,
    rankingTop1B: b.rankingBeforeKenLM[0]?.replacement,
    kenlmTop1A: a.kenlmTop[0]?.text,
    kenlmTop1B: b.kenlmTop[0]?.text,
  };
}

function offlineCounterfactualCD(exampleWindows, recallPre) {
  if (!recallPre?.length) return { c: null, d: null };

  const recompute = (mutatePattern) =>
    recallPre.map((h) => {
      const win = exampleWindows.find((w) => w.pinyinKey === h.windowPinyinKey);
      const pattern = win?.acousticTonePattern;
      if (!pattern?.length || !h.queryTonePinyinKey) {
        return { ...h, tonePenalty: TONE_MATCH, toneReason: 'no_pattern' };
      }
      const mutated = mutatePattern ? mutatePattern([...pattern]) : pattern;
      const candidateTones = h.queryTonePinyinKey.split('|').map((s) => {
        const m = s.match(/([1-5])$/);
        return m ? parseInt(m[1], 10) : 0;
      });
      let compatible = mutated.length === candidateTones.length;
      if (compatible) {
        for (let i = 0; i < mutated.length; i++) {
          if (mutated[i] !== candidateTones[i]) {
            compatible = false;
            break;
          }
        }
      }
      const penalty = compatible ? TONE_MATCH : TONE_MISMATCH;
      const before = h.candidateScoreBeforeTone ?? h.candidateScoreAfterTone / (h.tonePenalty || 1);
      return {
        windowPinyinKey: h.windowPinyinKey,
        replacement: h.replacement,
        acousticPattern: mutated,
        tonePenalty: penalty,
        toneReason: compatible ? 'match' : 'mismatch',
        scoreBefore: before,
        scoreAfter: before * penalty,
        scoreDelta: before * penalty - (h.candidateScoreAfterTone ?? before),
      };
    });

  const variantC = recompute(() => [3, 3, 3, 3, 3].slice(0, 4));
  const variantD = recompute((pat) => {
    const out = [...pat];
    for (let i = 0; i < out.length; i++) {
      if (out[i] === 3) out[i] = 2;
    }
    return out;
  });

  return {
    c: {
      label: 'uniform_pattern_proxy',
      hits: variantC,
      penaltyChanges: variantC.filter((h, i) => h.tonePenalty !== recallPre[i]?.tonePenalty).length,
      scoreChanges: variantC.filter((h, i) => Math.abs(h.scoreAfter - (recallPre[i]?.candidateScoreAfterTone ?? 0)) > 1e-6).length,
    },
    d: {
      label: 'wrong_tone_3_to_2',
      hits: variantD,
      penaltyChanges: variantD.filter((h, i) => h.tonePenalty !== recallPre[i]?.tonePenalty).length,
      scoreChanges: variantD.filter((h, i) => Math.abs(h.scoreAfter - (recallPre[i]?.candidateScoreAfterTone ?? 0)) > 1e-6).length,
    },
  };
}

function synthesizeMultiSegmentWav(outPath, parts, gapSec = 1.2) {
  const chunks = [];
  let sampleRate = 16000;
  for (const wav of parts) {
    const { pcm, sampleRate: sr } = wavToPcm16(wav);
    sampleRate = sr;
    chunks.push(pcm);
    chunks.push(Buffer.alloc(Math.floor(gapSec * sr * 2)));
  }
  const pcm = Buffer.concat(chunks);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
  return { sampleRate, durationSec: pcm.length / (sampleRate * 2) };
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const port = getTestServerPort();
  if (!(await waitTestServerHealth(port))) {
    console.error('Node test server not ready');
    process.exit(2);
  }
  const ready = await waitAsrReady(port, {
    warmupWavPath: path.join(DIALOG_DIR, 'dialog_d001.wav'),
    maxWaitMs: 300000,
    label: 'p10-biz-audit',
  });
  if (!ready.ready) {
    console.error('ASR not ready', ready.lastError);
    process.exit(2);
  }

  const { cases } = loadDialog200Manifest(path.join(DIALOG_DIR, 'cases.manifest.json'));
  const fixtures = cases.filter(isToneSensitive);
  const fixtureIds = fixtures.map((f) => f.id);
  console.log(`Tone-sensitive fixtures: ${fixtureIds.join(', ')}`);

  const savedConfig = readConfig();
  const report = {
    timestamp: new Date().toISOString(),
    fixtureIds,
    fixtures: [],
    aggregate: {},
    sliceLossAudit: [],
    multiSegmentVad: [],
    smokeArtifact: null,
    batchInference: null,
  };

  try {
    patchFwConfig({ toneEnabled: true, traceIds: fixtureIds });

    for (const caseDef of fixtures) {
      const fid = caseDef.id;
      const wavPath = path.join(DIALOG_DIR, caseDef.file);
      const fixDir = path.join(OUT_ROOT, fid);
      fs.mkdirSync(fixDir, { recursive: true });

      console.log(`[${fid}] Variant A (real tone)...`);
      const fwA = await postFwUtterance(wavPath, `biz-fw-a-${fid}`);
      const nodeA = await postNodePipeline(wavPath, fid, 'A');
      fs.writeFileSync(path.join(fixDir, 'variant_a_node.json'), JSON.stringify(nodeA, null, 2));
      fs.writeFileSync(path.join(fixDir, 'variant_a_fw.json'), JSON.stringify(fwA, null, 2));

      const traceA = buildInfluenceTrace(nodeA.body, 'A_real');
      const sliceCounts = extractSliceCounts(fwA.data, nodeA.body);
      report.sliceLossAudit.push({ fixtureId: fid, ...sliceCounts });

      console.log(`[${fid}] Variant B (tone disabled)...`);
      patchFwConfig({ toneEnabled: false, traceIds: [fid] });
      const nodeB = await postNodePipeline(wavPath, fid, 'B');
      patchFwConfig({ toneEnabled: true, traceIds: fixtureIds });
      fs.writeFileSync(path.join(fixDir, 'variant_b_node.json'), JSON.stringify(nodeB, null, 2));
      const traceB = buildInfluenceTrace(nodeB.body, 'B_disabled');

      const offlineCD = offlineCounterfactualCD(traceA.exampleWindows, traceA.recallPreFilterSample);
      const cmpAB = compareVariants(traceA, traceB);

      const row = {
        fixtureId: fid,
        scenario: caseDef.scenario,
        variantA: traceA,
        variantB: traceB,
        compareAB: cmpAB,
        offlineCounterfactualCD: offlineCD,
        sliceCounts,
      };
      report.fixtures.push(row);
      fs.writeFileSync(path.join(fixDir, 'trace_summary.json'), JSON.stringify(row, null, 2));
      console.log(`[${fid}] finalA=${traceA.finalCandidate?.slice(0, 40)} finalB=${traceB.finalCandidate?.slice(0, 40)} changed=${cmpAB.finalCandidateChanged}`);
    }

    console.log('Multi-segment VAD samples...');
    const multiPairs = [
      ['d001', 'd049'],
      ['d050', 'd051'],
      ['d052', 'd053'],
      ['d088', 'd089'],
      ['d025', 'd026'],
    ];
    const multiDir = path.join(OUT_ROOT, 'multi_segment_vad');
    fs.mkdirSync(multiDir, { recursive: true });
    for (const [a, b] of multiPairs) {
      const outWav = path.join(multiDir, `${a}_${b}_gap.wav`);
      const meta = synthesizeMultiSegmentWav(outWav, [
        path.join(DIALOG_DIR, `dialog_${a}.wav`),
        path.join(DIALOG_DIR, `dialog_${b}.wav`),
      ]);
      const fw = await postFwUtterance(outWav, `multi-${a}-${b}`);
      const node = await postNodePipeline(outWav, `${a}_${b}`, 'multi');
      const vadCount = fw.data?.diagnostics?.audio_segmentation?.fw_vad_segment_count ?? null;
      const row = {
        id: `${a}_${b}`,
        wav: outWav,
        vadSegmentCount: vadCount,
        fwToneSlices: fw.data?.tone?.acousticToneSlices?.length ?? 0,
        nodeToneSlices: node.body?.extra?.utterance_tone?.acousticToneSlices?.length ?? 0,
        fwWords: countWords(fw.data?.segments),
        nodeWords: countWords(node.body?.segments),
        toneEnabled: node.body?.extra?.fw_detector?.spanAssemblyV4?.tone?.toneEnabled,
        nodeOk: node.ok,
        durationSec: meta.durationSec,
      };
      report.multiSegmentVad.push(row);
      fs.writeFileSync(path.join(multiDir, `${a}_${b}.json`), JSON.stringify(row, null, 2));
      console.log(`  ${a}+${b} vad=${vadCount} fwSlices=${row.fwToneSlices} nodeSlices=${row.nodeToneSlices}`);
    }

    try {
      const health = await fetch(`http://127.0.0.1:${FW_PORT}/health`, { signal: AbortSignal.timeout(8000) });
      report.smokeArtifact = { healthOk: health.ok };
    } catch (_) {}

    const py = path.join(PROJECT_ROOT, 'electron_node/services/faster_whisper_vad/.venv/Scripts/python.exe');
    const batchScript = path.join(PROJECT_ROOT, 'electron_node/services/faster_whisper_vad/scripts/tone_p10_batch_inference_audit.py');
    if (fs.existsSync(py) && fs.existsSync(batchScript)) {
      const { spawnSync } = await import('child_process');
      const r = spawnSync(py, [batchScript], { encoding: 'utf8', timeout: 120000 });
      try {
        report.batchInference = JSON.parse(r.stdout.trim().split('\n').pop());
      } catch {
        report.batchInference = { stdout: r.stdout?.slice(-500), stderr: r.stderr?.slice(-300) };
      }
    }
  } finally {
    writeConfig(savedConfig);
  }

  const agg = {
    fixtureCount: report.fixtures.length,
    posteriorPresent: report.fixtures.filter((f) => f.variantA.sliceCount > 0).length,
    tonePatternHit: report.fixtures.filter((f) => (f.variantA.exampleWindows?.length || 0) > 0).length,
    tonePenaltyTriggered: report.fixtures.filter((f) =>
      f.variantA.recallPreFilterSample?.some((h) => h.tonePenalty != null && h.tonePenalty < 1)
    ).length,
    rankingReorderedAB: report.fixtures.filter((f) => f.compareAB.rankingTop1A !== f.compareAB.rankingTop1B).length,
    kenlmTopChangedAB: report.fixtures.filter((f) => f.compareAB.kenlmTop1A !== f.compareAB.kenlmTop1B).length,
    finalCandidateChangedAB: report.fixtures.filter((f) => f.compareAB.finalCandidateChanged).length,
    toneNoEffectAB: report.fixtures.filter(
      (f) => !f.compareAB.finalCandidateChanged && !f.compareAB.rankingTop1A !== f.compareAB.rankingTop1B
    ).length,
    sliceLossFirstAtNode: report.sliceLossAudit.filter((s) => s.nodeUtteranceTone < s.fwHttp).length,
    multiSegmentWithVad2Plus: report.multiSegmentVad.filter((m) => (m.vadSegmentCount ?? 0) >= 2).length,
  };
  report.aggregate = agg;

  const outJson = path.join(OUT_ROOT, 'business_effect_audit.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(agg, null, 2));
  console.log('Wrote', outJson);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
