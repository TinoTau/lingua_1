import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSystemResources: () => ipcRenderer.invoke('get-system-resources'),
  
  // 模型管理接口
  getInstalledModels: () => ipcRenderer.invoke('get-installed-models'),
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  downloadModel: (modelId: string, version?: string) => ipcRenderer.invoke('download-model', modelId, version),
  uninstallModel: (modelId: string, version?: string) => ipcRenderer.invoke('uninstall-model', modelId, version),
  getModelPath: (modelId: string, version?: string) => ipcRenderer.invoke('get-model-path', modelId, version),
  getModelRanking: () => ipcRenderer.invoke('get-model-ranking'),
  
  // 模型下载事件
  onModelProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('models:progress', (_, progress) => callback(progress));
  },
  onModelError: (callback: (error: any) => void) => {
    ipcRenderer.on('models:error', (_, error) => callback(error));
  },
  removeModelProgressListener: () => {
    ipcRenderer.removeAllListeners('models:progress');
  },
  removeModelErrorListener: () => {
    ipcRenderer.removeAllListeners('models:error');
  },
  
  // 节点和模块管理
  getNodeStatus: () => ipcRenderer.invoke('get-node-status'),
  generatePairingCode: () => ipcRenderer.invoke('generate-pairing-code'),
  getModuleStatus: () => ipcRenderer.invoke('get-module-status'),
  toggleModule: (moduleName: string, enabled: boolean) => ipcRenderer.invoke('toggle-module', moduleName, enabled),
});

