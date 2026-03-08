export interface ElectronAPI {
  getSystemResources: () => Promise<{
    cpu: number;
    gpu: number | null;
    gpuMem: number | null;
    memory: number;
  }>;

  // 服务管理接口（已替换模型管理）
  getInstalledServices: () => Promise<any[]>;
  getAvailableServices: () => Promise<any[]>;
  downloadService: (serviceId: string, version?: string, platform?: string) => Promise<boolean>;
  uninstallService: (serviceId: string, version?: string) => Promise<boolean>;
  getServiceRanking: () => Promise<any[]>;

  // 服务下载事件
  onServiceProgress: (callback: (progress: any) => void) => void;
  onServiceError: (callback: (error: any) => void) => void;
  removeServiceProgressListener: () => void;
  removeServiceErrorListener: () => void;

  // 模型管理接口（保留以兼容旧代码，但已废弃）
  getInstalledModels: () => Promise<any[]>;
  getAvailableModels: () => Promise<any[]>;
  downloadModel: (modelId: string, version?: string) => Promise<boolean>;
  uninstallModel: (modelId: string, version?: string) => Promise<boolean>;
  getModelPath: (modelId: string, version?: string) => Promise<string | null>;
  getModelRanking: () => Promise<any[]>;

  // 模型下载事件（保留以兼容旧代码，但已废弃）
  onModelProgress: (callback: (progress: any) => void) => void;
  onModelError: (callback: (error: any) => void) => void;
  removeModelProgressListener: () => void;
  removeModelErrorListener: () => void;

  // 节点管理（调度器地址来自配置，供 UI 显示）
  getSchedulerUrl: () => Promise<string>;
  getNodeStatus: () => Promise<{
    online: boolean;
    nodeId: string | null;
    connected: boolean;
    lastHeartbeat: Date | null;
  }>;
  reconnectNode: () => Promise<{ success: boolean; error?: string }>;
  generatePairingCode: () => Promise<string | null>;

  // Rust 服务管理
  getRustServiceStatus: () => Promise<{
    running: boolean;
    starting: boolean;
    pid: number | null;
    port: number | null;
    startedAt: Date | null;
    lastError: string | null;
    taskCount: number;
    gpuUsageMs: number;
  }>;
  startRustService: () => Promise<{ success: boolean; error?: string }>;
  stopRustService: () => Promise<{ success: boolean; error?: string }>;

  // 自动启动服务（根据已安装的模型）
  autoStartServicesByModels: () => Promise<{ success: boolean; results?: Record<string, boolean>; error?: string }>;

  // 服务偏好（按 serviceId 存储运行状态，由用户安装的服务动态决定）
  getServicePreferences: () => Promise<Record<string, boolean>>;
  setServicePreferences: (prefs: Record<string, boolean>) => Promise<{ success: boolean; error?: string }>;

  // 处理效率指标（OBS-1，按服务ID分组）
  getProcessingMetrics: () => Promise<Record<string, number>>;

  // 语义修复服务管理
  getSemanticRepairServiceStatus: (serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en') => Promise<{
    serviceId: string;
    running: boolean;
    starting: boolean;
    pid: number | null;
    port: number | null;
    startedAt: Date | null;
    lastError: string | null;
  }>;
  // 服务发现与启停（统一：statuses 一次拉取，start/stop 通用）
  serviceDiscovery: {
    list: () => Promise<Array<{
      id: string;
      name: string;
      type: string;
      status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
      pid?: number;
      port?: number;
      lastError?: string;
      installPath: string;
    }>>;
    statuses: () => Promise<Array<{
      serviceId: string;
      type: string;
      running: boolean;
      starting: boolean;
      pid: number | null;
      port: number | null;
      startedAt: Date | null;
      lastError: string | null;
    }>>;
    refresh: () => Promise<Array<{
      id: string;
      name: string;
      type: string;
      status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
      pid?: number;
      port?: number;
      lastError?: string;
      installPath: string;
    }>>;
    start: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
    stop: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
    get: (serviceId: string) => Promise<{
      id: string;
      name: string;
      type: string;
      status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
      pid?: number;
      port?: number;
      lastError?: string;
      installPath: string;
    } | null>;
  };

  // 获取所有服务的元数据
  getAllServiceMetadata: () => Promise<Record<string, any>>;

  // 联调/功能测试（完整 pipeline）
  runPipelineWithMockAsr: (asrText: string, srcLang?: string, tgtLang?: string) => Promise<Record<string, unknown>>;
  runPipelineWithAudio: (wavPath: string, options?: { srcLang?: string; tgtLang?: string }) => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
