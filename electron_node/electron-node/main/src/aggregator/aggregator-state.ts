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
import { AggregatorStateContextManager } from './aggregator-state-context';
import { AggregatorStateTextProcessor } from './aggregator-state-text-processor';
import { AggregatorStateMergeGroupManager } from './aggregator-state-merge-group-manager';
import { AggregatorStateCommitHandler } from './aggregator-state-commit-handler';
import { AggregatorStateUtteranceProcessor } from './aggregator-state-utterance-processor';
import { AggregatorStateActionDecider } from './aggregator-state-action-decider';
import { AggregatorStatePendingManager } from './aggregator-state-pending-manager';
import { AggregatorStateCommitExecutor } from './aggregator-state-commit-executor';
import { processOneUtterance } from './aggregator-state-process-utterance';

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
    isTimeoutTriggered: boolean = false
  ): AggregatorCommitResult {
    const { result, stateUpdate } = processOneUtterance(
      text,
      segments,
      langProbs,
      qualityScore,
      isFinal,
      isManualCut,
      isTimeoutTriggered,
      {
        sessionStartTimeMs: this.sessionStartTimeMs,
        lastUtteranceEndTimeMs: this.lastUtteranceEndTimeMs,
        lastUtterance: this.lastUtterance,
        pendingText: this.pendingText,
        tailBuffer: this.tailBuffer,
        lastCommitTsMs: this.lastCommitTsMs,
        mergeGroupStartUtterance: this.mergeGroupStartUtterance,
        mergeGroupStartTimeMs: this.mergeGroupStartTimeMs,
        accumulatedAudioDurationMs: this.accumulatedAudioDurationMs,
        metrics: this.metrics,
      },
      {
        utteranceProcessor: this.utteranceProcessor,
        actionDecider: this.actionDecider,
        mergeGroupManager: this.mergeGroupManager,
        textProcessor: this.textProcessor,
        pendingManager: this.pendingManager,
        commitHandler: this.commitHandler,
        commitExecutor: this.commitExecutor,
      }
    );
    this.sessionStartTimeMs = stateUpdate.sessionStartTimeMs;
    this.lastUtteranceEndTimeMs = stateUpdate.lastUtteranceEndTimeMs;
    this.lastUtterance = stateUpdate.lastUtterance;
    this.pendingText = stateUpdate.pendingText;
    this.tailBuffer = stateUpdate.tailBuffer;
    this.lastCommitTsMs = stateUpdate.lastCommitTsMs;
    this.mergeGroupStartUtterance = stateUpdate.mergeGroupStartUtterance;
    this.mergeGroupStartTimeMs = stateUpdate.mergeGroupStartTimeMs;
    this.accumulatedAudioDurationMs = stateUpdate.accumulatedAudioDurationMs;
    this.metrics = stateUpdate.metrics;
    return result;
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

  /**
   * 更新最后一个提交的文本（用于语义修复后更新）
   */
  updateLastCommittedTextAfterRepair(utteranceIndex: number, originalText: string, repairedText: string): void {
    this.contextManager.updateLastCommittedText(utteranceIndex, originalText, repairedText);
  }

  /**
   * 获取上一个utterance的已提交文本（用于NMT服务的context_text）
   */
  getLastCommittedText(currentUtteranceIndex: number): string | null {
    return this.contextManager.getLastCommittedText(currentUtteranceIndex);
  }
}

