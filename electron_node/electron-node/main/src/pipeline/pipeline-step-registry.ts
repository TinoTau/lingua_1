/**
 * Pipeline 步骤注册表
 * 将步骤类型映射到实际的执行函数，实现解耦
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';
import { ServicesBundle } from './job-pipeline';
import { PipelineStepType } from './pipeline-mode-config';
export type { PipelineStepType };
import { runAsrStep } from './steps/asr-step';
import { runFwDetectorStep } from './steps/fw-detector-step';
import { runAggregationStep } from './steps/aggregation-step';
import { runLegacyLexiconRecallStep } from '../legacy/recover/steps/legacy-lexicon-recall-step';
import { runLegacySentenceRepairStep } from '../legacy/recover/steps/legacy-sentence-repair-step';
import { runPhoneticCorrectionStep } from './steps/phonetic-correction-step';
import { runPunctuationRestoreStep } from './steps/punctuation-restore-step';
import { runSemanticRepairStep } from './steps/semantic-repair-step';
import { runDedupStep } from './steps/dedup-step';
import { runTranslationStep } from './steps/translation-step';
import { runTtsStep } from './steps/tts-step';
import { runYourTtsStep } from './steps/yourtts-step';
import { PartialResultCallback } from '../inference/inference-service';
import logger from '../logger';

/**
 * 步骤执行函数类型
 */
export type StepExecutor = (
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle,
  options?: any
) => Promise<void>;

/**
 * Pipeline 步骤注册表
 * 将步骤类型映射到执行函数
 */
/**
 * Pipeline step registry.
 *
 * FW mainline (fw_detector_v1): applyFwDetectorPipelineMode removes LEXICON_RECALL / SENTENCE_REPAIR.
 *
 * Enhancement steps (still registered, default OFF via node-config):
 * - PHONETIC_CORRECTION (5016), PUNCTUATION_RESTORE (5017), SEMANTIC_REPAIR (5015)
 * - Gated by enhancement-gate + isSegmentWriteLocked when FW has applied span replacements.
 */
export const STEP_REGISTRY: Record<PipelineStepType, StepExecutor> = {
  ASR: async (job, ctx, services, options) => {
    await runAsrStep(job, ctx, services, options);
  },

  FW_SPAN_DETECTOR: async (job, ctx) => {
    await runFwDetectorStep(job, ctx);
  },

  AGGREGATION: async (job, ctx, services) => {
    await runAggregationStep(job, ctx, services);
  },

  LEXICON_RECALL: async (job, ctx, services) => {
    await runLegacyLexiconRecallStep(job, ctx, services, { nodeId: services.nodeId });
  },

  SENTENCE_REPAIR: async (job, ctx, services) => {
    await runLegacySentenceRepairStep(job, ctx, services);
  },

  PHONETIC_CORRECTION: async (job, ctx, services) => {
    await runPhoneticCorrectionStep(job, ctx, services);
  },

  PUNCTUATION_RESTORE: async (job, ctx, services) => {
    await runPunctuationRestoreStep(job, ctx, services);
  },

  SEMANTIC_REPAIR: async (job, ctx, services) => {
    await runSemanticRepairStep(job, ctx, services);
  },

  DEDUP: async (job, ctx, services) => {
    await runDedupStep(job, ctx, services);
  },

  TRANSLATION: async (job, ctx, services) => {
    await runTranslationStep(job, ctx, services);
  },

  TTS: async (job, ctx, services) => {
    await runTtsStep(job, ctx, services);
  },

  YOURTTS: async (job, ctx, services) => {
    await runYourTtsStep(job, ctx, services);
  },
};

/**
 * 执行单个步骤
 */
export async function executeStep(
  step: PipelineStepType,
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle,
  options?: any
): Promise<void> {
  const executor = STEP_REGISTRY[step];
  if (!executor) {
    logger.error(
      { step, jobId: job.job_id },
      `Unknown pipeline step: ${step}`
    );
    throw new Error(`Unknown pipeline step: ${step}`);
  }

  logger.debug(
    { step, jobId: job.job_id, sessionId: job.session_id },
    `Executing pipeline step: ${step}`
  );

  await executor(job, ctx, services, options);
}
