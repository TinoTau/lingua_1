import React from 'react';
import './SystemResources.css';

interface SystemResourcesProps {
  resources: {
    cpu: number;
    gpu: number | null;
    memory: number;
  } | null;
  onOpenModelManagement?: () => void;
}

export function SystemResources({ resources, onOpenModelManagement }: SystemResourcesProps) {
  if (!resources) {
    return <div className="lsr-root">加载中...</div>;
  }

  return (
    <div className="lsr-root">
      <h2 className="lsr-title">系统资源</h2>
      <div className="lsr-item">
        <label className="lsr-label">CPU:</label>
        <div className="lsr-progress">
          <div
            className="lsr-progress-fill"
            style={{ width: `${resources.cpu}%` }}
          ></div>
        </div>
        <span className="lsr-value">{resources.cpu.toFixed(1)}%</span>
      </div>
      {resources.gpu !== null && (
        <div className="lsr-item">
          <label className="lsr-label">GPU:</label>
          <div className="lsr-progress">
            <div
              className="lsr-progress-fill"
              style={{ width: `${resources.gpu}%` }}
            ></div>
          </div>
          <span className="lsr-value">{resources.gpu.toFixed(1)}%</span>
        </div>
      )}
      <div className="lsr-item">
        <label className="lsr-label">内存:</label>
        <div className="lsr-progress">
          <div
            className="lsr-progress-fill"
            style={{ width: `${resources.memory}%` }}
          ></div>
        </div>
        <span className="lsr-value">{resources.memory.toFixed(1)}%</span>
      </div>
      
      {onOpenModelManagement && (
        <div className="lsr-model-btn-container">
          <button 
            className="lsr-model-btn"
            onClick={onOpenModelManagement}
          >
            模型管理
          </button>
        </div>
      )}
    </div>
  );
}

