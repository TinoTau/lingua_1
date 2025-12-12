import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSystemResources: () => ipcRenderer.invoke('get-system-resources'),
  getInstalledModels: () => ipcRenderer.invoke('get-installed-models'),
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  installModel: (modelId: string) => ipcRenderer.invoke('install-model', modelId),
  uninstallModel: (modelId: string) => ipcRenderer.invoke('uninstall-model', modelId),
  getNodeStatus: () => ipcRenderer.invoke('get-node-status'),
  generatePairingCode: () => ipcRenderer.invoke('generate-pairing-code'),
  getModuleStatus: () => ipcRenderer.invoke('get-module-status'),
  toggleModule: (moduleName: string, enabled: boolean) => ipcRenderer.invoke('toggle-module', moduleName, enabled),
});

