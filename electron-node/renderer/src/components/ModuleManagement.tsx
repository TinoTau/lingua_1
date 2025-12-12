import React, { useState, useEffect } from 'react';
import './ModuleManagement.css';

interface ModuleStatus {
  name: string;
  enabled: boolean;
  description: string;
}

const MODULES: ModuleStatus[] = [
  {
    name: 'emotion_detection',
    enabled: false,
    description: '情感检测',
  },
  {
    name: 'voice_style_detection',
    enabled: false,
    description: '音色风格检测',
  },
  {
    name: 'speech_rate_detection',
    enabled: false,
    description: '语速检测',
  },
  {
    name: 'speech_rate_control',
    enabled: false,
    description: '语速控制',
  },
  {
    name: 'speaker_identification',
    enabled: false,
    description: '音色识别',
  },
  {
    name: 'persona_adaptation',
    enabled: false,
    description: '个性化适配',
  },
];

export function ModuleManagement() {
  const [modules, setModules] = useState<ModuleStatus[]>(MODULES);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    loadModuleStatus();
  }, []);

  const loadModuleStatus = async () => {
    try {
      const status = await window.electronAPI.getModuleStatus();
      if (status) {
        setModules(prevModules =>
          prevModules.map(m => ({
            ...m,
            enabled: status[m.name] || false,
          }))
        );
      }
      setLastRefresh(new Date());
    } catch (error) {
      console.error('加载模块状态失败:', error);
    }
  };

  const toggleModule = async (moduleName: string, currentEnabled: boolean) => {
    setLoading(true);
    try {
      const success = await window.electronAPI.toggleModule(moduleName, !currentEnabled);
      if (success) {
        setModules(prevModules =>
          prevModules.map(m =>
            m.name === moduleName ? { ...m, enabled: !currentEnabled } : m
          )
        );
        setLastRefresh(new Date());
      } else {
        alert('切换模块状态失败');
      }
    } catch (error) {
      console.error('切换模块状态失败:', error);
      alert('切换模块状态失败: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    await loadModuleStatus();
    setLoading(false);
  };

  return (
    <div className="module-management">
      <div className="module-header">
        <h2>功能模块管理</h2>
        <div className="module-actions">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="refresh-button"
          >
            {loading ? '刷新中...' : '手动刷新'}
          </button>
          {lastRefresh && (
            <span className="last-refresh">
              最后更新: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="module-list">
        {modules.map((module) => (
          <div key={module.name} className="module-item">
            <div className="module-info">
              <h3>{module.description}</h3>
              <p className="module-name">{module.name}</p>
            </div>
            <div className="module-control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={module.enabled}
                  onChange={() => toggleModule(module.name, module.enabled)}
                  disabled={loading}
                />
                <span className="slider"></span>
              </label>
              <span className="module-status">
                {module.enabled ? '已启用' : '已禁用'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="module-note">
        <p>💡 提示：模块状态更改后立即生效，无需重启。如果更改未生效，请点击"手动刷新"按钮。</p>
      </div>
    </div>
  );
}

