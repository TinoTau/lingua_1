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

    // 启动 NodeAgent（唯一入口，调度器地址见配置 scheduler.url）
    if (managers.nodeAgent) {
      logger.info({}, 'NodeAgent.start() 被调用（自动连接调度器）');
      managers.nodeAgent.start().catch((error) => {
        logger.error({ error }, 'Failed to start NodeAgent');
      });
    } else {
      logger.warn({}, 'NodeAgent 未创建，无法连接调度器');
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
});

// 生命周期用 getter 取当前 nodeAgent，避免模块加载时 managers 尚未赋值
const getNodeAgent = () => managers.nodeAgent;
registerWindowAllClosedHandler(getNodeAgent);
registerBeforeQuitHandler(getNodeAgent);
registerProcessSignalHandlers(getNodeAgent);
registerExceptionHandlers(getNodeAgent);

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
