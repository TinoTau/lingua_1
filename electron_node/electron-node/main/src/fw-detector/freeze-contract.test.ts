/**
 * P1~P4 冻结主链 — Freeze Simplification 冻结合约
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { DEFAULT_CONFIG } from '../node-config-defaults';
import { PIPELINE_MODES } from '../pipeline/pipeline-mode-config';
import { applyFwDetectorPipelineMode } from './pipeline-mode-fw';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import type { FwMetadataSpanGateRuntimeConfig } from './fw-config';
import { FW_ASR_ENGINE, FW_ASR_SERVICE_ID } from './fw-mode';

const SRC_ROOT = path.resolve(__dirname, '..');

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('P1~P4 freeze simplification contract', () => {
  it('DEFAULT_CONFIG 对齐冻结默认', () => {
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
    expect(fw?.maxSpans).toBeUndefined();
    expect(fw?.fwMetadataSpanGate?.maxSpans).toBe(4);
  });

  it('loadFwDetectorRuntimeConfig 冻结路径默认', () => {
    const cfg = loadFwDetectorRuntimeConfig();
    expect(cfg.kenlmGateMode).toBe('weak_veto');
    expect(cfg.candidateRequireRepairTarget).toBe(true);
    expect(cfg.spanDetectBudget).toBeGreaterThanOrEqual(12);
    expect(cfg.spanGateMode).toBe('fw_metadata_gate');
    expect(cfg.kenlmSpanGate.enabled).toBe(false);
    expect(cfg.fwMetadataSpanGate.enabled).toBe(true);
    expect(cfg.useSentenceLevelRerank).toBe(true);
    expect(cfg.enableKenLMGate).toBe(true);
    expect(cfg.maxSpans).toBe(cfg.fwMetadataSpanGate.maxSpans);
    expect(cfg.fwMetadataSpanGate.maxSpans).toBe(4);
    expect(cfg.maxSentenceCandidates).toBe(16);
    expect(cfg.minDeltaToReplace).toBe(0.03);
  });

  it('metadata gate runtime 不含死配置字段', () => {
    const gate = loadFwDetectorRuntimeConfig().fwMetadataSpanGate as FwMetadataSpanGateRuntimeConfig &
      Record<string, unknown>;
    expect('compressionRatioThreshold' in gate).toBe(false);
    expect('noSpeechProbThreshold' in gate).toBe(false);
  });

  it('metadata gate 源码不读取死配置', () => {
    const gateSrc = readSrc('fw-detector/fw-metadata-span-gate.ts');
    expect(gateSrc).not.toContain('compressionRatioThreshold');
    expect(gateSrc).not.toContain('noSpeechProbThreshold');
  });

  it('V2 recall 双开关：DEFAULT_CONFIG 均为 true', () => {
    expect(DEFAULT_CONFIG.features?.lexiconRuntimeV2?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.features?.fwDetector?.useLexiconRuntimeV2Recall).toBe(true);
  });

  it('基础 PIPELINE 模板不含 LEXICON_RECALL / SENTENCE_REPAIR', () => {
    for (const mode of Object.values(PIPELINE_MODES)) {
      if (mode.name === '文本翻译模式') {
        continue;
      }
      expect(mode.steps).not.toContain('LEXICON_RECALL');
      expect(mode.steps).not.toContain('SENTENCE_REPAIR');
    }
  });

  it('FW pipeline: ASR → FW_SPAN_DETECTOR → AGGREGATION，无 legacy ASR repair 步骤', () => {
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

  it('orchestrator 主链接 hint + topK/sentence rerank pipeline', () => {
    const orchSrc = readSrc('fw-detector/fw-detector-orchestrator.ts');
    expect(orchSrc).not.toContain('span-replacement-eval');
    expect(orchSrc).toContain('createSpanDetectorHint');
    expect(orchSrc).toContain('runFwTopKDecisionPipeline');
    expect(orchSrc).toContain('../legacy/fw-detector/fw-topk-decision-pipeline');
    expect(orchSrc).toContain('runFwSentenceRerankPipeline');
    expect(orchSrc).toContain('useSentenceLevelRerank');
    expect(orchSrc).toContain('config.fwMetadataSpanGate.maxSpans');
  });

  it('pinyin-probe 已删除', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/pinyin-probe.ts'))).toBe(false);
  });

  it('rawAsrText 写点仅 asr-step 合并结果（静态）', () => {
    const asrStep = readSrc('pipeline/steps/asr-step.ts');
    const assignments = [...asrStep.matchAll(/ctx\.rawAsrText\s*(?<![=<>!])=(?!=)/g)];
    expect(assignments.length).toBe(1);
    expect(asrStep).toContain('ctx.rawAsrText = mergedAsrText;');
  });

  it('segment 初始化不 fallback asrText', () => {
    const asrStep = readSrc('pipeline/steps/asr-step.ts');
    const fwStep = readSrc('pipeline/steps/fw-detector-step.ts');
    expect(asrStep).toContain("ctx.segmentForJobResult = (ctx.rawAsrText ?? '').trim()");
    expect(asrStep).not.toMatch(/segmentForJobResult\s*=\s*\([^)]*asrText/);
    expect(fwStep).toContain("ctx.segmentForJobResult = (ctx.rawAsrText ?? '').trim()");
  });

  it('result-builder text_asr 来自 segmentForJobResult', () => {
    const core = readSrc('pipeline/result-builder-core.ts');
    expect(core).toMatch(/text_asr:\s*finalAsrText/);
    expect(core).toContain('resolveBusinessAsrText');
    expect(core).not.toContain('ctx.repairedText');
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
    const core = readSrc('pipeline/result-builder-core.ts');
    expect(core).toContain('resolveBusinessAsrText');
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

  it('FW pipeline 不含 LEXICON_RECALL / SENTENCE_REPAIR', () => {
    const mode = applyFwDetectorPipelineMode(PIPELINE_MODES.GENERAL_VOICE_TRANSLATION);
    expect(mode.steps).not.toContain('LEXICON_RECALL');
    expect(mode.steps).not.toContain('SENTENCE_REPAIR');
  });

  it('result-builder FW 路径不静态 import legacy ASR repair', () => {
    const rb = readSrc('pipeline/result-builder.ts');
    const rbFw = readSrc('pipeline/result-builder-fw.ts');
    expect(rb).not.toContain('recover-result-bridge');
    expect(rb).not.toContain('legacy/asr-repair');
    expect(rb).toContain('buildFwJobResult');
    expect(rbFw).not.toContain('legacy/asr-repair');
    expect(rbFw).toContain('buildFwResultExtra');
  });

  it('fw-detector orchestrator 不引用 legacy/asr-repair 或 sentence-repair', () => {
    const orch = readSrc('fw-detector/fw-detector-orchestrator.ts');
    expect(orch).not.toContain('legacy/asr-repair');
    expect(orch).not.toMatch(/sentence-repair|lexicon-recall-step|SENTENCE_REPAIR/);
  });

  it('FW 主链源文件不 import legacy/asr-repair', () => {
    const fwPaths = [
      'fw-detector/pipeline-mode-fw.ts',
      'fw-detector/fw-detector-orchestrator.ts',
      'pipeline/steps/fw-detector-step.ts',
      'pipeline/steps/aggregation-step.ts',
      'pipeline/steps/asr-step.ts',
      'pipeline/steps/dedup-step.ts',
      'pipeline/steps/translation-step.ts',
      'pipeline/post-asr-routing.ts',
      'pipeline/result-builder.ts',
      'pipeline/result-builder-fw.ts',
    ];
    for (const rel of fwPaths) {
      const src = readSrc(rel);
      expect(src).not.toContain('legacy/asr-repair');
    }
  });

  it('legacy/fw-detector 回滚链已归档', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'legacy/fw-detector/fw-topk-decision-pipeline.ts'))).toBe(true);
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/fw-topk-decision-pipeline.ts'))).toBe(false);
    const orch = readSrc('fw-detector/fw-detector-orchestrator.ts');
    expect(orch).toContain('../legacy/fw-detector/fw-topk-decision-pipeline');
  });

  it('JobContext 含 legacy 分区', () => {
    const jc = readSrc('pipeline/context/job-context.ts');
    expect(jc).toContain('legacy?: LegacyContext');
    expect(fs.existsSync(path.join(SRC_ROOT, 'pipeline/context/legacy-context.ts'))).toBe(true);
  });

  it('buildFwResultExtra 路径不打包 legacy 观测字段', () => {
    const rbFw = readSrc('pipeline/result-builder-fw.ts');
    const legacyExtra = readSrc('legacy/asr-repair/legacy-asr-repair-result-extra.ts');
    expect(rbFw).toContain('buildFwResultExtra');
    expect(rbFw).not.toMatch(/buildFwResultExtra[\s\S]*sentence_repair/);
    expect(rbFw).not.toMatch(/buildFwResultExtra[\s\S]*asr_nbest/);
    for (const key of ['sentence_repair', 'asr_nbest', 'asr_repair_lifecycle', 'asr_hypotheses']) {
      expect(legacyExtra).toContain(key);
    }
    expect(legacyExtra).not.toContain('recover_lifecycle');
    expect(legacyExtra).not.toContain('recover_contract_version');
  });

  it('enhancement 步骤位于 pipeline/enhancement/', () => {
    for (const name of [
      'phonetic-correction-step.ts',
      'punctuation-restore-step.ts',
      'semantic-repair-step.ts',
    ]) {
      expect(fs.existsSync(path.join(SRC_ROOT, 'pipeline/enhancement', name))).toBe(true);
      expect(fs.existsSync(path.join(SRC_ROOT, 'pipeline/steps', name))).toBe(false);
    }
  });

  it('segmentForJobResult 写点白名单（静态）', () => {
    const allowed = [
      'pipeline/steps/asr-step.ts',
      'pipeline/steps/fw-detector-step.ts',
      'fw-detector/fw-detector-orchestrator.ts',
      'pipeline/steps/aggregation-step.ts',
      'pipeline/enhancement/semantic-repair-step.ts',
      'pipeline/enhancement/phonetic-correction-step.ts',
      'pipeline/enhancement/punctuation-restore-step.ts',
      'pipeline/post-asr-routing.ts',
      'legacy/asr-repair/asr-repair/sentence-rerank/legacy-apply-sentence-repair.ts',
    ];
    for (const rel of allowed) {
      expect(fs.existsSync(path.join(SRC_ROOT, rel))).toBe(true);
    }
  });
});
