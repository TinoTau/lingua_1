import React from 'react';

function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>测试页面 - 简化版</h1>
      <p>如果您能看到这个页面，说明React渲染正常。</p>
      <button onClick={() => alert('按钮点击测试')}>测试按钮</button>
      
      <hr />
      
      <h2>测试electronAPI</h2>
      <button onClick={async () => {
        try {
          console.log('window.electronAPI:', window.electronAPI);
          const resources = await window.electronAPI.getSystemResources();
          console.log('系统资源:', resources);
          alert('API调用成功！查看Console');
        } catch (error) {
          console.error('API调用失败:', error);
          alert('API调用失败！查看Console');
        }
      }}>
        测试API调用
      </button>
    </div>
  );
}

export default App;
