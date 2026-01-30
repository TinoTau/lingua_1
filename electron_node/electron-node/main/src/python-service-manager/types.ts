/**
 * Python 服务配置接口
 */
export interface PythonServiceConfig {
  name: string;
  port: number;
  servicePath: string;
  venvPath: string;
  scriptPath: string;
  workingDir: string;
  logDir: string;
  logFile: string;
  env: Record<string, string>;
}

/**
 * Python 服务状态接口
 */
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

/**
 * Python 服务名称类型
 */
export type PythonServiceName = 'nmt' | 'tts' | 'yourtts' | 'speaker_embedding' | 'faster_whisper_vad';

