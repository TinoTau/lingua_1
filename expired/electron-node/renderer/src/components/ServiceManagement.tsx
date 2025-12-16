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
}

interface RustServiceStatus {
  running: boolean;
  starting: boolean; // 正在启动中
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
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

  const handleAutoStart = async () => {
    setLoading(prev => ({ ...prev, autoStart: true }));
    try {
      const result = await window.electronAPI.autoStartServicesByModels();
      if (!result.success) {
        alert(`自动启动失败: ${result.error}`);
      } else {
        alert(`自动启动完成: ${JSON.stringify(result.results, null, 2)}`);
      }
    } catch (error) {
      alert(`自动启动失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, autoStart: false }));
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

  return (
    <div className="service-management">
      <div className="service-header">
        <h2>服务管理</h2>
        <button
          className="auto-start-button"
          onClick={handleAutoStart}
          disabled={loading.autoStart}
        >
          {loading.autoStart ? '启动中...' : '根据已安装模型自动启动'}
        </button>
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
                  <span className="detail-label">进程ID:</span>
                  <span className="detail-value">{rustStatus.pid}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">端口:</span>
                  <span className="detail-value">{rustStatus.port}</span>
                </div>
                {rustStatus.startedAt && (
                  <div className="detail-row">
                    <span className="detail-label">启动时间:</span>
                    <span className="detail-value">
                      {new Date(rustStatus.startedAt).toLocaleTimeString('zh-CN')}
                    </span>
                  </div>
                )}
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
            {rustStatus?.running ? (
              <button
                onClick={handleStopRust}
                disabled={loading.rust}
                className="stop-button"
              >
                {loading.rust ? '停止中...' : '停止'}
              </button>
            ) : (
              <button
                onClick={handleStartRust}
                disabled={loading.rust || rustStatus?.starting}
                className="start-button"
              >
                {loading.rust || rustStatus?.starting ? '启动中...' : '启动'}
              </button>
            )}
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
                      <span className="detail-label">进程ID:</span>
                      <span className="detail-value">{status.pid}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">端口:</span>
                      <span className="detail-value">{status.port}</span>
                    </div>
                    {status.startedAt && (
                      <div className="detail-row">
                        <span className="detail-label">启动时间:</span>
                        <span className="detail-value">
                          {new Date(status.startedAt).toLocaleTimeString('zh-CN')}
                        </span>
                      </div>
                    )}
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
                {isRunning ? (
                  <button
                    onClick={() => handleStopPython(serviceName as 'nmt' | 'tts' | 'yourtts')}
                    disabled={isLoading}
                    className="stop-button"
                  >
                    {isLoading ? '停止中...' : '停止'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleStartPython(serviceName as 'nmt' | 'tts' | 'yourtts')}
                    disabled={isLoading || isStarting}
                    className="start-button"
                  >
                    {isLoading || isStarting ? '启动中...' : '启动'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
