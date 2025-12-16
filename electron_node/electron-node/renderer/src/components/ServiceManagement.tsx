import React, { useState, useEffect } from 'react';
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

export function ServiceManagement() {
  const [rustStatus, setRustStatus] = useState<RustServiceStatus | null>(null);
  const [pythonStatuses, setPythonStatuses] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [prefs, setPrefs] = useState<{
    rustEnabled: boolean;
    nmtEnabled: boolean;
    ttsEnabled: boolean;
    yourttsEnabled: boolean;
  } | null>(null);

  useEffect(() => {
    // 加载服务偏好和当前状态
    const init = async () => {
      try {
        const p = await window.electronAPI.getServicePreferences();
        setPrefs(p);
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
      const [rust, python] = await Promise.all([
        window.electronAPI.getRustServiceStatus(),
        window.electronAPI.getAllPythonServiceStatuses(),
      ]);
      setRustStatus(rust);
      setPythonStatuses(python);
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

  const handleStartPython = async (serviceName: 'nmt' | 'tts' | 'yourtts') => {
    setLoading(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await window.electronAPI.startPythonService(serviceName);
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

  const handleStopPython = async (serviceName: 'nmt' | 'tts' | 'yourtts') => {
    setLoading(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await window.electronAPI.stopPythonService(serviceName);
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
      rust: '节点推理服务',
    };
    return map[name] || name;
  };

  const getServicePort = (name: string): number => {
    const map: Record<string, number> = {
      nmt: 5008,
      tts: 5006,
      yourtts: 5004,
      rust: 5009,
    };
    return map[name] || 0;
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

      const newPrefs = { rustEnabled, nmtEnabled, ttsEnabled, yourttsEnabled };
      setPrefs(newPrefs);
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

  const handleTogglePython = async (serviceName: 'nmt' | 'tts' | 'yourtts', checked: boolean) => {
    if (checked) {
      await handleStartPython(serviceName);
    } else {
      await handleStopPython(serviceName);
    }
  };

  return (
    <div className="service-management">
      <div className="service-header">
        <h2>服务管理</h2>
      </div>

      <div className="services-list">
        {/* Rust 服务 */}
        <div className="service-item">
          <div className="service-info">
            <div className="service-name-row">
              <h3>节点推理服务 (Rust)</h3>
              <span className={`status-badge ${rustStatus?.running ? 'running' :
                rustStatus?.starting ? 'starting' :
                  'stopped'
                }`}>
                {rustStatus?.running ? '运行中' :
                  rustStatus?.starting ? '正在启动...' :
                    '已停止'}
              </span>
            </div>
            {rustStatus?.running && (
              <div className="service-details">
                <div className="detail-row">
                  <span className="detail-label">任务次数:</span>
                  <span className="detail-value">{rustStatus.taskCount || 0}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">GPU使用时长:</span>
                  <span className="detail-value">
                    {formatGpuUsageMs(rustStatus.gpuUsageMs || 0)}
                  </span>
                </div>
              </div>
            )}
            {rustStatus?.lastError && (
              <div className="error-message">
                <span className="error-icon">⚠️</span>
                <span>{rustStatus.lastError}</span>
              </div>
            )}
          </div>
          <div className="service-actions">
            <label className="service-switch">
              <input
                type="checkbox"
                checked={rustStatus?.running || false}
                onChange={(e) => handleToggleRust(e.target.checked)}
                disabled={loading.rust || rustStatus?.starting}
              />
              <span className="service-switch-slider"></span>
            </label>
          </div>
        </div>

        {/* Python 服务 */}
        {['nmt', 'tts', 'yourtts'].map((serviceName) => {
          const status = pythonStatuses.find(s => s.name === serviceName);
          const isRunning = status?.running || false;
          const isStarting = status?.starting || false;
          const isLoading = loading[serviceName] || false;

          return (
            <div key={serviceName} className="service-item">
              <div className="service-info">
                <div className="service-name-row">
                  <h3>{getServiceDisplayName(serviceName)}</h3>
                  <span className={`status-badge ${isRunning ? 'running' :
                      isStarting ? 'starting' :
                        'stopped'
                    }`}>
                    {isRunning ? '运行中' :
                      isStarting ? '正在启动...' :
                        '已停止'}
                  </span>
                </div>
                {isRunning && status && (
                  <div className="service-details">
                    <div className="detail-row">
                      <span className="detail-label">任务次数:</span>
                      <span className="detail-value">{status.taskCount || 0}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">GPU使用时长:</span>
                      <span className="detail-value">
                        {formatGpuUsageMs(status.gpuUsageMs || 0)}
                      </span>
                    </div>
                  </div>
                )}
                {status?.lastError && (
                  <div className="error-message">
                    <span className="error-icon">⚠️</span>
                    <span>{status.lastError}</span>
                  </div>
                )}
              </div>
              <div className="service-actions">
                <label className="service-switch">
                  <input
                    type="checkbox"
                    checked={isRunning}
                    onChange={(e) => handleTogglePython(serviceName as 'nmt' | 'tts' | 'yourtts', e.target.checked)}
                    disabled={isLoading || isStarting}
                  />
                  <span className="service-switch-slider"></span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
