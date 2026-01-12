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
} from './aggregator-decision';
import { DEFAULT_DEDUP_CONFIG, DedupConfig } from './dedup';
import { DEFAULT_TAIL_CARRY_CONFIG, TailCarryConfig } from './tail-carry';
import { SegmentInfo } from '../task-router/types';
import logger from '../logger';
import { AggregatorStateContextManager } from './aggregator-state-context';
import { AggregatorStateTextProcessor } from './aggregator-state-text-processor';
import { AggregatorStateMergeGroupManager } from './aggregator-state-merge-group-manager';
import { AggregatorStateCommitHandler } from './aggregator-state-commit-handler';
import { AggregatorStateUtteranceProcessor } from './aggregator-state-utterance-processor';
import { AggregatorStateActionDecider } from './aggregator-state-action-decider';
import { AggregatorStatePendingManager } from './aggregator-state-pending-manager';
import { AggregatorStateCommitExecutor } from './aggregator-state-commit-executor';

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
  
  // 会话时间轴
  private sessionStartTimeMs: number = 0;
  private lastUtteranceEndTimeMs: number = 0;
  
  // 合并组状态（由 mergeGroupManager 管理，这里保留用于向后兼容和状态同步）
  private mergeGroupStartUtterance: UtteranceInfo | null = null;
  private mergeGroupStartTimeMs: number = 0;
  private accumulatedAudioDurationMs: number = 0;
  
  // 上下文管理器
  private contextManager: AggregatorStateContextManager;
  
  // 处理器
  private textProcessor: AggregatorStateTextProcessor;
  private mergeGroupManager: AggregatorStateMergeGroupManager;
  private commitHandler: AggregatorStateCommitHandler;
  private utteranceProcessor: AggregatorStateUtteranceProcessor;
  private actionDecider: AggregatorStateActionDecider;
  private pendingManager: AggregatorStatePendingManager;
  private commitExecutor: AggregatorStateCommitExecutor;
  
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
    this.textProcessor = new AggregatorStateTextProcessor(
      this.dedupConfig,
      this.tailCarryConfig
    );
    this.mergeGroupManager = new AggregatorStateMergeGroupManager();
    this.commitHandler = new AggregatorStateCommitHandler(
      this.mode,
      this.tuning,
      this.tailCarryConfig
    );
    this.utteranceProcessor = new AggregatorStateUtteranceProcessor();
    this.actionDecider = new AggregatorStateActionDecider(this.mode, this.tuning);
    this.pendingManager = new AggregatorStatePendingManager(
      this.tailCarryConfig,
      this.mergeGroupManager
    );
    this.commitExecutor = new AggregatorStateCommitExecutor(
      this.commitHandler,
      this.mergeGroupManager,
      this.contextManager
    );
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
    isTimeoutTriggered: boolean = false,
    hasPendingSecondHalfMerged: boolean = false
  ): AggregatorCommitResult {
    const nowMs = Date.now();
    
    // 使用 utterance 处理器进行预处理
    const utteranceResult = this.utteranceProcessor.processUtterance(
      text,
      segments,
      langProbs,
      qualityScore,
      isFinal,
      isManualCut,
      isPauseTriggered,
      isTimeoutTriggered,
      this.sessionStartTimeMs,
      this.lastUtteranceEndTimeMs
    );
    
    // 修复：如果合并了pendingSecondHalf，将标志传递给utteranceInfo
    if (hasPendingSecondHalfMerged) {
      (utteranceResult.utteranceInfo as any).hasPendingSecondHalfMerged = true;
    }
    
    const curr = utteranceResult.utteranceInfo;
    const startMs = utteranceResult.utteranceTime.startMs;
    const endMs = utteranceResult.utteranceTime.endMs;
    const gapMs = utteranceResult.utteranceTime.gapMs;
    
    // 更新会话开始时间
    if (utteranceResult.utteranceTime.newSessionStartTimeMs !== this.sessionStartTimeMs) {
      this.sessionStartTimeMs = utteranceResult.utteranceTime.newSessionStartTimeMs;
    }
    
    // 更新指标
    if (utteranceResult.hasMissingSegments) {
      this.metrics.missingGapCount++;
    }

    // 使用动作决策器决定流动作
    const action = this.actionDecider.decideAction(this.lastUtterance, curr);
    
    // 更新指标
    if (action === 'MERGE') {
      this.metrics.mergeCount++;
    } else {
      this.metrics.newStreamCount++;
    }

    // 使用合并组管理器判断是否是合并组的第一个
    const currentMergeGroupState = this.mergeGroupManager.getState();
    const isFirstInMergedGroup = this.mergeGroupManager.checkIsFirstInMergedGroup(
      action,
      this.pendingText,
      this.lastUtterance
    );
    
    // 添加调试日志
    if (action === 'MERGE') {
      logger.info(
        {
          text: text.substring(0, 50),
          pendingText: this.pendingText.substring(0, 50),
          hasMergeGroupStart: currentMergeGroupState.mergeGroupStartUtterance !== null,
          hasLastUtterance: this.lastUtterance !== null,
          lastUtteranceText: this.lastUtterance?.text.substring(0, 50),
          isFirstInMergedGroup,
        },
        'AggregatorState: MERGE action, checking isFirstInMergedGroup'
      );
    }
    
    // 使用文本处理器处理文本合并和去重
    const textProcessResult = this.textProcessor.processText(
      action,
      utteranceResult.processedText,
      this.lastUtterance,
      this.tailBuffer
    );
    const processedText = textProcessResult.processedText;
    let deduped = textProcessResult.deduped;
    let dedupChars = textProcessResult.dedupChars;
    
    // 更新指标
    if (deduped) {
      this.metrics.dedupCount++;
      this.metrics.dedupCharsRemoved += dedupChars;
    }
    if (textProcessResult.tailBufferCleared) {
      this.tailBuffer = '';
      this.metrics.tailCarryUsage++;
    }
    
    // 使用 pending manager 处理文本合并和状态管理
    // 修复：在NEW_STREAM时，先保存之前的pendingText，用于提交
    const previousPendingText = action === 'NEW_STREAM' ? this.pendingText : '';
    
    let pendingUpdateResult: { newPendingText: string; newTailBuffer: string; mergeGroupStateSynced: boolean };
    if (action === 'MERGE' && this.lastUtterance) {
      pendingUpdateResult = this.pendingManager.handleMerge(
        processedText,
        this.pendingText,
        curr,
        startMs,
        endMs,
        isFirstInMergedGroup
      );
    } else {
      pendingUpdateResult = this.pendingManager.handleNewStream(
        processedText,
        this.pendingText,
        this.tailBuffer
      );
      
      // 修复：在NEW_STREAM时，如果之前的pendingText存在，先提交之前的文本
      // 这样可以确保之前的文本被记录到recentCommittedText中，用于去重
      if (previousPendingText && previousPendingText.trim().length > 0) {
        // 使用临时提交处理器判断是否需要提交之前的文本
        const previousMergeGroupState = this.mergeGroupManager.getState();
        const previousCommitDecision = this.commitHandler.decideCommit(
          'NEW_STREAM',
          previousPendingText,
          this.lastCommitTsMs,
          nowMs,
          previousMergeGroupState.mergeGroupStartTimeMs,
          isFinal,
          isManualCut,
          isPauseTriggered,
          isTimeoutTriggered
        );
        
        // 如果之前的文本应该提交，先提交它
        if (previousCommitDecision.shouldCommit) {
          const previousCommitResult = this.commitExecutor.executeCommit(
            previousPendingText,
            this.tailBuffer,
            isFinal,
            isManualCut,
            qualityScore,
            gapMs,
            previousCommitDecision.commitByManualCut,
            previousCommitDecision.commitByTimeout
          );
          const previousCommitText = previousCommitResult.commitText;
          if (previousCommitText && previousCommitText.trim().length > 0) {
            // 更新上下文（记录到recentCommittedText，用于去重）
            this.contextManager.updateRecentCommittedText(previousCommitText);
            logger.info(
              {
                text: previousCommitText.substring(0, 50),
                textLength: previousCommitText.length,
                action: 'NEW_STREAM',
                reason: 'Committed previous pendingText before starting new stream, for deduplication',
              },
              'AggregatorState: Committed previous pendingText in NEW_STREAM for deduplication'
            );
          }
        }
      }
    }
    
    // 更新 pending text 和 tail buffer
    this.pendingText = pendingUpdateResult.newPendingText;
    this.tailBuffer = pendingUpdateResult.newTailBuffer;
    
    // 同步合并组状态
    if (pendingUpdateResult.mergeGroupStateSynced) {
      const syncedState = this.pendingManager.syncMergeGroupState();
      this.mergeGroupStartUtterance = syncedState.mergeGroupStartUtterance;
      this.mergeGroupStartTimeMs = syncedState.mergeGroupStartTimeMs;
      this.accumulatedAudioDurationMs = syncedState.accumulatedAudioDurationMs;
    }

    // 更新状态
    this.lastUtterance = curr;
    this.lastUtteranceEndTimeMs = endMs;
    if (this.sessionStartTimeMs === 0) {
      this.sessionStartTimeMs = startMs;
    }

    // 使用提交处理器判断是否需要提交
    const mergeGroupState = this.mergeGroupManager.getState();
    const commitDecision = this.commitHandler.decideCommit(
      action,
      this.pendingText,
      this.lastCommitTsMs,
      nowMs,
      mergeGroupState.mergeGroupStartTimeMs,
      isFinal,
      isManualCut,
      isPauseTriggered,
      isTimeoutTriggered
    );
    
    let shouldCommitNow = commitDecision.shouldCommit;
    const isLastInMergedGroup = commitDecision.isLastInMergedGroup;
    const commitByManualCut = commitDecision.commitByManualCut;
    const commitByTimeout = commitDecision.commitByTimeout;
    
    // 如果收到手动发送/3秒静音标识，清空合并组状态
    if (commitByManualCut && action === 'MERGE') {
      this.mergeGroupManager.clearMergeGroup();
      // 同步状态
      const newState = this.mergeGroupManager.getState();
      this.mergeGroupStartUtterance = newState.mergeGroupStartUtterance;
      this.mergeGroupStartTimeMs = newState.mergeGroupStartTimeMs;
      this.accumulatedAudioDurationMs = newState.accumulatedAudioDurationMs;
    }
    
    // 记录提交条件的判断（用于调试）
    this.commitHandler.logCommitDecision(
      action,
      text,
      commitDecision,
      gapMs,
      this.accumulatedAudioDurationMs,
      mergeGroupState.mergeGroupStartTimeMs,
      this.pendingText.length,
      this.lastCommitTsMs,
      nowMs,
      isFinal,
      isManualCut
    );

    // 计算首次输出延迟
    if (this.metrics.commitCount === 0 && shouldCommitNow) {
      this.metrics.commitLatencyMs = nowMs - this.sessionStartTimeMs;
    }

    // 如果需要 commit，使用提交执行器执行提交
    let commitText = '';
    if (shouldCommitNow && this.pendingText) {
      const commitResult = this.commitExecutor.executeCommit(
        this.pendingText,
        this.tailBuffer,
        isFinal,
        isManualCut,
        qualityScore,
        gapMs,
        commitByManualCut,
        commitByTimeout
      );
      commitText = commitResult.commitText;
      this.tailBuffer = commitResult.newTailBuffer;
      if (commitResult.tailCarryUsed) {
        this.metrics.tailCarryUsage++;
      }
      
      this.pendingText = '';
      this.lastCommitTsMs = nowMs;
      this.metrics.commitCount++;
      
      // 同步合并组状态
      const syncedState = this.commitExecutor.syncMergeGroupState();
      this.mergeGroupStartUtterance = syncedState.mergeGroupStartUtterance;
      this.mergeGroupStartTimeMs = syncedState.mergeGroupStartTimeMs;
      this.accumulatedAudioDurationMs = syncedState.accumulatedAudioDurationMs;
    } else if (isFinal && this.pendingText) {
      // 如果是 final 但没有触发 commit（可能是因为 pending 文本太短），强制提交
      // 确保 final 时所有文本都被提交
      const commitResult = this.commitExecutor.executeCommit(
        this.pendingText,
        this.tailBuffer,
        true, // isFinal
        isManualCut,
        qualityScore,
        gapMs,
        commitByManualCut,
        commitByTimeout
      );
      commitText = commitResult.commitText;
      this.tailBuffer = commitResult.newTailBuffer;
      if (commitResult.tailCarryUsed) {
        this.metrics.tailCarryUsage++;
      }
      
      this.pendingText = '';
      this.lastCommitTsMs = nowMs;
      this.metrics.commitCount++;
      // 标记为应该提交
      shouldCommitNow = true;
      
      // 同步合并组状态
      const syncedState = this.commitExecutor.syncMergeGroupState();
      this.mergeGroupStartUtterance = syncedState.mergeGroupStartUtterance;
      this.mergeGroupStartTimeMs = syncedState.mergeGroupStartTimeMs;
      this.accumulatedAudioDurationMs = syncedState.accumulatedAudioDurationMs;
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
    // 重置合并组状态
    this.mergeGroupManager.reset();
    // 同步状态
    const newState = this.mergeGroupManager.getState();
    this.mergeGroupStartUtterance = newState.mergeGroupStartUtterance;
    this.mergeGroupStartTimeMs = newState.mergeGroupStartTimeMs;
    this.accumulatedAudioDurationMs = newState.accumulatedAudioDurationMs;
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

