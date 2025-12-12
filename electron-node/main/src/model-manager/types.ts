// ===== v3 方案数据模型 =====

export interface ModelFileInfo {
  path: string;
  size_bytes: number;
}

export interface ModelVersion {
  version: string;
  size_bytes: number;
  files: ModelFileInfo[];
  checksum_sha256: string;
  updated_at: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  task: string;
  languages: string[];
  default_version: string;
  versions: ModelVersion[];
}

export interface InstalledModelVersion {
  status: 'ready' | 'downloading' | 'verifying' | 'installing' | 'error';
  installed_at: string;
  size_bytes: number;
  checksum_sha256: string;
  files?: Array<{ path: string; sha256: string }>;
  extra?: Record<string, unknown>;
}

export interface Registry {
  [modelId: string]: {
    [version: string]: InstalledModelVersion;
  };
}

export interface LockFile {
  pid: number;
  timestamp: number;
  modelId: string;
  version: string;
  timeout: number;
}

export interface ModelDownloadProgress {
  modelId: string;
  version: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  state: 'checking' | 'downloading' | 'verifying' | 'installing' | 'ready';
  currentFile?: string; // 当前下载的文件名
  currentFileProgress?: number; // 当前文件进度百分比
  downloadedFiles?: number; // 已下载文件数
  totalFiles?: number; // 总文件数
  downloadSpeed?: number; // 下载速度（字节/秒）
  estimatedTimeRemaining?: number; // 预计剩余时间（秒）
}

export interface ModelDownloadError {
  modelId: string;
  version: string;
  stage: 'network' | 'disk' | 'checksum' | 'unknown';
  message: string;
  canRetry: boolean;
}

