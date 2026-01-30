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
      try {
        const status = await window.electronAPI.getNodeStatus();
        setNodeStatus(status);
      } catch (error) {
        console.error('Failed to fetch node status:', error);
      }
      
      try {
        const resources = await window.electronAPI.getSystemResources();
        setSystemResources(resources);
      } catch (error) {
        console.error('Failed to fetch system resources:', error);
      }
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
    <div className="lap-root">
      <header className="lap-header">
        <h1>Lingua Node 客户端</h1>
        <div className="lap-header-status">
          <NodeStatus status={nodeStatus} />
        </div>
      </header>

      <main className="lap-main">
        {currentPage === 'main' ? (
          <>
            <div className="lap-left-panel">
              <SystemResources 
                resources={systemResources} 
                onOpenModelManagement={handleOpenModelManagement}
              />
            </div>
            <div className="lap-middle-panel">
              <ServiceManagement />
            </div>
          </>
        ) : (
          <div className="lap-model-management-page">
            <ModelManagement onBack={handleBackToMain} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
