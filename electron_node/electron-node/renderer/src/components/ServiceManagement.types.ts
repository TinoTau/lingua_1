export interface ServiceStatus {
  name: string;
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number;
  gpuUsageMs: number;
}

export interface RustServiceStatus {
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number;
  gpuUsageMs: number;
}

export interface SemanticRepairServiceStatus {
  serviceId: string;
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
}

export interface PhoneticServiceStatus {
  serviceId: string;
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
}

export interface DiscoveredService {
  id: string;
  name: string;
  type: string;
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  pid?: number;
  port?: number;
  lastError?: string;
  installPath: string;
}
