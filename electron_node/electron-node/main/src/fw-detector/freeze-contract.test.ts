/**
 * P1.2c-fix 合并冻结合约 — 静态断言（V1.1 代码对照版 §二、§十）
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { DEFAULT_CONFIG } from '../node-config-defaults';
import { PIPELINE_MODES } from '../pipeline/pipeline-mode-config';
import { applyFwDetectorPipelineMode } from './pipeline-mode-fw';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import { FW_ASR_ENGINE, FW_ASR_SERVICE_ID } from './fw-mode';

const SRC_ROOT = path.resolve(__dirname, '..');

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('P1.2c-fix merge freeze contract (V1.1)', () => {
  it('DEFAULT_CONFIG 对齐 V1.1 冻结默认', () => {
    const fw = DEFAULT_CONFIG.features?.fwDetector;
    expect(DEFAULT_CONFIG.asr?.engine).toBe(FW_ASR_ENGINE);
    expect(fw?.enabled).toBe(true);
    expect(fw?.disableAsrRerun).toBe(true);
    expect(fw?.spanDetectBudget).toBeGreaterThanOrEqual(12);
    expect(fw?.candidateRequireRepairTarget).toBe(true);
    expect(fw?.repairTargetScoreBoost).toBe(0);
    expect(fw?.kenlmGateMode).toBe('weak_veto');
    expect(fw?.enableKenLMGate).toBe(true);
    expect(DEFAULT_CONFIG.features?.lexiconRecall?.enabled).toBe(false);
    expect(fw?.finalScoreWeights?.prior).toBe(0.3);
  });

  it('loadFwDetectorRuntimeConfig 默认 weak_veto + candidateRequireRepairTarget', () => {
    const cfg = loadFwDetectorRuntimeConfig();
    expect(cfg.kenlmGateMode).toBe('weak_veto');
    expect(cfg.candidateRequireRepairTarget).toBe(true);
    expect(cfg.spanDetectBudget).toBeGreaterThanOrEqual(12);
  });

  it('FW pipeline: ASR → FW_SPAN_DETECTOR → AGGREGATION，移除 Recover 步骤', () => {
    const mode = applyFwDetectorPipelineMode(PIPELINE_MODES.GENERAL_VOICE_TRANSLATION);
    expect(mode.steps).toEqual(
      expect.arrayContaining(['ASR', 'FW_SPAN_DETECTOR', 'AGGREGATION'])
    );
    expect(mode.steps).not.toContain('LEXICON_RECALL');
    expect(mode.steps).not.toContain('SENTENCE_REPAIR');
    const asrIdx = mode.steps.indexOf('ASR');
    const fwIdx = mode.steps.indexOf('FW_SPAN_DETECTOR');
    const aggIdx = mode.steps.indexOf('AGGREGATION');
    expect(fwIdx).toBe(asrIdx + 1);
    expect(aggIdx).toBeGreaterThan(fwIdx);
  });

  it('FW 引擎常量与 ASR 路由一致', () => {
    expect(FW_ASR_SERVICE_ID).toBe('faster-whisper-vad');
  });

  it('Detector 源文件不含 recallSpanTopK / repairTarget 读取', () => {
    const detectorSrc = stripComments(readSrc('fw-detector/suspicious-span-detector-v1.ts'));
    const hintSrc = stripComments(readSrc('fw-detector/span-detector-hint.ts'));
    expect(detectorSrc).not.toMatch(/recallSpanTopK|local-span-recall|repairTarget|hasReplacementCandidate/);
    expect(hintSrc).not.toMatch(/recallSpanTopK|local-span-recall|lexicon-runtime/);
  });

  it('orchestrator 主链不接 span-replacement-eval', () => {
    const orchSrc = readSrc('fw-detector/fw-detector-orchestrator.ts');
    expect(orchSrc).not.toContain('span-replacement-eval');
    expect(orchSrc).toContain('createSpanDetectorHint');
    expect(orchSrc).toContain('runFwTopKDecisionPipeline');
  });

  it('pinyin-probe 已删除', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/pinyin-probe.ts'))).toBe(false);
  });

  it('rawAsrText 写点仅 asr-step 首段（静态）', () => {
    const asrStep = readSrc('pipeline/steps/asr-step.ts');
    const assignments = [...asrStep.matchAll(/ctx\.rawAsrText\s*(?<![=<>!])=(?!=)/g)];
    expect(assignments.length).toBe(1);
    expect(asrStep).toContain('ctx.rawAsrText === undefined');
  });

  it('result-builder text_asr 来自 segmentForJobResult', () => {
    const rb = readSrc('pipeline/result-builder.ts');
    expect(rb).toMatch(/text_asr:\s*finalAsrText/);
    expect(rb).toContain('resolveBusinessAsrText');
    expect(rb).not.toContain('ctx.repairedText');
    expect(rb).toContain('raw_asr_text');
  });

  it('post-asr-routing 不含 syncRepairedTextBaseline', () => {
    const routing = readSrc('pipeline/post-asr-routing.ts');
    expect(routing).not.toContain('syncRepairedTextBaseline');
    expect(routing).not.toContain('ctx.repairedText');
  });

  it('resolveBusinessAsrText 只读 segmentForJobResult，禁止 asr/raw/repaired fallback', () => {
    const routing = stripComments(readSrc('pipeline/post-asr-routing.ts'));
    expect(routing).toContain('resolveBusinessAsrText');
    expect(routing).not.toContain('resolveBusinessAsrTextSource');
    expect(routing).not.toMatch(/\bctx\.asrText\b/);
    expect(routing).not.toMatch(/\bctx\.rawAsrText\b/);
    expect(routing).not.toMatch(/\brepairedText\b/);
    expect(routing).not.toMatch(/return\s*['"]asrText['"]/);
  });

  it('aggregation-step currentSegment 不 fallback asrText/rawAsrText', () => {
    const agg = stripComments(readSrc('pipeline/steps/aggregation-step.ts'));
    expect(agg).not.toMatch(/detectorSegment\s*\|\|\s*ctx\.asrText/);
    expect(agg).not.toMatch(/ctx\.asrText\s*\|\|/);
    expect(agg).not.toMatch(/\bctx\.rawAsrText\b/);
  });

  it('result-builder 使用 resolveBusinessAsrText', () => {
    const rb = readSrc('pipeline/result-builder.ts');
    expect(rb).toContain('resolveBusinessAsrText');
  });

  it('FW pipeline 含 DEDUP 且位于 TRANSLATION 前', () => {
    const mode = applyFwDetectorPipelineMode(PIPELINE_MODES.GENERAL_VOICE_TRANSLATION);
    const dedupIdx = mode.steps.indexOf('DEDUP');
    const transIdx = mode.steps.indexOf('TRANSLATION');
    expect(dedupIdx).toBeGreaterThanOrEqual(0);
    expect(transIdx).toBeGreaterThan(dedupIdx);
  });

  it('JobContext 类型不含 repairedText', () => {
    const jc = readSrc('pipeline/context/job-context.ts');
    expect(jc).not.toMatch(/\brepairedText\b/);
  });

  it('FW 主链源文件不 import legacy/recover', () => {
    const fwPaths = [
      'fw-detector/pipeline-mode-fw.ts',
      'pipeline/steps/fw-detector-step.ts',
      'pipeline/steps/aggregation-step.ts',
      'pipeline/steps/asr-step.ts',
    ];
    for (const rel of fwPaths) {
      const src = readSrc(rel);
      expect(src).not.toContain('legacy/recover');
    }
  });
});
