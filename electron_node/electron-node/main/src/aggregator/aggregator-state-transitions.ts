/**
 * Aggregator State 状态转换：commit 分支执行与状态更新结果
 * 从 aggregator-state.ts 迁出，仅迁移实现，不新增逻辑与调用路径。
 */

import type { AggregatorStateCommitExecutor } from './aggregator-state-commit-executor';
import type { MergeGroupState } from './aggregator-state-merge-group-manager';

export interface CommitBranchResult {
  commitText: string;
  newTailBuffer: string;
  tailCarryUsed: boolean;
  syncedState: MergeGroupState;
}

/**
 * 执行一次 commit（executeCommit + syncMergeGroupState），返回需写回 state 的结果
 */
export function runCommitAndGetStateUpdate(
  commitExecutor: AggregatorStateCommitExecutor,
  pendingText: string,
  tailBuffer: string,
  isFinal: boolean,
  isManualCut: boolean,
  qualityScore: number | undefined,
  gapMs: number,
  commitByManualCut: boolean,
  commitByTimeout: boolean
): CommitBranchResult {
  const commitResult = commitExecutor.executeCommit(
    pendingText,
    tailBuffer,
    isFinal,
    isManualCut,
    qualityScore,
    gapMs,
    commitByManualCut,
    commitByTimeout
  );
  const syncedState = commitExecutor.syncMergeGroupState();
  return {
    commitText: commitResult.commitText,
    newTailBuffer: commitResult.newTailBuffer,
    tailCarryUsed: commitResult.tailCarryUsed,
    syncedState: {
      mergeGroupStartUtterance: syncedState.mergeGroupStartUtterance,
      mergeGroupStartTimeMs: syncedState.mergeGroupStartTimeMs,
      accumulatedAudioDurationMs: syncedState.accumulatedAudioDurationMs,
    },
  };
}
