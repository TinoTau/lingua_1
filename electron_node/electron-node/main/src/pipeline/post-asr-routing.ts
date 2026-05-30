/**
 * 聚合之后、翻译之前的门控与文本来源（单一职责）
 * SSOT: ctx.segmentForJobResult
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';
import {
  isPhoneticCorrectionEnabled,
  isPunctuationRestoreEnabled,
  isSemanticRepairEnabled,
} from '../node-config';

export type PostAggregationRoutingInput = {
  segmentReady: boolean;
  wantsPostAsrPipeline: boolean;
  deferTranslation?: boolean;
};

export function resolveSourceLang(job: JobAssignMessage, ctx: JobContext): string {
  if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
    return ctx.detectedSourceLang;
  }
  if (job.src_lang === 'auto' && job.lang_a) {
    return job.lang_a;
  }
  return job.src_lang || 'zh';
}

/** 聚合步骤末尾：仅写门控 flag，不修改 segmentForJobResult */
export function applyPostAggregationRouting(
  job: JobAssignMessage,
  ctx: JobContext,
  input: PostAggregationRoutingInput
): void {
  const defer = input.deferTranslation === true || !input.wantsPostAsrPipeline;
  const segment = (ctx.segmentForJobResult ?? '').trim();
  const segmentReady = input.segmentReady && segment.length > 0;

  ctx.shouldDeferTranslation = defer;
  ctx.shouldAllowTranslation = !defer && segmentReady;

  const srcLang = resolveSourceLang(job, ctx);
  ctx.shouldRunPhoneticCorrection =
    !defer && segmentReady && isPhoneticCorrectionEnabled(job) && srcLang === 'zh';
  ctx.shouldRunPunctuationRestore =
    !defer
    && segmentReady
    && isPunctuationRestoreEnabled()
    && (srcLang === 'zh' || srcLang === 'en');
  ctx.shouldRunSemanticRepairHttp =
    !defer && segmentReady && isSemanticRepairEnabled(job);
}

/** FW / 句级修复已写 segment 时，5015/5016 不得覆盖 */
export function isSegmentWriteLocked(ctx: JobContext): boolean {
  return ctx.asrRepairApplied === true;
}

/** NMT / text_asr 唯一来源：segmentForJobResult（无 asrText / rawAsrText fallback） */
export function resolveBusinessAsrText(ctx: JobContext): string {
  return (ctx.segmentForJobResult ?? '').trim();
}

/** 翻译输入（与 buildJobResult.text_asr 同源） */
export function getTextForTranslation(ctx: JobContext): string {
  return resolveBusinessAsrText(ctx);
}

export function markSemanticRepairSkipped(
  ctx: JobContext,
  reason: string,
  options?: { degraded?: boolean; fallbackText?: string }
): void {
  ctx.semanticRepairSkipped = true;
  ctx.semanticRepairSkipReason = reason;
  ctx.semanticRepairDegraded = options?.degraded === true;
  ctx.semanticRepairHttpCalled = false;
  ctx.semanticRepairHttpApplied = false;
  ctx.semanticRepairApplied = false;
  if (!isSegmentWriteLocked(ctx) && options?.fallbackText !== undefined) {
    ctx.segmentForJobResult = options.fallbackText.trim();
  }
}

export function markSemanticRepairHttpSuccess(
  ctx: JobContext,
  textOut: string,
  confidence?: number
): void {
  if (isSegmentWriteLocked(ctx)) {
    ctx.semanticRepairSkipped = true;
    ctx.semanticRepairSkipReason = 'SEGMENT_WRITE_LOCKED';
    ctx.semanticRepairHttpCalled = true;
    ctx.semanticRepairHttpApplied = false;
    ctx.semanticRepairApplied = false;
    return;
  }
  ctx.semanticRepairSkipped = false;
  ctx.semanticRepairSkipReason = undefined;
  ctx.semanticRepairDegraded = false;
  ctx.semanticRepairHttpCalled = true;
  ctx.semanticRepairHttpApplied = true;
  ctx.semanticRepairApplied = true;
  ctx.segmentForJobResult = textOut;
  ctx.semanticRepairConfidence = confidence;
}
