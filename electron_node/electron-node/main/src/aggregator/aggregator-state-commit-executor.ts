/**
 * Aggregator State Commit Executor
 * 执行提交操作：提取文本、更新上下文、清空合并组状态等
 */

import { AggregatorStateCommitHandler } from './aggregator-state-commit-handler';
import { AggregatorStateMergeGroupManager } from './aggregator-state-merge-group-manager';
import { AggregatorStateContextManager } from './aggregator-state-context';
import logger from '../logger';

export interface CommitExecutionResult {
  commitText: string;
  newTailBuffer: string;
  tailCarryUsed: boolean;
}

export class AggregatorStateCommitExecutor {
  constructor(
    private commitHandler: AggregatorStateCommitHandler,
    private mergeGroupManager: AggregatorStateMergeGroupManager,
    private contextManager: AggregatorStateContextManager
  ) {}

  /**
   * 执行提交操作
   */
  executeCommit(
    pendingText: string,
    tailBuffer: string,
    isFinal: boolean,
    isManualCut: boolean,
    qualityScore: number | undefined,
    gapMs: number,
    commitByManualCut: boolean,
    commitByTimeout: boolean
  ): CommitExecutionResult {
    // 使用提交处理器提取文本
    const commitTextResult = this.commitHandler.extractCommitText(
      pendingText,
      tailBuffer,
      isFinal,
      isManualCut
    );

    // 注意：不再在聚合阶段更新recentCommittedText
    // 只在语义修复后更新，确保recentCommittedText中只包含最终提交的文本
    this.contextManager.setLastCommitQuality(qualityScore);

    // 清空合并组状态
    const mergeGroupStateBeforeClear = this.mergeGroupManager.getState();
    if (mergeGroupStateBeforeClear.mergeGroupStartUtterance) {
      logger.info(
        {
          text: commitTextResult.commitText.substring(0, 50),
          mergeGroupStartText: mergeGroupStateBeforeClear.mergeGroupStartUtterance.text.substring(0, 50),
          accumulatedDurationMs: mergeGroupStateBeforeClear.accumulatedAudioDurationMs,
          commitByManualCut: commitByManualCut,
          commitByTimeout: commitByTimeout,
          gapMs: gapMs,
          commitTextLength: commitTextResult.commitText.length,
        },
        'AggregatorStateCommitExecutor: Clearing mergeGroupStartUtterance after commit'
      );
    }
    this.mergeGroupManager.clearMergeGroup();

    return {
      commitText: commitTextResult.commitText,
      newTailBuffer: commitTextResult.newTailBuffer,
      tailCarryUsed: commitTextResult.tailCarryUsed,
    };
  }

  /**
   * 同步合并组状态（从 manager 同步到外部状态）
   */
  syncMergeGroupState(): {
    mergeGroupStartUtterance: any | null;
    mergeGroupStartTimeMs: number;
    accumulatedAudioDurationMs: number;
  } {
    const state = this.mergeGroupManager.getState();
    return {
      mergeGroupStartUtterance: state.mergeGroupStartUtterance,
      mergeGroupStartTimeMs: state.mergeGroupStartTimeMs,
      accumulatedAudioDurationMs: state.accumulatedAudioDurationMs,
    };
  }
}
