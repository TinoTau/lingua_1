/**
 * SequentialExecutor 队列逻辑：按 utteranceIndex 插入、超时收集、下一个可运行任务
 * 从 sequential-executor.ts 迁出，仅迁移实现，不新增逻辑与调用路径。
 */

import type { SequentialTask } from './types';

/**
 * 按 utterance_index 有序插入队列
 */
export function enqueueTaskOrdered(queue: SequentialTask[], task: SequentialTask): void {
  let inserted = false;
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].utteranceIndex > task.utteranceIndex) {
      queue.splice(i, 0, task);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    queue.push(task);
  }
}

/**
 * 收集并移除超时任务，返回被移除的任务（由调用方 reject）
 */
export function collectExpiredAndRemove(
  queue: SequentialTask[],
  now: number,
  maxWaitMs: number
): SequentialTask[] {
  const expired: SequentialTask[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const waitTime = now - queue[i].timestamp;
    if (waitTime > maxWaitMs) {
      expired.push(queue.splice(i, 1)[0]);
    }
  }
  return expired;
}

/**
 * 从队列中取出下一个可执行任务（utteranceIndex === currentIndex + 1），并移除所有已过期的（utteranceIndex <= currentIndex）
 * 返回 { nextTask, expired }，expired 由调用方 reject
 */
export function findNextRunnableAndRemoveExpired(
  queue: SequentialTask[],
  currentIndex: number
): { nextTask: SequentialTask | null; expired: SequentialTask[] } {
  const expired: SequentialTask[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const task = queue[i];
    if (task.utteranceIndex <= currentIndex) {
      expired.push(queue.splice(i, 1)[0]);
    }
  }

  let foundIndex = -1;
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].utteranceIndex === currentIndex + 1) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex !== -1) {
    const nextTask = queue.splice(foundIndex, 1)[0];
    return { nextTask, expired };
  }
  return { nextTask: null, expired };
}
