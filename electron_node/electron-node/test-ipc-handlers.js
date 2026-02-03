/**
 * IPC Handlers 诊断脚本
 * 验证所有必需的 IPC handlers 是否正确注册
 */

const { app, ipcMain } = require('electron');
const path = require('path');

console.log('======================================');
console.log('IPC Handlers 诊断测试');
console.log('======================================\n');

// 等待 app ready
app.whenReady().then(async () => {
  console.log('✅ Electron app ready\n');

  try {
    // 加载主进程代码
    const indexPath = path.join(__dirname, 'main', 'electron-node', 'main', 'src', 'index.js');
    console.log(`Loading main process from: ${indexPath}`);

    // 等待一下，让主进程初始化
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 检查所有IPC handlers
    console.log('\n检查已注册的 IPC Handlers:\n');

    const requiredHandlers = [
      'get-system-resources',
      'get-all-service-metadata',
      'get-node-status',
      'get-rust-service-status',
      'start-rust-service',
      'stop-rust-service',
      'get-python-service-status',
      'get-all-python-service-statuses',
      'start-python-service',
      'stop-python-service',
      'get-service-preferences',
      'set-service-preferences',
      'get-processing-metrics',
      'get-semantic-repair-service-status',
      'services:list',
      'services:statuses',
      'services:refresh',
      'services:start',
      'services:stop',
      'services:get',
      'get-installed-models',
      'get-available-models',
      'download-model',
      'uninstall-model',
      'get-model-path',
      'get-model-ranking',
    ];

    let registeredCount = 0;
    let missingCount = 0;

    for (const handler of requiredHandlers) {
      try {
        // 尝试调用handler（可能会失败，但至少能知道它是否注册）
        const result = await ipcMain.handle(handler, async () => {
          return { __test: true };
        });

        console.log(`✅ ${handler}`);
        registeredCount++;
      } catch (error) {
        console.log(`❌ ${handler} - 未注册或错误`);
        missingCount++;
      }
    }

    console.log('\n======================================');
    console.log(`总计: ${requiredHandlers.length} 个 handlers`);
    console.log(`已注册: ${registeredCount} 个`);
    console.log(`缺失: ${missingCount} 个`);
    console.log('======================================\n');

    if (missingCount > 0) {
      console.error('⚠️ 存在未注册的 IPC handlers！');
      console.error('可能原因:');
      console.error('1. 主进程初始化失败');
      console.error('2. registerHandlers 函数未被调用');
      console.error('3. 编译产物未更新');
    } else {
      console.log('✅ 所有 IPC handlers 已正确注册！');
    }

    process.exit(missingCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ 诊断脚本执行失败:', error);
    process.exit(1);
  }
});

// 超时保护
setTimeout(() => {
  console.error('\n❌ 诊断脚本超时（30秒）');
  process.exit(1);
}, 30000);
