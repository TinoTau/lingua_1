/// <reference types="vite/client" />

// CSS 模块类型声明
declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

interface Window {
  electronAPI: {
    getSystemResources: () => Promise<any>;

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

    // 节点管理（调度器地址来自配置）
    getSchedulerUrl: () => Promise<string>;
    getNodeStatus: () => Promise<any>;
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

    // Python 服务管理
    getPythonServiceStatus: (serviceName: 'nmt' | 'tts' | 'yourtts') => Promise<{
      name: string;
      running: boolean;
      starting: boolean;
      pid: number | null;
      port: number | null;
      startedAt: Date | null;
      lastError: string | null;
      taskCount: number;
      gpuUsageMs: number;
    }>;
    getAllPythonServiceStatuses: () => Promise<Array<{
      name: string;
      running: boolean;
      starting: boolean;
      pid: number | null;
      port: number | null;
      startedAt: Date | null;
      lastError: string | null;
      taskCount: number;
      gpuUsageMs: number;
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
    serviceDiscovery: {
      list: () => Promise<unknown>;
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
      refresh: () => Promise<unknown>;
      start: (serviceId: string) => Promise<void>;
      stop: (serviceId: string) => Promise<void>;
      get: (serviceId: string) => Promise<unknown>;
    };
  };
}

