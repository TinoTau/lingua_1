/**
 * SequentialExecutor 超时检查逻辑（从 sequential-executor.ts 迁出）
 * 仅迁移实现，不改变接口与逻辑。
 */

import logger from '../logger';
import { ServiceType, SequentialTask, SequentialExecutorConfig, SequentialExecutorState } from './types';

/**
 * 检查并拒绝超时的等待任务
 */
export function runTimeoutCheck(
  state: SequentialExecutorState,
  config: Required<SequentialExecutorConfig>
): void {
  const now = Date.now();
  for (const [sessionId, sessionQueues] of state.waitingQueue.entries()) {
    for (const [taskType, queue] of sessionQueues.entries()) {
      const expiredTasks: SequentialTask[] = [];
      for (const task of queue) {
        const waitTime = now - task.timestamp;
        if (waitTime > config.maxWaitMs) {
          expiredTasks.push(task);
        }
      }

      for (const task of expiredTasks) {
        const index = queue.indexOf(task);
        if (index !== -1) {
          queue.splice(index, 1);
        }
        const waitTime = now - task.timestamp;
        logger.warn(
          {
            sessionId: task.sessionId,
            utteranceIndex: task.utteranceIndex,
            jobId: task.jobId,
            taskType: task.taskType,
            waitTimeMs: waitTime,
            maxWaitMs: config.maxWaitMs,
          },
          'SequentialExecutor: Task timeout, rejecting'
        );
        task.reject(new Error(`SequentialExecutor: Task timeout after ${waitTime}ms`));
      }
    }
  }
}
