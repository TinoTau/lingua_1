/**
 * Aggregator State Action Decider
 * 决定流动作：MERGE 还是 NEW_STREAM
 */

import { Mode, StreamAction, UtteranceInfo, AggregatorTuning, decideStreamAction } from './aggregator-decision';
import logger from '../logger';

export class AggregatorStateActionDecider {
  constructor(
    private mode: Mode,
    private tuning: AggregatorTuning
  ) {}

  /**
   * 决定流动作：merge 还是 new_stream
   * 关键逻辑：
   * 1. 如果上一个utterance有手动发送标识，当前应该是NEW_STREAM
   *    因为上一个utterance已经被强制提交，当前应该是新的流
   * 2. isPauseTriggered（3秒静音）不应该强制NEW_STREAM，因为这只是自然的停顿，应该允许正常决策
   */
  decideAction(
    lastUtterance: UtteranceInfo | null,
    currentUtterance: UtteranceInfo
  ): StreamAction {
    
    // 修复：只对 isManualCut 强制 NEW_STREAM，isPauseTriggered 不应该强制 NEW_STREAM
    // 因为 isPauseTriggered 只是表示 3 秒静音触发的自然停顿，应该允许正常决策（基于 gapMs 等）
    if (lastUtterance && lastUtterance.isManualCut) {
      // 上一个utterance有手动发送标识，当前应该是NEW_STREAM
      logger.info(
        {
          text: currentUtterance.text.substring(0, 50),
          lastUtteranceText: lastUtterance.text.substring(0, 50),
          lastUtteranceIsManualCut: lastUtterance.isManualCut,
          reason: 'Last utterance had manual cut, starting new stream',
        },
        'AggregatorStateActionDecider: Forcing NEW_STREAM due to last utterance manual cut'
      );
      return 'NEW_STREAM';
    } else {
      // 正常决策（包括 isPauseTriggered 的情况，通过 gapMs 等正常判断）
      return decideStreamAction(lastUtterance, currentUtterance, this.mode, this.tuning);
    }
  }
}
