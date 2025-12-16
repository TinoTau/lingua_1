import React from 'react';
import './RustServiceStatus.css';

interface RustServiceStatusProps {
  status: {
    running: boolean;
    pid: number | null;
    port: number | null;
    startedAt: Date | null;
    lastError: string | null;
  } | null;
}

export function RustServiceStatus({ status }: RustServiceStatusProps) {
  if (!status) {
    return <div className="rust-service-status">加载中...</div>;
  }

  return (
    <div className={`rust-service-status ${status.running ? 'running' : 'stopped'}`}>
      <div className="status-header">
        <span className="status-indicator"></span>
        <span className="status-text">
          {status.running ? '推理服务运行中' : '推理服务已停止'}
        </span>
      </div>

      {status.running && (
        <div className="status-details">
          {status.pid && (
            <div className="detail-item">
              <span className="detail-label">进程ID:</span>
              <span className="detail-value">{status.pid}</span>
            </div>
          )}
          {status.port && (
            <div className="detail-item">
              <span className="detail-label">端口:</span>
              <span className="detail-value">{status.port}</span>
            </div>
          )}
          {status.startedAt && (
            <div className="detail-item">
              <span className="detail-label">启动时间:</span>
              <span className="detail-value">
                {new Date(status.startedAt).toLocaleTimeString('zh-CN')}
              </span>
            </div>
          )}
        </div>
      )}

      {status.lastError && (
        <div className="error-message">
          <span className="error-label">错误:</span>
          <span className="error-text">{status.lastError}</span>
        </div>
      )}
    </div>
  );
}
