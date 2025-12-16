import React, { useState, useEffect } from 'react';
import './ModelManagement.css';

interface ModelInfo {
  id: string;
  name: string;
  task: string;
  languages: string[];
  default_version: string;
  versions: Array<{
    version: string;
    size_bytes: number;
    files: Array<{ path: string; size_bytes: number }>;
  }>;
}

interface InstalledModel {
  modelId: string;
  version: string;
  info: {
    status: 'ready' | 'downloading' | 'verifying' | 'installing' | 'error';
    installed_at: string;
    size_bytes: number;
  };
}

interface ModelProgress {
  modelId: string;
  version: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  state: 'checking' | 'downloading' | 'verifying' | 'installing' | 'ready';
  currentFile?: string;
  currentFileProgress?: number;
  downloadedFiles?: number;
  totalFiles?: number;
  downloadSpeed?: number;
  estimatedTimeRemaining?: number;
}

interface ModelError {
  modelId: string;
  version: string;
  stage: 'network' | 'disk' | 'checksum' | 'unknown';
  message: string;
  canRetry: boolean;
}

interface ModelRanking {
  model_id: string;
  request_count: number;
  rank: number;
}

export function ModelManagement() {
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelRanking, setModelRanking] = useState<ModelRanking[]>([]);
  const [activeTab, setActiveTab] = useState<'installed' | 'available' | 'ranking'>('available');
  const [downloadProgress, setDownloadProgress] = useState<Map<string, ModelProgress>>(new Map());
  const [downloadErrors, setDownloadErrors] = useState<Map<string, ModelError>>(new Map());

  useEffect(() => {
    loadModels();
    loadRanking();
    
    // 注册进度和错误事件监听器
    window.electronAPI.onModelProgress((progress: ModelProgress) => {
      setDownloadProgress(prev => new Map(prev).set(`${progress.modelId}_${progress.version}`, progress));
    });
    
    window.electronAPI.onModelError((error: ModelError) => {
      setDownloadErrors(prev => new Map(prev).set(`${error.modelId}_${error.version}`, error));
    });
    
    // 清理监听器
    return () => {
      window.electronAPI.removeModelProgressListener();
      window.electronAPI.removeModelErrorListener();
    };
  }, []);

  const loadModels = async () => {
    const installed = await window.electronAPI.getInstalledModels();
    const available = await window.electronAPI.getAvailableModels();
    setInstalledModels(installed);
    setAvailableModels(available);
  };

  const loadRanking = async () => {
    const ranking = await window.electronAPI.getModelRanking();
    setModelRanking(ranking);
  };

  const handleDownload = async (modelId: string, version?: string) => {
    try {
      await window.electronAPI.downloadModel(modelId, version);
      // 下载完成后重新加载列表
      setTimeout(() => loadModels(), 1000);
    } catch (error) {
      console.error('下载模型失败:', error);
    }
  };

  const handleUninstall = async (modelId: string, version?: string) => {
    const success = await window.electronAPI.uninstallModel(modelId, version);
    if (success) {
      loadModels();
    }
  };

  const handleRetry = async (modelId: string, version: string) => {
    setDownloadErrors(prev => {
      const newMap = new Map(prev);
      newMap.delete(`${modelId}_${version}`);
      return newMap;
    });
    await handleDownload(modelId, version);
  };

  const getModelStatus = (modelId: string, version: string): string => {
    const progressKey = `${modelId}_${version}`;
    const progress = downloadProgress.get(progressKey);
    const error = downloadErrors.get(progressKey);
    
    if (error) {
      return `错误: ${error.message}`;
    }
    
    if (progress) {
      return `${progress.state} - ${progress.percent.toFixed(1)}%`;
    }
    
    const installed = installedModels.find(
      m => m.modelId === modelId && m.version === version
    );
    
    if (installed) {
      return installed.info.status === 'ready' ? '已安装' : installed.info.status;
    }
    
    return '未安装';
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.ceil(seconds)}秒`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.ceil(seconds % 60);
      return `${minutes}分${secs}秒`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}小时${minutes}分钟`;
    }
  };

  return (
    <div className="model-management">
      <h2>模型管理</h2>
      
      <div className="tabs">
        <button
          className={activeTab === 'available' ? 'active' : ''}
          onClick={() => setActiveTab('available')}
        >
          可下载模型
        </button>
        <button
          className={activeTab === 'installed' ? 'active' : ''}
          onClick={() => setActiveTab('installed')}
        >
          已安装模型
        </button>
        <button
          className={activeTab === 'ranking' ? 'active' : ''}
          onClick={() => setActiveTab('ranking')}
        >
          热门模型排行
        </button>
      </div>

      {activeTab === 'available' && (
        <div className="model-list">
          {availableModels.length === 0 ? (
            <div className="empty-state">加载中...</div>
          ) : (
            availableModels.map((model) => {
              const defaultVersion = model.versions.find(v => v.version === model.default_version) || model.versions[0];
              const progressKey = `${model.id}_${defaultVersion?.version || ''}`;
              const progress = downloadProgress.get(progressKey);
              const error = downloadErrors.get(progressKey);
              const isInstalled = installedModels.some(
                m => m.modelId === model.id && m.info.status === 'ready'
              );
              
              return (
                <div key={model.id} className="model-item">
                  <div className="model-info">
                    <h3>{model.name}</h3>
                    <p>ID: {model.id}</p>
                    <p>类型: {model.task.toUpperCase()}</p>
                    <p>语言: {model.languages.join(', ')}</p>
                    <p>默认版本: {model.default_version}</p>
                    <p>大小: {defaultVersion ? formatBytes(defaultVersion.size_bytes) : 'N/A'}</p>
                    
                    {progress && (
                      <div className="progress-container">
                        <div className="progress-header">
                          <span className="progress-state">
                            {progress.state === 'downloading' && '下载中'}
                            {progress.state === 'verifying' && '验证中'}
                            {progress.state === 'installing' && '安装中'}
                            {progress.state === 'ready' && '已完成'}
                          </span>
                          {progress.currentFile && (
                            <span className="progress-file">
                              {progress.currentFile}
                              {progress.currentFileProgress !== undefined && 
                                ` (${progress.currentFileProgress.toFixed(1)}%)`}
                            </span>
                          )}
                          {progress.downloadedFiles !== undefined && progress.totalFiles !== undefined && (
                            <span className="progress-files">
                              文件: {progress.downloadedFiles} / {progress.totalFiles}
                            </span>
                          )}
                        </div>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                        <div className="progress-details">
                          <span className="progress-text">
                            {progress.percent.toFixed(1)}% ({formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)})
                          </span>
                          {progress.downloadSpeed !== undefined && progress.downloadSpeed > 0 && (
                            <span className="progress-speed">
                              速度: {formatBytes(progress.downloadSpeed)}/s
                            </span>
                          )}
                          {progress.estimatedTimeRemaining !== undefined && progress.estimatedTimeRemaining > 0 && (
                            <span className="progress-time">
                              剩余: {formatTime(progress.estimatedTimeRemaining)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {error && (
                      <div className="error-message">
                        <div className="error-header">
                          <span className="error-icon">⚠️</span>
                          <span className="error-type">
                            {error.stage === 'network' && '网络错误'}
                            {error.stage === 'disk' && '磁盘错误'}
                            {error.stage === 'checksum' && '校验错误'}
                            {error.stage === 'unknown' && '未知错误'}
                          </span>
                        </div>
                        <p className="error-detail">{error.message}</p>
                        {error.canRetry && (
                          <div className="error-actions">
                            <button 
                              className="retry-button"
                              onClick={() => handleRetry(model.id, defaultVersion?.version || '')}
                            >
                              重试下载
                            </button>
                          </div>
                        )}
                        {!error.canRetry && (
                          <p className="error-hint">
                            {error.stage === 'disk' && '请检查磁盘空间和权限'}
                            {error.stage === 'checksum' && '文件可能已损坏，请重新下载'}
                            {error.stage === 'network' && '请检查网络连接'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="model-actions">
                    {isInstalled ? (
                      <button disabled>已安装</button>
                    ) : progress ? (
                      <button disabled>下载中...</button>
                    ) : (
                      <button onClick={() => handleDownload(model.id)}>
                        下载
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'installed' && (
        <div className="model-list">
          {installedModels.length === 0 ? (
            <div className="empty-state">暂无已安装的模型</div>
          ) : (
            installedModels.map((model) => (
              <div key={`${model.modelId}_${model.version}`} className="model-item">
                <div className="model-info">
                  <h3>{model.modelId}</h3>
                  <p>版本: {model.version}</p>
                  <p>状态: {model.info.status}</p>
                  <p>大小: {formatBytes(model.info.size_bytes)}</p>
                  <p>安装时间: {new Date(model.info.installed_at).toLocaleString()}</p>
                </div>
                <div className="model-actions">
                  <button onClick={() => handleUninstall(model.modelId, model.version)}>
                    卸载
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'ranking' && (
        <div className="model-list">
          <h3>热门模型排行（需求量）</h3>
          {modelRanking.length === 0 ? (
            <div className="empty-state">加载中...</div>
          ) : (
            <table className="ranking-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>模型 ID</th>
                  <th>请求次数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {modelRanking.map((item) => {
                  const isInstalled = installedModels.some(
                    m => m.modelId === item.model_id && m.info.status === 'ready'
                  );
                  
                  return (
                    <tr key={item.model_id}>
                      <td>#{item.rank}</td>
                      <td>{item.model_id}</td>
                      <td>{item.request_count.toLocaleString()}</td>
                      <td>
                        {isInstalled ? (
                          <span>已安装</span>
                        ) : (
                          <button onClick={() => handleDownload(item.model_id)}>
                            下载
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
