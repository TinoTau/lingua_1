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
    // 已废弃：直接使用 processASRResult 的逻辑
    const asrResult = {
      text: result.text_asr || '',
      segments: result.segments,
      language_probability: result.extra?.language_probability ?? undefined,
      language_probabilities: result.extra?.language_probabilities ?? undefined,
      badSegmentDetection: { qualityScore: result.quality_score },
    };
    
    const processResult = this.processASRResult(job, asrResult);
    
    return {
      shouldSend: processResult.shouldProcess,
      aggregatedText: processResult.aggregatedText,
      action: processResult.action,
      metrics: processResult.metrics,
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
