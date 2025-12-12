import React, { useState, useEffect } from 'react';
import { SystemResources } from './components/SystemResources';
import { ModelManagement } from './components/ModelManagement';
import { NodeStatus } from './components/NodeStatus';
import './App.css';

function App() {
  const [nodeStatus, setNodeStatus] = useState<any>(null);
  const [systemResources, setSystemResources] = useState<any>(null);

  useEffect(() => {
    // 定期获取节点状态和系统资源
    const interval = setInterval(async () => {
      const status = await window.electronAPI.getNodeStatus();
      const resources = await window.electronAPI.getSystemResources();
      setNodeStatus(status);
      setSystemResources(resources);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Lingua Node 客户端</h1>
        <NodeStatus status={nodeStatus} />
      </header>

      <main className="app-main">
        <div className="left-panel">
          <SystemResources resources={systemResources} />
        </div>
        <div className="right-panel">
          <ModelManagement />
        </div>
      </main>
    </div>
  );
}

export default App;

