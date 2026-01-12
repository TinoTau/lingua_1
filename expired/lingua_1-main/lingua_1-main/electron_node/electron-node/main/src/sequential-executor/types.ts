/**
 * SequentialExecutor - 顺序执行管理器类型定义
 * 确保每个服务按utterance_index顺序执行
 */

export type ServiceType = 'ASR' | 'NMT' | 'TTS' | 'SEMANTIC_REPAIR';

export interface SequentialTask {
  sessionId: string;
  utteranceIndex: number;
  jobId?: string;
  taskType: ServiceType;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

export interface SequentialExecutorConfig {
  enabled: boolean;
  maxWaitMs?: number;  // 最大等待时间（超时后跳过）
  timeoutCheckIntervalMs?: number;  // 超时检查间隔
}

export interface SequentialExecutorState {
  currentIndex: Map<string, Map<ServiceType, number>>;  // sessionId -> taskType -> 当前处理的utterance_index
  waitingQueue: Map<string, Map<ServiceType, SequentialTask[]>>;  // sessionId -> taskType -> 等待队列
  processing: Map<string, Map<ServiceType, SequentialTask | null>>;  // sessionId -> taskType -> 当前正在处理的任务
}
