import { loadNodeConfig } from '../node-config';
import type { JobAssignMessage } from '@shared/protocols/messages';
import type { JobContext } from '../pipeline/context/job-context';

export const FW_ASR_ENGINE = 'fw_detector_v1';
export const FW_ASR_SERVICE_ID = 'faster-whisper-vad';

export function getAsrEngine(): string | undefined {
  return loadNodeConfig().asr?.engine;
}

export function isFwDetectorEngineEnabled(): boolean {
  return getAsrEngine() === FW_ASR_ENGINE;
}

export function getFwDetectorFeatureEnabled(): boolean {
  if (!isFwDetectorEngineEnabled()) {
    return false;
  }
  return loadNodeConfig().features?.fwDetector?.enabled === true;
}

export function resolveEffectiveSrcLang(
  job: { src_lang?: string },
  ctx: { detectedSourceLang?: string }
): string {
  if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
    return ctx.detectedSourceLang;
  }
  return job.src_lang ?? '';
}

export function isFwDetectorLanguage(
  job: { src_lang?: string },
  ctx: { detectedSourceLang?: string }
): boolean {
  const lang = resolveEffectiveSrcLang(job, ctx);
  if (!lang.trim()) {
    return false;
  }
  const base = lang.toLowerCase().split('-')[0];
  return base === 'zh' || base === 'yue';
}

export function isFwDetectorPipelineActive(
  job: JobAssignMessage,
  ctx: JobContext
): boolean {
  return getFwDetectorFeatureEnabled() && isFwDetectorLanguage(job, ctx);
}
