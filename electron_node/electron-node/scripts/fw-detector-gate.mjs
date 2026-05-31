#!/usr/bin/env node
/**
 * P1~P4 freeze gate — static checks for FW mainline isolation and simplification contract.
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
    fail('orchestrator must use hint + topK pipeline (frozen rollback path)');
  }
  if (!orchSrc.includes('runFwSentenceRerankPipeline') || !orchSrc.includes('useSentenceLevelRerank')) {
    fail('orchestrator must wire P4 sentence rerank pipeline + flag');
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

// V1.1 freeze: segment SSOT on main chain outputs
const ssotFiles = [
  ['pipeline/post-asr-routing.ts', ['resolveBusinessAsrText']],
  ['pipeline/result-builder.ts', ['resolveBusinessAsrText']],
  ['pipeline/context/job-context.ts', []],
];

for (const [rel, required] of ssotFiles) {
  const full = path.join(srcRoot, rel);
  if (!fs.existsSync(full)) {
    fail(`missing SSOT file: ${rel}`);
    continue;
  }
  const text = readRel(full);
  if (text.includes('ctx.repairedText') || text.includes('syncRepairedTextBaseline')) {
    fail(`${rel} must not reference repairedText or syncRepairedTextBaseline`);
  }
  for (const needle of required) {
    if (!text.includes(needle)) {
      fail(`${rel} missing freeze helper: ${needle}`);
    }
  }
}

const routingPath = path.join(srcRoot, 'pipeline/post-asr-routing.ts');
if (fs.existsSync(routingPath)) {
  const routingSrc = stripComments(readRel(routingPath));
  if (routingSrc.includes('resolveBusinessAsrTextSource')) {
    fail('post-asr-routing must not declare resolveBusinessAsrTextSource (no fallback chain)');
  }
  if (/return\s*['"]asrText['"]/.test(routingSrc)) {
    fail('post-asr-routing must not fallback resolveBusinessAsrText to asrText');
  }
  if (/\bctx\.asrText\b/.test(routingSrc)) {
    fail('post-asr-routing must not read ctx.asrText for business text');
  }
}

const aggPath = path.join(srcRoot, 'pipeline/steps/aggregation-step.ts');
if (fs.existsSync(aggPath)) {
  const aggSrc = stripComments(readRel(aggPath));
  if (/detectorSegment\s*\|\|\s*ctx\.asrText/.test(aggSrc) || /ctx\.asrText\s*\|\|/.test(aggSrc)) {
    fail('aggregation-step must not fallback currentSegment to ctx.asrText');
  }
}

const fwMainPaths = [
  path.join(fwRoot),
  stepPath,
  path.join(srcRoot, 'pipeline/steps/asr-step.ts'),
  path.join(srcRoot, 'pipeline/steps/aggregation-step.ts'),
  path.join(srcRoot, 'pipeline/steps/dedup-step.ts'),
  path.join(srcRoot, 'pipeline/steps/translation-step.ts'),
  path.join(srcRoot, 'pipeline/steps/fw-detector-step.ts'),
  path.join(srcRoot, 'pipeline/post-asr-routing.ts'),
  path.join(srcRoot, 'pipeline/result-builder.ts'),
  path.join(srcRoot, 'fw-detector/pipeline-mode-fw.ts'),
  path.join(srcRoot, 'fw-detector/fw-detector-orchestrator.ts'),
];

const legacyForbiddenTokens = [
  'buildLegacyRecoverContractExtra',
  'applyLegacySentenceRepair',
  'runLegacySentenceRepairStep',
  'runLegacyLexiconRecallStep',
];

/** Files that may mention LEXICON_RECALL / SENTENCE_REPAIR for registry or FW mode filtering only. */
const legacyStepNameAllowedFiles = new Set([
  path.join(srcRoot, 'pipeline/pipeline-step-registry.ts'),
  path.join(srcRoot, 'fw-detector/pipeline-mode-fw.ts'),
]);

for (const dirOrFile of fwMainPaths) {
  const files = fs.existsSync(dirOrFile) && fs.statSync(dirOrFile).isDirectory()
    ? walkTsFiles(dirOrFile)
    : fs.existsSync(dirOrFile)
      ? [dirOrFile]
      : [];
  for (const full of files) {
    const rel = path.relative(projectRoot, full);
    const text = stripComments(readRel(full));
    if (text.includes('legacy/recover')) {
      fail(`FW main chain must not import legacy/recover: ${rel}`);
    }
    for (const token of legacyForbiddenTokens) {
      if (text.includes(token)) {
        fail(`FW main chain must not reference legacy Recover symbol "${token}": ${rel}`);
      }
    }
    if (!legacyStepNameAllowedFiles.has(full)) {
      if (text.includes('SENTENCE_REPAIR') || text.includes('LEXICON_RECALL')) {
        fail(`FW main chain must not reference legacy Recover step names: ${rel}`);
      }
    }
  }
}

const registryPath = path.join(srcRoot, 'pipeline/pipeline-step-registry.ts');
if (fs.existsSync(registryPath)) {
  const registrySrc = readRel(registryPath);
  if (!registrySrc.includes('Legacy Recover steps')) {
    fail('pipeline-step-registry must document Legacy Recover steps (non-default)');
  }
  if (!registrySrc.includes('applyFwDetectorPipelineMode must remove LEXICON_RECALL')) {
    fail('pipeline-step-registry must note FW mode removes LEXICON_RECALL/SENTENCE_REPAIR');
  }
}

// PostCleanup P1: legacy/fw-detector rollback chain archived
const legacyFwRoot = path.join(srcRoot, 'legacy/fw-detector');
const legacyFwFiles = [
  'fw-topk-decision-pipeline.ts',
  'candidate-scorer.ts',
  'pick-approved-replacements.ts',
  'span-replacement-eval.ts',
];
for (const name of legacyFwFiles) {
  if (!fs.existsSync(path.join(legacyFwRoot, name))) {
    fail(`missing legacy/fw-detector/${name}`);
  }
  if (fs.existsSync(path.join(fwRoot, name))) {
    fail(`rollback file must not remain in fw-detector/: ${name}`);
  }
}
if (fs.existsSync(orchPath)) {
  const orchSrc = readRel(orchPath);
  if (!orchSrc.includes('../legacy/fw-detector/fw-topk-decision-pipeline')) {
    fail('orchestrator must import runFwTopKDecisionPipeline from legacy/fw-detector');
  }
}

const jobContextPath = path.join(srcRoot, 'pipeline/context/job-context.ts');
if (fs.existsSync(jobContextPath)) {
  const jcSrc = readRel(jobContextPath);
  if (!jcSrc.includes('legacy?: LegacyContext')) {
    fail('JobContext must declare legacy?: LegacyContext partition');
  }
}

const freezeGuardDoc = path.join(projectRoot, 'docs/FREEZE_GUARD.md');
if (!fs.existsSync(freezeGuardDoc)) {
  fail('docs/FREEZE_GUARD.md must exist (PostCleanup P1)');
}

if (failures.length) {
  process.exit(1);
}
console.log('[fw-gate] PASS — P1~P4 PostCleanup freeze guard checks OK');
