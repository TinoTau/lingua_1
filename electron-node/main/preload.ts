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
  
  // 节点管理
  getNodeStatus: () => ipcRenderer.invoke('get-node-status'),
  generatePairingCode: () => ipcRenderer.invoke('generate-pairing-code'),
  // 注意：模块管理 API 已移除
  // 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
});

