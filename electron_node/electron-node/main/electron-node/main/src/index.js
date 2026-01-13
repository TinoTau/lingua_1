"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const window_manager_1 = require("./window-manager");
const app_dependencies_1 = require("./app/app-dependencies");
const app_init_1 = require("./app/app-init");
const app_lifecycle_1 = require("./app/app-lifecycle");
const logger_1 = __importDefault(require("./logger"));
let managers = {
    nodeAgent: null,
    modelManager: null,
    inferenceService: null,
    rustServiceManager: null,
    pythonServiceManager: null,
    serviceRegistryManager: null,
    servicePackageManager: null,
    semanticRepairServiceManager: null,
};
electron_1.app.whenReady().then(async () => {
    (0, window_manager_1.createWindow)();
    // 等待窗口加载完成后检查系统依赖
    const mainWindow = (0, window_manager_1.getMainWindow)();
    if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => {
            (0, app_dependencies_1.checkDependenciesAndShowDialog)(mainWindow);
        });
    }
    else {
        setTimeout(() => {
            const window = (0, window_manager_1.getMainWindow)();
            if (window) {
                (0, app_dependencies_1.checkDependenciesAndShowDialog)(window);
            }
            else {
                (0, app_dependencies_1.checkDependenciesAndShowDialog)(null);
            }
        }, 1000);
    }
    try {
        // 初始化所有服务
        managers = await (0, app_init_1.initializeServices)();
        // 加载并验证配置
        (0, app_init_1.loadAndValidateConfig)();
        // 启动服务（根据用户偏好）
        await (0, app_init_1.startServicesByPreference)(managers);
        // 注册 IPC 处理器
        (0, app_init_1.registerIpcHandlers)(managers);
        // 启动 Node Agent
        (0, app_init_1.startNodeAgent)(managers);
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to initialize services');
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            (0, window_manager_1.createWindow)();
        }
    });
    // 注册生命周期事件处理器
    const mainWindowForClose = (0, window_manager_1.getMainWindow)();
    (0, app_lifecycle_1.registerWindowCloseHandler)(mainWindowForClose, managers.rustServiceManager, managers.pythonServiceManager, managers.semanticRepairServiceManager);
});
// 注册生命周期事件处理器
(0, app_lifecycle_1.registerWindowAllClosedHandler)(managers.nodeAgent, managers.rustServiceManager, managers.pythonServiceManager, managers.semanticRepairServiceManager);
(0, app_lifecycle_1.registerBeforeQuitHandler)(managers.nodeAgent, managers.rustServiceManager, managers.pythonServiceManager, managers.semanticRepairServiceManager);
(0, app_lifecycle_1.registerProcessSignalHandlers)(managers.nodeAgent, managers.rustServiceManager, managers.pythonServiceManager, managers.semanticRepairServiceManager);
(0, app_lifecycle_1.registerExceptionHandlers)(managers.nodeAgent, managers.rustServiceManager, managers.pythonServiceManager, managers.semanticRepairServiceManager);
// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
