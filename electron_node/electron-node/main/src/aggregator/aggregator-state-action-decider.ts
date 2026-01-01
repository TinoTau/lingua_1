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
   * 关键逻辑：如果上一个utterance有手动发送/3秒静音标识，当前应该是NEW_STREAM
   * 因为上一个utterance已经被强制提交，当前应该是新的流
   */
  decideAction(
    lastUtterance: UtteranceInfo | null,
    currentUtterance: UtteranceInfo
  ): StreamAction {
    if (lastUtterance && (lastUtterance.isManualCut || (lastUtterance as any).isPauseTriggered)) {
      // 上一个utterance有手动发送/3秒静音标识，当前应该是NEW_STREAM
      logger.info(
        {
          text: currentUtterance.text.substring(0, 50),
          lastUtteranceText: lastUtterance.text.substring(0, 50),
          lastUtteranceIsManualCut: lastUtterance.isManualCut,
          reason: 'Last utterance had manual cut or pause trigger, starting new stream',
        },
        'AggregatorStateActionDecider: Forcing NEW_STREAM due to last utterance trigger'
      );
      return 'NEW_STREAM';
    } else {
      // 正常决策
      return decideStreamAction(lastUtterance, currentUtterance, this.mode, this.tuning);
    }
  }
}
