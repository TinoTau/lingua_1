/**
 * Aggregator Middleware Translation Handler
 * 处理翻译相关的逻辑，包括批量处理、异步处理等
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { NMTTask } from '../task-router/types';
import { TaskRouter } from '../task-router/task-router';
import logger from '../logger';
import { LRUCache } from 'lru-cache';
import { AggregatorManager } from '../aggregator/aggregator-manager';

// 批量处理队列项
export interface BatchTranslationItem {
  job: JobAssignMessage;
  aggregatedText: string;
  contextText?: string;
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export class TranslationHandler {
  private taskRouter: TaskRouter | null;
  private translationCache: LRUCache<string, string>;
  private manager: AggregatorManager | null;
  private batchQueue: BatchTranslationItem[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_WINDOW_MS = 500;
  private readonly MAX_BATCH_SIZE = 5;
  private readonly MAX_CONCURRENT_NMT = 2;
  private pendingAsyncTranslations: Map<string, Promise<string>> = new Map();

  constructor(
    taskRouter: TaskRouter | null,
    translationCache: LRUCache<string, string>,
    manager: AggregatorManager | null
  ) {
    this.taskRouter = taskRouter;
    this.translationCache = translationCache;
    this.manager = manager;
  }

  /**
   * 异步处理重新翻译（后台更新）
   */
  async processAsyncRetranslation(
    job: JobAssignMessage,
    aggregatedText: string,
    contextText: string | undefined,
    cacheKey: string,
    shouldCacheThis: boolean
  ): Promise<void> {
    // 检查是否已经有正在进行的异步翻译
    if (this.pendingAsyncTranslations.has(cacheKey)) {
      logger.debug(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          cacheKey: cacheKey.substring(0, 50),
        },
        'Async retranslation already in progress, skipping'
      );
      return;
    }

    // 创建异步翻译 Promise
    const translationPromise = (async () => {
      try {
        if (!this.taskRouter) {
          logger.error(
            { jobId: job.job_id, sessionId: job.session_id },
            'Async retranslation: TaskRouter not available'
          );
          return '';
        }

        const nmtTask: NMTTask = {
          text: aggregatedText,
          src_lang: job.src_lang,
          tgt_lang: job.tgt_lang,
          context_text: contextText,
          job_id: job.job_id,
        };

        const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
        const translatedText = nmtResult.text;

        // 存入缓存
        if (shouldCacheThis && translatedText) {
          this.translationCache.set(cacheKey, translatedText);
        }

        // 保存当前翻译文本，供下一个 utterance 使用
        if (translatedText && this.manager) {
          this.manager.setLastTranslatedText(job.session_id, translatedText);
        }

        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            aggregatedText: aggregatedText.substring(0, 50),
            newTranslation: translatedText?.substring(0, 50),
            async: true,
          },
          'Async retranslation completed'
        );

        return translatedText;
      } catch (error) {
        logger.error(
          {
            error,
            jobId: job.job_id,
            sessionId: job.session_id,
          },
          'Async retranslation failed'
        );
        return '';
      } finally {
        // 清理待处理的异步翻译
        this.pendingAsyncTranslations.delete(cacheKey);
      }
    })();

    // 存储 Promise
    this.pendingAsyncTranslations.set(cacheKey, translationPromise);

    // 不等待完成，直接返回
    translationPromise.catch(() => {
      // 错误已在 Promise 内部处理
    });
  }

  /**
   * 批量处理重新翻译
   */
  async processBatchRetranslation(): Promise<void> {
    if (this.batchQueue.length === 0) {
      return;
    }

    // 取出当前批次（最多 MAX_BATCH_SIZE 个）
    const batch = this.batchQueue.splice(0, this.MAX_BATCH_SIZE);
    
    if (batch.length === 0) {
      return;
    }

    logger.debug(
      {
        batchSize: batch.length,
      },
      'Processing batch retranslation'
    );

    // 限制并发数，分批处理（避免GPU过载）
    const MAX_CONCURRENT = this.MAX_CONCURRENT_NMT;
    for (let i = 0; i < batch.length; i += MAX_CONCURRENT) {
      const chunk = batch.slice(i, i + MAX_CONCURRENT);
      const promises = chunk.map(async (item) => {
        try {
          if (!this.taskRouter) {
            item.reject(new Error('TaskRouter not available'));
            return;
          }

          const nmtTask: NMTTask = {
            text: item.aggregatedText,
            src_lang: item.job.src_lang,
            tgt_lang: item.job.tgt_lang,
            context_text: item.contextText,
            job_id: item.job.job_id,
          };

          const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
          item.resolve(nmtResult.text);
        } catch (error) {
          item.reject(error as Error);
        }
      });

      // 等待当前批次完成后再处理下一批
      await Promise.allSettled(promises);
    }

    // 如果还有待处理的任务，继续处理
    if (this.batchQueue.length > 0) {
      this.scheduleBatchProcessing();
    }
  }

  /**
   * 调度批量处理
   */
  scheduleBatchProcessing(): void {
    // 清除现有定时器
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // 如果队列已满，立即处理
    if (this.batchQueue.length >= this.MAX_BATCH_SIZE) {
      this.processBatchRetranslation();
      return;
    }

    // 否则，设置定时器
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.processBatchRetranslation();
    }, this.BATCH_WINDOW_MS);
  }

  /**
   * 添加批量翻译任务
   */
  addBatchTranslation(item: BatchTranslationItem): void {
    this.batchQueue.push(item);
    this.scheduleBatchProcessing();
  }

  /**
   * 获取批量队列长度
   */
  getBatchQueueLength(): number {
    return this.batchQueue.length;
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.batchQueue = [];
    this.pendingAsyncTranslations.clear();
  }
}
