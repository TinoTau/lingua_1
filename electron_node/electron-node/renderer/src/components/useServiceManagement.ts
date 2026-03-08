import { useState, useEffect } from 'react';
import type {
  RustServiceStatus,
  DiscoveredService,
} from './ServiceManagement.types';
import { getServiceDisplayName, formatGpuUsageMs } from './ServiceManagement.utils';

/** 与 services:statuses 返回项一致 */
export interface ServiceStatusItem {
  serviceId: string;
  type: string;
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
}

export function useServiceManagement() {
  const [rustStatus, setRustStatus] = useState<RustServiceStatus | null>(null);
  const [statuses, setStatuses] = useState<ServiceStatusItem[]>([]);
  const [discoveredServices, setDiscoveredServices] = useState<DiscoveredService[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [processingMetrics, setProcessingMetrics] = useState<Record<string, number>>({});
  const [serviceMetadata, setServiceMetadata] = useState<Record<string, any>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const nonRustStatuses = statuses.filter((s) => s.type !== 'rust');

  const loadDiscoveredServices = async () => {
    try {
      if (window.electronAPI.serviceDiscovery) {
        const services = await window.electronAPI.serviceDiscovery.list();
        setDiscoveredServices(services);
      }
    } catch (error) {
      console.error('加载服务列表失败:', error);
    }
  };

  const updateStatuses = async () => {
    try {
      const [rust, allStatuses, metrics] = await Promise.all([
        window.electronAPI.getRustServiceStatus(),
        window.electronAPI.serviceDiscovery.statuses(),
        window.electronAPI.getProcessingMetrics(),
      ]);
      setRustStatus(rust);
      setStatuses(allStatuses || []);
      setProcessingMetrics(metrics || {});
    } catch (error) {
      console.error('获取服务状态失败:', error);
    }
  };

  const syncPreferencesFromStatus = async () => {
    try {
      const prefs: Record<string, boolean> = {};
      for (const s of statuses) {
        prefs[s.serviceId] = s.running;
      }
      await window.electronAPI.setServicePreferences(prefs);
    } catch (error) {
      console.error('同步服务偏好失败:', error);
    }
  };

  const handleStartRust = async () => {
    setLoading((prev) => ({ ...prev, rust: true }));
    try {
      const result = await window.electronAPI.startRustService();
      if (!result.success) alert(`启动失败: ${result.error}`);
    } catch (error) {
      alert(`启动失败: ${error}`);
    } finally {
      setLoading((prev) => ({ ...prev, rust: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStopRust = async () => {
    setLoading((prev) => ({ ...prev, rust: true }));
    try {
      const result = await window.electronAPI.stopRustService();
      if (!result.success) alert(`停止失败: ${result.error}`);
    } catch (error) {
      alert(`停止失败: ${error}`);
    } finally {
      setLoading((prev) => ({ ...prev, rust: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleRefreshServices = async () => {
    setIsRefreshing(true);
    try {
      if (window.electronAPI.serviceDiscovery) {
        const services = await window.electronAPI.serviceDiscovery.refresh();
        setDiscoveredServices(services);
      }
    } catch (error) {
      console.error('刷新服务列表失败:', error);
      alert(`刷新服务列表失败: ${error}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToggleRust = async (checked: boolean) => {
    if (checked) await handleStartRust();
    else await handleStopRust();
  };

  const handleToggleService = async (serviceId: string, checked: boolean) => {
    setLoading((prev) => ({ ...prev, [serviceId]: true }));
    try {
      if (checked) {
        await window.electronAPI.serviceDiscovery.start(serviceId);
      } else {
        await window.electronAPI.serviceDiscovery.stop(serviceId);
      }
    } catch (error) {
      alert(checked ? `启动失败: ${error}` : `停止失败: ${error}`);
    } finally {
      setLoading((prev) => ({ ...prev, [serviceId]: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        await window.electronAPI.getServicePreferences();
        const metadata = await window.electronAPI.getAllServiceMetadata();
        setServiceMetadata(metadata);
        await loadDiscoveredServices();
      } catch (e) {
        console.error('加载服务偏好失败:', e);
      }
      await updateStatuses();
    };
    init();
    const interval = setInterval(async () => {
      await updateStatuses();
      await loadDiscoveredServices();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const getDisplayName = (serviceId: string) =>
    getServiceDisplayName(serviceId, serviceMetadata);

  return {
    rustStatus,
    statuses,
    nonRustStatuses,
    discoveredServices,
    loading,
    processingMetrics,
    serviceMetadata,
    isRefreshing,
    updateStatuses,
    loadDiscoveredServices,
    handleRefreshServices,
    handleStartRust,
    handleStopRust,
    handleToggleRust,
    handleToggleService,
    getServiceDisplayName: getDisplayName,
    formatGpuUsageMs,
  };
}
