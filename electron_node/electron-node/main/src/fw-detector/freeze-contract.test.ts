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
import { loadPinyinImeV2RuntimeConfig } from './pinyin-ime-v2/pinyin-ime-v2-config';
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
    const ime = DEFAULT_CONFIG.features?.pinyinImeV2;
    expect(DEFAULT_CONFIG.asr?.engine).toBe(FW_ASR_ENGINE);
    expect(fw?.enabled).toBe(true);
    expect(ime?.enabled).toBe(true);
    expect(ime?.directRepair).toBe(false);
    expect(fw?.disableAsrRerun).toBe(true);
    expect(fw?.candidateRequireRepairTarget).toBe(true);
    expect(fw?.kenlmGateMode).toBe('weak_veto');
    expect(fw?.enableKenLMGate).toBe(true);
    expect(DEFAULT_CONFIG.features?.lexiconRecall?.enabled).toBe(false);
    expect(DEFAULT_CONFIG.features?.lexiconRuntimeV2?.enabled).toBe(true);
    expect(ime?.maxApprovedSpans).toBe(4);
    expect(fw?.maxSentenceCandidates).toBe(16);
    expect(fw?.minDeltaToReplace).toBe(3.0);
    expect(fw?.spanAssemblyV4Enabled).toBe(true);
    expect(fw?.spanAssemblyV4DiagnosticsEnabled).toBe(false);
    expect(fw?.spanAssemblyV4DiagnosticsLevel).toBe('summary');
    expect(fw?.toneTimestampOnlyEnabled).toBe(true);
    expect(fw?.kenlmSubprocessTimeoutMs).toBe(5000);
    expect(fw?.kenlmSubprocessMaxLines).toBe(17);
  });

  it('loadFwDetectorRuntimeConfig 冻结路径默认', () => {
    const cfg = loadFwDetectorRuntimeConfig();
    const ime = loadPinyinImeV2RuntimeConfig();
    expect(cfg.kenlmGateMode).toBe('weak_veto');
    expect(cfg.candidateRequireRepairTarget).toBe(true);
    expect(ime.enabled).toBe(true);
    expect(cfg.enableKenLMGate).toBe(true);
    expect(cfg.maxSentenceCandidates).toBe(16);
    expect(cfg.minDeltaToReplace).toBe(3.0);
    expect(cfg.spanAssemblyV4Enabled).toBe(true);
    expect(cfg.spanAssemblyV4DiagnosticsEnabled).toBe(false);
    expect(cfg.toneTimestampOnlyEnabled).toBe(true);
    expect(cfg.kenlmSubprocessTimeoutMs).toBe(5000);
    expect(cfg.kenlmSubprocessMaxLines).toBe(17);
  });

  it('GATE-1: kenlm-scorer batch-only — no serial runtime symbols', () => {
    const src = readSrc('asr-repair/sentence-rerank/kenlm-scorer.ts');
    for (const sym of [
      'scoreBatchSerial',
      'buildSerialKenlmTiming',
      'shouldUseBatchSubprocess',
      'runKenlmQuery(',
      'kenlmBatchSubprocessEnabled',
      'fallbackToSerial',
      'kenlmRuntimeMode',
    ]) {
      expect(src).not.toContain(sym);
    }
  });

  it('GATE-2: rerank-fw-sentences pick uses raw score delta only', () => {
    const src = stripComments(readSrc('fw-detector/rerank-fw-sentences.ts'));
    expect(src).toContain('FW_RERANK_SCORE_MODE');
    expect(src).not.toMatch(/bestRawDelta\s*=.*normalizedScore/);
    expect(src).not.toMatch(/rawDelta\s*=.*normalizedScore/);
    expect(src).not.toMatch(/bestRawDelta\s*<\s*minDeltaToReplace[\s\S]{0,200}normalizedScore/);
  });

  it('local-span-recall V2-only', () => {
    const recallSrc = readSrc('lexicon/local-span-recall.ts');
    expect(recallSrc).not.toContain('recallSpanTopKV1');
    expect(recallSrc).not.toContain('isLexiconRuntimeV2RecallEnabled');
    expect(recallSrc).not.toContain('lookupTopKByPinyin');
    expect(recallSrc).toContain('recallSpanTopKV2');
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

  it('orchestrator V4-only：无 V2/V3 分支', () => {
    const orchSrc = readSrc('fw-detector/fw-detector-orchestrator.ts');
    expect(orchSrc).not.toContain('span-replacement-eval');
    expect(orchSrc).not.toContain('ensureLexiconRuntimeLoaded');
    expect(orchSrc).not.toMatch(/\bgetLexiconRuntime\b/);
    expect(orchSrc).not.toContain("from '../lexicon/lexicon-runtime-holder'");
    expect(orchSrc).not.toContain('runFwTopKDecisionPipeline');
    expect(orchSrc).not.toContain('useSentenceLevelRerank');
    expect(orchSrc).not.toContain('isLexiconRuntimeV2RecallEnabled');
    expect(orchSrc).not.toContain('resolveLexiconBundleDir');
    expect(orchSrc).not.toContain('spanAssemblyV3Enabled');
    expect(orchSrc).not.toContain('runFwDetectorV3Path');
    expect(orchSrc).not.toContain('resolvePinyinImeV2Spans');
    expect(orchSrc).not.toContain('runFwSentenceRerankPipeline');
    expect(orchSrc).toContain('runFwDetectorV4Path');
    expect(orchSrc).toContain("pipelinePath: 'v4'");
    expect(orchSrc).toContain('ensureLexiconRuntimeV2Loaded');
    expect(orchSrc).not.toContain('resolveFwSpans');
    expect(orchSrc).not.toContain('selectFwMetadataSpans');
    expect(orchSrc).not.toContain('detectSuspiciousSpansV1');
    expect(orchSrc).not.toContain('if (config.spanAssemblyV4Enabled)');
  });

  it('span-assembly-v3 目录已移除', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-v3'))).toBe(false);
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
    expect(rbFw).toContain('resolveFwLexiconRuntimeContract');
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

  it('legacy fw-topk-decision-pipeline 已归档且 orchestrator 不引用', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'legacy/fw-detector/fw-topk-decision-pipeline.ts'))).toBe(true);
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/fw-topk-decision-pipeline.ts'))).toBe(false);
    const orch = readSrc('fw-detector/fw-detector-orchestrator.ts');
    expect(orch).not.toContain('fw-topk-decision-pipeline');
  });

  it('legacy span detector 已归档', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'legacy/archive/fw-detector-span/suspicious-span-detector-v1.ts'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/suspicious-span-detector-v1.ts'))).toBe(false);
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

  it('assemble-parent-term-span-candidates-v4 使用 Greedy Longest 选择', () => {
    const assemblySrc = readSrc('fw-detector/span-assembly-v4/assemble-parent-term-span-candidates-v4.ts');
    expect(assemblySrc).toContain('selectGreedyLongestParentSpanCandidate');
    expect(assemblySrc).toContain('parentSpanCandidateEmittedCount');
    expect(assemblySrc).toContain('parentSpanCandidateSelectedCount');
  });

  it('run-coarse-sentence-beam-v4 使用 findOwningCoarseSpanIndexV4', () => {
    const beamSrc = readSrc('fw-detector/span-assembly-v4/run-coarse-sentence-beam-v4.ts');
    expect(beamSrc).toContain('findOwningCoarseSpanIndexV4');
    expect(beamSrc).not.toMatch(/rawStart === pick\.span\.start/);
  });

  it('coarse-path-assembly 优先用 GraphEdge.coarseSpanId 归属', () => {
    const pathSrc = readSrc('fw-detector/span-assembly-shared/coarse-path-assembly.ts');
    expect(pathSrc).toContain('edgeBelongsToSpan');
    expect(pathSrc).toContain('edge.coarseSpanId === span.id');
    expect(pathSrc).not.toContain('findOwningCoarseSpanIndex');
  });

  it('span-assembly-v4-orchestrator 主链 domain assembly，spanSets 不直接来自 beam', () => {
    const orchSrc = readSrc('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts');
    expect(orchSrc).toContain('runDomainAwareAssembly');
    expect(orchSrc).toContain('shadowBeamSpanSets: beam.spanSets');
    expect(orchSrc).toContain('spanSets: domainAwareSpanSets');
    expect(orchSrc).not.toMatch(/spanSets:\s*beam\.spanSets/);
    expect(orchSrc).toContain('voteUtteranceDomain({');
  });

  it('utterance-domain-vote 提供 Main/Shadow 双入口', () => {
    const voteSrc = readSrc('fw-detector/span-assembly-shared/utterance-domain-vote.ts');
    expect(voteSrc).toContain('voteUtteranceDomainFromPool');
    expect(voteSrc).toContain('voteUtteranceDomain(');
    expect(voteSrc).not.toContain('vote-utterance-domain');
  });

  it('parent_span_candidate GraphEdge 贯通 coarseSpanId', () => {
    const typesSrc = readSrc('fw-detector/span-assembly-shared/types.ts');
    const assemblySrc = readSrc('fw-detector/span-assembly-v4/assemble-parent-term-span-candidates-v4.ts');
    const graphSrc = readSrc('fw-detector/span-assembly-shared/coarse-candidate-graph.ts');
    expect(typesSrc).toContain('coarseSpanId?: string');
    expect(assemblySrc).toContain('coarseSpanId: candidate.coarseSpanId');
    expect(graphSrc).toContain('coarseSpanId: a.coarseSpanId ?? b.coarseSpanId');
    expect(graphSrc).toMatch(/a\.coarseSpanId !== b\.coarseSpanId/);
  });

  it('recallSpanTopKV2 冻结合约：不得引用 term_pinyin_ngrams / parent_fragment', () => {
    const v2Src = readSrc('lexicon-v2/recall-span-topk-v2.ts');
    expect(v2Src).not.toContain('term_pinyin_ngrams');
    expect(v2Src).not.toContain('parent_fragment');
    expect(v2Src).not.toContain('recallSpanTopKV3');
    expect(v2Src).not.toContain('lookupParentFragments');
  });

  it('tone-first recall 禁止单列 tone_pinyin_key SQL', () => {
    const runtimeSrc = readSrc('lexicon-v2/lexicon-runtime-v2.ts');
    const stripped = stripComments(runtimeSrc);
    expect(stripped).not.toMatch(/WHERE\s+tone_pinyin_key\s*=\s*\?/i);
    expect(stripped).toMatch(/pinyin_key\s*=\s*\?\s+AND\s+tone_pinyin_key\s*=\s*\?/i);
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
