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
const SCRIPTS_ROOT = path.resolve(__dirname, '../../../scripts');

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

function readScript(relativePath: string): string {
  return fs.readFileSync(path.join(SCRIPTS_ROOT, relativePath), 'utf8');
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

  it('Shadow Beam / parent graph assembly modules are deleted', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-v4/run-coarse-sentence-beam-v4.ts'))).toBe(
      false
    );
    expect(
      fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-v4/assemble-parent-term-span-candidates-v4.ts'))
    ).toBe(false);
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-shared/coarse-path-assembly.ts'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-shared/coarse-candidate-graph.ts'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-shared/domain-rerank.ts'))).toBe(false);
  });

  it('GATE-STEP5-LATTICE-TRACE: production ownership, compliance, and legacy bans', () => {
    const orchSrc = readSrc('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts');
    const latticeSrc = readSrc('fw-detector/span-assembly-v4/lattice-fine-span-runtime.ts');
    const mergeSrc = readSrc('fw-detector/span-assembly-v4/merge-cross-path-sentence-candidates.ts');
    const pathTypes = readSrc('fw-detector/span-assembly-v4/path-fine-span-types.ts');
    const rebindSrc = readSrc('fw-detector/span-assembly-v4/tone-fine-span-rebind.ts');
    const assembleSrc = readSrc('fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts');
    const v4Src = readSrc('fw-detector/fw-detector-v4-path.ts');
    const rerankSrc = readSrc('fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts');
    const buildSentSrc = readSrc('fw-detector/build-sentence-candidates.ts');
    const ban = (...parts: string[]) => parts.join('');

    expect(orchSrc).toContain('runLatticeFineSpanGeneration');
    expect(orchSrc).not.toContain(ban('runL', 'trFineSpanGeneration'));
    expect(orchSrc).toContain("generatorMode: 'multi_path_lattice'");
    expect(orchSrc).toContain("voteScope: 'per_path'");
    expect(orchSrc).toContain("assemblyScope: 'per_path'");
    expect(orchSrc).toContain("candidateCapScope: 'global'");
    expect(orchSrc).toContain('candidateCap: kenlmCap');
    expect(orchSrc).toContain('dedupBeforeCap: true');
    expect(orchSrc).toContain("dedupRetention: 'first_wins'");
    expect(orchSrc).toContain("crossPathMergeOwner: 'mergeCrossPathSentenceCandidates'");
    expect(orchSrc).toContain("kenlmInputOwner: 'cross_path_merge'");
    expect(orchSrc).toContain('prefilledCombinationsRequired: true');
    expect(orchSrc).toContain("toneEvidenceOwner: 'acoustic_tone_slices'");
    expect(orchSrc).toContain('toneRecomputedAfterRebind');
    expect(orchSrc).not.toContain('toneRecomputedAfterCommit');
    expect(orchSrc).not.toContain('temporaryPreStep4Collection');
    expect(orchSrc).not.toContain('STEP3_TEMPORARY');
    expect(orchSrc).not.toContain(ban('fallbackTo', 'Ltr'));
    expect(orchSrc).not.toContain('FormalFineSpan');
    expect(orchSrc).not.toContain('toneCommitTrace');
    expect(orchSrc).not.toContain(ban('ltr', 'RuntimeEnabled'));
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-v4', ban('ltr', '-fine-span-generator.ts')))).toBe(
      false
    );

    expect(latticeSrc).toContain('coverageStatus');
    expect(latticeSrc).toContain('pathCapEvents');
    expect(latticeSrc).toContain('edgeCountAfterFallback');
    expect(latticeSrc).not.toContain('coverageComplete');
    expect(latticeSrc).not.toMatch(/\bcapEvents:/);

    expect(mergeSrc).toContain("dedupKey: 'exact_text'");
    expect(mergeSrc).toContain("duplicateRetention: 'first_wins'");
    expect(mergeSrc).toContain("collectionOrder: 'path_bucket_candidate'");

    expect(pathTypes).toContain('PathFineSpan');
    expect(pathTypes).not.toContain('FormalFineSpan');
    expect(pathTypes).toContain('pathRawStart');
    expect(pathTypes).toContain('recomputedAfterRebind');
    expect(pathTypes).not.toContain('formalRawStart');
    expect(pathTypes).not.toContain('recomputedAfterCommit');

    expect(rebindSrc).toContain('recomputedAfterRebind');
    expect(rebindSrc).not.toContain('recomputedAfterCommit');
    expect(assembleSrc).toContain('pathFineSpans');
    expect(assembleSrc).not.toContain('formalSpans');
    expect(assembleSrc).toContain('PATH_FINE_SPAN_POOL');

    expect(v4Src).toMatch(/prefilledCombinations:\s*assemblyResult\.kenlmSentenceCandidates/);
    expect(rerankSrc).toContain('prefilledCombinations: SentenceCombination[]');
    expect(rerankSrc).not.toContain('prefilledCombinations?:');
    expect(rerankSrc).not.toContain('buildSentenceCandidates(');

    expect(buildSentSrc).not.toContain(ban('mergeCrossBucket', 'SentenceCandidates'));
    expect(orchSrc).not.toContain(ban('mergeCrossBucket', 'SentenceCandidates'));
  });

  it('span-assembly-v4-orchestrator main chain is presence vote + multi-bucket + cross-path merge (no shadow)', () => {
    const orchSrc = readSrc('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts');
    expect(orchSrc).toContain('runDomainAwareAssembly');
    expect(orchSrc).toContain('bucketSpanSets');
    expect(orchSrc).toContain('allocateDomainBucketSentenceBudget');
    expect(orchSrc).toContain('mergeCrossPathSentenceCandidates');
    expect(orchSrc).not.toContain('STEP3_TEMPORARY_PRE_STEP4_COLLECTION');
    expect(orchSrc).not.toContain('temporaryPreStep4Collection');
    expect(orchSrc).not.toContain('shadowBeamSpanSets');
    expect(orchSrc).not.toContain('runCoarseSentenceBeamV4');
    expect(orchSrc).not.toContain('applyDomainVoteToEdges');
    expect(orchSrc).not.toContain('voteUtteranceDomain({');
  });

  it('KenLM prefilled path consumes cross-path merged combinations', () => {
    const v4Src = readSrc('fw-detector/fw-detector-v4-path.ts');
    const rerankSrc = readSrc('fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts');
    expect(v4Src).toMatch(
      /prefilledCombinations:\s*assemblyResult\.kenlmSentenceCandidates\?\.combinations(?:\s*\?\?\s*\[\])?/
    );
    expect(rerankSrc).toContain('prefilledCombinations');
    expect(rerankSrc).toContain('input.prefilledCombinations');
    expect(rerankSrc).toContain('prefilledCombinations: SentenceCombination[]');
    expect(rerankSrc).not.toContain('prefilledCombinations?:');
    expect(rerankSrc).not.toContain('buildSentenceCandidates(');
    expect(rerankSrc).not.toContain('input.prefilledCombinations !== undefined');
  });

  it('GATE-FREEZE-PRESENCE: accepted Presence Vote contract static gates', () => {
    const voteSrc = readSrc('fw-detector/span-assembly-shared/utterance-domain-vote.ts');
    const assemblySrc = readSrc('fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts');
    const orchSrc = readSrc('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts');
    const v4Src = readSrc('fw-detector/fw-detector-v4-path.ts');
    const recallSrc = readSrc('fw-detector/span-assembly-v4/recall-topk-for-windows.ts');
    expect(voteSrc).toMatch(/DOMAIN_BUCKET_RETENTION_RATIO\s*=\s*0\.75/);
    expect(voteSrc).toContain('buildFineSpanDomainSet');
    expect(voteSrc).not.toMatch(/domainScores\[[^\]]+\]\s*\+=\s*[^;\n]*candidate\.score/);
    expect(voteSrc).not.toContain('VoteMass');
    expect(voteSrc).not.toContain('SOURCE_WEIGHT');
    expect(voteSrc).not.toContain('coverageWeight');
    expect(assemblySrc).toContain('voteUtteranceDomainFromPool');
    expect(assemblySrc).toContain('for (const bucketDomain of bucketDomains)');
    expect(assemblySrc).toContain('isBaseCandidate');
    expect(assemblySrc).toContain('domains?.includes(bucketDomain)');
    expect(orchSrc).toContain('mergeCrossPathSentenceCandidates');
    expect(orchSrc).toContain('allocateDomainBucketSentenceBudget');
    expect(v4Src).toContain('applied: false');
    // Phase 1: exact SSOT is V2; domain tag enrichment lives in runtime / V2 tiers (not PF path).
    expect(recallSrc).toContain('recallSpanTopKV2');
    expect(recallSrc).not.toContain('lookupParentFragments');
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-shared/domain-rerank.ts'))).toBe(
      false
    );
    expect(orchSrc).not.toContain('shadowBeamSpanSets');
    expect(orchSrc).not.toContain('runCoarseSentenceBeamV4');
  });

  it('GATE-DOC-DOMAIN-ATOMIC: domain multi lookup uses term-then-tags atomic query', () => {
    const runtimeSrc = readSrc('lexicon-v2/lexicon-runtime-v2.ts');
    expect(runtimeSrc).toContain('queryDomainMultiRowsAtomic');
    expect(runtimeSrc).toContain('GROUP BY d.id');
    expect(runtimeSrc).toContain('lookupTermDomainTagsInScope');
    expect(runtimeSrc).not.toMatch(
      /LIMIT \?`;\s*const rows = this\.db\s*\.prepare\(sql\)\s*\.all\([\s\S]*?Math\.max\(limit,\s*limit \* sortedIds\.length\)/
    );
  });

  it('GATE-DOC-SSOT: Runtime_SSOT_Contract_Freeze.md UTF-8 integrity and required contract strings', () => {
    const docsRoot = path.resolve(SRC_ROOT, '../../../../docs/tone-v2');
    const fwDocsRoot = path.resolve(SRC_ROOT, '../../../../docs/fw-detector');
    const freezePath = path.join(docsRoot, 'Runtime_SSOT_Contract_Freeze.md');
    expect(fs.existsSync(freezePath)).toBe(true);
    const buf = fs.readFileSync(freezePath);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(buf)).not.toThrow();
    const text = buf.toString('utf8');
    expect(text.includes('\uFFFD')).toBe(false);
    expect(/\?{3,}/.test(text)).toBe(false);

    // C0 control characters forbidden (allow only LF/CR; ban TAB and other C0).
    const controlChars = [...text].filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 && code !== 10 && code !== 13;
    });
    expect(controlChars).toEqual([]);

    // Markdown fences must pair (simple count; no full parser).
    const fenceCount = (text.match(/```/g) || []).length;
    expect(fenceCount % 2).toBe(0);
    expect(text).not.toMatch(/`\text/);
    expect(text).not.toMatch(/```\t/);

    for (const name of fs.readdirSync(docsRoot)) {
      if (/Runtime_SSOT_Contract_Freeze/i.test(name) && name !== 'Runtime_SSOT_Contract_Freeze.md') {
        throw new Error(`duplicate freeze file not allowed: ${name}`);
      }
      if (/Runtime_SSOT.*(Copy|Final|Latest|V2|\(2\)|\(3\))/i.test(name)) {
        throw new Error(`parallel freeze naming forbidden: ${name}`);
      }
    }

    const required = [
      'term_domain_tags',
      'Hotword.domains[]',
      'WindowCandidate.domains[]',
      'FineSpanDomainSet',
      'DOMAIN_BUCKET_RETENTION_RATIO = 0.75',
      'mergeCrossPathSentenceCandidates',
      'allocateDomainBucketSentenceBudget',
      'fw-detector-v4-path',
      'prefilledCombinations',
      'prefilledCombinations: required',
      'runFwSentenceRerankFromPrefilled',
      'rerankFwSentences',
      'applied:false',
      'ACCEPTED AND FROZEN',
      'KENLM INTEGRATION ACCEPTANCE',
      'KENLM QUALITY STATUS',
    ];
    for (const needle of required) {
      expect(text).toContain(needle);
    }
    expect(text).toMatch(/Fine-Span(?: Domain)? Presence Vote/i);
    expect(text).toMatch(/One Span One Vote Per Domain/i);
    expect(text).toMatch(/Shadow Beam[\s\S]{0,120}REMOVED/i);
    expect(text).toMatch(/Domain Rerank[\s\S]{0,120}REMOVED/i);
    expect(text).toMatch(/Multi-Bucket Assembly/i);
    expect(text).toMatch(/KenLM Cross-Bucket (Ranking|Integration)|跨桶统一评分/i);
    expect(text).toMatch(/Sentence Candidates\s*[≤<=]\s*16|<=16/i);

    // Forbid sole REAL KENLM ACCEPTANCE: PASS without Integration/Quality split.
    if (/REAL KENLM ACCEPTANCE:\s*PASS/i.test(text)) {
      expect(text).toMatch(/KENLM INTEGRATION ACCEPTANCE/i);
      expect(text).toMatch(/KENLM QUALITY STATUS/i);
      expect(text).toMatch(/Known Risks/i);
      throw new Error(
        'REAL KENLM ACCEPTANCE: PASS is forbidden; use KENLM INTEGRATION ACCEPTANCE + KENLM QUALITY STATUS'
      );
    }

    // Sibling current docs: ban obvious active legacy claims (exclude SUPERSEDED banners).
    const siblingPaths = [
      path.join(fwDocsRoot, 'DOMAIN_SOURCE_UNIFICATION.md'),
      path.join(fwDocsRoot, 'recall', 'DOMAIN_RECALL.md'),
      path.join(fwDocsRoot, 'assembly', 'FROZEN_V1_2.md'),
      path.join(fwDocsRoot, 'ARCHITECTURE.md'),
      path.join(fwDocsRoot, 'kenlm', 'KENLM_RUNTIME.md'),
      path.join(fwDocsRoot, 'CONTEXT_PRIOR.md'),
    ];
    for (const p of siblingPaths) {
      if (!fs.existsSync(p)) continue;
      const body = fs.readFileSync(p, 'utf8');
      if (/STATUS:\s*SUPERSEDED|SUPERSEDED\s*\/\s*HISTORICAL/i.test(body.slice(0, 800))) continue;
      expect(body).not.toMatch(/domain-rerank\.ts[^\n]{0,80}(is active|正式|active main)/i);
      expect(body).not.toMatch(/Shadow Beam[^\n]{0,80}(formal main chain|正式主链)/i);
      expect(body).not.toMatch(/Context Prior[^\n]{0,80}multiplier[^\n]{0,40}applied(?!\s*:\s*false)/i);
      expect(body).not.toMatch(/shadowBeamSpanSets[^\n]{0,60}(正式输入|formal input)/i);
    }
  });

  it('dead legacy production domain types removed from span-assembly-shared/types.ts', () => {
    const typesSrc = readSrc('fw-detector/span-assembly-shared/types.ts');
    expect(typesSrc).not.toContain('export type ParentTermEvidence');
    expect(typesSrc).not.toContain('export type ParentSpanCandidate');
    expect(typesSrc).not.toContain('export type GraphEdge =');
    expect(typesSrc).not.toContain('export type CoarseSpanPath');
  });

  it('utterance-domain-vote is FineSpan presence only (no graph shadow vote)', () => {
    const voteSrc = readSrc('fw-detector/span-assembly-shared/utterance-domain-vote.ts');
    expect(voteSrc).toContain('voteUtteranceDomainFromPool');
    expect(voteSrc).toContain('DOMAIN_BUCKET_RETENTION_RATIO');
    expect(voteSrc).toContain('buildFineSpanDomainSet');
    expect(voteSrc).not.toContain('applyDomainVoteToEdges');
    expect(voteSrc).not.toMatch(/export function voteUtteranceDomain\(/);
    expect(voteSrc).not.toContain('SOURCE_WEIGHT');
    expect(voteSrc).not.toContain('VoteMass');
  });

  it('recallSpanTopKV2 冻结合约：不得引用 term_pinyin_ngrams / parent_fragment', () => {
    const v2Src = readSrc('lexicon-v2/recall-span-topk-v2.ts');
    expect(v2Src).not.toContain('term_pinyin_ngrams');
    expect(v2Src).not.toContain('parent_fragment');
    expect(v2Src).not.toContain('recallSpanTopKV3');
    expect(v2Src).not.toContain('lookupParentFragments');
  });

  it('Phase2/3 PF full retirement: production Recall/Runtime 不得查询 fragment / ngram', () => {
    const runtimeSrc = stripComments(readSrc('lexicon-v2/lexicon-runtime-v2.ts'));
    const winSrc = stripComments(readSrc('fw-detector/span-assembly-v4/recall-topk-for-windows.ts'));
    const cacheSrc = stripComments(readSrc('fw-detector/span-assembly-v4/utterance-recall-cache.ts'));
    for (const src of [runtimeSrc, winSrc]) {
      expect(src).not.toContain('lookupParentFragments');
      expect(src).not.toContain('lookupParentFragmentsByNgramKey');
      expect(src).not.toContain('ngramRowToHotword');
      expect(src).not.toContain('term_pinyin_ngrams');
      expect(src).not.toContain('scoreFragmentHit');
      expect(src).not.toContain('mergeExactAndFragmentHits');
      expect(src).not.toContain('stmtNgram');
    }
    expect(fs.existsSync(path.join(SRC_ROOT, 'lexicon-v2/recall-span-topkv3.ts'))).toBe(false);
    expect(cacheSrc).not.toContain('parentFragmentTopK');
    expect(winSrc).not.toContain('parentFragmentTopK');
    expect(winSrc).not.toContain('perParentTermPerWindow');
  });

  it('tone-first recall 禁止单列 tone_pinyin_key SQL', () => {
    const runtimeSrc = readSrc('lexicon-v2/lexicon-runtime-v2.ts');
    const stripped = stripComments(runtimeSrc);
    expect(stripped).not.toMatch(/WHERE\s+tone_pinyin_key\s*=\s*\?/i);
    expect(stripped).toMatch(/pinyin_key\s*=\s*\?\s+AND\s+tone_pinyin_key\s*=\s*\?/i);
  });

  it('GATE-INT-1: buildSentenceCandidates uses rawOverlap interval assembly', () => {
    const assemblySrc = readSrc('fw-detector/build-sentence-candidates.ts');
    expect(assemblySrc).toContain("from './span-assembly-v4/classify-overlap-relation'");
    expect(assemblySrc).toContain('rawOverlap');
    expect(assemblySrc).toContain('intervalAssemblyCandidateCount');
    expect(assemblySrc).not.toMatch(/spanSets\.map\([\s\S]*?\)\.reduce/);
  });

  it('GATE-INT-2: SpanReplacementPick optional window slots (CFG Integration; not FROZEN_V1_2 required propagation)', () => {
    // Classification: B — CFG / Integration gate (not Runtime Domain SSOT).
    // DomainAware intermediate may hold domains[] for sameDomain membership.
    // SpanReplacementPick / KenLM path must not receive domains / domainId / selectedDomain.
    const pickSrc = readSrc('fw-detector/build-sentence-candidates.ts');
    const windowPickSrc = readSrc('fw-detector/span-assembly-v4/window-candidate-to-pick.ts');
    expect(pickSrc).toContain('windowSource?');
    expect(pickSrc).toContain('coveredCoarseSpanIds?');
    expect(windowPickSrc).not.toContain('selectedDomain');
    expect(windowPickSrc).toContain('domains: candidate.domains');
    expect(windowPickSrc).toMatch(
      /domainAwarePickToSpanReplacementPick[\s\S]*?return \{[\s\S]*?candidateScore: pick\.score,\s*\};/
    );
    expect(windowPickSrc).not.toMatch(
      /domainAwarePickToSpanReplacementPick[\s\S]*?return \{[\s\S]*?\bdomains\s*:/
    );
    expect(windowPickSrc).not.toMatch(
      /domainAwarePickToSpanReplacementPick[\s\S]*?return \{[\s\S]*?\bdomainId\s*:/
    );
    expect(pickSrc).not.toMatch(/export type SpanReplacementPick = \{[\s\S]*?\bdomains\??\s*:/);
    expect(windowPickSrc).toContain('domainAwarePickToSpanReplacementPick');
  });

  it('GATE-INT-3: rerank prefilled matches coarse span via rawOverlap', () => {
    const rerankSrc = readSrc('fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts');
    expect(rerankSrc).toContain('rawOverlap');
    expect(rerankSrc).toContain('findPickForCoarseSpan');
    expect(rerankSrc).not.toMatch(
      /r\.span\.start\s*===\s*span\.start[\s\S]{0,80}r\.span\.end\s*===\s*span\.end/
    );
  });

  it('GATE-INT-4: interval metrics H3 synced across types and orchestrator', () => {
    for (const rel of [
      'fw-detector/types.ts',
      'fw-detector/span-assembly-v4/v4-types.ts',
      'fw-detector/fw-detector-v4-path.ts',
      'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts',
    ]) {
      const src = readSrc(rel);
      expect(src).toContain('intervalAssemblyCandidateCount');
      expect(src).toContain('intervalRejectedOverlapCount');
    }
    const limitsSrc = readSrc('fw-detector/span-assembly-v4/v4-limits.ts');
    expect(limitsSrc).toContain('maxIntervalEnumNodes');
    expect(limitsSrc).toContain('maxIntervalRepairPicksPerPath');
  });

  it('GATE-SV2-1: v3 runtime gate accepts only lexicon-v3-runtime-v3 schema (PF retirement)', () => {
    const gateSrc = readScript('lexicon/run-gate-v3-runtime.mjs');
    expect(gateSrc).toContain('V3_SCHEMA_VERSION_V3');
    expect(gateSrc).toMatch(/schemaVersion\s*!==\s*V3_SCHEMA_VERSION_V3/);
    expect(gateSrc).not.toContain('V3_SCHEMA_VERSION_V2');
    expect(gateSrc).not.toMatch(/four-table-v1/);
    expect(gateSrc).toContain('term_pinyin_ngrams');
    expect(gateSrc).toMatch(/term_pinyin_ngrams.*must not exist/);
  });

  it('GATE-SV2-2: patch manifest writer emits lexicon-v3-runtime-v3 only (PF retirement)', () => {
    const writerSrc = readSrc('lexicon-patch-v3/manifest-writer.ts');
    expect(writerSrc).toContain('LEXICON_V3_RUNTIME_V3_SCHEMA_VERSION');
    expect(writerSrc).not.toContain('four-table-v1');
    expect(writerSrc).not.toContain('LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION');
  });

  it('GATE-SV2-3: patch applier is term-centric — no direct domain_lexicon insert', () => {
    const applierSrc = stripComments(readSrc('lexicon-patch-v3/sqlite-patch-applier.ts'));
    expect(applierSrc).toContain('INSERT INTO term');
    expect(applierSrc).toContain('rematerializeTermInDb');
    expect(applierSrc).not.toMatch(/INSERT\s+INTO\s+domain_lexicon/i);
  });

  it('GATE-SV2-4: mergeDomainTierRows rejects missing tag_weight — no prior_score fallback', () => {
    const runtimeSrc = stripComments(readSrc('lexicon-v2/lexicon-runtime-v2.ts'));
    const fnBlock = runtimeSrc.match(/function mergeDomainTierRows[\s\S]*?^}/m)?.[0] ?? '';
    expect(fnBlock).toContain('tag_weight');
    expect(fnBlock).not.toMatch(/prior_score\s*[|?]/);
    expect(fnBlock).not.toMatch(/prior_score\s*\?\?/);
  });

  it('GATE-SV2-5: parent-fragment ngram lookup API fully retired from runtime (Phase 2/3)', () => {
    const runtimeSrc = readSrc('lexicon-v2/lexicon-runtime-v2.ts');
    expect(runtimeSrc).not.toContain('lookupParentFragmentsByNgramKey');
    expect(runtimeSrc).not.toContain('isLexiconV3FiveTableV2Manifest');
    expect(runtimeSrc).not.toContain('getNgramQueryStats');
    expect(runtimeSrc).not.toContain('getAndResetNgramQueryStats');
    expect(runtimeSrc).not.toContain('stmtNgram');
    expect(runtimeSrc).toContain('isLexiconV3RuntimeV3Manifest');
    expect(runtimeSrc).not.toMatch(/FIVE_TABLE_RUNTIME_SCHEMA_VERSION/);
  });

  it('GATE-SV2-6: legacy build-for-electron fails fast', () => {
    const buildSrc = readScript('lexicon/build-for-electron.mjs');
    const blockSrc = readScript('lexicon/lib/legacy-build-block.mjs');
    expect(buildSrc).toContain('failLegacyLexiconBuild');
    expect(blockSrc).toContain('process.exit(1)');
  });

  it('GATE-SV2-7: domain patch SSOT is term table — applier writes term before materialize', () => {
    const applierSrc = readSrc('lexicon-patch-v3/sqlite-patch-applier.ts');
    expect(applierSrc).toContain("op.table === 'term'");
    expect(applierSrc).toContain('upsertTerm');
    expect(applierSrc).toContain('replaceTermTags');
    expect(applierSrc).not.toMatch(/table:\s*['"]domain['"]/);
  });

  it('GATE-ATOMICITY-1: unified Atomicity Validator owns all formal term write paths', () => {
    const core = readScript('lexicon/lib/atomicity-validator.cjs');
    const rebuild = readScript('lexicon/lib/full-rebuild-from-csv.mjs');
    const patchV3 = readSrc('lexicon-patch-v3/patch-validator.ts');
    const patchV4 = readSrc('lexicon-patch-v4/patch-validator-v4.ts');
    const industry = readScript('lexicon/industry_pack_v1/lib/validate-entry.mjs');
    const recall = readSrc('lexicon-v2/lexicon-runtime-v2.ts');

    expect(core).toContain('validateAtomicity');
    expect(core).toContain('applyAtomicityMode');
    expect(core).not.toContain("surface === '上线计划'");
    expect(core).not.toContain("surface === '接口文档'");
    expect(core).not.toContain('bad_compounds');

    expect(rebuild).toContain("require('./atomicity-validator.cjs')");
    expect(rebuild).toContain('validateAtomicity');
    expect(rebuild).toContain("atomicityModeRaw === 'audit'");
    expect(rebuild).toContain("|| 'enforce'");

    expect(patchV3).toContain("from '../lexicon-atomicity/atomicity-validator'");
    expect(patchV3).toContain('validateAtomicityForTermAdd');
    expect(patchV4).toContain("from '../lexicon-atomicity/atomicity-validator'");
    expect(patchV4).toContain('validateAtomicityForOp');
    expect(industry).toContain('atomicity-validator.cjs');
    expect(industry).toContain('atomicity_rejected');

    // Runtime Recall must not filter by atomicity
    expect(recall).not.toContain('validateAtomicity');
    expect(recall).not.toContain('REJECT_COMPOSITE');
    expect(recall).not.toContain('atomicityMode');
  });

  it('GATE-DSU-1: domain-rerank deleted; recall uses runtime-domain-registry', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-shared/domain-rerank.ts'))).toBe(
      false
    );
    const recallSrc = readSrc('lexicon-v2/resolve-recall-enabled-fine-domains.ts');
    expect(recallSrc).toContain('runtime-domain-registry');
    expect(recallSrc).not.toContain('profile-registry');
  });

  it('GATE-DSU-2: CFG-01 enabledDomains defaults empty', () => {
    expect(DEFAULT_CONFIG.features?.fwDetector?.enabledDomains).toEqual([]);
    const fwCfg = loadFwDetectorRuntimeConfig();
    expect(fwCfg.enabledDomains).toEqual([]);
  });

  it('GATE-DSU-2b: recallDomainScope is unique orchestrator Recall SSOT (not raw enabledDomains)', () => {
    const orchSrc = readSrc('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts');
    expect(orchSrc).toContain('recallDomainScope');
    expect(orchSrc).toContain('domainIds: recallDomainIds');
    expect(orchSrc).not.toMatch(/domainIds:\s*weakEnabled\s*\?\s*weakDomainPlan\.queryDomainIds\s*:\s*input\.enabledDomains/);
    expect(orchSrc).toContain('recallDomainScope is empty');
    const v4Src = readSrc('fw-detector/fw-detector-v4-path.ts');
    expect(v4Src).toContain('recallDomainScope');
    expect(v4Src).not.toMatch(/enabledDomains,\s*\n\s*minPrior/);
    const topSrc = readSrc('fw-detector/fw-detector-orchestrator.ts');
    expect(topSrc).toContain('resolveRecallScope');
    expect(topSrc).toContain('recall_domain_scope_empty');
  });

  it('GATE-DSU-3: LLM parser rejects fine primary via runtime registry', () => {
    const parserSrc = readSrc('lexicon-v2/lexicon-profile-decision-parser.ts');
    expect(parserSrc).toContain('isFinePrimaryDomainRejected');
    expect(parserSrc).toContain('isCoarseDomainEligibleForLlm');
    expect(parserSrc).not.toContain('isValidLLMDomain');
  });

  it('GATE-DSU-4: v3 gate enforces domain_hierarchy threshold and domainAvailability', () => {
    const gateSrc = readScript('lexicon/run-gate-v3-runtime.mjs');
    expect(gateSrc).toContain('assertTableThresholds');
    expect(gateSrc).toContain('domainAvailability');
    expect(gateSrc).toContain('BG-02');
    expect(gateSrc).toContain('BG-03');
    const thresholdsSrc = readScript('lexicon/lib/lexicon-v3-runtime.mjs');
    expect(thresholdsSrc).toContain('domain_hierarchy: 12');
  });

  it('GATE-DSU-5: runtime hierarchy is sqlite-only — no profile-registry fallback', () => {
    const registrySrc = readSrc('lexicon-v2/runtime-domain-registry.ts');
    expect(registrySrc).toContain('domain_hierarchy table missing');
    expect(registrySrc).not.toContain('hierarchyFromRegistryJson');
    expect(registrySrc).not.toMatch(/dev fallback/i);
  });

  it('GATE-CP-01: domain-rerank deleted; context-prior is diagnostics-only stub', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-shared/domain-rerank.ts'))).toBe(
      false
    );
    const cpSrc = readSrc('fw-detector/span-assembly-shared/context-prior.ts');
    expect(cpSrc).toContain('ContextPriorStats');
    expect(cpSrc).not.toContain('DOMAIN_RERANK_PENALTY');
    expect(cpSrc).not.toContain('computeDomainRerankPenalty');
  });

  it('GATE-CP-02: utterance-domain-vote must not import context prior', () => {
    const voteSrc = readSrc('fw-detector/span-assembly-shared/utterance-domain-vote.ts');
    expect(voteSrc).not.toContain('computeContextPriorMultiplier');
    expect(voteSrc).not.toContain('contextPrior');
  });

  it('GATE-CP-03: recall scope module must not read profile or context prior', () => {
    const recallSrc = readSrc('lexicon-v2/resolve-recall-enabled-fine-domains.ts');
    expect(recallSrc).not.toContain('primaryDomain');
    expect(recallSrc).not.toContain('contextPrior');
    expect(recallSrc).not.toContain('profile');
  });

  it('GATE-CP-04: context-prior stub has no registry mutation', () => {
    const cpSrc = readSrc('fw-detector/span-assembly-shared/context-prior.ts');
    expect(cpSrc).not.toContain('setRuntimeDomainRegistry');
    expect(cpSrc).not.toContain('profile-registry');
  });

  it('GATE-RANK-01: filterDomainCandidatesPerSpan exists and buckets base_term', () => {
    const filterSrc = readSrc('fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts');
    expect(filterSrc).toContain('export function filterDomainCandidatesPerSpan');
    expect(filterSrc).toContain("candidate.graphSource === 'base_term'");
    expect(filterSrc).toContain('baseCandidates');
  });

  it('GATE-RANK-02: selectPerSpanCandidates prefers sameDomain bucket', () => {
    const assemblySrc = readSrc('fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts');
    expect(assemblySrc).toContain('export function selectPerSpanCandidates');
    expect(assemblySrc).toContain('stableSortPicks');
    expect(assemblySrc).toContain('sameDomainCandidates');
    expect(assemblySrc).not.toContain('pickTopKFromBuckets');
  });

  it('GATE-RANK-04: Assembly Tone Guard must not exist on production path', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'fw-detector/span-assembly-v4/apply-tone-assembly-guard.ts'))).toBe(
      false
    );
    const orchSrc = readSrc('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts');
    const assemblySrc = readSrc('fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts');
    expect(orchSrc).not.toContain('applyToneAssemblyGuard');
    expect(assemblySrc).not.toContain('applyToneAssemblyGuard');
    const typesSrc = readSrc('fw-detector/types.ts');
    expect(typesSrc).not.toContain('toneGuardBlockedCount');
  });

  it('GATE-RANK-03: computeCandidateScore excludes editDistancePenalty', () => {
    const scoreSrc = readSrc('lexicon/candidate-score.ts');
    const fnMatch = scoreSrc.match(
      /\/\*\* Primary recall score[\s\S]*?export function computeCandidateScore[\s\S]*?\n}/
    );
    expect(fnMatch?.[0]).toBeTruthy();
    expect(fnMatch?.[0]).not.toContain('editDistancePenalty');
  });

  it('segmentForJobResult 写点白名单（静态）', () => {
    const allowed = [
      'pipeline/steps/asr-step.ts',
      'pipeline/steps/fw-detector-step.ts',
      'fw-detector/fw-detector-orchestrator.ts',
      'fw-detector/fw-detector-v4-path.ts',
      'pipeline/steps/aggregation-step.ts',
      'pipeline/steps/dedup-step.ts',
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

  it('dedup-step 经 duplicate sanitize 写 segmentForJobResult', () => {
    const dedupStep = readSrc('pipeline/steps/dedup-step.ts');
    expect(dedupStep).toContain('sanitizeSegmentForOutput');
    expect(dedupStep).toContain('ctx.segmentForJobResult = sanitizedText');
  });

  it('CLEANUP-1: no toneModule on FW v4 result path', () => {
    const v4Path = readSrc('fw-detector/fw-detector-v4-path.ts');
    expect(v4Path).not.toContain('toneModule');
    const rerank = readSrc('fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts');
    expect(rerank).not.toContain('FwToneModuleDiagnostics');
    expect(rerank).not.toContain('toneDiagnostics');
  });

  it('CLEANUP-2: hardDropCount remains zero-path stub (compatibility FROZEN)', () => {
    // Classification: C — Cleanup aligned to docs/fw-detector/compatibility/FROZEN.md
    // Hard drop main path is zero; metrics field hardDropCount is retained as stub (=0).
    // Do not require string absence — that contradicted the frozen Compatibility metrics table.
    const compat = readSrc('fw-detector/span-assembly-v4/candidate-compatibility-graph.ts');
    expect(compat).toContain('hardDropCount: 0');
    const v4Types = readSrc('fw-detector/span-assembly-v4/v4-types.ts');
    expect(v4Types).toContain('hardDropCount');
    expect(v4Types).toContain('droppedCandidateCount');
  });

  it('CLEANUP-3: no intervalPaths trace field', () => {
    const diagTypes = readSrc('fw-detector/span-assembly-v4/v4-diagnostics-types.ts');
    expect(diagTypes).not.toContain('intervalPaths');
    expect(diagTypes).not.toContain('IntervalPathTrace');
  });

  it('CLEANUP-4: dynamic pipeline uses finalizePipelineMode', () => {
    const modeCfg = readSrc('pipeline/pipeline-mode-config.ts');
    expect(modeCfg).toContain('return finalizePipelineMode(buildDynamicMode(job))');
  });

  it('CLEANUP-5: spanAssemblyV4Enabled=false fails fast', () => {
    const fwCfg = readSrc('fw-detector/fw-config.ts');
    expect(fwCfg).toContain('spanAssemblyV4Enabled === false');
    expect(fwCfg).toContain('throw new Error');
    expect(fwCfg).not.toContain('spanAssemblyV4Enabled=false is deprecated');
  });

  it('TONE-PRE-V2-1: no dead tonePayload on span-assembly-v4 orchestrator', () => {
    const orchSrc = readSrc('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts');
    const v4Path = readSrc('fw-detector/fw-detector-v4-path.ts');
    expect(orchSrc).not.toContain('tonePayload');
    expect(v4Path).not.toContain('tonePayload');
  });

  it('TONE-PRE-V2-2: KenLM prefilled rerank does not accept acoustic tone param', () => {
    const rerankSrc = readSrc('fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts');
    const v4Path = readSrc('fw-detector/fw-detector-v4-path.ts');
    expect(rerankSrc).not.toMatch(/\btone\s*\??\s*:/);
    expect(rerankSrc).not.toContain('UtteranceAcousticTonePayload');
    expect(v4Path).not.toMatch(/tone:\s*ctx\.asrResult/);
  });

  it('TONE-PRE-V2-3: Exists vs Effective — acousticToneSlices wired to Recall', () => {
    const asrStep = readSrc('pipeline/steps/asr-step.ts');
    const v4Path = readSrc('fw-detector/fw-detector-v4-path.ts');
    const recall = readSrc('fw-detector/span-assembly-v4/recall-topk-for-windows.ts');
    expect(asrStep).toContain('ctx.acousticToneSlices');
    expect(asrStep).toContain('normalizeAcousticSlices');
    expect(v4Path).toContain('acousticSlices: ctx.acousticToneSlices');
    expect(recall).toContain('extractAcousticTonePatternForRecall');
    expect(recall).toContain('computeToneScoreResult');
  });

  it('TONE-PRE-V2-4: no historical drift script paths in electron-node src', () => {
    const driftMarkers = [
      'scripts/tone-v2',
      'tone_module/v2',
      'gateway-scheduler-benchmark',
      'node-runtime-benchmark-contract',
      'offline-manifest',
    ];
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== 'dist') {
          out.push(...walk(full));
        } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.mjs'))) {
          out.push(full);
        }
      }
      return out;
    };
    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).replace(/\\/g, '/');
      if (rel.includes('tests/experiments') || rel.endsWith('freeze-contract.test.ts')) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const marker of driftMarkers) {
        expect(content).not.toContain(marker);
      }
    }
  });
});
