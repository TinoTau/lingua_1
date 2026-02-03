export interface ServiceInfo {
  service_id: string;
  name: string;
  latest_version: string;
  variants: Array<{
    version: string;
    platform: string;
    artifact: {
      type: string;
      url: string;
      sha256: string;
      size_bytes: number;
    };
  }>;
}

export interface InstalledService {
  serviceId: string;
  version: string;
  platform?: string;
  info: {
    status: 'ready' | 'downloading' | 'verifying' | 'installing' | 'error';
    installed_at: string;
    size_bytes: number;
  };
}

export interface ServiceProgress {
  serviceId: string;
  version: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  state: 'checking' | 'downloading' | 'verifying' | 'installing' | 'ready';
  currentFile?: string;
  currentFileProgress?: number;
  downloadedFiles?: number;
  totalFiles?: number;
  downloadSpeed?: number;
  estimatedTimeRemaining?: number;
}

export interface ServiceError {
  serviceId: string;
  version: string;
  stage: 'network' | 'disk' | 'checksum' | 'unknown';
  message: string;
  canRetry: boolean;
}

export interface ServiceRanking {
  service_id: string;
  node_count: number;
  rank: number;
}

export interface ModelManagementProps {
  onBack?: () => void;
}
