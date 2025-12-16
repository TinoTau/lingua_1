import { PythonServiceConfig } from '../utils/python-service-config';

export type { PythonServiceConfig };

export interface PythonServiceStatus {
  name: string;
  running: boolean;
  starting: boolean; // 正在启动中
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number; // 参与任务次数
  gpuUsageMs: number; // GPU累计使用时长（毫秒）
}

export type PythonServiceName = 'nmt' | 'tts' | 'yourtts';

