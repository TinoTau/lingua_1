/**
 * JobContext - 流水线上唯一上下文结构
 * 存放所有中间结果
 */

import { ASRResult, AsrKenlmMeta, AsrNBestItem } from '../../task-router/types';
import type { ASRHypothesis } from '../../asr/types';
import type { LexiconManifestReadyInfo, LexiconRuntimeStatus } from '../../lexicon/lexicon-types';
import type { WindowCandidate } from '../../lexicon/hotword-types';
import type { WindowRecallDiagnostics } from '../../lexicon/window-recall-diagnostics';
import type { SentenceCandidate } from '../../asr-repair/sentence-expansion/types';
import type { ExpansionDiagnostics } from '../../asr-repair/sentence-expansion/expansion-diagnostics';
import type { SegmentAlignmentDiagnostics } from '../../asr/segment-alignment-diagnostics';
import type { CrossBoundaryRiskReport } from '../../asr/cross-boundary-risk';
import type { RecallCoverageDiagnostics } from '../../lexicon/recall-coverage-diagnostics';
import type { RestoreMetrics } from '../../asr-repair/restore-metrics';
import type { SentenceRepairExtra } from '../../asr-repair/sentence-rerank/sentence-repair-observability';
import type { RecoverLifecycle } from '../recover-contract-types';
import type { SentenceCandidateTraceItem, V5Metrics } from '../v5-metrics';

export interface JobContext {
  // 音频相关
  audio?: Buffer;
  audioFormat?: 'pcm16' | 'opus';

  // ASR 相关
  asrText?: string;
  asrSegments?: any[];
  asrResult?: ASRResult;
  /** 本 job 实际 ASR 服务 id（如 asr-sherpa-lm）。 */
  asrServiceId?: string;
  /** ASR bad-segment 质量分（0–1），供聚合/语义修复/翻译门控。 */
  qualityScore?: number;
  /** CTC n-best from ASR HTTP (observability). */
  asrNbest?: AsrNBestItem[];
  /** Recover main-chain ASR hypotheses (includes synthetic top1 when no n-best). */
  asrHypotheses?: ASRHypothesis[];
  nbestSynthetic?: boolean;
  /** aggregation segment 与 CTC rank0 不一致时为 true（CTC n-best 仍可保留）。 */
  segmentSynthetic?: boolean;
  /** aggregation 后仍保留 ctx.asrNbest 多假设证据。 */
  ctcNbestPreserved?: boolean;
  aggregationResyncReason?: string;
  /** Utterance-level KenLM meta when ASR HTTP provides it. */
  asrKenlmMeta?: AsrKenlmMeta;
  lexiconRuntimeStatus?: LexiconRuntimeStatus;
  lexiconManifestVersion?: string;
  lexiconManifestReady?: LexiconManifestReadyInfo;
  lexiconRuntimeError?: string;
  lexiconDisabledReason?: string;
  lexiconRecallTruncated?: boolean;
  recoverLifecycle?: RecoverLifecycle;
  /** sentence-repair-step 早退原因（未写 sentenceRepairExtra 时） */
  recoverLifecycleSkipReason?: string;
  /** V3：本轮句修复是否因无窗扩展而跳过写回 */
  recoverSkipped?: boolean;
  repairSkipReason?: string | null;
  restoreMetrics?: RestoreMetrics;
  windowCandidates?: WindowCandidate[];
  /** V3 Phase B: segment-first window recall stats. */
  windowRecallDiagnostics?: WindowRecallDiagnostics;
  v5Metrics?: V5Metrics;
  segmentAlignmentDiagnostics?: SegmentAlignmentDiagnostics;
  /** Q1.8-03：跨 chunk 边界 observed 风险（只报告） */
  crossBoundaryRiskReport?: CrossBoundaryRiskReport | null;
  /** Q1.7：无 WindowCandidate 时的 recall coverage 诊断 */
  recallCoverageDiagnostics?: RecallCoverageDiagnostics | null;
  expansionDiagnostics?: ExpansionDiagnostics;
  sentenceCandidates?: SentenceCandidate[];
  sentenceCandidateTrace?: SentenceCandidateTraceItem[];
  /** Recover v1 final sentence repair pick (observability + result extra). */
  sentenceRepairDecision?: SentenceCandidate;
  /** 句级修复可观测性（result extra.sentence_repair）。 */
  sentenceRepairExtra?: SentenceRepairExtra;
  asrRepairApplied?: boolean;
  languageProbabilities?: Record<string, number>;
  /** 本 job 使用的 lexicon profile（turn 内固定） */
  activeProfilePrimary?: string;
  profileVersion?: string;
  domainBoostApplied?: number;

  // 聚合相关
  segmentForJobResult?: string;  // 本 job 的本段；语义修复只读此字段，产出 repairedText → text_asr / NMT
  aggregationAction?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  aggregationChanged?: boolean;
  isLastInMergedGroup?: boolean;
  /** @deprecated 请用 shouldRunSemanticRepairHttp；保留供旧测试/日志 */
  shouldSendToSemanticRepair?: boolean;
  shouldDeferTranslation?: boolean;
  shouldAllowTranslation?: boolean;
  shouldRunPhoneticCorrection?: boolean;
  shouldRunPunctuationRestore?: boolean;
  shouldRunSemanticRepairHttp?: boolean;
  aggregationMetrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
  lastCommittedText?: string | null;  // 上一个已提交的文本（用于 Trim 操作，避免重复获取，null表示没有上一个已提交的文本）

  // 语义修复相关
  repairedText?: string;
  semanticDecision?: 'PASS' | 'REPAIR' | 'REJECT';
  /** 仅当 5015 HTTP 修复成功时为 true */
  semanticRepairApplied?: boolean;
  semanticRepairConfidence?: number;
  semanticRepairHttpCalled?: boolean;
  semanticRepairHttpApplied?: boolean;
  semanticRepairSkipped?: boolean;
  semanticRepairSkipReason?: string;
  semanticRepairDegraded?: boolean;
  enNormalizeApplied?: boolean;

  // 同音纠错 5016
  phoneticCorrectionSkipped?: boolean;
  phoneticCorrectionSkipReason?: string;
  phoneticCorrectionDegraded?: boolean;
  phoneticCorrectionHttpCalled?: boolean;
  phoneticCorrectionApplied?: boolean;
  phoneticCorrectionStepMs?: number;
  phoneticCorrectionHttpMs?: number;

  // 断句 5017
  punctuationRestoreSkipped?: boolean;
  punctuationRestoreSkipReason?: string;
  punctuationRestoreDegraded?: boolean;
  punctuationRestoreHttpCalled?: boolean;
  punctuationRestoreApplied?: boolean;
  punctuationRestoreCalls?: number;
  punctuationRestoreStepMs?: number;
  punctuationRestoreHttpMs?: number;

  // 去重相关
  shouldSend?: boolean;
  dedupReason?: string;

  // 翻译相关
  translatedText?: string;
  /** 动态确定的目标语言（双向模式使用） */
  detectedTargetLang?: string;
  /** 动态检测到的源语言（双向模式使用） */
  detectedSourceLang?: string;
  /** src_lang=auto 时的解析来源：'detected' | 'fallback_candidate_pair' */
  sourceLangResolution?: string;

  // TTS 相关
  ttsAudio?: string; // base64
  ttsFormat?: string; // opus/wav

  // TONE 相关
  toneResult?: any;
  toneAudio?: string;
  toneFormat?: string;

  // LID / Router（Face2Face 二选一）
  lidMeta?: { lid_ms: number; p: number; lang_pred: string; strategy: string };
  routerMeta?: { selected_src_lang: string; current_src_lang: string; switched: boolean; reason: string };

  // 其他
  rerunCount?: number;
}

/**
 * 初始化 JobContext
 */
export function initJobContext(job: any): JobContext {
  return {
    // 从 job 中提取音频（如果需要）
    audio: job.audio ? Buffer.from(job.audio, 'base64') : undefined,
    audioFormat: job.audio_format as 'pcm16' | 'opus',
  };
}
