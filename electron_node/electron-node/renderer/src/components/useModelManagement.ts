import { useState, useEffect, useRef } from 'react';
import type {
  ServiceInfo,
  InstalledService,
  ServiceProgress,
  ServiceError,
  ServiceRanking,
} from './ModelManagement.types';

export function useModelManagement() {
  const [installedServices, setInstalledServices] = useState<InstalledService[]>([]);
  const [availableServices, setAvailableServices] = useState<ServiceInfo[]>([]);
  const [serviceRanking, setServiceRanking] = useState<ServiceRanking[]>([]);
  const [activeTab, setActiveTab] = useState<'installed' | 'available' | 'ranking'>('available');
  const [downloadProgress, setDownloadProgress] = useState<Map<string, ServiceProgress>>(new Map());
  const [downloadErrors, setDownloadErrors] = useState<Map<string, ServiceError>>(new Map());
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rustStatus, setRustStatus] = useState<{ running: boolean } | null>(null);
  const [pythonStatuses, setPythonStatuses] = useState<Array<{ name: string; running: boolean }>>([]);
  const [schedulerDisplayUrl, setSchedulerDisplayUrl] = useState<string>('');

  const loadingRef = useRef(false);
  const loadingRankingRef = useRef(false);

  useEffect(() => {
    if (window.electronAPI?.getSchedulerUrl) {
      window.electronAPI.getSchedulerUrl().then(setSchedulerDisplayUrl).catch(() => setSchedulerDisplayUrl(''));
    }
  }, []);

  useEffect(() => {
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

    loadServices().catch(err => {
      console.error('Failed to load available services:', err);
    });

    loadRanking().catch(err => {
      console.error('Failed to load service ranking:', err);
    });

    try {
      if (window.electronAPI?.onServiceProgress) {
        window.electronAPI.onServiceProgress((progress: ServiceProgress) => {
          setDownloadProgress(prev => new Map(prev).set(`${progress.serviceId}_${progress.version}`, progress));
        });
      }

      if (window.electronAPI?.onServiceError) {
        window.electronAPI.onServiceError((err: ServiceError) => {
          setDownloadErrors(prev => new Map(prev).set(`${err.serviceId}_${err.version}`, err));
        });
      }
    } catch (err) {
      console.warn('Failed to register service event listeners:', err);
    }

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

  useEffect(() => {
    const updateServiceStatuses = async () => {
      try {
        const [rust, python] = await Promise.all([
          window.electronAPI.getRustServiceStatus(),
          window.electronAPI.getAllPythonServiceStatuses(),
        ]);
        setRustStatus(rust);
        setPythonStatuses(python);
      } catch (err) {
        console.error('获取服务状态失败:', err);
      }
    };

    updateServiceStatuses();
    const interval = setInterval(updateServiceStatuses, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadServices = async () => {
    if (loadingRef.current) {
      console.debug('loadServices already in progress, skipping');
      return;
    }

    setLoadingAvailable(true);
    loadingRef.current = true;

    try {
      if (!window.electronAPI?.getAvailableServices) {
        console.warn('getAvailableServices API not available');
        setAvailableServices([]);
        return;
      }

      const available = await window.electronAPI.getAvailableServices();
      setAvailableServices(Array.isArray(available) ? available : []);

      if (available.length > 0) {
        setError(null);
      }
    } catch (err: unknown) {
      console.error('Failed to load available services:', err);
      setAvailableServices([]);
    } finally {
      setLoadingAvailable(false);
      loadingRef.current = false;
    }
  };

  const loadRanking = async () => {
    if (loadingRankingRef.current) {
      console.debug('loadRanking already in progress, skipping');
      return;
    }

    loadingRankingRef.current = true;
    try {
      if (!window.electronAPI?.getServiceRanking) {
        console.warn('getServiceRanking API not available');
        setServiceRanking([]);
        return;
      }

      const ranking = await window.electronAPI.getServiceRanking();
      setServiceRanking(Array.isArray(ranking) ? ranking : []);
    } catch (err: unknown) {
      console.error('Failed to load service ranking:', err);
      setServiceRanking([]);
    } finally {
      loadingRankingRef.current = false;
    }
  };

  const handleDownload = async (serviceId: string, version?: string, platform?: string) => {
    Promise.resolve().then(async () => {
      try {
        await window.electronAPI.downloadService(serviceId, version, platform);
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
      } catch (err) {
        console.error('下载服务失败:', err);
      }
    }).catch(err => {
      console.error('下载服务失败:', err);
    });
  };

  const handleUninstall = async (serviceId: string, version?: string) => {
    if (!confirm(`确定要卸载 ${serviceId}${version ? ` (版本 ${version})` : ''} 吗？这将删除服务文件且无法撤销。`)) {
      return;
    }
    Promise.resolve().then(async () => {
      const success = await window.electronAPI.uninstallService(serviceId, version);
      if (success) {
        try {
          if (window.electronAPI?.getInstalledServices) {
            const installed = await window.electronAPI.getInstalledServices();
            setInstalledServices(Array.isArray(installed) ? installed : []);
          }
        } catch (err) {
          console.error('Failed to refresh installed services:', err);
        }
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
    }).catch(err => {
      console.error('卸载服务失败:', err);
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

  return {
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
    loadRanking,
    handleDownload,
    handleUninstall,
    handleRetry,
  };
}
