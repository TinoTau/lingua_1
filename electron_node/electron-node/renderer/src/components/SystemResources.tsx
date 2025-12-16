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
    return <div>加载中...</div>;
  }

  return (
    <div className="system-resources">
      <h2>系统资源</h2>
      <div className="resource-item">
        <label>CPU:</label>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${resources.cpu}%` }}
          ></div>
        </div>
        <span>{resources.cpu.toFixed(1)}%</span>
      </div>
      {resources.gpu !== null && (
        <div className="resource-item">
          <label>GPU:</label>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${resources.gpu}%` }}
            ></div>
          </div>
          <span>{resources.gpu.toFixed(1)}%</span>
        </div>
      )}
      <div className="resource-item">
        <label>内存:</label>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${resources.memory}%` }}
          ></div>
        </div>
        <span>{resources.memory.toFixed(1)}%</span>
      </div>
      
      {onOpenModelManagement && (
        <div className="model-management-button-container">
          <button 
            className="model-management-button"
            onClick={onOpenModelManagement}
          >
            模型管理
          </button>
        </div>
      )}
    </div>
  );
}

