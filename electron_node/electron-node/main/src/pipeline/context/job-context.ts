/**
 * JobContext - æµæ°´çº¿ä¸å¯ä¸ä¸ä¸æç»æ? * å­æ¾ææä¸­é´ç»æ? */

import { ASRResult, AsrKenlmMeta, AsrNBestItem } from '../../task-router/types';
import type { ASRHypothesis } from '../../asr/types';
import type { LexiconManifestReadyInfo, LexiconRuntimeStatus } from '../../lexicon/lexicon-types';
import type { WindowCandidate } from '../../lexicon/hotword-types';
import type { WindowRecallDiagnostics } from '../../lexicon/window-recall-diagnostics';
import type { SentenceCandidate } from '../../legacy/asr-repair/asr-repair/sentence-expansion/types';
import type { ExpansionDiagnostics } from '../../legacy/asr-repair/asr-repair/sentence-expansion/expansion-diagnostics';
import type { SegmentAlignmentDiagnostics } from '../../asr/segment-alignment-diagnostics';
import type { CrossBoundaryRiskReport } from '../../asr/cross-boundary-risk';
import type { RecallCoverageDiagnostics } from '../../lexicon/recall-coverage-diagnostics';
import type { RestoreMetrics } from '../../legacy/asr-repair/asr-repair/restore-metrics';
import type { SentenceRepairExtra } from '../../legacy/asr-repair/asr-repair/sentence-rerank/sentence-repair-observability';
import type { AsrRepairLifecycle } from '../../legacy/asr-repair/legacy-asr-repair-contract-types';
import type { SentenceCandidateTraceItem, V5Metrics } from '../../legacy/asr-repair/legacy-v5-metrics';
import type { FwDetectorResult, KenlmGateMode } from '../../fw-detector/types';
import type { LegacyContext } from './legacy-context';

export interface JobContext {
  // é³é¢ç¸å³
  audio?: Buffer;
  audioFormat?: 'pcm16' | 'opus';

  // ASR ç¸å³
  /** Full raw ASR baseline for business chain (FW/Recall/KenLM/NMT). */
  rawAsrText?: string;
  /** Diagnostics only: mirrors merged ASR text for multi-segment probe. */
  asrMergeProbeText?: string;
  asrText?: string;
  asrSegments?: any[];
  asrResult?: ASRResult;
  /** æ?job å®é ASR æå¡ idï¼å¦ asr-sherpa-lmï¼ã?*/
  asrServiceId?: string;
  /** P0ï¼ASR / VAD / é³é¢åå¤ç?diagnosticsï¼å« node + FW åå±ååï¼?*/
  asrDiagnostics?: Record<string, unknown>;
  /** ASR bad-segment è´¨éåï¼0â?ï¼ï¼ä¾èå?è¯­ä¹ä¿®å¤/ç¿»è¯é¨æ§ã?*/
  qualityScore?: number;
  /** CTC n-best from ASR HTTP (observability). @deprecated use legacy.ctc — top-level kept for compat */
  asrNbest?: AsrNBestItem[];
  /** Recover main-chain ASR hypotheses (includes synthetic top1 when no n-best). */
  asrHypotheses?: ASRHypothesis[];
  nbestSynthetic?: boolean;
  /** aggregation segment ä¸?CTC rank0 ä¸ä¸è´æ¶ä¸?trueï¼CTC n-best ä»å¯ä¿çï¼ã?*/
  segmentSynthetic?: boolean;
  /** aggregation åä»ä¿ç ctx.asrNbest å¤åè®¾è¯æ®ã?*/
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
  asrRepairLifecycle?: AsrRepairLifecycle;
  /** sentence-repair-step æ©éåå ï¼æªå?sentenceRepairExtra æ¶ï¼ */
  asrRepairLifecycleSkipReason?: string;
  /** V3ï¼æ¬è½®å¥ä¿®å¤æ¯å¦å æ çªæ©å±èè·³è¿åå?*/
  asrRepairSkipped?: boolean;
  repairSkipReason?: string | null;
  restoreMetrics?: RestoreMetrics;
  windowCandidates?: WindowCandidate[];
  /** V3 Phase B: segment-first window recall stats. */
  windowRecallDiagnostics?: WindowRecallDiagnostics;
  v5Metrics?: V5Metrics;
  segmentAlignmentDiagnostics?: SegmentAlignmentDiagnostics;
  /** Q1.8-03ï¼è·¨ chunk è¾¹ç observed é£é©ï¼åªæ¥åï¼?*/
  crossBoundaryRiskReport?: CrossBoundaryRiskReport | null;
  /** Q1.7ï¼æ  WindowCandidate æ¶ç recall coverage è¯æ­ */
  recallCoverageDiagnostics?: RecallCoverageDiagnostics | null;
  expansionDiagnostics?: ExpansionDiagnostics;
  sentenceCandidates?: SentenceCandidate[];
  sentenceCandidateTrace?: SentenceCandidateTraceItem[];
  /** Recover v1 final sentence repair pick (observability + result extra). */
  sentenceRepairDecision?: SentenceCandidate;
  /** å¥çº§ä¿®å¤å¯è§æµæ§ï¼result extra.sentence_repairï¼ã?*/
  sentenceRepairExtra?: SentenceRepairExtra;
  asrRepairApplied?: boolean;
  fwDetectorResult?: FwDetectorResult;
  fwDetectorStepMs?: number;
  languageProbabilities?: Record<string, number>;
  /** æ?job ä½¿ç¨ç?lexicon profileï¼turn ååºå®ï¼ */
  activeProfilePrimary?: string;
  profileVersion?: string;
  domainBoostApplied?: number;
  /** FW detector override: restrict enabledDomains for this job */
  fwDetectorEnabledDomainsOverride?: string[];
  /** FW detector override: disable/enable KenLM gate for this job */
  fwDetectorEnableKenLMGateOverride?: boolean;
  fwDetectorKenlmGateModeOverride?: KenlmGateMode;
  fwDetectorKenlmVetoThresholdOverride?: number;

  /** Legacy Recover / CTC / window recall partition. FW main chain must not read/write. */
  legacy?: LegacyContext;

  // èåç¸å³
  segmentForJobResult?: string;  // SSOTï¼FW / èå / 5015 / NMT / text_asr
  aggregationAction?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  aggregationChanged?: boolean;
  isLastInMergedGroup?: boolean;
  shouldDeferTranslation?: boolean;
  shouldAllowTranslation?: boolean;
  shouldRunPhoneticCorrection?: boolean;
  shouldRunPunctuationRestore?: boolean;
  shouldRunSemanticRepairHttp?: boolean;
  aggregationMetrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
  lastCommittedText?: string | null;

  // è¯­ä¹ä¿®å¤ç¸å³
  semanticDecision?: 'PASS' | 'REPAIR' | 'REJECT';
  /** ä»å½ 5015 HTTP ä¿®å¤æåæ¶ä¸º true */
  semanticRepairApplied?: boolean;
  semanticRepairConfidence?: number;
  semanticRepairHttpCalled?: boolean;
  semanticRepairHttpApplied?: boolean;
  semanticRepairSkipped?: boolean;
  semanticRepairSkipReason?: string;
  semanticRepairDegraded?: boolean;
  enNormalizeApplied?: boolean;

  // åé³çº é 5016
  phoneticCorrectionSkipped?: boolean;
  phoneticCorrectionSkipReason?: string;
  phoneticCorrectionDegraded?: boolean;
  phoneticCorrectionHttpCalled?: boolean;
  phoneticCorrectionApplied?: boolean;
  phoneticCorrectionStepMs?: number;
  phoneticCorrectionHttpMs?: number;

  // æ­å¥ 5017
  punctuationRestoreSkipped?: boolean;
  punctuationRestoreSkipReason?: string;
  punctuationRestoreDegraded?: boolean;
  punctuationRestoreHttpCalled?: boolean;
  punctuationRestoreApplied?: boolean;
  punctuationRestoreCalls?: number;
  punctuationRestoreStepMs?: number;
  punctuationRestoreHttpMs?: number;

  // å»éç¸å³
  shouldSend?: boolean;
  dedupReason?: string;

  // ç¿»è¯ç¸å³
  translatedText?: string;
  /** å¨æç¡®å®çç®æ è¯­è¨ï¼ååæ¨¡å¼ä½¿ç¨ï¼ */
  detectedTargetLang?: string;
  /** å¨ææ£æµå°çæºè¯­è¨ï¼ååæ¨¡å¼ä½¿ç¨ï¼ */
  detectedSourceLang?: string;
  /** src_lang=auto æ¶çè§£ææ¥æºï¼?detected' | 'fallback_candidate_pair' */
  sourceLangResolution?: string;

  // TTS ç¸å³
  ttsAudio?: string; // base64
  ttsFormat?: string; // opus/wav

  // TONE ç¸å³
  toneResult?: any;
  toneAudio?: string;
  toneFormat?: string;

  // LID / Router
  lidMeta?: { lid_ms: number; p: number; lang_pred: string; strategy: string };
  routerMeta?: { selected_src_lang: string; current_src_lang: string; switched: boolean; reason: string };

  // å¶ä»
  rerunCount?: number;
}

/**
 * åå§å?JobContext
 */
export function initJobContext(job: any): JobContext {
  return {
    // ä»?job ä¸­æåé³é¢ï¼å¦æéè¦ï¼
    audio: job.audio ? Buffer.from(job.audio, 'base64') : undefined,
    audioFormat: job.audio_format as 'pcm16' | 'opus',
  };
}
