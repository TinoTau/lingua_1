import React, { useState, useEffect } from 'react';
import { SystemResources } from './components/SystemResources';
import { ModelManagement } from './components/ModelManagement';
import { NodeStatus } from './components/NodeStatus';
import { ServiceManagement } from './components/ServiceManagement';
import './App.css';

type Page = 'main' | 'modelManagement';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('main');
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

  const handleOpenModelManagement = () => {
    setCurrentPage('modelManagement');
  };

  const handleBackToMain = () => {
    setCurrentPage('main');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Lingua Node 客户端</h1>
        <div className="header-status">
          <NodeStatus status={nodeStatus} />
        </div>
      </header>

      <main className="app-main">
        {currentPage === 'main' ? (
          <>
            <div className="left-panel">
              <SystemResources 
                resources={systemResources} 
                onOpenModelManagement={handleOpenModelManagement}
              />
            </div>
            <div className="middle-panel">
              <ServiceManagement />
            </div>
          </>
        ) : (
          <div className="model-management-page">
            <ModelManagement onBack={handleBackToMain} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

