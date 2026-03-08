import './ServiceManagement.css';
import { useServiceManagement } from './useServiceManagement';
import {
  ServiceManagementRustSection,
  ServiceManagementDiscoveredItem,
} from './ServiceManagement.Sections';

export function ServiceManagement() {
  const {
    rustStatus,
    nonRustStatuses,
    loading,
    isRefreshing,
    handleRefreshServices,
    handleToggleRust,
    handleToggleService,
    getServiceDisplayName,
    formatGpuUsageMs,
  } = useServiceManagement();

  return (
    <div className="lsm-root">
      <div className="lsm-header">
        <h2>服务管理</h2>
        <button
          className="lsm-refresh-button"
          onClick={handleRefreshServices}
          disabled={isRefreshing}
          title="重新扫描服务目录，发现新添加的服务"
        >
          {isRefreshing ? '刷新中...' : '🔄 刷新服务'}
        </button>
      </div>

      <div className="lsm-list">
        <ServiceManagementRustSection
          rustStatus={rustStatus}
          loading={loading}
          onToggle={handleToggleRust}
          formatGpuUsageMs={formatGpuUsageMs}
        />

        {nonRustStatuses.map((status) => (
          <ServiceManagementDiscoveredItem
            key={status.serviceId}
            status={status}
            loading={loading}
            getDisplayName={getServiceDisplayName}
            onToggle={handleToggleService}
            filterError={true}
          />
        ))}
      </div>
    </div>
  );
}
