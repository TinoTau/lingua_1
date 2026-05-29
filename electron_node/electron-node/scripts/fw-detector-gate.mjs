#!/usr/bin/env node
/**
 * FW detector merge-freeze gate (P1.2c-fix V1.1).
 * Static checks: Recover isolation, Detector layering, deleted paths.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(projectRoot, 'main/src');
const fwRoot = path.join(srcRoot, 'fw-detector');
const stepPath = path.join(srcRoot, 'pipeline/steps/fw-detector-step.ts');

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error('[fw-gate] FAIL:', msg);
}

function walkTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkTsFiles(full, out);
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function readRel(full) {
  return fs.readFileSync(full, 'utf-8');
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const forbiddenImports = [
  'window-recall',
  'recallSegmentWindowCandidates',
  'enumerate-asr-windows',
  'lexicon-recall-step',
  'sentence-repair-step',
  'nbest-diff',
];

for (const full of [...walkTsFiles(fwRoot), stepPath].filter((p) => fs.existsSync(p))) {
  const rel = path.relative(projectRoot, full);
  const text = readRel(full);
  for (const token of forbiddenImports) {
    if (text.includes(token)) {
      fail(`forbidden token "${token}" in ${rel}`);
    }
  }
}

// V1.1: deleted module must not return
const pinyinProbe = path.join(fwRoot, 'pinyin-probe.ts');
if (fs.existsSync(pinyinProbe)) {
  fail('pinyin-probe.ts must remain deleted (P1.2c-fix layering)');
}

// V1.1: Detector layer — no lexicon recall
const detectorPath = path.join(fwRoot, 'suspicious-span-detector-v1.ts');
if (fs.existsSync(detectorPath)) {
  const detectorSrc = stripComments(readRel(detectorPath));
  for (const token of ['recallSpanTopK', 'local-span-recall', 'repairTarget', 'hasReplacementCandidate']) {
    if (detectorSrc.includes(token)) {
      fail(`Detector must not reference "${token}" (${path.relative(projectRoot, detectorPath)})`);
    }
  }
}

const hintPath = path.join(fwRoot, 'span-detector-hint.ts');
if (fs.existsSync(hintPath)) {
  const hintSrc = readRel(hintPath);
  if (/recallSpanTopK|local-span-recall|lexicon-runtime/.test(hintSrc)) {
    fail('span-detector-hint must not import lexicon recall');
  }
}

// V1.1: orchestrator must not wire span-replacement-eval back
const orchPath = path.join(fwRoot, 'fw-detector-orchestrator.ts');
if (fs.existsSync(orchPath)) {
  const orchSrc = readRel(orchPath);
  if (orchSrc.includes('span-replacement-eval')) {
    fail('orchestrator must not import span-replacement-eval');
  }
  if (!orchSrc.includes('createSpanDetectorHint') || !orchSrc.includes('runFwTopKDecisionPipeline')) {
    fail('orchestrator must use hint + topK pipeline (frozen main chain)');
  }
}

// V1.1: default config freeze keys
const defaultsPath = path.join(srcRoot, 'node-config-defaults.ts');
if (fs.existsSync(defaultsPath)) {
  const defaultsSrc = readRel(defaultsPath);
  for (const needle of [
    "engine: 'fw_detector_v1'",
    'disableAsrRerun: true',
    'spanDetectBudget: 12',
    'candidateRequireRepairTarget: true',
    "kenlmGateMode: 'weak_veto'",
  ]) {
    if (!defaultsSrc.includes(needle)) {
      fail(`node-config-defaults missing freeze default: ${needle}`);
    }
  }
}

if (failures.length) {
  process.exit(1);
}
console.log('[fw-gate] PASS — P1.2c-fix merge-freeze isolation checks OK');
