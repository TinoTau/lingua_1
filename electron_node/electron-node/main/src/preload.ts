import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSystemResources: () => ipcRenderer.invoke('get-system-resources'),

  // 服务管理接口（已替换模型管理）
  getInstalledServices: () => ipcRenderer.invoke('get-installed-services'),
  getAvailableServices: () => ipcRenderer.invoke('get-available-services'),
  downloadService: (serviceId: string, version?: string, platform?: string) => ipcRenderer.invoke('download-service', serviceId, version, platform),
  uninstallService: (serviceId: string, version?: string) => ipcRenderer.invoke('uninstall-service', serviceId, version),
  getServiceRanking: () => ipcRenderer.invoke('get-service-ranking'),

  // 服务下载事件
  onServiceProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('services:progress', (_, progress) => callback(progress));
  },
  onServiceError: (callback: (error: any) => void) => {
    ipcRenderer.on('services:error', (_, error) => callback(error));
  },
  removeServiceProgressListener: () => {
    ipcRenderer.removeAllListeners('services:progress');
  },
  removeServiceErrorListener: () => {
    ipcRenderer.removeAllListeners('services:error');
  },

  // 模型管理接口（保留以兼容旧代码，但已废弃）
  getInstalledModels: () => ipcRenderer.invoke('get-installed-models'),
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  downloadModel: (modelId: string, version?: string) => ipcRenderer.invoke('download-model', modelId, version),
  uninstallModel: (modelId: string, version?: string) => ipcRenderer.invoke('uninstall-model', modelId, version),
  getModelPath: (modelId: string, version?: string) => ipcRenderer.invoke('get-model-path', modelId, version),
  getModelRanking: () => ipcRenderer.invoke('get-model-ranking'),

  // 模型下载事件（保留以兼容旧代码，但已废弃）
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

  // 节点管理（调度器地址来自配置，供 UI 显示）
  getSchedulerUrl: () => ipcRenderer.invoke('get-scheduler-url'),
  getNodeStatus: () => ipcRenderer.invoke('get-node-status'),
  reconnectNode: () => ipcRenderer.invoke('reconnect-node'),
  generatePairingCode: () => ipcRenderer.invoke('generate-pairing-code'),

  // Rust 服务管理
  getRustServiceStatus: () => ipcRenderer.invoke('get-rust-service-status'),
  startRustService: () => ipcRenderer.invoke('start-rust-service'),
  stopRustService: () => ipcRenderer.invoke('stop-rust-service'),

  // Python 服务管理
  getPythonServiceStatus: (serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding') => ipcRenderer.invoke('get-python-service-status', serviceName),
  getAllPythonServiceStatuses: () => ipcRenderer.invoke('get-all-python-service-statuses'),
  startPythonService: (serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding') => ipcRenderer.invoke('start-python-service', serviceName),
  stopPythonService: (serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding') => ipcRenderer.invoke('stop-python-service', serviceName),

  // 自动启动服务（根据已安装的模型）
  autoStartServicesByModels: () => ipcRenderer.invoke('auto-start-services-by-models'),

  // 服务偏好（记住用户上一次选择的功能）
  getServicePreferences: () => ipcRenderer.invoke('get-service-preferences'),
  setServicePreferences: (prefs: {
    nmtEnabled: boolean;
    ttsEnabled: boolean;
    yourttsEnabled: boolean;
    fasterWhisperVadEnabled: boolean;
    speakerEmbeddingEnabled: boolean;
  }) => ipcRenderer.invoke('set-service-preferences', prefs),

  // 处理效率指标（OBS-1）
  getProcessingMetrics: () => ipcRenderer.invoke('get-processing-metrics'),

  getSemanticRepairServiceStatus: (serviceId: string) => ipcRenderer.invoke('get-semantic-repair-service-status', serviceId),

  /** 联调/测试：用模拟 ASR 文本跑完整 pipeline（聚合 → 语义修复 → 去重 → NMT） */
  runPipelineWithMockAsr: (asrText: string, srcLang?: string, tgtLang?: string) =>
    ipcRenderer.invoke('run-pipeline-with-mock-asr', asrText, srcLang, tgtLang),

  // 获取所有服务的元数据（用于动态显示服务信息）
  getAllServiceMetadata: () => ipcRenderer.invoke('get-all-service-metadata'),

  // 服务发现与启停（统一入口：statuses 一次拉取，start/stop 通用）
  serviceDiscovery: {
    list: () => ipcRenderer.invoke('services:list'),
    statuses: () => ipcRenderer.invoke('services:statuses'),
    refresh: () => ipcRenderer.invoke('services:refresh'),
    start: (serviceId: string) => ipcRenderer.invoke('services:start', serviceId),
    stop: (serviceId: string) => ipcRenderer.invoke('services:stop', serviceId),
    get: (serviceId: string) => ipcRenderer.invoke('services:get', serviceId),
  },

  // 注意：模块管理 API 已移除
  // 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
});
