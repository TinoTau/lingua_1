/**
 * Aggregator State Utterance Processor
 * 处理 utterance 的预处理：文本去重、时间戳计算、构建 UtteranceInfo
 */

import { UtteranceInfo } from './aggregator-decision';
import { detectInternalRepetition } from './dedup';
import { SegmentInfo } from '../task-router/types';
import { AggregatorStateUtils } from './aggregator-state-utils';

export interface UtteranceProcessResult {
  processedText: string;
  utteranceInfo: UtteranceInfo;
  utteranceTime: {
    startMs: number;
    endMs: number;
    gapMs: number;
    newSessionStartTimeMs: number;
  };
  hasMissingSegments: boolean;
}

export class AggregatorStateUtteranceProcessor {
  /**
   * 处理 utterance：去重、计算时间戳、构建 UtteranceInfo
   */
  processUtterance(
    text: string,
    segments: SegmentInfo[] | undefined,
    langProbs: { top1: string; p1: number; top2?: string; p2?: number },
    qualityScore: number | undefined,
    isFinal: boolean,
    isManualCut: boolean,
    isTimeoutTriggered: boolean,
    sessionStartTimeMs: number,
    lastUtteranceEndTimeMs: number
  ): UtteranceProcessResult {
    // 先检测并移除完全重复和内部重复
    const processedText = detectInternalRepetition(text);
    
    // 计算 utterance 的时间戳（从 segments 推导）
    const utteranceTime = AggregatorStateUtils.calculateUtteranceTime(
      segments,
      sessionStartTimeMs,
      lastUtteranceEndTimeMs
    );
    
    const hasMissingSegments = !segments || segments.length === 0;

    // 构建 UtteranceInfo
    const utteranceInfo: UtteranceInfo = {
      text: processedText,
      startMs: utteranceTime.startMs,
      endMs: utteranceTime.endMs,
      lang: {
        top1: langProbs.top1,
        p1: langProbs.p1,
        top2: langProbs.top2,
        p2: langProbs.p2,
      },
      qualityScore,
      isFinal,
      isManualCut,
      isTimeoutTriggered,
    } as any; // 临时使用any，因为UtteranceInfo接口需要更新

    return {
      processedText,
      utteranceInfo,
      utteranceTime,
      hasMissingSegments,
    };
  }
}
