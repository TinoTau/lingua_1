/**
 * 流水线并行调度器类型定义
 */

import { JobAssignMessage } from '@shared/protocols/messages';

export type StageStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface StageState {
  status: StageStatus;
  result?: any;
  canStart: boolean;  // 前一个阶段完成后为 true
  startedAt?: number;
  completedAt?: number;
}

export interface JobState {
  jobId: string;
  utteranceIndex: number;
  sessionId: string;
  job: JobAssignMessage;
  
  // 各阶段状态
  asr: StageState;
  semanticRepair: StageState;
  nmt: StageState;
  tts: StageState;
  
  // 元数据
  createdAt: number;
}

export interface PipelineSchedulerConfig {
  enabled: boolean;
  maxConcurrentJobs?: number;  // 最大并发job数（可选）
}
