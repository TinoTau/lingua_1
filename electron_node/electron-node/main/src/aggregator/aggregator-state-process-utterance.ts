/**
 * Aggregator State: processUtterance 核心逻辑（从 aggregator-state.ts 迁出）
 * 仅迁移实现，不改变接口与逻辑。
 */

import {
  StreamAction,
  UtteranceInfo,
} from './aggregator-decision';
import { SegmentInfo } from '../task-router/types';
import logger from '../logger';
import type { AggregatorStateTextProcessor } from './aggregator-state-text-processor';
import type { AggregatorStateMergeGroupManager } from './aggregator-state-merge-group-manager';
import type { AggregatorStateCommitHandler } from './aggregator-state-commit-handler';
import type { AggregatorStateUtteranceProcessor } from './aggregator-state-utterance-processor';
import type { AggregatorStateActionDecider } from './aggregator-state-action-decider';
import type { AggregatorStatePendingManager } from './aggregator-state-pending-manager';
import type { AggregatorStateCommitExecutor } from './aggregator-state-commit-executor';
import { runCommitAndGetStateUpdate } from './aggregator-state-transitions';
import type { AggregatorMetrics, AggregatorCommitResult } from './aggregator-state';

export interface ProcessUtteranceStateSnapshot {
  sessionStartTimeMs: number;
  lastUtteranceEndTimeMs: number;
  lastUtterance: UtteranceInfo | null;
  pendingText: string;
  tailBuffer: string;
  lastCommitTsMs: number;
  mergeGroupStartUtterance: UtteranceInfo | null;
  mergeGroupStartTimeMs: number;
  accumulatedAudioDurationMs: number;
  metrics: AggregatorMetrics;
}

export interface ProcessUtteranceStateUpdate {
  sessionStartTimeMs: number;
  lastUtteranceEndTimeMs: number;
  lastUtterance: UtteranceInfo | null;
  pendingText: string;
  tailBuffer: string;
  lastCommitTsMs: number;
  mergeGroupStartUtterance: UtteranceInfo | null;
  mergeGroupStartTimeMs: number;
  accumulatedAudioDurationMs: number;
  metrics: AggregatorMetrics;
}

export interface ProcessUtteranceHandlers {
  utteranceProcessor: AggregatorStateUtteranceProcessor;
  actionDecider: AggregatorStateActionDecider;
  mergeGroupManager: AggregatorStateMergeGroupManager;
  textProcessor: AggregatorStateTextProcessor;
  pendingManager: AggregatorStatePendingManager;
  commitHandler: AggregatorStateCommitHandler;
  commitExecutor: AggregatorStateCommitExecutor;
}

export function processOneUtterance(
  text: string,
  segments: SegmentInfo[] | undefined,
  langProbs: { top1: string; p1: number; top2?: string; p2?: number },
  qualityScore: number | undefined,
  isFinal: boolean,
  isManualCut: boolean,
  isTimeoutTriggered: boolean,
  state: ProcessUtteranceStateSnapshot,
  handlers: ProcessUtteranceHandlers
): { result: AggregatorCommitResult; stateUpdate: ProcessUtteranceStateUpdate } {
  const nowMs = Date.now();
  const {
    utteranceProcessor,
    actionDecider,
    mergeGroupManager,
    textProcessor,
    pendingManager,
    commitHandler,
    commitExecutor,
  } = handlers;

  let sessionStartTimeMs = state.sessionStartTimeMs;
  let pendingText = state.pendingText;
  let tailBuffer = state.tailBuffer;
  const metrics = { ...state.metrics };
  let mergeGroupStartUtterance = state.mergeGroupStartUtterance;
  let mergeGroupStartTimeMs = state.mergeGroupStartTimeMs;
  let accumulatedAudioDurationMs = state.accumulatedAudioDurationMs;

  const utteranceResult = utteranceProcessor.processUtterance(
    text,
    segments,
    langProbs,
    qualityScore,
    isFinal,
    isManualCut,
    isTimeoutTriggered,
    sessionStartTimeMs,
    state.lastUtteranceEndTimeMs
  );

  const curr = utteranceResult.utteranceInfo;
  const startMs = utteranceResult.utteranceTime.startMs;
  const endMs = utteranceResult.utteranceTime.endMs;
  const gapMs = utteranceResult.utteranceTime.gapMs;

  if (utteranceResult.utteranceTime.newSessionStartTimeMs !== sessionStartTimeMs) {
    sessionStartTimeMs = utteranceResult.utteranceTime.newSessionStartTimeMs;
  }

  if (utteranceResult.hasMissingSegments) {
    metrics.missingGapCount++;
  }

  const action = actionDecider.decideAction(state.lastUtterance, curr);

  if (action === 'MERGE') {
    metrics.mergeCount++;
  } else {
    metrics.newStreamCount++;
  }

  const currentMergeGroupState = mergeGroupManager.getState();
  const isFirstInMergedGroup = mergeGroupManager.checkIsFirstInMergedGroup(
    action,
    pendingText,
    state.lastUtterance
  );

  if (action === 'MERGE') {
    logger.info(
      {
        text: text.substring(0, 50),
        pendingText: pendingText.substring(0, 50),
        hasMergeGroupStart: currentMergeGroupState.mergeGroupStartUtterance !== null,
        hasLastUtterance: state.lastUtterance !== null,
        lastUtteranceText: state.lastUtterance?.text.substring(0, 50),
        isFirstInMergedGroup,
      },
      'AggregatorState: MERGE action, checking isFirstInMergedGroup'
    );
  }

  const textProcessResult = textProcessor.processText(
    action,
    utteranceResult.processedText,
    state.lastUtterance,
    tailBuffer
  );
  const processedText = textProcessResult.processedText;
  let deduped = textProcessResult.deduped;
  let dedupChars = textProcessResult.dedupChars;

  if (deduped) {
    metrics.dedupCount++;
    metrics.dedupCharsRemoved += dedupChars;
  }
  if (textProcessResult.tailBufferCleared) {
    tailBuffer = '';
    metrics.tailCarryUsage++;
  }

  const previousPendingText = action === 'NEW_STREAM' ? pendingText : '';

  let pendingUpdateResult: { newPendingText: string; newTailBuffer: string; mergeGroupStateSynced: boolean };
  if (action === 'MERGE' && state.lastUtterance) {
    pendingUpdateResult = pendingManager.handleMerge(
      processedText,
      pendingText,
      curr,
      startMs,
      endMs,
      isFirstInMergedGroup
    );
  } else {
    pendingUpdateResult = pendingManager.handleNewStream(
      processedText,
      pendingText,
      tailBuffer
    );

    if (previousPendingText && previousPendingText.trim().length > 0) {
      const previousMergeGroupState = mergeGroupManager.getState();
      const previousCommitDecision = commitHandler.decideCommit(
        'NEW_STREAM',
        previousPendingText,
        state.lastCommitTsMs,
        nowMs,
        previousMergeGroupState.mergeGroupStartTimeMs,
        isFinal,
        isManualCut,
        isTimeoutTriggered
      );

      const shouldCommitPrevious = previousCommitDecision.commitByManualCut ||
        previousCommitDecision.commitByTimeout || isFinal;
      if (shouldCommitPrevious) {
        const previousCommitResult = commitExecutor.executeCommit(
          previousPendingText,
          tailBuffer,
          isFinal,
          isManualCut,
          qualityScore,
          gapMs,
          previousCommitDecision.commitByManualCut,
          previousCommitDecision.commitByTimeout
        );
        const previousCommitText = previousCommitResult.commitText;
        if (previousCommitText && previousCommitText.trim().length > 0) {
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

  pendingText = pendingUpdateResult.newPendingText;
  tailBuffer = pendingUpdateResult.newTailBuffer;

  if (pendingUpdateResult.mergeGroupStateSynced) {
    const syncedState = pendingManager.syncMergeGroupState();
    mergeGroupStartUtterance = syncedState.mergeGroupStartUtterance;
    mergeGroupStartTimeMs = syncedState.mergeGroupStartTimeMs;
    accumulatedAudioDurationMs = syncedState.accumulatedAudioDurationMs;
  }

  const lastUtterance = curr;
  const lastUtteranceEndTimeMs = endMs;
  if (sessionStartTimeMs === 0) {
    sessionStartTimeMs = startMs;
  }

  const mergeGroupState = mergeGroupManager.getState();
  const commitDecision = commitHandler.decideCommit(
    action,
    pendingText,
    state.lastCommitTsMs,
    nowMs,
    mergeGroupState.mergeGroupStartTimeMs,
    isFinal,
    isManualCut,
    isTimeoutTriggered
  );

  const isLastInMergedGroup = commitDecision.isLastInMergedGroup;
  const commitByManualCut = commitDecision.commitByManualCut;
  const commitByTimeout = commitDecision.commitByTimeout;
  const shouldCommitNow = commitByManualCut || commitByTimeout || isFinal;

  if (commitByManualCut && action === 'MERGE') {
    mergeGroupManager.clearMergeGroup();
    const newState = mergeGroupManager.getState();
    mergeGroupStartUtterance = newState.mergeGroupStartUtterance;
    mergeGroupStartTimeMs = newState.mergeGroupStartTimeMs;
    accumulatedAudioDurationMs = newState.accumulatedAudioDurationMs;
  }

  commitHandler.logCommitDecision(
    action,
    text,
    commitDecision,
    gapMs,
    accumulatedAudioDurationMs,
    mergeGroupState.mergeGroupStartTimeMs,
    pendingText.length,
    state.lastCommitTsMs,
    nowMs,
    isFinal,
    isManualCut
  );

  if (metrics.commitCount === 0 && shouldCommitNow) {
    metrics.commitLatencyMs = nowMs - sessionStartTimeMs;
  }

  let commitText = '';
  let lastCommitTsMs = state.lastCommitTsMs;
  const shouldRunCommit = (shouldCommitNow && pendingText) || (isFinal && pendingText);
  if (shouldRunCommit) {
    const update = runCommitAndGetStateUpdate(
      commitExecutor,
      pendingText,
      tailBuffer,
      isFinal,
      isManualCut,
      qualityScore,
      gapMs,
      commitByManualCut,
      commitByTimeout
    );
    commitText = update.commitText;
    tailBuffer = update.newTailBuffer;
    if (update.tailCarryUsed) {
      metrics.tailCarryUsage++;
    }
    pendingText = '';
    lastCommitTsMs = nowMs;
    metrics.commitCount++;
    mergeGroupStartUtterance = update.syncedState.mergeGroupStartUtterance;
    mergeGroupStartTimeMs = update.syncedState.mergeGroupStartTimeMs;
    accumulatedAudioDurationMs = update.syncedState.accumulatedAudioDurationMs;
  }

  if (action === 'MERGE') {
    logger.info(
      {
        text: text.substring(0, 50),
        isLastInMergedGroup,
        commitByManualCut,
        commitByTimeout,
        isFinal,
        hasCommitText: !!commitText,
        commitTextLength: commitText.length,
      },
      'AggregatorState: MERGE action, isLastInMergedGroup determination'
    );
  }

  return {
    result: {
      text: commitText,
      action,
      isFirstInMergedGroup: action === 'MERGE' ? isFirstInMergedGroup : undefined,
      isLastInMergedGroup: action === 'MERGE' ? isLastInMergedGroup : undefined,
      metrics: {
        dedupCount: deduped ? 1 : 0,
        dedupCharsRemoved: dedupChars,
      },
    },
    stateUpdate: {
      sessionStartTimeMs,
      lastUtteranceEndTimeMs,
      lastUtterance,
      pendingText,
      tailBuffer,
      lastCommitTsMs,
      mergeGroupStartUtterance,
      mergeGroupStartTimeMs,
      accumulatedAudioDurationMs,
      metrics,
    },
  };
}
