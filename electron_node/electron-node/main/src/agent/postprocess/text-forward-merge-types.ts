/**
 * Text Forward Merge 公共类型
 * 供 TextForwardMergeManager 与 Gate 决策模块共用，避免循环依赖。
 */

import type { LengthDecisionConfig } from './text-forward-merge-length-decider';

export interface ForwardMergeResult {
  processedText: string;
  shouldDiscard: boolean;
  shouldWaitForMerge: boolean;
  shouldSendToSemanticRepair: boolean;
  deduped: boolean;
  dedupChars: number;
  mergedFromUtteranceIndex?: number;
  mergedFromPendingUtteranceIndex?: number;
  segmentForCurrentJob?: string;
}

export interface GateDecisionParams {
  mergedText: string;
  sessionId: string;
  jobId: string;
  utteranceIndex: number;
  isManualCut: boolean;
  nowMs: number;
  deduped: boolean;
  dedupChars: number;
  mergedFromUtteranceIndex?: number;
  mergedFromPendingUtteranceIndex?: number;
  prevCommittedLen?: number;
  lastSentLen?: number;
  lengthConfig: LengthDecisionConfig;
}

export interface PendingEntry {
  text: string;
  waitUntil: number;
  jobId: string;
  utteranceIndex: number;
}

export interface GateDecisionResult {
  action: 'DROP' | 'SEND' | 'HOLD';
  result: ForwardMergeResult;
  pendingEntry?: PendingEntry;
}
