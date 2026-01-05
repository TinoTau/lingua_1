import { useState, useEffect } from 'react';
import './ServiceManagement.css';

interface ServiceStatus {
  name: string;
  running: boolean;
  starting: boolean; // 正在启动中
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number; // 参与任务次数
  gpuUsageMs: number; // GPU累计使用时长（毫秒）
}

interface RustServiceStatus {
  running: boolean;
  starting: boolean; // 正在启动中
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number; // 参与任务次数
  gpuUsageMs: number; // GPU累计使用时长（毫秒）
}

interface SemanticRepairServiceStatus {
  serviceId: string;
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
}

export function ServiceManagement() {
  const [rustStatus, setRustStatus] = useState<RustServiceStatus | null>(null);
  const [pythonStatuses, setPythonStatuses] = useState<ServiceStatus[]>([]);
  const [semanticRepairStatuses, setSemanticRepairStatuses] = useState<SemanticRepairServiceStatus[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [processingMetrics, setProcessingMetrics] = useState<Record<string, number>>({});

  useEffect(() => {
    // 加载服务偏好和当前状态
    const init = async () => {
      try {
        await window.electronAPI.getServicePreferences();
      } catch (e) {
        console.error('加载服务偏好失败:', e);
      }
      await updateStatuses();
    };

    init();

    // 定期更新服务状态
    const interval = setInterval(async () => {
      await updateStatuses();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const updateStatuses = async () => {
    try {
      const [rust, python, metrics, semanticRepair] = await Promise.all([
        window.electronAPI.getRustServiceStatus(),
        window.electronAPI.getAllPythonServiceStatuses(),
        window.electronAPI.getProcessingMetrics(),
        window.electronAPI.getAllSemanticRepairServiceStatuses(),
      ]);
      setRustStatus(rust);
      setPythonStatuses(python);
      setProcessingMetrics(metrics || {});
      
      // 调试日志
      console.log('Semantic repair services:', semanticRepair);
      setSemanticRepairStatuses(semanticRepair || []);
      
      // 调试日志
      if (metrics && Object.keys(metrics).length > 0) {
        console.log('Processing metrics:', metrics);
      }
    } catch (error) {
      console.error('获取服务状态失败:', error);
    }
  };

  const handleStartRust = async () => {
    setLoading(prev => ({ ...prev, rust: true }));
    try {
      const result = await window.electronAPI.startRustService();
      if (!result.success) {
        alert(`启动失败: ${result.error}`);
      }
    } catch (error) {
      alert(`启动失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, rust: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStopRust = async () => {
    setLoading(prev => ({ ...prev, rust: true }));
    try {
      const result = await window.electronAPI.stopRustService();
      if (!result.success) {
        alert(`停止失败: ${result.error}`);
      }
    } catch (error) {
      alert(`停止失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, rust: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStartPython = async (serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding') => {
    setLoading(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await window.electronAPI.startPythonService(serviceName as any);
      if (!result.success) {
        alert(`启动失败: ${result.error}`);
      }
    } catch (error) {
      alert(`启动失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, [serviceName]: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStopPython = async (serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding') => {
    setLoading(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await window.electronAPI.stopPythonService(serviceName as any);
      if (!result.success) {
        alert(`停止失败: ${result.error}`);
      }
    } catch (error) {
      alert(`停止失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, [serviceName]: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };


  const getServiceDisplayName = (name: string): string => {
    const map: Record<string, string> = {
      nmt: 'NMT 翻译服务',
      tts: 'TTS 语音合成 (Piper)',
      yourtts: 'YourTTS 语音克隆',
      faster_whisper_vad: 'FastWhisperVad语音识别服务',
      speaker_embedding: 'Speaker Embedding 服务',
      rust: '节点推理服务 (Rust)',
      'en-normalize': 'EN Normalize 英文标准化服务',
      'semantic-repair-zh': 'Semantic Repair 中文语义修复',
      'semantic-repair-en': 'Semantic Repair 英文语义修复',
    };
    return map[name] || name;
  };

  // 获取服务ID（用于查找处理效率）
  const getServiceId = (serviceName: string): string => {
    const map: Record<string, string> = {
      faster_whisper_vad: 'faster-whisper-vad',
      nmt: 'nmt-m2m100',
      tts: 'piper-tts',
      yourtts: 'your-tts',
      speaker_embedding: 'speaker-embedding',
    };
    return map[serviceName] || serviceName;
  };

  const formatGpuUsageMs = (ms: number): string => {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else if (ms < 3600000) {
      return `${(ms / 60000).toFixed(2)}min`;
    } else {
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return `${hours}h ${minutes}min ${seconds}s`;
    }
  };

  // 根据当前运行状态推导服务偏好，并持久化到主进程
  const syncPreferencesFromStatus = async () => {
    try {
      const rustEnabled = !!rustStatus?.running;
      const nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
      const ttsEnabled = !!pythonStatuses.find(s => s.name === 'tts')?.running;
      const yourttsEnabled = !!pythonStatuses.find(s => s.name === 'yourtts')?.running;
      const fasterWhisperVadEnabled = !!pythonStatuses.find(s => s.name === 'faster_whisper_vad')?.running;
      const speakerEmbeddingEnabled = !!pythonStatuses.find(s => s.name === 'speaker_embedding')?.running;

      // 语义修复服务状态
      const semanticRepairZhEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-zh')?.running;
      const semanticRepairEnEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en')?.running;
      const enNormalizeEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'en-normalize')?.running;

      const newPrefs = { 
        rustEnabled, 
        nmtEnabled, 
        ttsEnabled, 
        yourttsEnabled, 
        fasterWhisperVadEnabled, 
        speakerEmbeddingEnabled,
        semanticRepairZhEnabled,
        semanticRepairEnEnabled,
        enNormalizeEnabled,
      };
      await window.electronAPI.setServicePreferences(newPrefs);
    } catch (error) {
      console.error('同步服务偏好失败:', error);
    }
  };

  const handleToggleRust = async (checked: boolean) => {
    if (checked) {
      await handleStartRust();
    } else {
      await handleStopRust();
    }
  };

  const handleTogglePython = async (serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding', checked: boolean) => {
    if (checked) {
      await handleStartPython(serviceName);
    } else {
      await handleStopPython(serviceName);
    }
  };

  const handleStartSemanticRepair = async (serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en') => {
    setLoading(prev => ({ ...prev, [serviceId]: true }));
    try {
      const result = await window.electronAPI.startSemanticRepairService(serviceId);
      if (!result.success) {
        alert(`启动失败: ${result.error}`);
      }
    } catch (error) {
      alert(`启动失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, [serviceId]: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStopSemanticRepair = async (serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en') => {
    setLoading(prev => ({ ...prev, [serviceId]: true }));
    try {
      const result = await window.electronAPI.stopSemanticRepairService(serviceId);
      if (!result.success) {
        alert(`停止失败: ${result.error}`);
      }
    } catch (error) {
      alert(`停止失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, [serviceId]: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleToggleSemanticRepair = async (serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en', checked: boolean) => {
    if (checked) {
      await handleStartSemanticRepair(serviceId);
    } else {
      await handleStopSemanticRepair(serviceId);
    }
  };

  return (
    <div className="lsm-root">
      <div className="lsm-header">
        <h2>服务管理</h2>
      </div>

      <div className="lsm-list">
        {/* Rust 服务 */}
        <div className="lsm-item">
          <div className="lsm-info">
            <div className="lsm-name-row">
              <h3>节点推理服务 (Rust)</h3>
              <span className={`lsm-badge ${rustStatus?.running ? 'is-running' :
                rustStatus?.starting ? 'is-starting' :
                  'is-stopped'
                }`}>
                {rustStatus?.running ? '运行中' :
                  rustStatus?.starting ? '正在启动...' :
                    '已停止'}
              </span>
            </div>
            {rustStatus?.running && (
              <div className="lsm-details">
                <div className="lsm-detail-row">
                  <span className="lsm-detail-label">任务次数:</span>
                  <span className="lsm-detail-value">{rustStatus.taskCount || 0}</span>
                </div>
                <div className="lsm-detail-row">
                  <span className="lsm-detail-label">GPU使用时长:</span>
                  <span className="lsm-detail-value">
                    {formatGpuUsageMs(rustStatus.gpuUsageMs || 0)}
                  </span>
                </div>
                {(() => {
                  // Rust 服务不直接处理任务，不显示处理效率
                  // 处理效率由各个 Python 服务分别显示
                  return null;
                })()}
              </div>
            )}
            {rustStatus?.lastError && (
              <div className="lsm-error">
                <span className="lsm-error-icon">⚠️</span>
                <span>{rustStatus.lastError}</span>
              </div>
            )}
          </div>
          <div className="lsm-actions">
            <label className="lsm-switch">
              <input
                type="checkbox"
                checked={rustStatus?.running || false}
                onChange={(e) => handleToggleRust(e.target.checked)}
                disabled={loading.rust || rustStatus?.starting}
              />
              <span className="lsm-switch-slider"></span>
            </label>
          </div>
        </div>

        {/* 语义修复服务 */}
        {semanticRepairStatuses.map((status) => {
          const serviceId = status.serviceId;
          const isRunning = status.running;
          const isStarting = status.starting;
          const isLoading = loading[serviceId] || false;
          const displayName = getServiceDisplayName(serviceId);

          return (
            <div key={serviceId} className="lsm-item">
              <div className="lsm-info">
                <div className="lsm-name-row">
                  <h3>{displayName}</h3>
                  <span className={`lsm-badge ${isRunning ? 'is-running' :
                    isStarting ? 'is-starting' :
                      'is-stopped'
                    }`}>
                    {isRunning ? '运行中' :
                      isStarting ? '正在启动...' :
                        '已停止'}
                  </span>
                </div>
                {isRunning && status.port && (
                  <div className="lsm-details">
                    <div className="lsm-detail-row">
                      <span className="lsm-detail-label">端口:</span>
                      <span className="lsm-detail-value">{status.port}</span>
                    </div>
                    {status.pid && (
                      <div className="lsm-detail-row">
                        <span className="lsm-detail-label">PID:</span>
                        <span className="lsm-detail-value">{status.pid}</span>
                      </div>
                    )}
                  </div>
                )}
                {status.lastError && (
                  <div className="lsm-error">
                    <span className="lsm-error-icon">⚠️</span>
                    <span>{status.lastError}</span>
                  </div>
                )}
              </div>
              <div className="lsm-actions">
                <label className="lsm-switch">
                  <input
                    type="checkbox"
                    checked={isRunning}
                    onChange={(e) => handleToggleSemanticRepair(serviceId as 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en', e.target.checked)}
                    disabled={isLoading || isStarting}
                  />
                  <span className="lsm-switch-slider"></span>
                </label>
              </div>
            </div>
          );
        })}

        {/* Python 服务 */}
        {['faster_whisper_vad', 'nmt', 'tts', 'yourtts', 'speaker_embedding'].map((serviceName) => {
          const status = pythonStatuses.find(s => s.name === serviceName);
          const isRunning = status?.running || false;
          const isStarting = status?.starting || false;
          const isLoading = loading[serviceName] || false;

          return (
            <div key={serviceName} className="lsm-item">
              <div className="lsm-info">
                <div className="lsm-name-row">
                  <h3>{getServiceDisplayName(serviceName)}</h3>
                  <span className={`lsm-badge ${isRunning ? 'is-running' :
                    isStarting ? 'is-starting' :
                      'is-stopped'
                    }`}>
                    {isRunning ? '运行中' :
                      isStarting ? '正在启动...' :
                        '已停止'}
                  </span>
                </div>
                {isRunning && status && (
                  <div className="lsm-details">
                    <div className="lsm-detail-row">
                      <span className="lsm-detail-label">任务次数:</span>
                      <span className="lsm-detail-value">{status.taskCount || 0}</span>
                    </div>
                    <div className="lsm-detail-row">
                      <span className="lsm-detail-label">GPU使用时长:</span>
                      <span className="lsm-detail-value">
                        {formatGpuUsageMs(status.gpuUsageMs || 0)}
                      </span>
                    </div>
                    {(() => {
                      const serviceId = getServiceId(serviceName);
                      const efficiency = processingMetrics[serviceId];
                      
                      // 调试日志
                      if (serviceName === 'faster_whisper_vad') {
                        console.log(`[${serviceName}] serviceId: ${serviceId}, efficiency:`, efficiency, 'all metrics:', processingMetrics);
                      }
                      
                      if (efficiency !== undefined && efficiency !== null && !isNaN(efficiency)) {
                        // 根据服务类型决定显示格式
                        if (serviceName === 'faster_whisper_vad') {
                          // ASR 服务：显示为倍数
                          return (
                            <div className="lsm-detail-row">
                              <span className="lsm-detail-label">处理效率:</span>
                              <span className="lsm-detail-value">
                                {efficiency.toFixed(2)}x
                              </span>
                            </div>
                          );
                        } else if (serviceName === 'nmt') {
                          // NMT 服务：显示为字符/秒
                          return (
                            <div className="lsm-detail-row">
                              <span className="lsm-detail-label">处理效率:</span>
                              <span className="lsm-detail-value">
                                {efficiency.toFixed(2)} 字符/秒
                              </span>
                            </div>
                          );
                        } else if (serviceName === 'tts' || serviceName === 'yourtts') {
                          // TTS 服务：显示为倍数
                          return (
                            <div className="lsm-detail-row">
                              <span className="lsm-detail-label">处理效率:</span>
                              <span className="lsm-detail-value">
                                {efficiency.toFixed(2)}x
                              </span>
                            </div>
                          );
                        }
                      }
                      // 如果没有数据，显示占位符
                      return (
                        <div className="lsm-detail-row">
                          <span className="lsm-detail-label">处理效率:</span>
                          <span className="lsm-detail-value" style={{ color: '#999' }}>
                            暂无数据
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {status?.lastError && (
                  <div className="lsm-error">
                    <span className="lsm-error-icon">⚠️</span>
                    <span>{status.lastError}</span>
                  </div>
                )}
              </div>
              <div className="lsm-actions">
                <label className="lsm-switch">
                  <input
                    type="checkbox"
                    checked={isRunning}
                    onChange={(e) => handleTogglePython(serviceName as 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding', e.target.checked)}
                    disabled={isLoading || isStarting}
                  />
                  <span className="lsm-switch-slider"></span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
