import React from 'react';
import type { RustServiceStatus, SemanticRepairServiceStatus, PhoneticServiceStatus, ServiceStatus } from './ServiceManagement.types';
import { filterErrorLines } from './ServiceManagement.utils';

type PythonServiceName = 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding';

interface RustSectionProps {
  rustStatus: RustServiceStatus | null;
  loading: Record<string, boolean>;
  onToggle: (checked: boolean) => void;
  formatGpuUsageMs: (ms: number) => string;
}

export function ServiceManagementRustSection({ rustStatus, loading, onToggle, formatGpuUsageMs }: RustSectionProps) {
  const errorLines = filterErrorLines(rustStatus?.lastError ?? null);
  return (
    <div className="lsm-item">
      <div className="lsm-info">
        <div className="lsm-name-row">
          <h3>节点推理服务 (Rust)</h3>
          <span className={`lsm-badge ${rustStatus?.running ? 'is-running' : rustStatus?.starting ? 'is-starting' : 'is-stopped'}`}>
            {rustStatus?.running ? '运行中' : rustStatus?.starting ? '正在启动...' : '已停止'}
          </span>
        </div>
        {rustStatus?.running && (
          <div className="lsm-details">
            <div className="lsm-detail-row">
              <span className="lsm-detail-label">任务次数:</span>
              <span className="lsm-detail-value">{rustStatus.taskCount || 0}</span>
            </div>
            <div className="lsm-detail-row">
              <span className="lsm-detail-label">GPU使用时长:</span>
              <span className="lsm-detail-value">{formatGpuUsageMs(rustStatus.gpuUsageMs || 0)}</span>
            </div>
          </div>
        )}
        {errorLines && (
          <div className="lsm-error">
            <span className="lsm-error-icon">❌</span>
            <span>{errorLines}</span>
          </div>
        )}
      </div>
      <div className="lsm-actions">
        <label className="lsm-switch">
          <input
            type="checkbox"
            checked={rustStatus?.running || false}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={loading.rust || rustStatus?.starting}
          />
          <span className="lsm-switch-slider"></span>
        </label>
      </div>
    </div>
  );
}

interface DiscoveredItemProps {
  status: SemanticRepairServiceStatus | PhoneticServiceStatus;
  loading: Record<string, boolean>;
  getDisplayName: (id: string) => string;
  onToggle: (serviceId: string, checked: boolean) => void;
  filterError?: boolean;
}

export function ServiceManagementDiscoveredItem({
  status,
  loading,
  getDisplayName,
  onToggle,
  filterError = true,
}: DiscoveredItemProps) {
  const serviceId = status.serviceId;
  const isRunning = status.running;
  const isStarting = status.starting;
  const isLoading = loading[serviceId] || false;
  const displayName = getDisplayName(serviceId);
  const errorLines = filterError ? filterErrorLines(status.lastError ?? null) : (status.lastError ?? null);

  return (
    <div className="lsm-item">
      <div className="lsm-info">
        <div className="lsm-name-row">
          <h3>{displayName}</h3>
          <span className={`lsm-badge ${isRunning ? 'is-running' : isStarting ? 'is-starting' : 'is-stopped'}`}>
            {isRunning ? '运行中' : isStarting ? '正在启动...' : '已停止'}
          </span>
        </div>
        {isRunning && status.port && (
          <div className="lsm-details">
            <div className="lsm-detail-row">
              <span className="lsm-detail-label">端口:</span>
              <span className="lsm-detail-value">{status.port}</span>
            </div>
            {status.pid && (
              <div className="lsm-detail-row">
                <span className="lsm-detail-label">PID:</span>
                <span className="lsm-detail-value">{status.pid}</span>
              </div>
            )}
          </div>
        )}
        {errorLines && (
          <div className="lsm-error">
            <span className="lsm-error-icon">❌</span>
            <span>{errorLines}</span>
          </div>
        )}
      </div>
      <div className="lsm-actions">
        <label className="lsm-switch">
          <input
            type="checkbox"
            checked={isRunning}
            onChange={(e) => onToggle(serviceId, e.target.checked)}
            disabled={isLoading || isStarting}
          />
          <span className="lsm-switch-slider"></span>
        </label>
      </div>
    </div>
  );
}

interface PythonSectionProps {
  pythonStatuses: ServiceStatus[];
  loading: Record<string, boolean>;
  processingMetrics: Record<string, number>;
  getServiceDisplayName: (id: string) => string;
  getServiceId: (name: string) => string;
  formatGpuUsageMs: (ms: number) => string;
  onToggle: (serviceName: PythonServiceName, checked: boolean) => void;
}

export function ServiceManagementPythonSection({
  pythonStatuses,
  loading,
  processingMetrics,
  getServiceDisplayName,
  getServiceId,
  formatGpuUsageMs,
  onToggle,
}: PythonSectionProps) {
  const serviceNames: PythonServiceName[] = ['faster_whisper_vad', 'nmt', 'tts', 'yourtts', 'speaker_embedding'];

  return (
    <>
      {serviceNames.map((serviceName) => {
        const status = pythonStatuses.find(s => s.name === serviceName);
        const isRunning = status?.running || false;
        const isStarting = status?.starting || false;
        const isLoading = loading[serviceName] || false;
        const serviceId = getServiceId(serviceName);
        const efficiency = processingMetrics[serviceId];

        const renderEfficiency = () => {
          if (serviceName === 'faster_whisper_vad') {
            console.log(`[${serviceName}] serviceId: ${serviceId}, efficiency:`, efficiency, 'all metrics:', processingMetrics);
          }
          if (efficiency !== undefined && efficiency !== null && !isNaN(efficiency)) {
            if (serviceName === 'faster_whisper_vad') {
              return (
                <div className="lsm-detail-row">
                  <span className="lsm-detail-label">处理效率:</span>
                  <span className="lsm-detail-value">{efficiency.toFixed(2)}x</span>
                </div>
              );
            }
            if (serviceName === 'nmt') {
              return (
                <div className="lsm-detail-row">
                  <span className="lsm-detail-label">处理效率:</span>
                  <span className="lsm-detail-value">{efficiency.toFixed(2)} 字符/秒</span>
                </div>
              );
            }
            if (serviceName === 'tts' || serviceName === 'yourtts') {
              return (
                <div className="lsm-detail-row">
                  <span className="lsm-detail-label">处理效率:</span>
                  <span className="lsm-detail-value">{efficiency.toFixed(2)}x</span>
                </div>
              );
            }
          }
          return (
            <div className="lsm-detail-row">
              <span className="lsm-detail-label">处理效率:</span>
              <span className="lsm-detail-value" style={{ color: '#999' }}>暂无数据</span>
            </div>
          );
        };

        const errorLines = filterErrorLines(status?.lastError ?? null);

        return (
          <div key={serviceName} className="lsm-item">
            <div className="lsm-info">
              <div className="lsm-name-row">
                <h3>{getServiceDisplayName(serviceName)}</h3>
                <span className={`lsm-badge ${isRunning ? 'is-running' : isStarting ? 'is-starting' : 'is-stopped'}`}>
                  {isRunning ? '运行中' : isStarting ? '正在启动...' : '已停止'}
                </span>
              </div>
              {isRunning && status && (
                <div className="lsm-details">
                  <div className="lsm-detail-row">
                    <span className="lsm-detail-label">任务次数:</span>
                    <span className="lsm-detail-value">{status.taskCount || 0}</span>
                  </div>
                  <div className="lsm-detail-row">
                    <span className="lsm-detail-label">GPU使用时长:</span>
                    <span className="lsm-detail-value">{formatGpuUsageMs(status.gpuUsageMs || 0)}</span>
                  </div>
                  {renderEfficiency()}
                </div>
              )}
              {errorLines && (
                <div className="lsm-error">
                  <span className="lsm-error-icon">❌</span>
                  <span>{errorLines}</span>
                </div>
              )}
            </div>
            <div className="lsm-actions">
              <label className="lsm-switch">
                <input
                  type="checkbox"
                  checked={isRunning}
                  onChange={(e) => onToggle(serviceName, e.target.checked)}
                  disabled={isLoading || isStarting}
                />
                <span className="lsm-switch-slider"></span>
              </label>
            </div>
          </div>
        );
      })}
    </>
  );
}
