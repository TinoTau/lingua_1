/**
 * SequentialExecutor 处理下一个任务逻辑（从 sequential-executor.ts 迁出）
 * 仅迁移实现，不改变接口与逻辑。
 */

import logger from '../logger';
import { ServiceType, SequentialTask, SequentialExecutorConfig, SequentialExecutorState } from './types';
import { findNextRunnableAndRemoveExpired } from './sequential-executor-queue';

/**
 * 从等待队列中取出下一个可执行任务并执行，或记录等待日志
 */
export function processNextTaskFromState(
  state: SequentialExecutorState,
  sessionId: string,
  taskType: ServiceType,
  config: Required<SequentialExecutorConfig>,
  onProcessTask: (task: SequentialTask) => void
): void {
  const sessionQueues = state.waitingQueue.get(sessionId);
  if (!sessionQueues) {
    return;
  }

  const queue = sessionQueues.get(taskType);
  if (!queue || queue.length === 0) {
    return;
  }

  const sessionState = state.currentIndex.get(sessionId);
  const currentIndex = sessionState?.get(taskType) ?? -1;

  const { nextTask, expired } = findNextRunnableAndRemoveExpired(queue, currentIndex);
  for (const task of expired) {
    logger.warn(
      {
        sessionId,
        currentIndex,
        taskIndex: task.utteranceIndex,
        taskType: task.taskType,
        jobId: task.jobId,
      },
      'SequentialExecutor: Task index is less than or equal to current index, skipping expired task'
    );
    task.reject(new Error(`SequentialExecutor: Task index ${task.utteranceIndex} is less than or equal to current index ${currentIndex}, task expired`));
  }

  if (nextTask) {
    onProcessTask(nextTask);
  } else {
    const firstInQueue = queue[0];
    if (firstInQueue) {
      const waitTime = Date.now() - firstInQueue.timestamp;
      if (waitTime > 10000) {
        logger.warn(
          {
            sessionId,
            currentIndex,
            nextIndex: firstInQueue.utteranceIndex,
            taskType: firstInQueue.taskType,
            jobId: firstInQueue.jobId,
            queueLength: queue.length,
            waitTimeMs: waitTime,
            maxWaitMs: config.maxWaitMs,
            note: 'Task has been waiting in queue for a long time, may be blocked',
          },
          'SequentialExecutor: Next task index is not consecutive, waiting (long wait detected)'
        );
      } else {
        logger.debug(
          {
            sessionId,
            currentIndex,
            nextIndex: firstInQueue.utteranceIndex,
            taskType: firstInQueue.taskType,
            jobId: firstInQueue.jobId,
            queueLength: queue.length,
            waitTimeMs: waitTime,
          },
          'SequentialExecutor: Next task index is not consecutive, waiting'
        );
      }
    }
  }
}
