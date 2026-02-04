import './ServiceManagement.css';
import { useServiceManagement } from './useServiceManagement';
import {
  ServiceManagementRustSection,
  ServiceManagementDiscoveredItem,
  ServiceManagementPythonSection,
} from './ServiceManagement.Sections';

export function ServiceManagement() {
  const {
    rustStatus,
    pythonStatuses,
    semanticRepairStatuses,
    phoneticStatuses,
    punctuationStatuses,
    loading,
    processingMetrics,
    isRefreshing,
    handleRefreshServices,
    handleToggleRust,
    handleTogglePython,
    handleToggleService,
    getServiceDisplayName,
    getServiceId,
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

        {semanticRepairStatuses.map((status) => (
          <ServiceManagementDiscoveredItem
            key={status.serviceId}
            status={status}
            loading={loading}
            getDisplayName={getServiceDisplayName}
            onToggle={handleToggleService}
            filterError={true}
          />
        ))}

        {phoneticStatuses.map((status) => (
          <ServiceManagementDiscoveredItem
            key={status.serviceId}
            status={status}
            loading={loading}
            getDisplayName={getServiceDisplayName}
            onToggle={handleToggleService}
            filterError={false}
          />
        ))}

        {punctuationStatuses.map((status) => (
          <ServiceManagementDiscoveredItem
            key={status.serviceId}
            status={status}
            loading={loading}
            getDisplayName={getServiceDisplayName}
            onToggle={handleToggleService}
            filterError={false}
          />
        ))}

        <ServiceManagementPythonSection
          pythonStatuses={pythonStatuses}
          loading={loading}
          processingMetrics={processingMetrics}
          getServiceDisplayName={getServiceDisplayName}
          getServiceId={getServiceId}
          formatGpuUsageMs={formatGpuUsageMs}
          onToggle={handleTogglePython}
        />
      </div>
    </div>
  );
}
