/**
 * AudioBuffer Key 生成工具
 *
 * mergeKey = turnId + targetLang；无 turn_id 时退化为 job_id。
 * 同一 turn、同一目标语言的多个 Job 共用同一 buffer；仅 manual/timeout finalize 时 flush 并输出。
 */

import { JobAssignMessage } from '@shared/protocols/messages';

/**
 * 构建 mergeKey：有 turn_id 时用 turn_id + tgt_lang（同 turn 同语言同 buffer），否则用 job_id。
 */
export function buildBufferKey(job: JobAssignMessage): string {
  if (job.turn_id && job.tgt_lang) {
    return `${job.turn_id}|${job.tgt_lang}`;
  }
  return job.job_id;
}
