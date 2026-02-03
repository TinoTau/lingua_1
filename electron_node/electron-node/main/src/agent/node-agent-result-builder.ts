/**
 * 构建待发送结果列表：主结果 + 空容器核销（NO_TEXT_ASSIGNED）
 * 从 node-agent-simple.ts 迁出，仅迁移实现，不改变接口与逻辑。
 */

import logger from '../logger';
import type { JobAssignMessage } from '../../../../shared/protocols/messages';
import type { JobResult } from '../inference/inference-service';

/** 单次发送项：job + result + shouldSend + reason */
export type ResultToSendItem = {
  job: JobAssignMessage;
  result: JobResult;
  shouldSend: boolean;
  reason?: string;
};

/**
 * 构建待发送结果列表：主结果 + 空容器核销（NO_TEXT_ASSIGNED）。
 * 同一 job_id 只出现一次；pendingEmptyJobs 中与主 job 重复或彼此重复的项会被跳过。
 */
export function buildResultsToSend(
  job: JobAssignMessage,
  processResult: { finalResult: JobResult; shouldSend: boolean; reason?: string }
): ResultToSendItem[] {
  const list: ResultToSendItem[] = [
    {
      job,
      result: processResult.finalResult,
      shouldSend: processResult.shouldSend,
      reason: processResult.reason,
    },
  ];
  const seenJobIds = new Set<string>([job.job_id]);
  const pendingEmptyJobs = (processResult.finalResult.extra as any)?.pendingEmptyJobs as
    | { job_id: string; utterance_index: number }[]
    | undefined;
  if (processResult.shouldSend && pendingEmptyJobs?.length) {
    const emptyResult: JobResult = {
      text_asr: '',
      text_translated: '',
      tts_audio: '',
      should_send: true,
      extra: { reason: 'NO_TEXT_ASSIGNED' },
    };
    for (const empty of pendingEmptyJobs) {
      if (seenJobIds.has(empty.job_id)) continue;
      seenJobIds.add(empty.job_id);
      list.push({
        job: { ...job, job_id: empty.job_id, utterance_index: empty.utterance_index },
        result: emptyResult,
        shouldSend: true,
        reason: 'NO_TEXT_ASSIGNED',
      });
    }
  }
  return list;
}

/** 单条发送回调：sendJobResult(job, result, startTime, shouldSend, reason?) */
export type SendJobResultFn = (
  job: JobAssignMessage,
  result: JobResult,
  startTime: number,
  shouldSend: boolean,
  reason?: string
) => void;

/**
 * 记录 SEND_PLAN 并按顺序执行发送（与 node-agent-simple handleJob 中逻辑一致）
 */
export function sendJobResultPlan(
  job: JobAssignMessage,
  resultsToSend: ResultToSendItem[],
  sendOne: SendJobResultFn,
  startTime: number
): void {
  const planId = String(Date.now() % 1e6);
  const planItems = resultsToSend.map((item, idx) => ({
    idx,
    job_id: item.job.job_id,
    reason: item.reason ?? (item.result.extra as any)?.reason ?? (item.result as any).dedup_reason ?? '',
    shouldSend: item.shouldSend,
    isEmptyJob: !(item.result.text_asr || '').trim().length || (item.result.extra as any)?.reason === 'NO_TEXT_ASSIGNED',
  }));
  const planFingerprint = planItems.map((i) => `${i.job_id}|${i.reason}|${i.isEmptyJob}`).join(',');
  logger.info(
    { tag: 'SEND_PLAN', job_id: job.job_id, planId, items: planItems, planFingerprint },
    'SEND_PLAN'
  );

  let attemptSeq = 0;
  const total = resultsToSend.length;
  for (let idx = 0; idx < resultsToSend.length; idx++) {
    const { job: j, result: r, shouldSend: s, reason } = resultsToSend[idx];
    const attemptReason = reason ?? (r.extra as any)?.reason ?? (r as any).dedup_reason;
    attemptSeq += 1;
    logger.info(
      {
        tag: 'SEND_ATTEMPT',
        planId,
        idx,
        total,
        job_id: j.job_id,
        reason: attemptReason,
        attemptSeq,
        callSite: 'node-agent.handleJob.loop',
      },
      'SEND_ATTEMPT'
    );
    sendOne(j, r, startTime, s, reason ?? (r.extra as any)?.reason ?? (r as any).dedup_reason);
    logger.info({ tag: 'SEND_DONE', planId, attemptSeq, ok: true }, 'SEND_DONE');
  }
}
