/**
 * Aggregator Middleware: 作为中间件处理 ASR 结果
 * 在 NodeAgent 中集成，不依赖 PipelineOrchestrator 的具体实现
 */

import { AggregatorManager, Mode } from '../aggregator';
import { JobAssignMessage, JobResultMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { SegmentInfo, NMTTask } from '../task-router/types';
import { TaskRouter } from '../task-router/task-router';
import logger from '../logger';
import { LRUCache } from 'lru-cache';
import { scoreCandidates, selectBestCandidate } from '../aggregator/candidate-scorer';
import { detectHomophoneErrors, hasPossibleHomophoneErrors } from '../aggregator/homophone-detector';
import { learnHomophonePattern } from '../aggregator/homophone-learner';
import { generateCacheKey, shouldCache } from '../aggregator/cache-key-generator';
import { PromptBuilder, PromptBuilderContext } from '../asr/prompt-builder';
import { NeedRescoreDetector, NeedRescoreContext } from '../asr/need-rescore';
import { Rescorer, RescoreContext, Candidate } from '../asr/rescorer';
import { CandidateProvider, CandidateProviderContext } from '../asr/candidate-provider';
import { AudioRingBuffer } from '../asr/audio-ring-buffer';
import { SecondaryDecodeWorker } from '../asr/secondary-decode-worker';
import { TranslationHandler } from './aggregator-middleware-translation';
import { AudioHandler } from './aggregator-middleware-audio';
import { DeduplicationHandler } from './aggregator-middleware-deduplication';

export interface AggregatorMiddlewareConfig {
  enabled: boolean;  // 是否启用 Aggregator
  mode: Mode;  // offline 或 room
  ttlMs?: number;  // 会话超时时间
  maxSessions?: number;  // 最大会话数
  translationCacheSize?: number;  // 翻译缓存大小（默认 200，提高缓存命中率）
  translationCacheTtlMs?: number;  // 翻译缓存过期时间（默认 10 分钟，提高缓存命中率）
  enableAsyncRetranslation?: boolean;  // 是否启用异步重新翻译（默认 false）
  asyncRetranslationThreshold?: number;  // 异步重新翻译阈值（文本长度，默认 50 字符）
  nmtRepairEnabled?: boolean;  // 是否启用 NMT Repair（默认 false）
  nmtRepairNumCandidates?: number;  // NMT Repair 候选数量（默认 5）
  nmtRepairThreshold?: number;  // NMT Repair 触发阈值（质量分数，默认 0.7）
}

export interface AggregatorMiddlewareResult {
  shouldSend: boolean;  // 是否应该发送结果（Aggregator 决定提交时）
  aggregatedText?: string;  // 聚合后的文本（如果提交）
  translatedText?: string;  // 重新翻译的文本（如果文本被聚合）
  action?: 'MERGE' | 'NEW_STREAM';  // 决策动作
  metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
    nmtRetranslationTimeMs?: number;  // 重新翻译耗时（毫秒）
    // S2: Rescoring trace信息
    rescoreApplied?: boolean;  // 是否应用了rescoring
    rescoreReasons?: string[];  // rescoring触发原因
    rescoreAddedLatencyMs?: number;  // rescoring增加的延迟（毫秒）
  };
}

export class AggregatorMiddleware {
  private manager: AggregatorManager | null = null;
  private config: AggregatorMiddlewareConfig;
  private taskRouter: TaskRouter | null = null;
  private translationCache: LRUCache<string, string>;
  
  // S1/S2: 短句准确率提升组件
  private promptBuilder: PromptBuilder | null = null;
  private needRescoreDetector: NeedRescoreDetector | null = null;
  private rescorer: Rescorer | null = null;
  private candidateProvider: CandidateProvider | null = null;
  
  // S2-6: 二次解码 worker
  private secondaryDecodeWorker: SecondaryDecodeWorker | null = null;
  
  // 模块化处理器
  private translationHandler: TranslationHandler;
  private audioHandler: AudioHandler;
  private deduplicationHandler: DeduplicationHandler;

  constructor(config: AggregatorMiddlewareConfig, taskRouter?: TaskRouter) {
    this.config = config;
    this.taskRouter = taskRouter || null;
    
    // 初始化翻译缓存：默认 200 条，10 分钟过期（提高缓存命中率）
    this.translationCache = new LRUCache<string, string>({
      max: config.translationCacheSize || 200,
      ttl: config.translationCacheTtlMs || 10 * 60 * 1000,
    });
    
    // 初始化模块化处理器
    this.audioHandler = new AudioHandler();
    this.deduplicationHandler = new DeduplicationHandler();
    
    if (config.enabled) {
      this.manager = new AggregatorManager({
        ttlMs: config.ttlMs || 5 * 60 * 1000,
        maxSessions: config.maxSessions || 1000,
      });
      
      // 初始化翻译处理器
      this.translationHandler = new TranslationHandler(
        this.taskRouter,
        this.translationCache,
        this.manager
      );
      
      // S1/S2: 初始化短句准确率提升组件
      const mode = config.mode || 'offline';
      this.promptBuilder = new PromptBuilder(mode);
      this.needRescoreDetector = new NeedRescoreDetector();
      this.rescorer = new Rescorer();
      this.candidateProvider = new CandidateProvider();
      
      // S2-6: 二次解码已禁用（GPU占用过高）
      this.secondaryDecodeWorker = null;
      logger.info({}, 'S2-6: Secondary decode worker disabled (GPU optimization)');
      
      logger.info(
        { 
          mode: config.mode, 
          hasTaskRouter: !!taskRouter,
          cacheSize: config.translationCacheSize || 200,
          cacheTtlMs: config.translationCacheTtlMs || 10 * 60 * 1000,
          s1S2Enabled: true,
          s2SecondaryDecodeEnabled: !!this.secondaryDecodeWorker,
        },
        'Aggregator middleware initialized with S1/S2 support'
      );
    } else {
      // 即使未启用，也需要初始化处理器（用于兼容）
      this.translationHandler = new TranslationHandler(
        this.taskRouter,
        this.translationCache,
        null
      );
    }
  }

  /**
   * 处理 ASR 结果（在 NMT 之前调用）
   * @param job 原始 job 请求
   * @param asrResult ASR 结果
   * @returns 聚合后的文本和是否应该处理（shouldProcess）
   */
  processASRResult(
    job: JobAssignMessage,
    asrResult: { text: string; segments?: SegmentInfo[]; language_probability?: number; language_probabilities?: Record<string, number>; badSegmentDetection?: { qualityScore?: number } }
  ): { aggregatedText: string; shouldProcess: boolean; action?: 'MERGE' | 'NEW_STREAM'; metrics?: { dedupCount?: number; dedupCharsRemoved?: number } } {
    // 验证 session_id 是否存在（关键：确保 session 隔离）
    if (!job.session_id || job.session_id.trim() === '') {
      logger.error(
        { jobId: job.job_id, traceId: job.trace_id },
        'Job missing session_id, cannot process with Aggregator. Falling back to original ASR text.'
      );
      // 降级：返回原始结果
      return {
        aggregatedText: asrResult.text || '',
        shouldProcess: true,
      };
    }

    // 如果未启用，直接返回原始结果
    if (!this.config.enabled || !this.manager) {
      return {
        aggregatedText: asrResult.text || '',
        shouldProcess: true,
      };
    }

    // 检查 ASR 结果是否为空
    const asrTextTrimmed = (asrResult.text || '').trim();
    if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
      // 空结果直接返回
      return {
        aggregatedText: '',
        shouldProcess: false,  // 空文本不需要处理
      };
    }

    // 提取 segments
    const segments: SegmentInfo[] | undefined = asrResult.segments;

    // 提取语言概率信息
    const langProbs = {
      top1: asrResult.language_probabilities
        ? Object.keys(asrResult.language_probabilities)[0] || job.src_lang
        : job.src_lang,
      p1: asrResult.language_probability || 0.9,
      top2: asrResult.language_probabilities
        ? Object.keys(asrResult.language_probabilities).find(
            (lang) => {
              const keys = Object.keys(asrResult.language_probabilities!);
              return lang !== (keys[0] || job.src_lang);
            }
          )
        : undefined,
      p2: asrResult.language_probabilities
        ? (() => {
            const keys = Object.keys(asrResult.language_probabilities);
            const top1Key = keys[0] || job.src_lang;
            const top2Key = keys.find((lang) => lang !== top1Key);
            return top2Key ? asrResult.language_probabilities[top2Key] : undefined;
          })()
        : undefined,
    };

    // 确定模式
    const mode: Mode = (job.mode === 'two_way_auto' || (job as any).room_mode) ? 'room' : 'offline';

    // 处理 utterance
    const aggregatorResult = this.manager.processUtterance(
      job.session_id,
      asrTextTrimmed,
      segments,
      langProbs,
      asrResult.badSegmentDetection?.qualityScore,
      true,  // isFinal: P0 只处理 final 结果
      (job as any).is_manual_cut || (job as any).isManualCut || false,  // 从 job 中提取
      mode
    );

    // 记录聚合决策结果（详细日志在 PipelineOrchestrator 中输出）
    if (aggregatorResult.metrics) {
      logger.debug(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          action: aggregatorResult.action,
          deduped: aggregatorResult.metrics.dedupCount ? true : false,
          dedupChars: aggregatorResult.metrics.dedupCharsRemoved || 0,
        },
        'AggregatorMiddleware: Utterance processing completed'
      );
    }

    // 如果 Aggregator 决定提交，返回聚合后的文本
    let aggregatedText = asrTextTrimmed;
    let shouldProcess = true;

    if (aggregatorResult.shouldCommit && aggregatorResult.text) {
      // Aggregator 决定提交，使用聚合后的文本
      aggregatedText = aggregatorResult.text;
      shouldProcess = true;
      // 详细日志在 PipelineOrchestrator 中输出
    } else if (aggregatorResult.action === 'MERGE') {
      // Merge 操作：文本已累积到 pending，但还没有提交
      // 如果是 final，应该已经提交了 pending 文本（在 processUtterance 中）
      // 如果 shouldCommit=false，说明 pending 文本还没有达到提交条件
      // 但因为是 final，我们需要强制提交 pending 文本
      if (!aggregatorResult.shouldCommit) {
        // 强制 flush pending 文本（因为是 final）
        const flushedText = this.manager?.flush(job.session_id) || '';
        if (flushedText && flushedText.trim().length > 0) {
          aggregatedText = flushedText;
          shouldProcess = true;
          // 详细日志在 PipelineOrchestrator 中输出
        } else {
          // 如果没有 pending 文本，使用当前文本
          aggregatedText = asrTextTrimmed;
          shouldProcess = true;
          // 详细日志在 PipelineOrchestrator 中输出
        }
      } else {
        // shouldCommit=true，但 action=MERGE，使用当前文本
        aggregatedText = asrTextTrimmed;
        shouldProcess = true;
        // 详细日志在 PipelineOrchestrator 中输出
      }
    } else {
      // NEW_STREAM: 使用原始文本
      aggregatedText = asrTextTrimmed;
      shouldProcess = true;
    }

    // 检查是否与上次发送的文本完全相同（防止重复处理）
    const duplicateCheck = this.deduplicationHandler.isDuplicate(
      job.session_id,
      aggregatedText,
      job.job_id,
      job.utterance_index
    );
    if (duplicateCheck.isDuplicate) {
      return {
        aggregatedText: '',
        shouldProcess: false,
        action: aggregatorResult.action,
        metrics: aggregatorResult.metrics,
      };
    }

    return {
      aggregatedText,
      shouldProcess,
      action: aggregatorResult.action,
      metrics: aggregatorResult.metrics,
    };
  }

  /**
   * 处理 JobResult（中间件入口）- 已废弃，保留用于兼容
   * @param job 原始 job 请求
   * @param result 推理服务返回的结果
   * @returns 处理后的结果和是否应该发送
   * @deprecated 使用 processASRResult 代替，在 NMT 之前处理
   */
  async process(
    job: JobAssignMessage,
    result: JobResult
  ): Promise<AggregatorMiddlewareResult> {
    // 检查是否是第一次任务（通过session状态判断，避免第一次任务时触发S2导致GPU过载）
    const isFirstJob = !this.manager?.getMetrics(job.session_id);
    
    // S2-5: 音频缓存已禁用（不再需要，因为二次解码已禁用）
    // 不再缓存音频，节省内存
    
    // 验证 session_id 是否存在（关键：确保 session 隔离）
    if (!job.session_id || job.session_id.trim() === '') {
      logger.error(
        { jobId: job.job_id, traceId: job.trace_id },
        'Job missing session_id, cannot process with Aggregator. Falling back to original result.'
      );
      // 降级：返回原始结果
      return {
        shouldSend: true,
        aggregatedText: result.text_asr,
      };
    }

    // 如果未启用，直接返回原始结果
    if (!this.config.enabled || !this.manager) {
      return {
        shouldSend: true,
        aggregatedText: result.text_asr,
      };
    }

    // 检查 ASR 结果是否为空
    const asrTextTrimmed = (result.text_asr || '').trim();
    if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
      // 空结果直接发送
      return {
        shouldSend: true,
        aggregatedText: '',
      };
    }

    // 提取 segments（从 result.segments 中获取）
    const segments: SegmentInfo[] | undefined = result.segments;

    // 提取语言概率信息
    const langProbs = {
      top1: result.extra?.language_probabilities
        ? Object.keys(result.extra.language_probabilities)[0] || job.src_lang
        : job.src_lang,
      p1: result.extra?.language_probability || 0.9,
      top2: result.extra?.language_probabilities
        ? Object.keys(result.extra.language_probabilities).find(
            (lang) => {
              const keys = Object.keys(result.extra!.language_probabilities!);
              return lang !== (keys[0] || job.src_lang);
            }
          )
        : undefined,
      p2: result.extra?.language_probabilities
        ? (() => {
            const keys = Object.keys(result.extra.language_probabilities);
            const top1Key = keys[0] || job.src_lang;
            const top2Key = keys.find((lang) => lang !== top1Key);
            return top2Key ? result.extra.language_probabilities[top2Key] : undefined;
          })()
        : undefined,
    };

    // 确定模式
    const mode: Mode = (job.mode === 'two_way_auto' || (job as any).room_mode) ? 'room' : 'offline';

    // 处理 utterance
    const aggregatorResult = this.manager.processUtterance(
      job.session_id,
      asrTextTrimmed,
      segments,
      langProbs,
      result.quality_score,
      true,  // isFinal: P0 只处理 final 结果
      false,  // isManualCut: 从 job 中提取（如果有）
      mode
    );

    // 记录指标
    if (aggregatorResult.metrics) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          action: aggregatorResult.action,
          deduped: aggregatorResult.metrics.dedupCount ? true : false,
          dedupChars: aggregatorResult.metrics.dedupCharsRemoved || 0,
        },
        'Aggregator middleware processing completed'
      );
    }

    // 定期输出完整指标
    const metrics = this.manager.getMetrics(job.session_id);
    if (metrics && metrics.commitCount > 0 && metrics.commitCount % 10 === 0) {
      logger.info(
        {
          sessionId: job.session_id,
          metrics: {
            commitCount: metrics.commitCount,
            mergeCount: metrics.mergeCount,
            newStreamCount: metrics.newStreamCount,
            dedupCount: metrics.dedupCount,
            dedupCharsRemoved: metrics.dedupCharsRemoved,
            tailCarryUsage: metrics.tailCarryUsage,
            commitLatencyMs: metrics.commitLatencyMs,
            missingGapCount: metrics.missingGapCount,
          },
        },
        'Aggregator middleware metrics summary'
      );
    }

    // P0: 只处理 final 结果，所以总是提交
    // 如果 Aggregator 决定不提交（shouldCommit=false），说明是 merge 操作，文本已累积到 pending
    // 但因为是 final，我们仍然需要提交当前结果
    let aggregatedText = asrTextTrimmed;
    
    if (aggregatorResult.shouldCommit && aggregatorResult.text) {
      // Aggregator 决定提交，使用聚合后的文本
      aggregatedText = aggregatorResult.text;
      logger.debug(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          action: aggregatorResult.action,
          originalLength: asrTextTrimmed.length,
          aggregatedLength: aggregatedText.length,
        },
        'Aggregator middleware: Using aggregated text'
      );
    } else if (aggregatorResult.action === 'MERGE') {
      // Merge 操作：文本已累积到 pending
      // 如果是 final，应该已经提交了 pending 文本（在 processUtterance 中）
      // 如果 shouldCommit=false，说明 pending 文本还没有达到提交条件
      // 但因为是 final，我们需要强制提交 pending 文本
      if (!aggregatorResult.shouldCommit) {
        // 强制 flush pending 文本（因为是 final）
        const flushedText = this.manager?.flush(job.session_id) || '';
        if (flushedText && flushedText.trim().length > 0) {
          // 检查是否与上次发送的文本相同（防止重复发送）
          const lastSent = this.deduplicationHandler.getLastSentText(job.session_id);
          if (lastSent) {
            const normalizeText = (text: string): string => {
              return text.replace(/\s+/g, ' ').trim();
            };
            const normalizedFlushed = normalizeText(flushedText);
            const normalizedLastSent = normalizeText(lastSent);
            if (normalizedFlushed === normalizedLastSent) {
              logger.warn(
                {
                  jobId: job.job_id,
                  sessionId: job.session_id,
                  utteranceIndex: job.utterance_index,
                  flushedText: flushedText.substring(0, 50),
                },
                'Skipping duplicate flushed text (same as last sent)'
              );
              return {
                shouldSend: false,
                aggregatedText: flushedText,
                action: aggregatorResult.action,
                metrics: aggregatorResult.metrics,
              };
            }
          }
          aggregatedText = flushedText;
          logger.debug(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              action: aggregatorResult.action,
              flushedLength: flushedText.length,
            },
            'Aggregator middleware: Flushed pending text for final utterance'
          );
        } else {
          // 如果没有 pending 文本，使用当前文本
          aggregatedText = asrTextTrimmed;
          logger.debug(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              action: aggregatorResult.action,
            },
            'Aggregator middleware: Merge action, no pending text, using current text'
          );
        }
      } else {
        // shouldCommit=true，但 action=MERGE，使用当前文本
        aggregatedText = asrTextTrimmed;
        logger.debug(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            action: aggregatorResult.action,
          },
          'Aggregator middleware: Merge action, using current text'
        );
      }
    }

    // S2: Rescoring已禁用（依赖二次解码，GPU占用过高）
    // 不再进行rescoring，直接使用aggregatedText
    let finalText = aggregatedText;
    let rescoreApplied = false;
    let rescoreReasons: string[] = [];
    let rescoreAddedLatencyMs = 0;
    
    
    // 使用finalText（可能经过rescoring）
    aggregatedText = finalText;

    // 注意：已废弃的方法，不再重新触发 NMT 翻译
    // 现在 AggregatorMiddleware 在 NMT 之前调用（通过 processASRResult），
    // 所以这里只返回聚合后的文本，不进行重新翻译
    // 保留原始翻译文本（从 result 中获取）
    let translatedText: string | undefined = result.text_translated;
    let nmtRetranslationTimeMs: number | undefined = undefined;
    
    // 不再重新触发 NMT，因为已经在 NMT 之前处理了
    logger.debug(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        note: 'Deprecated process() method: NMT retranslation skipped (already processed in processASRResult)',
      },
      'Aggregator middleware: Using original translation (no retranslation in deprecated method)'
    );
    
    // 保存当前翻译文本，供下一个 utterance 使用（1分钟过期）
    if (translatedText && this.manager) {
      this.manager.setLastTranslatedText(job.session_id, translatedText);
    }
    
    // 移除所有重新翻译逻辑，因为已经在 NMT 之前处理了
    // 以下代码已注释，保留用于参考
    /*
    if (aggregatedText.trim() !== asrTextTrimmed.trim() && this.taskRouter) {
      const nmtStartTime = Date.now();
      
      // 获取上下文文本（用于缓存键生成）
      let contextText = this.manager?.getLastTranslatedText(job.session_id) || undefined;
      if (contextText && contextText.length > 200) {
        contextText = contextText.substring(contextText.length - 200);
      }
      
      // 生成缓存键（使用优化的缓存键生成器）
      const cacheKey = generateCacheKey(
        job.src_lang,
        job.tgt_lang,
        aggregatedText,
        contextText
      );
      
      // 检查是否应该缓存（太短或太长的文本可能不值得缓存）
      const shouldCacheThis = shouldCache(aggregatedText);
      
      // 检查缓存
      const cachedTranslation = shouldCacheThis ? this.translationCache.get(cacheKey) : undefined;
      if (cachedTranslation) {
        translatedText = cachedTranslation;
        nmtRetranslationTimeMs = Date.now() - nmtStartTime;
        
        logger.debug(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            cacheHit: true,
            translationTimeMs: nmtRetranslationTimeMs,
          },
          'Re-triggered NMT for aggregated text (from cache)'
        );
      } else {
        // 缓存未命中，调用 NMT 服务
        // 检查是否应该异步处理（长文本）
        const shouldAsync = this.config.enableAsyncRetranslation && 
                            aggregatedText.length > (this.config.asyncRetranslationThreshold || 50);
        
        if (shouldAsync) {
          // 异步处理：先返回原始翻译，后台更新
          translatedText = result.text_translated || '';
          nmtRetranslationTimeMs = Date.now() - nmtStartTime;  // 异步处理延迟接近 0
          
          // 后台异步处理翻译
          this.translationHandler.processAsyncRetranslation(job, aggregatedText, contextText, cacheKey, shouldCacheThis);
          
          logger.debug(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              textLength: aggregatedText.length,
              async: true,
            },
            'Re-triggered NMT for aggregated text (async processing)'
          );
        } else {
          // 同步处理：等待翻译完成
          try {
            // 获取上一个 utterance 的翻译文本作为上下文（1分钟过期）
            let contextText = this.manager?.getLastTranslatedText(job.session_id) || undefined;
            
            // 限制上下文文本长度（避免过长导致问题）
            if (contextText && contextText.length > 200) {
              contextText = contextText.substring(contextText.length - 200);
            }
            
            // 检查是否应该使用 NMT Repair
            const shouldRepair = this.shouldRepair(
              aggregatedText,
              result.quality_score,
              aggregatorResult.metrics?.dedupCharsRemoved || 0
            );
            
            // 检查是否可能包含同音字错误
            const hasHomophoneErrors = hasPossibleHomophoneErrors(aggregatedText);
            
            // 如果可能包含同音字错误，生成原文候选（包括原文和修复后的原文）
            let sourceCandidates: string[] = [aggregatedText];
            if (hasHomophoneErrors) {
              sourceCandidates = detectHomophoneErrors(aggregatedText);
              logger.debug(
                {
                  jobId: job.job_id,
                  sessionId: job.session_id,
                  originalText: aggregatedText.substring(0, 50),
                  numSourceCandidates: sourceCandidates.length,
                  sourceCandidates: sourceCandidates.map(c => c.substring(0, 30)),
                },
                'NMT Repair: Detected possible homophone errors, generating source candidates'
              );
            }
            
            // 如果只有一个原文候选且启用了 NMT Repair，使用 NMT 候选生成
            if (sourceCandidates.length === 1 && shouldRepair) {
              const nmtTask: NMTTask = {
                text: aggregatedText,
                src_lang: job.src_lang,
                tgt_lang: job.tgt_lang,
                context_text: contextText,
                job_id: job.job_id,
                num_candidates: this.config.nmtRepairNumCandidates || 5,
              };
              
              const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
              
              // 构建候选列表（包含原始翻译）
              const candidates = [
                { candidate: aggregatedText, translation: result.text_translated || '' },
                ...(nmtResult.candidates || []).map(candidate => ({
                  candidate: aggregatedText,
                  translation: candidate,
                })),
              ];
              
              // 获取上一个翻译作为上下文（用于打分）
              const previousTranslation = this.manager?.getLastTranslatedText(job.session_id) || undefined;
              
              // 对候选进行打分
              const scoredCandidates = scoreCandidates(
                candidates,
                aggregatedText,
                result.text_translated || '',
                previousTranslation
              );
              
              // 选择最佳候选
              const bestCandidate = selectBestCandidate(
                scoredCandidates,
                result.text_translated || '',
                this.config.nmtRepairThreshold ? 1 - this.config.nmtRepairThreshold : 0.05
              );
              
              if (bestCandidate) {
                translatedText = bestCandidate.translation;
                logger.info(
                  {
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    originalTranslation: result.text_translated?.substring(0, 50),
                    bestTranslation: bestCandidate.translation.substring(0, 50),
                    bestScore: bestCandidate.score,
                    numCandidates: scoredCandidates.length,
                  },
                  'NMT Repair: Selected best candidate'
                );
              } else {
                translatedText = nmtResult.text;
                logger.debug(
                  {
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    reason: 'No significant improvement',
                  },
                  'NMT Repair: Using original translation (no significant improvement)'
                );
              }
            } else if (sourceCandidates.length > 1) {
              // 有多个原文候选（同音字修复），对每个候选进行 NMT 翻译并打分
              logger.debug(
                {
                  jobId: job.job_id,
                  sessionId: job.session_id,
                  numSourceCandidates: sourceCandidates.length,
                },
                'NMT Repair: Translating multiple source candidates for homophone repair'
              );
              
              // 对每个原文候选进行 NMT 翻译
              if (!this.taskRouter) {
                logger.error(
                  { jobId: job.job_id, sessionId: job.session_id },
                  'NMT Repair: TaskRouter not available, cannot translate source candidates'
                );
                translatedText = result.text_translated || '';
              } else {
                // 限制并发数，分批处理（避免GPU过载）
                const MAX_CONCURRENT_CANDIDATES = 2;  // 最多同时翻译2个候选
                const translatedCandidates: Array<{ candidate: string; translation: string }> = [];
                
                for (let i = 0; i < sourceCandidates.length; i += MAX_CONCURRENT_CANDIDATES) {
                  const chunk = sourceCandidates.slice(i, i + MAX_CONCURRENT_CANDIDATES);
                  const translationPromises = chunk.map(async (sourceCandidate) => {
                    const nmtTask: NMTTask = {
                      text: sourceCandidate,
                      src_lang: job.src_lang,
                      tgt_lang: job.tgt_lang,
                      context_text: contextText,
                      job_id: job.job_id,
                    };
                    
                    const nmtResult = await this.taskRouter!.routeNMTTask(nmtTask);
                    return {
                      candidate: sourceCandidate,
                      translation: nmtResult.text,
                    };
                  });
                  
                  const chunkResults = await Promise.all(translationPromises);
                  translatedCandidates.push(...chunkResults);
                }
                
                // 获取上一个翻译作为上下文（用于打分）
                const previousTranslation = this.manager?.getLastTranslatedText(job.session_id) || undefined;
                
                // 对候选进行打分
                const scoredCandidates = scoreCandidates(
                  translatedCandidates,
                  aggregatedText,
                  result.text_translated || '',
                  previousTranslation
                );
                
                // 选择最佳候选
                const bestCandidate = selectBestCandidate(
                  scoredCandidates,
                  result.text_translated || '',
                  this.config.nmtRepairThreshold ? 1 - this.config.nmtRepairThreshold : 0.05
                );
                
                if (bestCandidate) {
                  // 更新 aggregatedText 为修复后的原文
                  const originalAggregatedText = aggregatedText;
                  aggregatedText = bestCandidate.candidate;
                  translatedText = bestCandidate.translation;
                  
                  // 计算分数提升（用于自动学习）
                  const originalScore = scoredCandidates.find(c => c.candidate === originalAggregatedText)?.score || 0;
                  const scoreImprovement = bestCandidate.score - originalScore;
                  
                  // 如果修复后的文本与原文不同，且分数有明显提升，进行自动学习
                  if (bestCandidate.candidate !== originalAggregatedText && scoreImprovement > 0.1) {
                    learnHomophonePattern(originalAggregatedText, bestCandidate.candidate, scoreImprovement);
                  }
                  
                  logger.info(
                    {
                      jobId: job.job_id,
                      sessionId: job.session_id,
                      originalText: originalAggregatedText.substring(0, 50),
                      fixedText: bestCandidate.candidate.substring(0, 50),
                      originalTranslation: result.text_translated?.substring(0, 50),
                      bestTranslation: bestCandidate.translation.substring(0, 50),
                      bestScore: bestCandidate.score,
                      scoreImprovement: scoreImprovement.toFixed(3),
                      numCandidates: scoredCandidates.length,
                    },
                    'NMT Repair: Selected best candidate (homophone repair)'
                  );
                } else {
                  // 没有明显更好的候选，使用原始翻译
                  translatedText = result.text_translated || '';
                  logger.debug(
                    {
                      jobId: job.job_id,
                      sessionId: job.session_id,
                      reason: 'No significant improvement',
                    },
                    'NMT Repair: Using original translation (no significant improvement)'
                  );
                }
              }
            } else {
              // 没有同音字错误，也没有启用 NMT Repair，直接翻译
              // 检查是否应该使用批量处理
              const shouldBatch = this.batchQueue.length > 0 || 
                                 (this.config.enableAsyncRetranslation && aggregatedText.length <= (this.config.asyncRetranslationThreshold || 50));
              
              if (shouldBatch && this.batchQueue.length < this.MAX_BATCH_SIZE) {
                // 使用批量处理
                translatedText = await new Promise<string>((resolve, reject) => {
                  this.batchQueue.push({
                    job,
                    aggregatedText,
                    contextText,
                    resolve,
                    reject,
                    timestamp: Date.now(),
                  });
                  
                  // 调度批量处理
                  this.translationHandler.addBatchTranslation({
                    job,
                    aggregatedText,
                    contextText,
                    resolve,
                    reject,
                    timestamp: Date.now(),
                  });
                });
              } else {
                // 直接翻译
                const nmtTask: NMTTask = {
                  text: aggregatedText,
                  src_lang: job.src_lang,
                  tgt_lang: job.tgt_lang,
                  context_text: contextText,
                  job_id: job.job_id,
                };
                
                const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
                translatedText = nmtResult.text;
              }
            }
          
          nmtRetranslationTimeMs = Date.now() - nmtStartTime;
          
          // 存入缓存（只有适合缓存的文本才缓存）
          if (shouldCacheThis && translatedText) {
            this.translationCache.set(cacheKey, translatedText);
          }
          
          // 保存当前翻译文本，供下一个 utterance 使用（1分钟过期）
          if (translatedText && this.manager) {
            this.manager.setLastTranslatedText(job.session_id, translatedText);
          }
          
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              originalText: asrTextTrimmed.substring(0, 50),
              aggregatedText: aggregatedText.substring(0, 50),
              originalTranslation: result.text_translated?.substring(0, 50),
              newTranslation: translatedText?.substring(0, 50),
              translationTimeMs: nmtRetranslationTimeMs,
              cacheHit: false,
              hasContext: !!contextText,
              contextText: contextText?.substring(0, 30),
            },
            'Re-triggered NMT for aggregated text'
          );
        } catch (error) {
          // 降级：使用原始翻译
          logger.error(
            {
              error,
              jobId: job.job_id,
              sessionId: job.session_id,
              aggregatedText: aggregatedText.substring(0, 50),
            },
            'Failed to re-trigger NMT, using original translation'
          );
          // translatedText 保持 undefined，使用原始翻译
          nmtRetranslationTimeMs = Date.now() - nmtStartTime;
        }
        }
      }
    }
    */
    // 重新翻译逻辑结束（已注释）
    
    // 如果是 NEW_STREAM，清理上下文（可选，但保留1分钟过期机制）
    // 注意：我们使用1分钟过期机制，所以不需要手动清理

    // 检查是否与上次发送的文本完全相同（防止重复发送）
    // 优化：使用更严格的文本比较（去除所有空白字符，包括换行符、多个空格等）
    const lastSent = this.deduplicationHandler.getLastSentText(job.session_id);
    if (lastSent) {
      // 规范化文本：去除所有空白字符，只保留实际内容
      const normalizeText = (text: string): string => {
        return text.replace(/\s+/g, ' ').trim();
      };
      
      const normalizedAggregated = normalizeText(aggregatedText);
      const normalizedLastSent = normalizeText(lastSent);
      
      if (normalizedAggregated === normalizedLastSent && normalizedAggregated.length > 0) {
        // 完全相同的文本，不发送（防止停止后重复返回）
        logger.warn(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            text: aggregatedText.substring(0, 50),
            normalizedText: normalizedAggregated.substring(0, 50),
            lastSentText: lastSent.substring(0, 50),
          },
          'Skipping duplicate text (same as last sent after normalization)'
        );
        return {
          shouldSend: false,
          aggregatedText,
          translatedText,
          action: aggregatorResult.action,
          metrics: {
            ...aggregatorResult.metrics,
            nmtRetranslationTimeMs,
          },
        };
      }
      
      // 额外检查：如果文本非常相似（相似度>95%），也视为重复
      if (normalizedAggregated.length > 0 && normalizedLastSent.length > 0) {
        const similarity = this.deduplicationHandler.calculateTextSimilarity(normalizedAggregated, normalizedLastSent);
        if (similarity > 0.95) {
          logger.warn(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              text: aggregatedText.substring(0, 50),
              lastSentText: lastSent.substring(0, 50),
              similarity,
            },
            'Skipping duplicate text (high similarity with last sent)'
          );
          return {
            shouldSend: false,
            aggregatedText,
            translatedText,
            action: aggregatorResult.action,
            metrics: {
              ...aggregatorResult.metrics,
              nmtRetranslationTimeMs,
            },
          };
        }
      }
    }
    
    // 在返回前立即更新lastSentText（防止并发请求导致的重复发送）
    // 注意：这里只是标记，实际发送在NodeAgent中
    if (aggregatedText && aggregatedText.length > 0) {
      this.deduplicationHandler.setLastSentText(job.session_id, aggregatedText);
      logger.debug(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          text: aggregatedText.substring(0, 50),
        },
        'Updated lastSentText (pre-send) to prevent duplicate'
      );
    }
    
    // 注意：lastSentText 的更新应该在 NodeAgent 发送成功后进行
    // 这里只返回结果，不更新 lastSentText（由 NodeAgent 负责更新）
    
    return {
      shouldSend: true,  // P0 总是发送（因为是 final）
      aggregatedText,
      translatedText,  // 新增：重新翻译的文本
      action: aggregatorResult.action,
      metrics: {
        ...aggregatorResult.metrics,
        nmtRetranslationTimeMs,  // 新增：重新翻译耗时
        // S2: Rescoring trace信息
        rescoreApplied,
        rescoreReasons: rescoreReasons.length > 0 ? rescoreReasons : undefined,
        rescoreAddedLatencyMs: rescoreAddedLatencyMs > 0 ? rescoreAddedLatencyMs : undefined,
      },
    };
  }

  /**
   * 强制 flush session（stop/leave 时调用）
   */
  flush(sessionId: string): string {
    if (!this.config.enabled || !this.manager) {
      return '';
    }
    return this.manager.flush(sessionId);
  }

  /**
   * 获取最后发送的文本
   */
  getLastSentText(sessionId: string): string | undefined {
    return this.deduplicationHandler.getLastSentText(sessionId);
  }

  /**
   * 设置最后发送的文本（在成功发送后调用）
   */
  setLastSentText(sessionId: string, text: string): void {
    this.deduplicationHandler.setLastSentText(sessionId, text);
  }

  /**
   * 清理 session（显式关闭）
   */
  removeSession(sessionId: string): void {
    if (!this.config.enabled || !this.manager) {
      return;
    }
    this.manager.removeSession(sessionId);
    // 清理最后发送的文本记录
    this.deduplicationHandler.removeSession(sessionId);
    // S2-5: 清理音频缓存
    this.audioHandler.clearAudio(sessionId);
  }
  

  /**
   * 判断是否应该触发 NMT Repair
   */
  private shouldRepair(
    text: string,
    qualityScore: number | undefined,
    dedupCharsRemoved: number
  ): boolean {
    // 如果未启用 NMT Repair，直接返回 false
    if (!this.config.nmtRepairEnabled) {
      return false;
    }
    
    // 质量分数低
    if (qualityScore !== undefined && qualityScore < (this.config.nmtRepairThreshold || 0.7)) {
      return true;
    }
    
    // 明显重复（Dedup 裁剪量大）
    if (dedupCharsRemoved > 10) {
      return true;
    }
    
    // 文本过短或过长（可能是错误）
    if (text.length < 3 || text.length > 500) {
      return false;  // 过短或过长不修复
    }
    
    return false;
  }

  /**
   * 获取 session 指标
   */
  getMetrics(sessionId: string) {
    if (!this.config.enabled || !this.manager) {
      return null;
    }
    return this.manager.getMetrics(sessionId);
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

