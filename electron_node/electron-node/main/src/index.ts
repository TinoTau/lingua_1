/**
 * 主进程入口：路径别名、诊断钩子、CUDA 路径、Electron 启动与 IPC 编排
 * 路径别名与诊断钩子由子模块负责，本文件只做顺序调用与导出。
 */
require('./index-path-alias');
import { installDiagnosticHooks } from './index-diagnostic-hooks';
import { setupCudaPath } from './index-cuda-path';
import { registerIpcHandlers } from './index-ipc';
import { app, BrowserWindow } from 'electron';
import { createWindow, getMainWindow } from './window-manager';
import { checkDependenciesAndShowDialog } from './app/app-dependencies';
import {
  initializeServicesSimple as initializeServices,
  loadAndValidateConfig,
  startServicesByPreference,
  ServiceManagers
} from './app/app-init-simple';
import { loadNodeConfig } from './node-config';
import { registerWindowAllClosedHandler, registerBeforeQuitHandler, registerProcessSignalHandlers, registerExceptionHandlers } from './app/app-lifecycle-simple';
import { registerModelHandlers } from './ipc-handlers/model-handlers';
import { getServiceRunner } from './service-layer';
import logger from './logger';

installDiagnosticHooks();
setupCudaPath();

let managers: ServiceManagers = {
  nodeAgent: null,
  modelManager: null,
  inferenceService: null,
  serviceRunner: null,
  endpointResolver: null,
};

app.whenReady().then(async () => {
  console.log('\n========================================');
  console.log('🚀 Electron App Ready!');
  console.log('========================================\n');

  console.log('📍 Debug: Checking if packaged:', app.isPackaged);
  console.log('📍 Debug: NODE_ENV:', process.env.NODE_ENV || 'not set');

  // ✅ 开发模式：检查Vite是否运行（简单直接）
  // 如果 renderer/dist 已构建，或者 NODE_ENV=production，则跳过 Vite 检查（生产构建模式）
  const path = require('path');
  const fs = require('fs');
  const rendererDistPath = path.join(__dirname, '../../../renderer/dist');
  const rendererBuilt = fs.existsSync(rendererDistPath);
  const isProduction = process.env.NODE_ENV === 'production';

  // 只在开发环境且未构建时检查Vite
  // 生产环境（NODE_ENV=production）或已构建的renderer都不需要Vite
  if (!app.isPackaged && !rendererBuilt && !isProduction) {
    console.log('📍 Debug: Development mode, checking Vite...');
    try {
      await fetch('http://localhost:5173', { signal: AbortSignal.timeout(2000) });
      console.log('✅ Vite dev server is running');
    } catch (error) {
      console.error('📍 Debug: Vite check failed:', error);
      const { dialog } = require('electron');
      dialog.showErrorBox(
        '❌ 开发环境未就绪',
        '请先在另一个终端运行:\n\nnpm run dev\n\n等待Vite启动后，再运行 npm start'
      );
      app.quit();
      return;
    }
  } else {
    if (isProduction) {
      console.log('✅ Production mode (NODE_ENV=production), skipping Vite check');
    } else if (rendererBuilt) {
      console.log('✅ Renderer already built, skipping Vite check');
    } else if (app.isPackaged) {
      console.log('✅ App is packaged, skipping Vite check');
    }
  }

  console.log('📍 Debug: Proceeding to IPC handler registration...');

  logger.info({}, '🚀 Registering all IPC handlers immediately...');
  console.log('🔧 Registering IPC handlers...');
  registerIpcHandlers(() => managers);

  console.log('📱 Creating main window...');
  createWindow();
  console.log('✅ Main window created!\n');

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
    console.log('\n========================================');
    console.log('⚙️  Initializing service managers...');
    console.log('========================================\n');
    logger.info({}, '========================================');
    logger.info({}, '   使用新的简化服务层架构');
    logger.info({}, '========================================');

    // 初始化所有服务（简化版）
    console.log('🔄 Calling initializeServices()...');
    managers = await initializeServices();
    console.log('✅ initializeServices() completed!');
    console.log('   - serviceRunner:', !!managers.serviceRunner);
    console.log('   - endpointResolver:', !!managers.endpointResolver);
    console.log('   - modelManager:', !!managers.modelManager);
    console.log('   - inferenceService:', !!managers.inferenceService);
    console.log('   - nodeAgent:', !!managers.nodeAgent);

    // 加载并验证配置
    loadAndValidateConfig();

    // 启动服务（根据用户偏好）
    await startServicesByPreference(managers);

    // 注册 Model IPC 处理器
    registerModelHandlers(managers.modelManager);

    // ✅ 所有IPC handlers已在app.whenReady()中使用新架构注册

    logger.info({}, '✅ All service managers initialized successfully!');
    logger.info({
      serviceRunner: !!managers.serviceRunner,
      endpointResolver: !!managers.endpointResolver,
      modelManager: !!managers.modelManager,
      inferenceService: !!managers.inferenceService,
      nodeAgent: !!managers.nodeAgent,
    }, 'Managers status');

    // 启动 Node Agent（简化版）
    if (managers.nodeAgent) {
      managers.nodeAgent.start().catch((error) => {
        logger.error({ error }, 'Failed to start NodeAgent');
      });
    }

    logger.info({}, '========================================');
    logger.info({}, '   应用初始化完成（新架构）');
    logger.info({}, '========================================');
    console.log('\n========================================');
    console.log('🎉 Application initialized successfully!');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n❌ FATAL ERROR during initialization:');
    console.error(error);
    console.error('\n');
    logger.error({ error }, 'Failed to initialize services');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Day 5: 简化lifecycle，删除空的registerWindowCloseHandler
});

// 注册应用级生命周期事件处理器（使用新架构）
registerWindowAllClosedHandler(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

registerBeforeQuitHandler(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

registerProcessSignalHandlers(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

registerExceptionHandlers(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
