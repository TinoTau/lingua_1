/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getSystemResources: () => Promise<any>;
    
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
    
    // 节点和模块管理
    getNodeStatus: () => Promise<any>;
    generatePairingCode: () => Promise<string | null>;
    getModuleStatus: () => Promise<any>;
    toggleModule: (moduleName: string, enabled: boolean) => Promise<boolean>;
  };
}

