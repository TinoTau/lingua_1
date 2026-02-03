import React, { useState, useEffect } from 'react';
import './NodeStatus.css';

interface NodeStatusProps {
  status: {
    online: boolean;
    nodeId: string | null;
    connected: boolean;
  } | null;
  /** 重连后立即刷新状态（由父组件传入，避免等 2s 轮询） */
  onRefreshStatus?: () => Promise<void>;
}

export function NodeStatus({ status, onRefreshStatus }: NodeStatusProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status?.connected) setErrorMessage(null);
  }, [status?.connected]);

  if (!status) {
    return <div className="lns-root">加载中...</div>;
  }

  const handleReconnect = async () => {
    if (status.connected || isReconnecting) {
      return;
    }

    setIsReconnecting(true);
    setErrorMessage(null);
    try {
      const result = await window.electronAPI.reconnectNode();
      if (!result.success) {
        const msg = result.error || '重连失败';
        setErrorMessage(msg);
        console.error('重连失败:', result.error);
      } else {
        await onRefreshStatus?.();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(msg);
      console.error('重连失败:', error);
    } finally {
      setIsReconnecting(false);
    }
  };

  const title = errorMessage ? errorMessage : (!status.connected ? '点击重连' : undefined);

  return (
    <div
      className={`lns-root ${status.connected ? 'is-connected' : 'is-disconnected'} ${!status.connected ? 'is-clickable' : ''}`}
      onClick={handleReconnect}
      style={!status.connected ? { cursor: 'pointer' } : undefined}
      title={title}
    >
      <span className="lns-indicator"></span>
      <span className="lns-text">
        {isReconnecting ? '重连中...' : (status.connected ? '已连接' : '未连接')}
      </span>
      {status.nodeId && (
        <span className="lns-node-id">节点ID: {status.nodeId}</span>
      )}
      {errorMessage && (
        <span className="lns-error" title={errorMessage}>
          （{errorMessage}）
        </span>
      )}
    </div>
  );
}

