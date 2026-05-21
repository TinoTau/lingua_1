/**
 * 聚合之后、翻译之前的门控与文本来源（单一职责，避免 shouldSendToSemanticRepair 一名多义）
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';
import {
  isPhoneticCorrectionEnabled,
  isPunctuationRestoreEnabled,
  isSemanticRepairEnabled,
} from '../node-config';

export type PostAggregationRoutingInput = {
  /** 本段是否有可处理文本 */
  segmentReady: boolean;
  /** 聚合判定：本 job 是否进入后处理（非 HOLD / 非过短丢弃） */
  wantsPostAsrPipeline: boolean;
  /** turn 未 finalize 等：故意延后翻译 */
  deferTranslation?: boolean;
};

/** 解析源语言（含 auto + detected） */
export function resolveSourceLang(job: JobAssignMessage, ctx: JobContext): string {
  if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
    return ctx.detectedSourceLang;
  }
  if (job.src_lang === 'auto' && job.lang_a) {
    return job.lang_a;
  }
  return job.src_lang || 'zh';
}

/**
 * 聚合步骤末尾调用：写入拆分后的门控，并同步 legacy 字段。
 */
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
  const semanticOn = isSemanticRepairEnabled(job);
  const phoneticOn = isPhoneticCorrectionEnabled(job);
  const punctuationOn = isPunctuationRestoreEnabled();

  ctx.shouldRunPhoneticCorrection =
    !defer && segmentReady && phoneticOn && srcLang === 'zh';
  ctx.shouldRunPunctuationRestore =
    !defer && segmentReady && punctuationOn && (srcLang === 'zh' || srcLang === 'en');
  ctx.shouldRunSemanticRepairHttp =
    !defer && segmentReady && semanticOn;

  // legacy：仅表示「曾计划走 5015 门控」，实际执行还看 shouldExecuteStep + 服务是否 running
  ctx.shouldSendToSemanticRepair = ctx.shouldRunSemanticRepairHttp;

  if (defer || !segmentReady) {
    ctx.repairedText = '';
    return;
  }

  syncRepairedTextBaseline(ctx);
}

/** Recover 句级修复已写回时，5015/5016 不得再改 repairedText。 */
export function isRecoverWriteLocked(ctx: JobContext): boolean {
  return ctx.asrRepairApplied === true;
}

/** 后处理步骤之后、语义修复之前：用当前 segment 作为 NMT 输入基线 */
export function syncRepairedTextBaseline(ctx: JobContext): void {
  const text = (ctx.segmentForJobResult ?? '').trim();
  if (text.length > 0) {
    ctx.repairedText = text;
  }
}

/** 翻译输入：repairedText → segment → asrText */
export function getTextForTranslation(ctx: JobContext): string {
  const repaired = (ctx.repairedText ?? '').trim();
  if (repaired.length > 0) return repaired;
  const segment = (ctx.segmentForJobResult ?? '').trim();
  if (segment.length > 0) return segment;
  return (ctx.asrText ?? '').trim();
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
  if (!isRecoverWriteLocked(ctx)) {
    ctx.repairedText = (options?.fallbackText ?? ctx.segmentForJobResult ?? '').trim();
  }
}

export function markSemanticRepairHttpSuccess(
  ctx: JobContext,
  textOut: string,
  confidence?: number
): void {
  if (isRecoverWriteLocked(ctx)) {
    ctx.semanticRepairSkipped = true;
    ctx.semanticRepairSkipReason = 'RECOVER_WRITE_LOCKED';
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
  ctx.repairedText = textOut;
  ctx.semanticRepairConfidence = confidence;
}
