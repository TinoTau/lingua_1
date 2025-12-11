import React, { useState, useEffect } from 'react';
import './ModelManagement.css';

export function ModelManagement() {
  const [installedModels, setInstalledModels] = useState<any[]>([]);
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    const installed = await window.electronAPI.getInstalledModels();
    const available = await window.electronAPI.getAvailableModels();
    setInstalledModels(installed);
    setAvailableModels(available);
  };

  const handleInstall = async (modelId: string) => {
    const success = await window.electronAPI.installModel(modelId);
    if (success) {
      loadModels();
    }
  };

  const handleUninstall = async (modelId: string) => {
    const success = await window.electronAPI.uninstallModel(modelId);
    if (success) {
      loadModels();
    }
  };

  return (
    <div className="model-management">
      <div className="tabs">
        <button
          className={activeTab === 'installed' ? 'active' : ''}
          onClick={() => setActiveTab('installed')}
        >
          已下载模型
        </button>
        <button
          className={activeTab === 'available' ? 'active' : ''}
          onClick={() => setActiveTab('available')}
        >
          可下载模型
        </button>
      </div>

      <div className="model-list">
        {activeTab === 'installed' ? (
          installedModels.length === 0 ? (
            <div className="empty-state">暂无已安装的模型</div>
          ) : (
            installedModels.map((model) => (
              <div key={model.model_id} className="model-item">
                <div className="model-info">
                  <h3>{model.model_id}</h3>
                  <p>版本: {model.version}</p>
                </div>
                <button onClick={() => handleUninstall(model.model_id)}>
                  卸载
                </button>
              </div>
            ))
          )
        ) : (
          availableModels.length === 0 ? (
            <div className="empty-state">加载中...</div>
          ) : (
            availableModels.map((model) => (
              <div key={model.model_id} className="model-item">
                <div className="model-info">
                  <h3>{model.name}</h3>
                  <p>类型: {model.model_type}</p>
                  <p>大小: {(model.size_bytes / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button onClick={() => handleInstall(model.model_id)}>
                  安装
                </button>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}

