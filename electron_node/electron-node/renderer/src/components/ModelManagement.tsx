import './ModelManagement.css';
import { useModelManagement } from './useModelManagement';
import {
  ModelManagementAvailableTab,
  ModelManagementInstalledTab,
  ModelManagementRankingTab,
} from './ModelManagement.Sections';
import type { ModelManagementProps } from './ModelManagement.types';

export function ModelManagement({ onBack }: ModelManagementProps) {
  const {
    installedServices,
    availableServices,
    serviceRanking,
    activeTab,
    setActiveTab,
    downloadProgress,
    downloadErrors,
    loadingAvailable,
    error,
    rustStatus,
    pythonStatuses,
    schedulerDisplayUrl,
    loadServices,
    handleDownload,
    handleUninstall,
    handleRetry,
  } = useModelManagement();

  return (
    <div className="lmm-root">
      <div className="lmm-header">
        {onBack && (
          <button className="lmm-back" onClick={onBack}>
            ← 返回
          </button>
        )}
        <h2>服务管理</h2>
      </div>

      <div className="lmm-tabs">
        <button
          className={activeTab === 'available' ? 'is-active' : ''}
          onClick={() => setActiveTab('available')}
        >
          可下载服务
        </button>
        <button
          className={activeTab === 'installed' ? 'is-active' : ''}
          onClick={() => setActiveTab('installed')}
        >
          已安装服务
        </button>
        <button
          className={activeTab === 'ranking' ? 'is-active' : ''}
          onClick={() => setActiveTab('ranking')}
        >
          热门服务排行
        </button>
      </div>

      {activeTab === 'available' && (
        <ModelManagementAvailableTab
          availableServices={availableServices}
          installedServices={installedServices}
          downloadProgress={downloadProgress}
          downloadErrors={downloadErrors}
          loadingAvailable={loadingAvailable}
          error={error}
          schedulerDisplayUrl={schedulerDisplayUrl}
          onLoadServices={loadServices}
          onDownload={handleDownload}
          onRetry={handleRetry}
        />
      )}

      {activeTab === 'installed' && (
        <ModelManagementInstalledTab
          installedServices={installedServices}
          rustStatus={rustStatus}
          pythonStatuses={pythonStatuses}
          onUninstall={handleUninstall}
        />
      )}

      {activeTab === 'ranking' && (
        <ModelManagementRankingTab
          serviceRanking={serviceRanking}
          installedServices={installedServices}
          onDownload={handleDownload}
          onUninstall={handleUninstall}
        />
      )}
    </div>
  );
}
