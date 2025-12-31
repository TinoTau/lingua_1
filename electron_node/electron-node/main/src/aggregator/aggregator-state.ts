/* Aggregator State: 会话态管理
   维护每个 session 的 Aggregator 状态，包括：
   - 待提交的文本（pending text）
   - 上一个 utterance 信息
   - 会话时间轴
   - Tail buffer
*/

import {
  Mode,
  StreamAction,
  UtteranceInfo,
  AggregatorTuning,
  defaultTuning,
  decideStreamAction,
  shouldCommit,
} from './aggregator-decision';
import { dedupMergePrecise, DEFAULT_DEDUP_CONFIG, DedupConfig, detectInternalRepetition } from './dedup';
import { extractTail, removeTail, DEFAULT_TAIL_CARRY_CONFIG, TailCarryConfig } from './tail-carry';
import { SegmentInfo } from '../task-router/types';
import logger from '../logger';
import { AggregatorStateUtils } from './aggregator-state-utils';
import { AggregatorStateContextManager } from './aggregator-state-context';

export interface AggregatorMetrics {
  commitCount: number;
  mergeCount: number;
  newStreamCount: number;
  dedupCount: number;
  dedupCharsRemoved: number;
  tailCarryUsage: number;
  veryShortUttRate: number;
  missingGapCount: number;
  commitLatencyMs: number;  // 首次输出延迟
}

export interface AggregatorCommitResult {
  text: string;
  shouldCommit: boolean;
  action: StreamAction;
  isFirstInMergedGroup?: boolean;  // 是否是合并组中的第一个 utterance（已废弃，保留用于兼容）
  isLastInMergedGroup?: boolean;  // 是否是合并组中的最后一个 utterance（新逻辑：合并到最后一个）
  metrics: Partial<AggregatorMetrics>;
}

export class AggregatorState {
  private sessionId: string;
  private mode: Mode;
  private tuning: AggregatorTuning;
  private dedupConfig: DedupConfig;
  private tailCarryConfig: TailCarryConfig;

  // 状态
  private pendingText: string = '';
  private lastUtterance: UtteranceInfo | null = null;
  private lastCommitTsMs: number = 0;
  private tailBuffer: string = '';
  
  // 新增：跟踪当前合并组的起始 utterance（用于判断是否是合并组中的第一个）
  // 当 action="MERGE" 且 pendingText 为空时，记录当前 utterance 为合并组的开始
  // 当 action="NEW_STREAM" 或提交后，清空此标志
  private mergeGroupStartUtterance: UtteranceInfo | null = null;
  
  // 会话时间轴
  private sessionStartTimeMs: number = 0;
  private lastUtteranceEndTimeMs: number = 0;
  private accumulatedAudioDurationMs: number = 0;  // 累积的音频时长（毫秒）
  private mergeGroupStartTimeMs: number = 0;  // 当前合并组的开始时间（用于计算累积时长）
  
  // 上下文管理器
  private contextManager: AggregatorStateContextManager;
  
  // 指标
  private metrics: AggregatorMetrics = {
    commitCount: 0,
    mergeCount: 0,
    newStreamCount: 0,
    dedupCount: 0,
    dedupCharsRemoved: 0,
    tailCarryUsage: 0,
    veryShortUttRate: 0,
    missingGapCount: 0,
    commitLatencyMs: 0,
  };

  constructor(
    sessionId: string,
    mode: Mode = 'offline',
    tuning?: AggregatorTuning,
    dedupConfig?: DedupConfig,
    tailCarryConfig?: TailCarryConfig
  ) {
    this.sessionId = sessionId;
    this.mode = mode;
    this.tuning = tuning || defaultTuning(mode);
    this.dedupConfig = dedupConfig || DEFAULT_DEDUP_CONFIG;
    this.tailCarryConfig = tailCarryConfig || DEFAULT_TAIL_CARRY_CONFIG;
    this.sessionStartTimeMs = Date.now();
    this.lastCommitTsMs = Date.now();
    this.contextManager = new AggregatorStateContextManager();
  }

  /**
   * 处理新的 utterance
   * @param text ASR 文本
   * @param segments ASR segments（用于计算时间戳）
   * @param langProbs 语言概率信息
   * @param qualityScore 质量分数
   * @param isFinal 是否为 final
   * @param isManualCut 是否为手动截断
   * @returns 处理结果
   */
  processUtterance(
    text: string,
    segments: SegmentInfo[] | undefined,
    langProbs: { top1: string; p1: number; top2?: string; p2?: number },
    qualityScore: number | undefined,
    isFinal: boolean = false,
    isManualCut: boolean = false,
    isPauseTriggered: boolean = false,
    isTimeoutTriggered: boolean = false
  ): AggregatorCommitResult {
    const nowMs = Date.now();
    
    // 先检测并移除完全重复和内部重复
    text = detectInternalRepetition(text);
    
    // 计算 utterance 的时间戳（从 segments 推导）
    const utteranceTime = AggregatorStateUtils.calculateUtteranceTime(
      segments,
      this.sessionStartTimeMs,
      this.lastUtteranceEndTimeMs
    );
    const startMs = utteranceTime.startMs;
    const endMs = utteranceTime.endMs;
    const gapMs = utteranceTime.gapMs;
    if (utteranceTime.newSessionStartTimeMs !== this.sessionStartTimeMs) {
      this.sessionStartTimeMs = utteranceTime.newSessionStartTimeMs;
    }
    if (!segments || segments.length === 0) {
      this.metrics.missingGapCount++;
    }

    // 构建 UtteranceInfo
    const curr: UtteranceInfo = {
      text,
      startMs,
      endMs,
      lang: {
        top1: langProbs.top1,
        p1: langProbs.p1,
        top2: langProbs.top2,
        p2: langProbs.p2,
      },
      qualityScore,
      isFinal,
      isManualCut,
      isPauseTriggered,
      isTimeoutTriggered,
    } as any; // 临时使用any，因为UtteranceInfo接口需要更新

    // 决策：merge 还是 new_stream
    // 关键逻辑：如果上一个utterance有手动发送/3秒静音标识，当前应该是NEW_STREAM
    // 因为上一个utterance已经被强制提交，当前应该是新的流
    let action: StreamAction;
    if (this.lastUtterance && (this.lastUtterance.isManualCut || (this.lastUtterance as any).isPauseTriggered)) {
      // 上一个utterance有手动发送/3秒静音标识，当前应该是NEW_STREAM
      action = 'NEW_STREAM';
      logger.info(
        {
          text: text.substring(0, 50),
          lastUtteranceText: this.lastUtterance.text.substring(0, 50),
          lastUtteranceIsManualCut: this.lastUtterance.isManualCut,
          reason: 'Last utterance had manual cut or pause trigger, starting new stream',
        },
        'AggregatorState: Forcing NEW_STREAM due to last utterance trigger'
      );
    } else {
      // 正常决策
      action = decideStreamAction(this.lastUtterance, curr, this.mode, this.tuning);
    }
    
    // 更新指标
    if (action === 'MERGE') {
      this.metrics.mergeCount++;
    } else {
      this.metrics.newStreamCount++;
    }

    // 处理文本合并
    let processedText = text;
    let deduped = false;
    let dedupChars = 0;

    // 记录是否是合并组中的第一个 utterance
    // 关键逻辑：
    // 1. 如果 action="MERGE" 且 pendingText 为空 且 mergeGroupStartUtterance 为 null，说明这是新合并组的开始
    // 2. 如果 action="MERGE" 但 pendingText 不为空，说明之前已经有 utterance 被合并了，当前 utterance 不是第一个
    // 3. 如果 action="MERGE" 但 mergeGroupStartUtterance 已存在，说明这是后续被合并的 utterance
    // 4. 如果 action="MERGE" 但 lastUtterance 不存在，说明这是第一个 utterance，不能是合并组
    // 5. 重要：如果 pendingText 为空且 mergeGroupStartUtterance 为 null，说明之前的合并组已经完成（已提交），当前 utterance 是新合并组的开始
    const isFirstInMergedGroup = action === 'MERGE' && 
                                  this.pendingText === '' && 
                                  this.mergeGroupStartUtterance === null &&
                                  this.lastUtterance !== null;
    
    // 添加调试日志
    if (action === 'MERGE') {
      logger.info(  // 改为 info 级别，确保输出
        {
          text: text.substring(0, 50),
          pendingText: this.pendingText.substring(0, 50),
          hasMergeGroupStart: this.mergeGroupStartUtterance !== null,
          hasLastUtterance: this.lastUtterance !== null,
          lastUtteranceText: this.lastUtterance?.text.substring(0, 50),
          isFirstInMergedGroup,
        },
        'AggregatorState: MERGE action, checking isFirstInMergedGroup'
      );
    }
    
    if (action === 'MERGE' && this.lastUtterance) {
      // 如果有 tail buffer，先与 tail 合并
      if (this.tailBuffer) {
        const tailDedup = dedupMergePrecise(this.tailBuffer, text, this.dedupConfig);
        processedText = tailDedup.text;
        
        // 修复：如果去重后文本为空，且原始文本较短（可能是误判），保留原始文本
        if (tailDedup.deduped && !processedText.trim() && text.length <= 10) {
          logger.warn(
            {
              originalText: text,
              originalTextLength: text.length,
              tailBuffer: this.tailBuffer.substring(0, 50),
              overlapChars: tailDedup.overlapChars,
              reason: 'Dedup with tail buffer resulted in empty text for short utterance, keeping original text',
            },
            'AggregatorState: Dedup with tail buffer removed all text for short utterance, keeping original'
          );
          processedText = text; // 保留原始文本
          deduped = false; // 重置去重标志
        } else if (tailDedup.deduped) {
          deduped = true;
          dedupChars += tailDedup.overlapChars;
          this.metrics.dedupCount++;
          this.metrics.dedupCharsRemoved += tailDedup.overlapChars;
        }
        this.tailBuffer = '';
        this.metrics.tailCarryUsage++;
      } else {
        // 与上一个 utterance 的尾部去重
        const lastText = this.lastUtterance.text;
        const lastTail = extractTail(lastText, this.tailCarryConfig) || lastText.slice(-20); // 使用最后 20 个字符作为参考
        const dedupResult = dedupMergePrecise(lastTail, text, this.dedupConfig);
        processedText = dedupResult.text;
        
        // 修复：如果去重后文本为空，且原始文本较短（可能是误判），保留原始文本
        // 避免短句（如 "就回来了"）被完全去重导致语音丢失
        if (dedupResult.deduped && !processedText.trim() && text.length <= 10) {
          logger.warn(
            {
              originalText: text,
              originalTextLength: text.length,
              lastTail: lastTail.substring(0, 50),
              overlapChars: dedupResult.overlapChars,
              reason: 'Dedup resulted in empty text for short utterance, keeping original text to avoid speech loss',
            },
            'AggregatorState: Dedup removed all text for short utterance, keeping original to prevent speech loss'
          );
          processedText = text; // 保留原始文本，避免语音丢失
          deduped = false; // 重置去重标志，因为保留了原始文本
          dedupChars = Math.max(0, dedupChars - dedupResult.overlapChars); // 调整去重字符数
        } else if (dedupResult.deduped) {
          deduped = true;
          dedupChars += dedupResult.overlapChars;
          this.metrics.dedupCount++;
          this.metrics.dedupCharsRemoved += dedupResult.overlapChars;
        }
      }

      // 合并到 pending text
      this.pendingText += (this.pendingText ? ' ' : '') + processedText;
      
      // 如果是合并组的第一个 utterance，记录它和开始时间
      if (isFirstInMergedGroup) {
        this.mergeGroupStartUtterance = curr;
        this.mergeGroupStartTimeMs = startMs;  // 记录合并组的开始时间
        this.accumulatedAudioDurationMs = endMs - startMs;  // 初始化累积时长
        logger.info(  // 改为 info 级别，确保输出
          {
            text: text.substring(0, 50),
            isFirstInMergedGroup: true,
            mergeGroupStartTimeMs: this.mergeGroupStartTimeMs,
            initialAccumulatedDurationMs: this.accumulatedAudioDurationMs,
          },
          'AggregatorState: Starting new merge group'
        );
      } else {
        // 后续的 utterance：累加音频时长
        const currentUtteranceDurationMs = endMs - startMs;
        this.accumulatedAudioDurationMs += currentUtteranceDurationMs;
      }
    } else {
      // NEW_STREAM: 先提交之前的 pending text
      if (this.pendingText) {
        // 提交时移除 tail
        const textToCommit = removeTail(this.pendingText, this.tailCarryConfig);
        const tail = extractTail(this.pendingText, this.tailCarryConfig);
        if (tail) {
          this.tailBuffer = tail;
        }
        this.pendingText = '';
        // 注意：这里应该触发 commit，但为了简化，我们在 shouldCommit 中处理
      }

      // 开始新的 stream，清空合并组起始标志和累积时长
      // 重要：NEW_STREAM 时清空 tailBuffer，因为新句子不应该保留上一个句子的 tail
      // tailBuffer 只应该在 MERGE 时使用，用于去重
      this.tailBuffer = '';
      this.mergeGroupStartUtterance = null;
      this.mergeGroupStartTimeMs = 0;
      this.accumulatedAudioDurationMs = 0;
      this.pendingText = processedText;
      
      logger.info(
        {
          text: processedText.substring(0, 50),
          clearedTailBuffer: true,
        },
        'AggregatorState: NEW_STREAM, cleared tailBuffer'
      );
    }

    // 更新状态
    this.lastUtterance = curr;
    this.lastUtteranceEndTimeMs = endMs;
    if (this.sessionStartTimeMs === 0) {
      this.sessionStartTimeMs = startMs;
    }

    // 检查是否需要 commit
    // 新逻辑：基于用户行为的动态合并
    // 优先级：1. 手动发送（isManualCut/isPauseTriggered） > 2. 10秒超时（isTimeoutTriggered或从NEW_STREAM开始计时） > 3. 原有条件
    
    // 1. 手动发送或3秒静音触发：用户点击发送按钮或3秒静音，立即处理并强制提交
    // 注意：如果收到这些标识，当前utterance应该被标记为合并组的最后一个
    const shouldCommitByManualCut = isManualCut || isPauseTriggered;
    
    // 2. 10秒超时触发：从NEW_STREAM开始计时，如果超过10秒，自动提交
    // 如果收到isTimeoutTriggered标识，或者从合并组开始时间计算超过10秒
    const TIMEOUT_THRESHOLD_MS = 10000;  // 10秒
    const shouldCommitByTimeout = isTimeoutTriggered || 
      (action === 'MERGE' && this.mergeGroupStartTimeMs > 0 && 
       (nowMs - this.mergeGroupStartTimeMs) >= TIMEOUT_THRESHOLD_MS);
    
    // 3. 如果收到手动发送/3秒静音标识，强制提交并标记为合并组的最后一个
    // 下一个utterance应该被识别为NEW_STREAM（因为上一个已经提交了）
    let shouldCommitNow: boolean;
    let isLastInMergedGroup = false;
    
    if (shouldCommitByManualCut && action === 'MERGE') {
      // 强制提交当前合并组
      shouldCommitNow = true;
      // 标记为合并组的最后一个
      isLastInMergedGroup = true;
      // 清空合并组状态，下一个utterance将是NEW_STREAM
      this.mergeGroupStartUtterance = null;
      this.mergeGroupStartTimeMs = 0;
      this.accumulatedAudioDurationMs = 0;
    } else {
      // 组合所有提交条件（优先级：手动发送/静音 > 10秒超时 > 原有条件）
      shouldCommitNow = shouldCommit(
        this.pendingText,
        this.lastCommitTsMs,
        nowMs,
        this.mode,
        this.tuning
      ) || shouldCommitByManualCut || shouldCommitByTimeout || isFinal;
      
      // 如果是MERGE且触发提交，标记为合并组的最后一个
      if (action === 'MERGE' && shouldCommitNow) {
        isLastInMergedGroup = true;
      }
    }
    
    // 保存提交原因，供后续使用和日志
    const commitByManualCut = shouldCommitByManualCut;
    const commitByTimeout = shouldCommitByTimeout;
    
    // 添加调试日志，记录提交条件的判断
    if (action === 'MERGE') {
      logger.info(  // 改为 info 级别，确保日志输出
        {
          text: text.substring(0, 50),
          shouldCommitNow,
          commitByManualCut,
          commitByTimeout,
          isPauseTriggered,
          isTimeoutTriggered,
          gapMs,
          accumulatedAudioDurationMs: this.accumulatedAudioDurationMs,
          mergeGroupStartTimeMs: this.mergeGroupStartTimeMs,
          timeSinceMergeGroupStart: this.mergeGroupStartTimeMs > 0 ? (nowMs - this.mergeGroupStartTimeMs) : 0,
          pendingTextLength: this.pendingText.length,
          lastCommitTsMs: this.lastCommitTsMs,
          nowMs,
          elapsedSinceLastCommit: nowMs - this.lastCommitTsMs,
          isFinal,
          isManualCut,
        },
        'AggregatorState: MERGE action, checking commit conditions'
      );
    }

    // 计算首次输出延迟
    if (this.metrics.commitCount === 0 && shouldCommitNow) {
      this.metrics.commitLatencyMs = nowMs - this.sessionStartTimeMs;
    }

    // 如果需要 commit，提取文本（保留 tail）
    let commitText = '';
    if (shouldCommitNow && this.pendingText) {
      // 如果是 isFinal，不保留 tail，全部输出（确保完整）
      if (isFinal || isManualCut) {
        commitText = this.pendingText;
        // 如果有 tail buffer，也包含进去
        if (this.tailBuffer) {
          commitText = this.tailBuffer + commitText;
          this.tailBuffer = '';
        }
      } else {
        // 非 final，保留 tail
        commitText = removeTail(this.pendingText, this.tailCarryConfig);
        const tail = extractTail(this.pendingText, this.tailCarryConfig);
        if (tail) {
          this.tailBuffer = tail;
          this.metrics.tailCarryUsage++;
        }
      }
      
      this.pendingText = '';
      this.lastCommitTsMs = nowMs;
      this.metrics.commitCount++;
      // S1/S2: 更新最近提交的文本
      this.contextManager.updateRecentCommittedText(commitText);
      this.contextManager.setLastCommitQuality(qualityScore);
      
      // 提交后，清空合并组相关标志和累积时长
      if (this.mergeGroupStartUtterance) {
        logger.info(  // 改为 info 级别，确保输出
          {
            text: commitText.substring(0, 50),
            mergeGroupStartText: this.mergeGroupStartUtterance.text.substring(0, 50),
            accumulatedDurationMs: this.accumulatedAudioDurationMs,
            commitByManualCut: commitByManualCut,
            commitByTimeout: commitByTimeout,
            gapMs: gapMs,
            commitTextLength: commitText.length,
          },
          'AggregatorState: Clearing mergeGroupStartUtterance after commit'
        );
        this.mergeGroupStartUtterance = null;
        this.mergeGroupStartTimeMs = 0;
        this.accumulatedAudioDurationMs = 0;
      }
    } else if (isFinal && this.pendingText) {
      // 如果是 final 但没有触发 commit（可能是因为 pending 文本太短），强制提交
      // 确保 final 时所有文本都被提交
      commitText = this.pendingText;
      // 如果有 tail buffer，也包含进去
      if (this.tailBuffer) {
        commitText = this.tailBuffer + commitText;
        this.tailBuffer = '';
      }
      
      this.pendingText = '';
      this.lastCommitTsMs = nowMs;
      this.metrics.commitCount++;
      // S1/S2: 更新最近提交的文本
      this.contextManager.updateRecentCommittedText(commitText);
      this.contextManager.setLastCommitQuality(qualityScore);
      // 标记为应该提交
      shouldCommitNow = true;
      
      // 提交后，清空合并组相关标志和累积时长
      // 如果收到手动发送/3秒静音标识，清空合并组状态，下一个utterance将是NEW_STREAM
      if (this.mergeGroupStartUtterance) {
        logger.info(  // 改为 info 级别，确保输出
          {
            text: commitText.substring(0, 50),
            mergeGroupStartText: this.mergeGroupStartUtterance.text.substring(0, 50),
            accumulatedDurationMs: this.accumulatedAudioDurationMs,
            commitTextLength: commitText.length,
            commitByManualCut,
            commitByTimeout,
          },
          'AggregatorState: Clearing mergeGroupStartUtterance after commit'
        );
      }
      // 清空合并组状态（无论是否有mergeGroupStartUtterance）
      this.mergeGroupStartUtterance = null;
      this.mergeGroupStartTimeMs = 0;
      this.accumulatedAudioDurationMs = 0;
    }

    // 新逻辑：判断是否是合并组中的最后一个
    // 如果是 MERGE 且触发提交，则当前 utterance 是最后一个
    // 提交可能由以下条件触发：
    // 1. 手动发送（commitByManualCut）
    // 2. 10秒超时（commitByTimeout）
    // 3. 原有提交条件（shouldCommit 函数返回 true）
    // 4. isFinal（最终结果）
    // isLastInMergedGroup 已经在上面根据 shouldCommitNow 设置
    
    // 添加调试日志
    if (action === 'MERGE') {
      logger.info(  // 改为 info 级别，确保日志输出
        {
          text: text.substring(0, 50),
          isLastInMergedGroup,
          shouldCommitNow,
          commitByManualCut,
          commitByTimeout,
          hasCommitText: !!commitText,
          commitTextLength: commitText.length,
        },
        'AggregatorState: MERGE action, isLastInMergedGroup determination'
      );
    }
    
    return {
      text: commitText,
      shouldCommit: shouldCommitNow,
      action,
      isFirstInMergedGroup: action === 'MERGE' ? isFirstInMergedGroup : undefined,  // 保留用于兼容
      isLastInMergedGroup: action === 'MERGE' ? isLastInMergedGroup : undefined,  // 新逻辑
      metrics: {
        dedupCount: deduped ? 1 : 0,
        dedupCharsRemoved: dedupChars,
      },
    };
  }

  /**
   * 强制 flush（stop/leave 时调用）
   */
  flush(): string {
    let textToFlush = '';
    
    if (this.pendingText) {
      // flush 时不保留 tail，全部输出
      textToFlush = this.pendingText;
      if (this.tailBuffer) {
        textToFlush = this.tailBuffer + textToFlush;
        this.tailBuffer = '';
      }
      this.pendingText = '';
      this.lastCommitTsMs = Date.now();
      this.metrics.commitCount++;
    } else if (this.tailBuffer) {
      // 如果只有 tail buffer，也输出
      textToFlush = this.tailBuffer;
      this.tailBuffer = '';
      this.metrics.commitCount++;
    }

    return textToFlush;
  }


  /**
   * 获取指标
   */
  getMetrics(): AggregatorMetrics {
    return { ...this.metrics };
  }

  /**
   * 重置状态（用于测试或会话重启）
   */
  reset(): void {
    this.pendingText = '';
    this.lastUtterance = null;
    this.lastCommitTsMs = Date.now();
    this.tailBuffer = '';
    this.sessionStartTimeMs = 0;
    this.lastUtteranceEndTimeMs = 0;
    this.accumulatedAudioDurationMs = 0;
    this.metrics = {
      commitCount: 0,
      mergeCount: 0,
      newStreamCount: 0,
      dedupCount: 0,
      dedupCharsRemoved: 0,
      tailCarryUsage: 0,
      veryShortUttRate: 0,
      missingGapCount: 0,
      commitLatencyMs: 0,
    };
    // 清理翻译文本和上下文缓存
    this.contextManager.clearContext();
  }
  
  /**
   * 获取上一个 utterance 的翻译文本（检查是否过期）
   */
  getLastTranslatedText(): string | null {
    return this.contextManager.getLastTranslatedText();
  }
  
  /**
   * 设置上一个 utterance 的翻译文本
   */
  setLastTranslatedText(translatedText: string): void {
    this.contextManager.setLastTranslatedText(translatedText);
  }
  
  /**
   * 清理翻译文本（NEW_STREAM 时可选调用）
   */
  clearLastTranslatedText(): void {
    this.contextManager.clearLastTranslatedText();
  }

  /**
   * S1/S2: 获取最近提交的文本
   */
  getRecentCommittedText(): string[] {
    return this.contextManager.getRecentCommittedText();
  }

  /**
   * S1/S2: 获取最近关键词
   */
  getRecentKeywords(): string[] {
    return this.contextManager.getRecentKeywords();
  }

  /**
   * S1/S2: 设置用户关键词
   */
  setUserKeywords(keywords: string[]): void {
    this.contextManager.setUserKeywords(keywords);
  }

  /**
   * S1/S2: 更新关键词（从最近文本中提取）
   */
  updateKeywordsFromRecent(): void {
    this.contextManager.updateKeywordsFromRecent();
  }

  /**
   * S1/S2: 获取上一次提交的质量分数
   */
  getLastCommitQuality(): number | undefined {
    return this.contextManager.getLastCommitQuality();
  }
}

