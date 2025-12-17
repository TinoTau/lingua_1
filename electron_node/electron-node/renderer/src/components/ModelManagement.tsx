import React, { useState, useEffect, useRef } from 'react';
import './ModelManagement.css';

interface ServiceInfo {
  service_id: string;
  name: string;
  latest_version: string;
  variants: Array<{
    version: string;
    platform: string;
    artifact: {
      type: string;
      url: string;
      sha256: string;
      size_bytes: number;
    };
  }>;
}

interface InstalledService {
  serviceId: string;
  version: string;
  platform?: string;
  info: {
    status: 'ready' | 'downloading' | 'verifying' | 'installing' | 'error';
    installed_at: string;
    size_bytes: number;
  };
}

interface ServiceProgress {
  serviceId: string;
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

interface ServiceError {
  serviceId: string;
  version: string;
  stage: 'network' | 'disk' | 'checksum' | 'unknown';
  message: string;
  canRetry: boolean;
}

interface ServiceRanking {
  service_id: string;
  node_count: number;
  rank: number;
}

interface ModelManagementProps {
  onBack?: () => void;
}

export function ModelManagement({ onBack }: ModelManagementProps) {
  const [installedServices, setInstalledServices] = useState<InstalledService[]>([]);
  const [availableServices, setAvailableServices] = useState<ServiceInfo[]>([]);
  const [serviceRanking, setServiceRanking] = useState<ServiceRanking[]>([]);
  const [activeTab, setActiveTab] = useState<'installed' | 'available' | 'ranking'>('available');
  const [downloadProgress, setDownloadProgress] = useState<Map<string, ServiceProgress>>(new Map());
  const [downloadErrors, setDownloadErrors] = useState<Map<string, ServiceError>>(new Map());
  const [loadingAvailable, setLoadingAvailable] = useState(false); // 只用于可下载服务的加载状态
  const [error, setError] = useState<string | null>(null);
  
  // 使用 ref 来防止并发请求，避免周期性阻塞
  const loadingRef = useRef(false);
  const loadingRankingRef = useRef(false);

  useEffect(() => {
    // 所有初始化操作都是异步的，不阻塞 UI 渲染
    // 先加载已安装的服务（本地数据，快速，不会堵塞）
    // 使用 Promise 而不是 async/await，确保完全异步
    Promise.resolve().then(async () => {
      try {
        if (window.electronAPI?.getInstalledServices) {
          const installed = await window.electronAPI.getInstalledServices();
          setInstalledServices(Array.isArray(installed) ? installed : []);
        }
      } catch (err) {
        console.error('Failed to load installed services:', err);
        setInstalledServices([]);
      }
    }).catch(err => {
      console.error('Failed to initialize installed services:', err);
      setInstalledServices([]);
    });
    
    // 然后异步加载可下载服务和排行（网络请求，可能较慢或失败）
    // 使用独立执行，避免一个请求失败影响另一个
    // 完全异步，不阻塞任何操作
    loadServices().catch(err => {
      console.error('Failed to load available services:', err);
      // 不设置错误状态，只记录日志，让用户至少能看到已安装的服务
    });
    
    loadRanking().catch(err => {
      console.error('Failed to load service ranking:', err);
      // 不设置错误状态，只记录日志
    });

    // 注册进度和错误事件监听器（如果 API 存在）
    try {
      if (window.electronAPI?.onServiceProgress) {
        window.electronAPI.onServiceProgress((progress: ServiceProgress) => {
          setDownloadProgress(prev => new Map(prev).set(`${progress.serviceId}_${progress.version}`, progress));
        });
      }

      if (window.electronAPI?.onServiceError) {
        window.electronAPI.onServiceError((error: ServiceError) => {
          setDownloadErrors(prev => new Map(prev).set(`${error.serviceId}_${error.version}`, error));
        });
      }
    } catch (err) {
      console.warn('Failed to register service event listeners:', err);
    }

    // 清理监听器
    return () => {
      try {
        if (window.electronAPI?.removeServiceProgressListener) {
          window.electronAPI.removeServiceProgressListener();
        }
        if (window.electronAPI?.removeServiceErrorListener) {
          window.electronAPI.removeServiceErrorListener();
        }
      } catch (err) {
        console.warn('Failed to remove service event listeners:', err);
      }
    };
  }, []);

  const loadServices = async () => {
    // 如果正在加载，跳过本次请求，避免重复请求导致阻塞
    if (loadingRef.current) {
      console.debug('loadServices already in progress, skipping');
      return;
    }
    
    // 只设置可下载服务的加载状态，不影响已安装服务的显示
    setLoadingAvailable(true);
    loadingRef.current = true;
    
    try {
      // 检查 API 是否存在
      if (!window.electronAPI?.getAvailableServices) {
        console.warn('getAvailableServices API not available');
        setAvailableServices([]);
        return;
      }
      
      // 异步加载可下载的服务（网络请求，可能较慢或失败）
      // 不阻塞UI，让用户可以先看到已安装的服务并进行操作
      const available = await window.electronAPI.getAvailableServices();
      setAvailableServices(Array.isArray(available) ? available : []);
      
      // 如果列表为空，清除之前的错误提示（可能是网络问题已解决）
      if (available.length > 0) {
        setError(null);
      }
    } catch (err: any) {
      console.error('Failed to load available services:', err);
      // 不设置错误状态，只设置空数组，让用户至少能看到已安装的服务
      setAvailableServices([]);
      // 只在列表为空时显示提示（避免重复提示）
      // 注意：这里不设置全局错误，只在控制台记录，避免阻塞用户操作
    } finally {
      setLoadingAvailable(false);
      loadingRef.current = false;
    }
  };

  const loadRanking = async () => {
    // 如果正在加载，跳过本次请求，避免重复请求导致阻塞
    if (loadingRankingRef.current) {
      console.debug('loadRanking already in progress, skipping');
      return;
    }
    
    loadingRankingRef.current = true;
    try {
      // 检查 API 是否存在
      if (!window.electronAPI?.getServiceRanking) {
        console.warn('getServiceRanking API not available');
        setServiceRanking([]);
        return;
      }

      const ranking = await window.electronAPI.getServiceRanking();
      // 确保返回的是数组
      setServiceRanking(Array.isArray(ranking) ? ranking : []);
    } catch (err: any) {
      console.error('Failed to load service ranking:', err);
      setServiceRanking([]);
    } finally {
      loadingRankingRef.current = false;
    }
  };

  const handleDownload = async (serviceId: string, version?: string, platform?: string) => {
    // 异步执行，不阻塞 UI
    Promise.resolve().then(async () => {
      try {
        await window.electronAPI.downloadService(serviceId, version, platform);
        // 下载完成后只刷新已安装服务列表（本地数据，快速），不重新加载可下载服务（避免网络请求）
        setTimeout(async () => {
          try {
            if (window.electronAPI?.getInstalledServices) {
              const installed = await window.electronAPI.getInstalledServices();
              setInstalledServices(Array.isArray(installed) ? installed : []);
            }
          } catch (err) {
            console.error('Failed to refresh installed services:', err);
          }
        }, 1000);
      } catch (error) {
        console.error('下载服务失败:', error);
      }
    }).catch(error => {
      console.error('下载服务失败:', error);
    });
  };

  const handleUninstall = async (serviceId: string, version?: string) => {
    if (!confirm(`确定要卸载 ${serviceId}${version ? ` (版本 ${version})` : ''} 吗？这将删除服务文件且无法撤销。`)) {
      return;
    }
    // 异步执行卸载操作，不阻塞 UI
    Promise.resolve().then(async () => {
      const success = await window.electronAPI.uninstallService(serviceId, version);
      if (success) {
        // 只刷新已安装服务列表（本地数据，快速），不重新加载可下载服务（避免网络请求）
        try {
          if (window.electronAPI?.getInstalledServices) {
            const installed = await window.electronAPI.getInstalledServices();
            setInstalledServices(Array.isArray(installed) ? installed : []);
          }
        } catch (err) {
          console.error('Failed to refresh installed services:', err);
        }
        // 清除相关的下载进度和错误
        if (version) {
          const progressKey = `${serviceId}_${version}`;
          setDownloadProgress(prev => {
            const newMap = new Map(prev);
            newMap.delete(progressKey);
            return newMap;
          });
          setDownloadErrors(prev => {
            const newMap = new Map(prev);
            newMap.delete(progressKey);
            return newMap;
          });
        }
      } else {
        alert(`卸载 ${serviceId}${version ? ` (版本 ${version})` : ''} 失败。请查看日志了解详情。`);
      }
    }).catch(error => {
      console.error('卸载服务失败:', error);
      alert(`卸载 ${serviceId}${version ? ` (版本 ${version})` : ''} 失败。请查看日志了解详情。`);
    });
  };

  const handleRetry = async (serviceId: string, version: string) => {
    setDownloadErrors(prev => {
      const newMap = new Map(prev);
      newMap.delete(`${serviceId}_${version}`);
      return newMap;
    });
    await handleDownload(serviceId, version);
  };

  const getServiceStatus = (serviceId: string, version: string): string => {
    const progressKey = `${serviceId}_${version}`;
    const progress = downloadProgress.get(progressKey);
    const error = downloadErrors.get(progressKey);

    if (error) {
      return `错误: ${error.message}`;
    }

    if (progress) {
      return `${progress.state} - ${progress.percent.toFixed(1)}%`;
    }

    const installed = installedServices.find(
      s => s.serviceId === serviceId && s.version === version
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
      <div className="model-management-header">
        {onBack && (
          <button className="back-button" onClick={onBack}>
            ← 返回
          </button>
        )}
        <h2>服务管理</h2>
      </div>

      <div className="tabs">
        <button
          className={activeTab === 'available' ? 'active' : ''}
          onClick={() => setActiveTab('available')}
        >
          可下载服务
        </button>
        <button
          className={activeTab === 'installed' ? 'active' : ''}
          onClick={() => setActiveTab('installed')}
        >
          已安装服务
        </button>
        <button
          className={activeTab === 'ranking' ? 'active' : ''}
          onClick={() => setActiveTab('ranking')}
        >
          热门服务排行
        </button>
      </div>

      {activeTab === 'available' && (
        <div className="model-list">
          {loadingAvailable ? (
            <div className="empty-state">
              <div>加载中...</div>
              <div className="hint-text">正在从调度服务器获取服务列表...</div>
            </div>
          ) : error ? (
            <div className="empty-state error-state">
              <div className="error-icon">⚠️</div>
              <div className="error-message">{error}</div>
              <button className="retry-button" onClick={loadServices}>
                重试
              </button>
            </div>
          ) : availableServices.length === 0 ? (
            <div className="empty-state">
              <div>没有可用的服务</div>
              <div className="hint-text">请检查调度服务器是否运行在 http://localhost:5010</div>
              <button className="retry-button" onClick={loadServices}>
                刷新
              </button>
            </div>
          ) : (
            availableServices.map((service) => {
              // 获取当前平台的变体，如果没有则使用第一个
              const currentPlatform = navigator.platform.includes('Win') ? 'windows-x64' :
                navigator.platform.includes('Mac') ? 'darwin-x64' : 'linux-x64';
              const platformVariant = service.variants.find(v => v.platform === currentPlatform) || service.variants[0];
              const version = platformVariant?.version || service.latest_version;
              const progressKey = `${service.service_id}_${version}`;
              const progress = downloadProgress.get(progressKey);
              const error = downloadErrors.get(progressKey);
              const isInstalled = installedServices.some(
                s => s.serviceId === service.service_id && s.version === version && s.info.status === 'ready'
              );

              return (
                <div key={service.service_id} className="model-item">
                  <div className="model-info">
                    <h3>{service.name || service.service_id}</h3>
                    <p>服务ID: {service.service_id}</p>
                    <p>最新版本: {service.latest_version}</p>
                    {platformVariant && (
                      <>
                        <p>平台: {platformVariant.platform}</p>
                        <p>大小: {formatBytes(platformVariant.artifact.size_bytes)}</p>
                      </>
                    )}

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
                              onClick={() => handleRetry(service.service_id, version)}
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
                      <button className="download-button" disabled>已安装</button>
                    ) : progress ? (
                      <button className="download-button" disabled>下载中...</button>
                    ) : (
                      <button className="download-button" onClick={() => handleDownload(service.service_id, version, platformVariant?.platform)}>
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
          {installedServices.length === 0 ? (
            <div className="empty-state">暂无已安装的服务</div>
          ) : (
            installedServices.map((service) => (
              <div key={`${service.serviceId}_${service.version}`} className="model-item">
                <div className="model-info">
                  <h3>{service.serviceId}</h3>
                  <p>版本: {service.version}</p>
                  {service.platform && <p>平台: {service.platform}</p>}
                  <p>状态: {service.info.status}</p>
                  <p>大小: {formatBytes(service.info.size_bytes)}</p>
                  <p>安装时间: {new Date(service.info.installed_at).toLocaleString()}</p>
                </div>
                <div className="model-actions">
                  <button className="uninstall-button" onClick={() => handleUninstall(service.serviceId, service.version)}>
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
          <h3>热门服务排行（使用节点数）</h3>
          {serviceRanking.length === 0 ? (
            <div className="empty-state">加载中...</div>
          ) : (
            <table className="ranking-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>服务 ID</th>
                  <th>使用节点数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {serviceRanking.map((item) => {
                  const installedService = installedServices.find(
                    s => s.serviceId === item.service_id && s.info.status === 'ready'
                  );
                  const isInstalled = !!installedService;

                  return (
                    <tr key={item.service_id}>
                      <td>#{item.rank}</td>
                      <td>{item.service_id}</td>
                      <td>{item.node_count.toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {isInstalled ? (
                            <>
                              <span style={{ color: '#28a745', fontWeight: 500 }}>已安装</span>
                              <button
                                className="uninstall-button"
                                onClick={() => handleUninstall(item.service_id, installedService?.version)}
                              >
                                卸载
                              </button>
                            </>
                          ) : (
                            <button className="download-button" onClick={() => handleDownload(item.service_id)}>
                              下载
                            </button>
                          )}
                        </div>
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
