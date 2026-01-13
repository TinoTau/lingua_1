import { app, BrowserWindow } from 'electron';
import { createWindow, getMainWindow } from './window-manager';
import { checkDependenciesAndShowDialog } from './app/app-dependencies';
import { initializeServices, loadAndValidateConfig, startServicesByPreference, registerIpcHandlers, startNodeAgent, ServiceManagers } from './app/app-init';
import { registerWindowCloseHandler, registerWindowAllClosedHandler, registerBeforeQuitHandler, registerProcessSignalHandlers, registerExceptionHandlers } from './app/app-lifecycle';
import logger from './logger';

let managers: ServiceManagers = {
  nodeAgent: null,
  modelManager: null,
  inferenceService: null,
  rustServiceManager: null,
  pythonServiceManager: null,
  serviceRegistryManager: null,
  servicePackageManager: null,
  semanticRepairServiceManager: null,
};

app.whenReady().then(async () => {
  createWindow();

  // 等待窗口加载完成后检查系统依赖
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      checkDependenciesAndShowDialog(mainWindow);
    });
  } else {
    setTimeout(() => {
      const window = getMainWindow();
      if (window) {
        checkDependenciesAndShowDialog(window);
      } else {
        checkDependenciesAndShowDialog(null);
      }
    }, 1000);
  }

  try {
    // 初始化所有服务
    managers = await initializeServices();

    // 加载并验证配置
    loadAndValidateConfig();

    // 启动服务（根据用户偏好）
    await startServicesByPreference(managers);

    // 注册 IPC 处理器
    registerIpcHandlers(managers);

    // 启动 Node Agent
    startNodeAgent(managers);
  } catch (error) {
    logger.error({ error }, 'Failed to initialize services');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // 注册生命周期事件处理器
  const mainWindowForClose = getMainWindow();
  registerWindowCloseHandler(
    mainWindowForClose,
    managers.rustServiceManager,
    managers.pythonServiceManager,
    managers.semanticRepairServiceManager
  );
});

// 注册生命周期事件处理器
registerWindowAllClosedHandler(
  managers.nodeAgent,
  managers.rustServiceManager,
  managers.pythonServiceManager,
  managers.semanticRepairServiceManager
);

registerBeforeQuitHandler(
  managers.nodeAgent,
  managers.rustServiceManager,
  managers.pythonServiceManager,
  managers.semanticRepairServiceManager
);

registerProcessSignalHandlers(
  managers.nodeAgent,
  managers.rustServiceManager,
  managers.pythonServiceManager,
  managers.semanticRepairServiceManager
);

registerExceptionHandlers(
  managers.nodeAgent,
  managers.rustServiceManager,
  managers.pythonServiceManager,
  managers.semanticRepairServiceManager
);

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
