export interface ElectronAPI {
  getSystemResources: () => Promise<{
    cpu: number;
    gpu: number | null;
    gpuMem: number | null;
    memory: number;
  }>;

  // 模型管理接口
  getInstalledModels: () => Promise<any[]>;
  getAvailableModels: () => Promise<any[]>;
  downloadModel: (modelId: string, version?: string) => Promise<boolean>;
  uninstallModel: (modelId: string, version?: string) => Promise<boolean>;
  getModelPath: (modelId: string, version?: string) => Promise<string | null>;
  getModelRanking: () => Promise<any[]>;

  // 模型下载事件
  onModelProgress: (callback: (progress: any) => void) => void;
  onModelError: (callback: (error: any) => void) => void;
  removeModelProgressListener: () => void;
  removeModelErrorListener: () => void;

  // 节点管理
  getNodeStatus: () => Promise<{
    online: boolean;
    nodeId: string | null;
    connected: boolean;
    lastHeartbeat: Date | null;
  }>;
  generatePairingCode: () => Promise<string | null>;

  // Rust 服务管理
  getRustServiceStatus: () => Promise<{
    running: boolean;
    pid: number | null;
    port: number | null;
    startedAt: Date | null;
    lastError: string | null;
  }>;
  startRustService: () => Promise<{ success: boolean; error?: string }>;
  stopRustService: () => Promise<{ success: boolean; error?: string }>;

  // Python 服务管理
  getPythonServiceStatus: (serviceName: 'nmt' | 'tts' | 'yourtts') => Promise<{
    name: string;
    running: boolean;
    pid: number | null;
    port: number | null;
    startedAt: Date | null;
    lastError: string | null;
  }>;
  getAllPythonServiceStatuses: () => Promise<Array<{
    name: string;
    running: boolean;
    pid: number | null;
    port: number | null;
    startedAt: Date | null;
    lastError: string | null;
  }>>;
  startPythonService: (serviceName: 'nmt' | 'tts' | 'yourtts') => Promise<{ success: boolean; error?: string }>;
  stopPythonService: (serviceName: 'nmt' | 'tts' | 'yourtts') => Promise<{ success: boolean; error?: string }>;

  // 自动启动服务（根据已安装的模型）
  autoStartServicesByModels: () => Promise<{ success: boolean; results?: Record<string, boolean>; error?: string }>;

  // 服务偏好（记住用户上一次选择的功能）
  getServicePreferences: () => Promise<{
    rustEnabled: boolean;
    nmtEnabled: boolean;
    ttsEnabled: boolean;
    yourttsEnabled: boolean;
  }>;
  setServicePreferences: (prefs: {
    rustEnabled: boolean;
    nmtEnabled: boolean;
    ttsEnabled: boolean;
    yourttsEnabled: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
