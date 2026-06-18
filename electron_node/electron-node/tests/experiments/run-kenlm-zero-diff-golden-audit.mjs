#!/usr/bin/env node
/**
 * KenLM Runtime Zero Diff Golden Audit — serial vs batch per case.
 * Requires test server :5020 + node running.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTestServerPort } from '../lib/wait-asr-ready.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIALOG_DIR = path.resolve(__dirname, '../../../../test wav/dialog_200');
const MANIFEST = path.join(DIALOG_DIR, 'cases.manifest.json');
const CONFIG_PATH = path.join(
  process.env.APPDATA || '',
  'lingua-electron-node',
  'electron-node-config.json'
);
const OUT = path.join(__dirname, 'kenlm-zero-diff-golden-audit-result.json');

// Fixed 10-case subset per Development Plan V1.0.2
const GOLDEN_IDS = [
  'd001',
  'd002',
  'd005',
  'd021',
  'd048',
  'd065',
  'd079',
  'd003',
  'd046',
  'd050',
];

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function setBatchEnabled(enabled) {
  const cfg = loadConfig();
  cfg.features = cfg.features || {};
  cfg.features.fwDetector = cfg.features.fwDetector || {};
  cfg.features.fwDetector.kenlmBatchSubprocessEnabled = enabled;
  saveConfig(cfg);
}

function extractFwSnapshot(extra) {
  const fw = extra?.fw_detector || {};
  const sr = fw.sentenceRerank || {};
  const scores = sr.allCombinationDeltas
    ? null
    : null;
  const kenlmScores =
    extra?._kenlm_score_snapshot ||
    sr._kenlmScores ||
    null;

  return {
    kenlmQueryCount: fw.kenlmVetoQueryCount ?? sr.kenlmQueryCount,
    combinationCount: sr.combinationCount,
    maxDelta: sr.maxDelta,
    pickedIsRaw: sr.pickedIsRaw,
    pickedText: sr.picked?.text ?? null,
    allCombinationDeltas: sr.allCombinationDeltas ?? [],
    topCandidates: (sr.topCandidates || []).map((t) => ({
      text: t.text,
      kenlmDelta: t.kenlmDelta,
      replacementCount: t.replacementCount,
    })),
    approved: (fw.replacements || [])
      .filter((r) => r.applied)
      .map((r) => `${r.start}:${r.end}:${r.after}`)
      .sort(),
    appliedCount: fw.summary?.appliedCount ?? 0,
    segmentForJobResult: extra?.segment_for_job_result ?? extra?.text_asr ?? '',
    rawScores: sr.allCombinationDeltas
      ? undefined
      : undefined,
    kenlmRuntimeMode: sr.kenlmRuntimeMode,
    kenlmSubprocessCount: sr.kenlmSubprocessCount,
  };
}

function extractKenlmScoresFromExtra(extra) {
  const sr = extra?.fw_detector?.sentenceRerank || {};
  const deltas = sr.allCombinationDeltas || [];
  const rawText = extra?.raw_asr_text || '';
  const top = sr.topCandidates || [];
  return {
    rawScoreBaseline: null,
    normalizedBaseline: null,
    deltas,
    maxDelta: sr.maxDelta,
    kenlmQueryCount: extra?.fw_detector?.kenlmVetoQueryCount ?? sr.kenlmQueryCount,
    combinationCount: sr.combinationCount,
    pickedIsRaw: sr.pickedIsRaw,
    pickedText: sr.picked?.text ?? null,
    topCandidates: top.map((t) => ({ text: t.text, kenlmDelta: t.kenlmDelta })),
    appliedCount: extra?.fw_detector?.summary?.appliedCount ?? 0,
    approved: (extra?.fw_detector?.replacements || [])
      .filter((r) => r.applied)
      .map((r) => `${r.start}:${r.end}:${r.after}`)
      .sort()
      .join('|'),
    segmentForJobResult: (extra?.text_asr || '').trim(),
    kenlmRuntimeMode: sr.kenlmRuntimeMode,
  };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function runCase(port, caseDef, mode) {
  const wavPath = path.join(DIALOG_DIR, caseDef.file);
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      session_id: `zero-diff-${caseDef.id}-${mode}-${Date.now()}`,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return extractKenlmScoresFromExtra(data.extra || {});
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const byId = Object.fromEntries(manifest.map((c) => [c.id, c]));
  const port = getTestServerPort();
  const originalCfg = loadConfig();
  const results = [];

  try {
    for (const id of GOLDEN_IDS) {
      const caseDef = byId[id];
      if (!caseDef) {
        results.push({ id, error: 'missing manifest', match: false });
        continue;
      }
      console.log(`[zero-diff] ${id} serial...`);
      setBatchEnabled(false);
      await new Promise((r) => setTimeout(r, 500));
      const serial = await runCase(port, caseDef, 'serial');

      console.log(`[zero-diff] ${id} batch...`);
      setBatchEnabled(true);
      await new Promise((r) => setTimeout(r, 500));
      const batch = await runCase(port, caseDef, 'batch');

      const fields = [
        'kenlmQueryCount',
        'combinationCount',
        'maxDelta',
        'pickedIsRaw',
        'pickedText',
        'allCombinationDeltas',
        'topCandidates',
        'appliedCount',
        'approved',
        'segmentForJobResult',
      ];
      const serialPick = {
        kenlmQueryCount: serial.kenlmQueryCount,
        combinationCount: serial.combinationCount,
        maxDelta: serial.maxDelta,
        pickedIsRaw: serial.pickedIsRaw,
        pickedText: serial.pickedText,
        allCombinationDeltas: serial.deltas,
        topCandidates: serial.topCandidates,
        appliedCount: serial.appliedCount,
        approved: serial.approved,
        segmentForJobResult: serial.segmentForJobResult,
      };
      const batchPick = {
        kenlmQueryCount: batch.kenlmQueryCount,
        combinationCount: batch.combinationCount,
        maxDelta: batch.maxDelta,
        pickedIsRaw: batch.pickedIsRaw,
        pickedText: batch.pickedText,
        allCombinationDeltas: batch.deltas,
        topCandidates: batch.topCandidates,
        appliedCount: batch.appliedCount,
        approved: batch.approved,
        segmentForJobResult: batch.segmentForJobResult,
      };
      const fieldDiffs = {};
      let match = true;
      for (const f of fields) {
        const eq = deepEqual(serialPick[f], batchPick[f]);
        fieldDiffs[f] = eq ? 'MATCH' : { serial: serialPick[f], batch: batchPick[f] };
        if (!eq) match = false;
      }
      results.push({
        id,
        scenario: caseDef.scenario,
        match,
        fieldDiffs,
        serial: { ...serialPick, kenlmRuntimeMode: serial.kenlmRuntimeMode },
        batch: { ...batchPick, kenlmRuntimeMode: batch.kenlmRuntimeMode },
      });
      console.log(`[zero-diff] ${id} => ${match ? 'MATCH' : 'DIFF'}`);
    }
  } finally {
    saveConfig(originalCfg);
  }

  const report = {
    timestamp: new Date().toISOString(),
    goldenIds: GOLDEN_IDS,
    allMatch: results.every((r) => r.match),
    matchCount: results.filter((r) => r.match).length,
    total: results.length,
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('[zero-diff] wrote', OUT);
  console.log('[zero-diff] summary', report.matchCount, '/', report.total, 'match');
  process.exit(report.allMatch ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
