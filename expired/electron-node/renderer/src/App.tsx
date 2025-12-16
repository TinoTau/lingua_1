import React, { useState, useEffect } from 'react';
import { SystemResources } from './components/SystemResources';
import { ModelManagement } from './components/ModelManagement';
import { NodeStatus } from './components/NodeStatus';
import { RustServiceStatus } from './components/RustServiceStatus';
import { ServiceManagement } from './components/ServiceManagement';
import './App.css';

function App() {
  const [nodeStatus, setNodeStatus] = useState<any>(null);
  const [systemResources, setSystemResources] = useState<any>(null);
  const [rustServiceStatus, setRustServiceStatus] = useState<any>(null);

  useEffect(() => {
    // 定期获取节点状态、系统资源和 Rust 服务状态
    const interval = setInterval(async () => {
      const status = await window.electronAPI.getNodeStatus();
      const resources = await window.electronAPI.getSystemResources();
      const rustStatus = await window.electronAPI.getRustServiceStatus();
      setNodeStatus(status);
      setSystemResources(resources);
      setRustServiceStatus(rustStatus);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Lingua Node 客户端</h1>
        <div className="header-status">
          <RustServiceStatus status={rustServiceStatus} />
          <NodeStatus status={nodeStatus} />
        </div>
      </header>

      <main className="app-main">
        <div className="left-panel">
          <SystemResources resources={systemResources} />
        </div>
        <div className="middle-panel">
          <ServiceManagement />
        </div>
        <div className="right-panel">
          <ModelManagement />
        </div>
      </main>
    </div>
  );
}

export default App;

