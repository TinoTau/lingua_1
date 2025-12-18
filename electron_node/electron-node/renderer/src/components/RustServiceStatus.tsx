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
    return <div className="lrs-root">加载中...</div>;
  }

  return (
    <div className={`lrs-root ${status.running ? 'is-running' : 'is-stopped'}`}>
      <div className="lrs-header">
        <span className="lrs-indicator"></span>
        <span className="lrs-text">
          {status.running ? '推理服务运行中' : '推理服务已停止'}
        </span>
      </div>

      {status.running && (
        <div className="lrs-details">
          {status.pid && (
            <div className="lrs-detail-item">
              <span className="lrs-detail-label">进程ID:</span>
              <span className="lrs-detail-value">{status.pid}</span>
            </div>
          )}
          {status.port && (
            <div className="lrs-detail-item">
              <span className="lrs-detail-label">端口:</span>
              <span className="lrs-detail-value">{status.port}</span>
            </div>
          )}
          {status.startedAt && (
            <div className="lrs-detail-item">
              <span className="lrs-detail-label">启动时间:</span>
              <span className="lrs-detail-value">
                {new Date(status.startedAt).toLocaleTimeString('zh-CN')}
              </span>
            </div>
          )}
        </div>
      )}

      {status.lastError && (
        <div className="lrs-error">
          <span className="lrs-error-label">错误:</span>
          <span className="lrs-error-text">{status.lastError}</span>
        </div>
      )}
    </div>
  );
}
