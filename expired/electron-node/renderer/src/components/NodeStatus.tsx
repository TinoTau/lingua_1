import React from 'react';
import './NodeStatus.css';

interface NodeStatusProps {
  status: {
    online: boolean;
    nodeId: string | null;
    connected: boolean;
  } | null;
}

export function NodeStatus({ status }: NodeStatusProps) {
  if (!status) {
    return <div className="node-status">加载中...</div>;
  }

  return (
    <div className={`node-status ${status.connected ? 'connected' : 'disconnected'}`}>
      <span className="status-indicator"></span>
      <span className="status-text">
        {status.connected ? '已连接' : '未连接'}
      </span>
      {status.nodeId && (
        <span className="node-id">节点ID: {status.nodeId}</span>
      )}
    </div>
  );
}

