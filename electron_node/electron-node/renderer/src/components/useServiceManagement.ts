import { useState, useEffect } from 'react';
import type {
  ServiceStatus,
  RustServiceStatus,
  SemanticRepairServiceStatus,
  PhoneticServiceStatus,
  PunctuationServiceStatus,
  DiscoveredService,
} from './ServiceManagement.types';
import { getServiceDisplayName, getServiceId, formatGpuUsageMs } from './ServiceManagement.utils';

type PythonServiceName = 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding';

export function useServiceManagement() {
  const [rustStatus, setRustStatus] = useState<RustServiceStatus | null>(null);
  const [pythonStatuses, setPythonStatuses] = useState<ServiceStatus[]>([]);
  const [semanticRepairStatuses, setSemanticRepairStatuses] = useState<SemanticRepairServiceStatus[]>([]);
  const [phoneticStatuses, setPhoneticStatuses] = useState<PhoneticServiceStatus[]>([]);
  const [punctuationStatuses, setPunctuationStatuses] = useState<PunctuationServiceStatus[]>([]);
  const [discoveredServices, setDiscoveredServices] = useState<DiscoveredService[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [processingMetrics, setProcessingMetrics] = useState<Record<string, number>>({});
  const [serviceMetadata, setServiceMetadata] = useState<Record<string, any>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

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
      const [rust, python, metrics, allStatuses] = await Promise.all([
        window.electronAPI.getRustServiceStatus(),
        window.electronAPI.getAllPythonServiceStatuses(),
        window.electronAPI.getProcessingMetrics(),
        window.electronAPI.serviceDiscovery.statuses(),
      ]);
      setRustStatus(rust);
      setPythonStatuses(python);
      setProcessingMetrics(metrics || {});
      const statuses = allStatuses || [];
      setSemanticRepairStatuses(statuses.filter((s: { type: string }) => s.type === 'semantic'));
      setPhoneticStatuses(statuses.filter((s: { type: string }) => s.type === 'phonetic'));
      setPunctuationStatuses(statuses.filter((s: { type: string }) => s.type === 'punctuation'));
    } catch (error) {
      console.error('获取服务状态失败:', error);
    }
  };

  const syncPreferencesFromStatus = async () => {
    try {
      const rustEnabled = !!rustStatus?.running;
      const nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
      const ttsEnabled = !!pythonStatuses.find(s => s.name === 'tts')?.running;
      const yourttsEnabled = !!pythonStatuses.find(s => s.name === 'yourtts')?.running;
      const fasterWhisperVadEnabled = !!pythonStatuses.find(s => s.name === 'faster_whisper_vad')?.running;
      const speakerEmbeddingEnabled = !!pythonStatuses.find(s => s.name === 'speaker_embedding')?.running;
      const semanticRepairZhEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-zh')?.running;
      const semanticRepairEnEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en')?.running;
      const enNormalizeEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'en-normalize')?.running;
      const semanticRepairEnZhEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en-zh')?.running;
      const phoneticCorrectionEnabled = !!phoneticStatuses.find(s => s.serviceId === 'phonetic-correction-zh')?.running;
      const punctuationRestoreEnabled = !!punctuationStatuses.find(s => s.serviceId === 'punctuation-restore')?.running;
      const newPrefs = {
        rustEnabled,
        nmtEnabled,
        ttsEnabled,
        yourttsEnabled,
        fasterWhisperVadEnabled,
        speakerEmbeddingEnabled,
        semanticRepairZhEnabled,
        semanticRepairEnEnabled,
        enNormalizeEnabled,
        semanticRepairEnZhEnabled,
        phoneticCorrectionEnabled,
        punctuationRestoreEnabled,
      };
      await window.electronAPI.setServicePreferences(newPrefs);
    } catch (error) {
      console.error('同步服务偏好失败:', error);
    }
  };

  const handleStartRust = async () => {
    setLoading(prev => ({ ...prev, rust: true }));
    try {
      const result = await window.electronAPI.startRustService();
      if (!result.success) {
        alert(`启动失败: ${result.error}`);
      }
    } catch (error) {
      alert(`启动失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, rust: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStopRust = async () => {
    setLoading(prev => ({ ...prev, rust: true }));
    try {
      const result = await window.electronAPI.stopRustService();
      if (!result.success) {
        alert(`停止失败: ${result.error}`);
      }
    } catch (error) {
      alert(`停止失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, rust: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStartPython = async (serviceName: PythonServiceName) => {
    setLoading(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await window.electronAPI.startPythonService(serviceName as any);
      if (!result.success) {
        alert(`启动失败: ${result.error}`);
      }
    } catch (error) {
      alert(`启动失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, [serviceName]: false }));
      await updateStatuses();
      await syncPreferencesFromStatus();
    }
  };

  const handleStopPython = async (serviceName: PythonServiceName) => {
    setLoading(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await window.electronAPI.stopPythonService(serviceName as any);
      if (!result.success) {
        alert(`停止失败: ${result.error}`);
      }
    } catch (error) {
      alert(`停止失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, [serviceName]: false }));
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
        console.log('服务列表已刷新:', services);
      }
    } catch (error) {
      console.error('刷新服务列表失败:', error);
      alert(`刷新服务列表失败: ${error}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToggleRust = async (checked: boolean) => {
    if (checked) {
      await handleStartRust();
    } else {
      await handleStopRust();
    }
  };

  const handleTogglePython = async (serviceName: PythonServiceName, checked: boolean) => {
    if (checked) {
      await handleStartPython(serviceName);
    } else {
      await handleStopPython(serviceName);
    }
  };

  const handleToggleService = async (serviceId: string, checked: boolean) => {
    setLoading(prev => ({ ...prev, [serviceId]: true }));
    try {
      if (checked) {
        await window.electronAPI.serviceDiscovery.start(serviceId);
      } else {
        await window.electronAPI.serviceDiscovery.stop(serviceId);
      }
    } catch (error) {
      alert(checked ? `启动失败: ${error}` : `停止失败: ${error}`);
    } finally {
      setLoading(prev => ({ ...prev, [serviceId]: false }));
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
        console.log('Loaded service metadata:', metadata);
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

  const getDisplayName = (serviceId: string) => getServiceDisplayName(serviceId, serviceMetadata);

  return {
    rustStatus,
    pythonStatuses,
    semanticRepairStatuses,
    phoneticStatuses,
    punctuationStatuses,
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
    handleStartPython,
    handleStopPython,
    handleToggleRust,
    handleTogglePython,
    handleToggleService,
    getServiceDisplayName: getDisplayName,
    getServiceId,
    formatGpuUsageMs,
  };
}
