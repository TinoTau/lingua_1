import logger from '../logger';
import { getSentenceKenlmRuntimeStatus } from './lm-scorer';

/** 启动时打印 Sentence KenLM 状态（与 CTC asr_kenlm_meta 无关） */
export function logSentenceKenlmStartupStatus(): void {
  const status = getSentenceKenlmRuntimeStatus();
  if (status.enabled && status.modelPath) {
    const msg = `[KENLM] enabled=true path=${status.modelPath} query=${status.queryPath} fail_open=true`;
    console.log(msg);
    logger.info(
      { modelPath: status.modelPath, queryPath: status.queryPath },
      '[KENLM] sentence rerank ready'
    );
    return;
  }
  const msg = `[KENLM] enabled=false reason=${status.reason ?? 'unknown'} fail_open=true`;
  console.log(msg);
  logger.warn({ reason: status.reason, queryPath: status.queryPath }, '[KENLM] sentence rerank disabled');
}
