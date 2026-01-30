/**
 * Aggregator State Commit Handler
 * 处理提交逻辑（判断何时提交、提取文本等）
 */

import { Mode, AggregatorTuning } from './aggregator-decision';
import { extractTail, removeTail, TailCarryConfig } from './tail-carry';
import logger from '../logger';

export interface CommitDecision {
  commitByManualCut: boolean;
  commitByTimeout: boolean;
  isLastInMergedGroup: boolean;
}

export interface CommitTextResult {
  commitText: string;
  newTailBuffer: string;
  tailCarryUsed: boolean;
}

export class AggregatorStateCommitHandler {
  private readonly TIMEOUT_THRESHOLD_MS = 10000;  // 10秒

  constructor(
    private mode: Mode,
    private tuning: AggregatorTuning,
    private tailCarryConfig: TailCarryConfig
  ) {}

  /**
   * 判断是否需要提交
   */
  decideCommit(
    action: 'MERGE' | 'NEW_STREAM',
    pendingText: string,
    lastCommitTsMs: number,
    nowMs: number,
    mergeGroupStartTimeMs: number,
    isFinal: boolean,
    isManualCut: boolean,
    isTimeoutTriggered: boolean
  ): CommitDecision {
    // 1. 手动发送触发：用户点击发送按钮，立即处理并强制提交
    const commitByManualCut = isManualCut;
    
    // 2. 10秒超时触发：从NEW_STREAM开始计时，如果超过10秒，自动提交
    const commitByTimeout = isTimeoutTriggered || 
      (action === 'MERGE' && mergeGroupStartTimeMs > 0 && 
       (nowMs - mergeGroupStartTimeMs) >= this.TIMEOUT_THRESHOLD_MS);
    
    let isLastInMergedGroup = false;
    
    // 判断是否需要提交：手动发送、10秒超时、或最终结果
    const shouldCommit = commitByManualCut || commitByTimeout || isFinal;
    
    if (commitByManualCut && action === 'MERGE') {
      // 强制提交当前合并组
      isLastInMergedGroup = true;
    } else if (action === 'MERGE' && shouldCommit) {
      // 如果是MERGE且触发提交，标记为合并组的最后一个
      isLastInMergedGroup = true;
    }

    return {
      commitByManualCut,
      commitByTimeout,
      isLastInMergedGroup,
    };
  }

  /**
   * 提取提交文本（处理tail buffer）
   */
  extractCommitText(
    pendingText: string,
    tailBuffer: string,
    isFinal: boolean,
    isManualCut: boolean
  ): CommitTextResult {
    let commitText = '';
    let newTailBuffer = tailBuffer;
    let tailCarryUsed = false;

    if (isFinal || isManualCut) {
      // 如果是 isFinal，不保留 tail，全部输出（确保完整）
      commitText = pendingText;
      // 如果有 tail buffer，也包含进去
      if (tailBuffer) {
        commitText = tailBuffer + commitText;
        newTailBuffer = '';
      }
    } else {
      // 非 final，保留 tail
      commitText = removeTail(pendingText, this.tailCarryConfig);
      const tail = extractTail(pendingText, this.tailCarryConfig);
      if (tail) {
        newTailBuffer = tail;
        tailCarryUsed = true;
      }
    }

    return {
      commitText,
      newTailBuffer,
      tailCarryUsed,
    };
  }

  /**
   * 记录提交条件的判断（用于调试）
   */
  logCommitDecision(
    action: 'MERGE' | 'NEW_STREAM',
    text: string,
    decision: CommitDecision,
    gapMs: number,
    accumulatedAudioDurationMs: number,
    mergeGroupStartTimeMs: number,
    pendingTextLength: number,
    lastCommitTsMs: number,
    nowMs: number,
    isFinal: boolean,
    isManualCut: boolean
  ): void {
    if (action === 'MERGE') {
      logger.info(
        {
          text: text.substring(0, 50),
          commitByManualCut: decision.commitByManualCut,
          commitByTimeout: decision.commitByTimeout,
          gapMs,
          accumulatedAudioDurationMs,
          mergeGroupStartTimeMs,
          timeSinceMergeGroupStart: mergeGroupStartTimeMs > 0 ? (nowMs - mergeGroupStartTimeMs) : 0,
          pendingTextLength,
          lastCommitTsMs,
          nowMs,
          elapsedSinceLastCommit: nowMs - lastCommitTsMs,
          isFinal,
          isManualCut,
        },
        'AggregatorStateCommitHandler: MERGE action, checking commit conditions'
      );
    }
  }
}
