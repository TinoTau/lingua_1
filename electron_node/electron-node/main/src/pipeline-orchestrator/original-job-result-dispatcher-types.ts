/**
 * OriginalJobResultDispatcher 类型定义
 * 从 original-job-result-dispatcher.ts 迁出，供 dispatcher、cleanup、finalize 共用。
 */

import type { JobAssignMessage } from '@shared/protocols/messages';
import type { SegmentInfo } from '../task-router/types';

/**
 * 原始Job的ASR数据
 */
export interface OriginalJobASRData {
  originalJobId: string;
  asrText: string;
  asrSegments: SegmentInfo[];
  languageProbabilities?: Record<string, number>;
  batchIndex?: number;
  jobIndex?: number;
  /** 是否缺失（ASR 失败/超时，标记为已结算但无文本） */
  missing?: boolean;
}

/**
 * 原始Job的处理回调
 */
export type OriginalJobCallback = (
  asrData: OriginalJobASRData,
  originalJobMsg: JobAssignMessage
) => Promise<void>;

/**
 * 原始Job的注册信息
 */
export interface OriginalJobRegistration {
  originalJob: JobAssignMessage;
  callback: OriginalJobCallback;
  expectedSegmentCount: number;
  receivedCount: number;
  missingCount: number;
  accumulatedSegments: OriginalJobASRData[];
  accumulatedSegmentsList: SegmentInfo[];
  startedAt: number;
  lastActivityAt: number;
  isFinalized: boolean;
  ttlTimerHandle?: NodeJS.Timeout;
}
