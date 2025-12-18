import React, { useState } from 'react';
import './NodeStatus.css';

interface NodeStatusProps {
  status: {
    online: boolean;
    nodeId: string | null;
    connected: boolean;
  } | null;
}

export function NodeStatus({ status }: NodeStatusProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);

  if (!status) {
    return <div className="lns-root">加载中...</div>;
  }

  const handleReconnect = async () => {
    if (status.connected || isReconnecting) {
      return;
    }

    setIsReconnecting(true);
    try {
      const result = await window.electronAPI.reconnectNode();
      if (!result.success) {
        console.error('重连失败:', result.error);
      }
    } catch (error) {
      console.error('重连失败:', error);
    } finally {
      setIsReconnecting(false);
    }
  };

  return (
    <div 
      className={`lns-root ${status.connected ? 'is-connected' : 'is-disconnected'} ${!status.connected ? 'is-clickable' : ''}`}
      onClick={handleReconnect}
      style={!status.connected ? { cursor: 'pointer' } : undefined}
      title={!status.connected ? '点击重连' : undefined}
    >
      <span className="lns-indicator"></span>
      <span className="lns-text">
        {isReconnecting ? '重连中...' : (status.connected ? '已连接' : '未连接')}
      </span>
      {status.nodeId && (
        <span className="lns-node-id">节点ID: {status.nodeId}</span>
      )}
    </div>
  );
}

