import type { ServiceInfo, InstalledService, ServiceProgress, ServiceError, ServiceRanking } from './ModelManagement.types';
import { formatBytes, formatTime } from './ModelManagement.utils';

const currentPlatform = navigator.platform.includes('Win') ? 'windows-x64' :
  navigator.platform.includes('Mac') ? 'darwin-x64' : 'linux-x64';

function getServiceRunningStatus(
  service: InstalledService,
  rustStatus: { running: boolean } | null,
  pythonStatuses: Array<{ name: string; running: boolean }>
): boolean {
  if (service.serviceId === 'node-inference') {
    return rustStatus?.running ?? false;
  }
  if (service.serviceId === 'nmt-m2m100') {
    return pythonStatuses.find(s => s.name === 'nmt')?.running ?? false;
  }
  if (service.serviceId === 'piper-tts') {
    return pythonStatuses.find(s => s.name === 'tts')?.running ?? false;
  }
  if (service.serviceId === 'your-tts') {
    return pythonStatuses.find(s => s.name === 'yourtts')?.running ?? false;
  }
  if (
    service.serviceId === 'en-normalize' ||
    service.serviceId === 'semantic-repair-zh' ||
    service.serviceId === 'semantic-repair-en'
  ) {
    return false;
  }
  return false;
}

export interface ModelManagementAvailableTabProps {
  availableServices: ServiceInfo[];
  installedServices: InstalledService[];
  downloadProgress: Map<string, ServiceProgress>;
  downloadErrors: Map<string, ServiceError>;
  loadingAvailable: boolean;
  error: string | null;
  schedulerDisplayUrl: string;
  onLoadServices: () => Promise<void>;
  onDownload: (serviceId: string, version?: string, platform?: string) => Promise<void>;
  onRetry: (serviceId: string, version: string) => Promise<void>;
}

export function ModelManagementAvailableTab({
  availableServices,
  installedServices,
  downloadProgress,
  downloadErrors,
  loadingAvailable,
  error,
  schedulerDisplayUrl,
  onLoadServices,
  onDownload,
  onRetry,
}: ModelManagementAvailableTabProps) {
  return (
    <div className="lmm-list">
      {loadingAvailable ? (
        <div className="lmm-empty">
          <div>加载中...</div>
          <div className="lmm-hint">正在从调度服务器获取服务列表...</div>
        </div>
      ) : error ? (
        <div className="lmm-empty is-error-state">
          <div className="lmm-error-icon">⚠️</div>
          <div className="lmm-error">{error}</div>
          <button className="lmm-retry" onClick={onLoadServices}>
            重试
          </button>
        </div>
      ) : availableServices.length === 0 ? (
        <div className="lmm-empty">
          <div>没有可用的服务</div>
          <div className="lmm-hint">
            {schedulerDisplayUrl
              ? `请检查调度服务器是否已启动（配置地址: ${schedulerDisplayUrl}）`
              : '请检查调度服务器是否已启动（地址见 electron-node-config.json 中 scheduler.url）'}
          </div>
          <button className="lmm-retry" onClick={onLoadServices}>
            刷新
          </button>
        </div>
      ) : (
        availableServices.map((service) => {
          const platformVariant = service.variants.find(v => v.platform === currentPlatform) || service.variants[0];
          const version = platformVariant?.version || service.latest_version;
          const progressKey = `${service.service_id}_${version}`;
          const progress = downloadProgress.get(progressKey);
          const err = downloadErrors.get(progressKey);
          const isInstalled = installedServices.some(
            s => s.serviceId === service.service_id && s.version === version && s.info.status === 'ready'
          );

          return (
            <div key={service.service_id} className="lmm-item">
              <div className="lmm-info">
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
                  <div className="lmm-progress">
                    <div className="lmm-progress-header">
                      <span className="lmm-progress-state">
                        {progress.state === 'downloading' && '下载中'}
                        {progress.state === 'verifying' && '验证中'}
                        {progress.state === 'installing' && '安装中'}
                        {progress.state === 'ready' && '已完成'}
                      </span>
                      {progress.currentFile && (
                        <span className="lmm-progress-file">
                          {progress.currentFile}
                          {progress.currentFileProgress !== undefined &&
                            ` (${progress.currentFileProgress.toFixed(1)}%)`}
                        </span>
                      )}
                      {progress.downloadedFiles !== undefined && progress.totalFiles !== undefined && (
                        <span className="lmm-progress-files">
                          文件: {progress.downloadedFiles} / {progress.totalFiles}
                        </span>
                      )}
                    </div>
                    <div className="lmm-progress-bar">
                      <div
                        className="lmm-progress-fill"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                    <div className="lmm-progress-details">
                      <span className="lmm-progress-text">
                        {progress.percent.toFixed(1)}% ({formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)})
                      </span>
                      {progress.downloadSpeed !== undefined && progress.downloadSpeed > 0 && (
                        <span className="lmm-progress-speed">
                          速度: {formatBytes(progress.downloadSpeed)}/s
                        </span>
                      )}
                      {progress.estimatedTimeRemaining !== undefined && progress.estimatedTimeRemaining > 0 && (
                        <span className="lmm-progress-time">
                          剩余: {formatTime(progress.estimatedTimeRemaining)}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {err && (
                  <div className="lmm-error">
                    <div className="lmm-error-header">
                      <span className="lmm-error-icon">⚠️</span>
                      <span className="lmm-error-type">
                        {err.stage === 'network' && '网络错误'}
                        {err.stage === 'disk' && '磁盘错误'}
                        {err.stage === 'checksum' && '校验错误'}
                        {err.stage === 'unknown' && '未知错误'}
                      </span>
                    </div>
                    <p className="lmm-error-detail">{err.message}</p>
                    {err.canRetry && (
                      <div className="lmm-error-actions">
                        <button
                          className="lmm-retry"
                          onClick={() => onRetry(service.service_id, version)}
                        >
                          重试下载
                        </button>
                      </div>
                    )}
                    {!err.canRetry && (
                      <p className="lmm-error-hint">
                        {err.stage === 'disk' && '请检查磁盘空间和权限'}
                        {err.stage === 'checksum' && '文件可能已损坏，请重新下载'}
                        {err.stage === 'network' && '请检查网络连接'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="lmm-actions">
                {isInstalled ? (
                  <button className="lmm-download" disabled>已安装</button>
                ) : progress ? (
                  <button className="lmm-download" disabled>下载中...</button>
                ) : (
                  <button className="lmm-download" onClick={() => onDownload(service.service_id, version, platformVariant?.platform)}>
                    下载
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export interface ModelManagementInstalledTabProps {
  installedServices: InstalledService[];
  rustStatus: { running: boolean } | null;
  pythonStatuses: Array<{ name: string; running: boolean }>;
  onUninstall: (serviceId: string, version?: string) => Promise<void>;
}

export function ModelManagementInstalledTab({
  installedServices,
  rustStatus,
  pythonStatuses,
  onUninstall,
}: ModelManagementInstalledTabProps) {
  return (
    <div className="lmm-list">
      {installedServices.length === 0 ? (
        <div className="lmm-empty">暂无已安装的服务</div>
      ) : (
        installedServices.map((service) => {
          const isRunning = getServiceRunningStatus(service, rustStatus, pythonStatuses);
          const statusText = isRunning ? '运行中' : '已停止';

          return (
            <div key={`${service.serviceId}_${service.version}`} className="lmm-item">
              <div className="lmm-info">
                <h3>{service.serviceId}</h3>
                <p>版本: {service.version}</p>
                {service.platform && <p>平台: {service.platform}</p>}
                <p>状态: <span style={{ color: isRunning ? '#28a745' : '#6c757d', fontWeight: 500 }}>{statusText}</span></p>
                <p>大小: {formatBytes(service.info.size_bytes)}</p>
                <p>安装时间: {new Date(service.info.installed_at).toLocaleString()}</p>
              </div>
              <div className="lmm-actions">
                <button className="lmm-uninstall" onClick={() => onUninstall(service.serviceId, service.version)}>
                  卸载
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export interface ModelManagementRankingTabProps {
  serviceRanking: ServiceRanking[];
  installedServices: InstalledService[];
  onDownload: (serviceId: string, version?: string, platform?: string) => Promise<void>;
  onUninstall: (serviceId: string, version?: string) => Promise<void>;
}

export function ModelManagementRankingTab({
  serviceRanking,
  installedServices,
  onDownload,
  onUninstall,
}: ModelManagementRankingTabProps) {
  return (
    <div className="lmm-list">
      <h3>热门服务排行（使用节点数）</h3>
      {serviceRanking.length === 0 ? (
        <div className="lmm-empty">加载中...</div>
      ) : (
        <table className="lmm-ranking-table">
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
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                      {isInstalled ? (
                        <>
                          <span style={{ color: '#28a745', fontWeight: 500 }}>已安装</span>
                          <button
                            className="lmm-uninstall"
                            onClick={() => onUninstall(item.service_id, installedService?.version)}
                          >
                            卸载
                          </button>
                        </>
                      ) : (
                        <button className="lmm-download" onClick={() => onDownload(item.service_id)}>
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
  );
}
