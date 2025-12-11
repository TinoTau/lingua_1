/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getSystemResources: () => Promise<any>;
    getInstalledModels: () => Promise<any[]>;
    getAvailableModels: () => Promise<any[]>;
    installModel: (modelId: string) => Promise<boolean>;
    uninstallModel: (modelId: string) => Promise<boolean>;
    getNodeStatus: () => Promise<any>;
    generatePairingCode: () => Promise<string | null>;
  };
}

