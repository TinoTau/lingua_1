"use strict";
/**
 * 应用依赖检查模块
 * 负责检查系统依赖并显示错误对话框
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDependenciesAndShowDialog = checkDependenciesAndShowDialog;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../logger"));
const dependency_checker_1 = require("../utils/dependency-checker");
/**
 * 检查依赖并显示对话框
 */
function checkDependenciesAndShowDialog(mainWindow) {
    try {
        const dependencies = (0, dependency_checker_1.checkAllDependencies)();
        const { valid, missing } = (0, dependency_checker_1.validateRequiredDependencies)();
        if (!valid) {
            logger_1.default.error({ missing }, 'Required dependencies are missing');
            // 构建错误消息
            const missingList = missing.join(', ');
            const message = `缺少必需的依赖：${missingList}\n\n` +
                '请安装以下依赖后重新启动应用：\n\n' +
                dependencies
                    .filter(dep => dep.required && !dep.installed)
                    .map(dep => {
                    let installGuide = '';
                    if (dep.name === 'Python') {
                        installGuide = '• Python 3.10+\n  下载：https://www.python.org/downloads/\n  安装时请勾选 "Add Python to PATH"';
                    }
                    else if (dep.name === 'ffmpeg') {
                        installGuide = '• ffmpeg\n  Windows: 下载 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip\n  解压到 C:\\ffmpeg，并将 C:\\ffmpeg\\bin 添加到系统 PATH';
                    }
                    return `${dep.name}:\n  ${dep.message}\n  ${installGuide}`;
                })
                    .join('\n\n') +
                '\n\n详细安装指南请查看：electron_node/electron-node/docs/DEPENDENCY_INSTALLATION.md';
            // 显示错误对话框
            if (mainWindow) {
                electron_1.dialog.showMessageBox(mainWindow, {
                    type: 'error',
                    title: '依赖检查失败',
                    message: '缺少必需的系统依赖',
                    detail: message,
                    buttons: ['确定', '查看文档'],
                    defaultId: 0,
                    cancelId: 0,
                }).then((result) => {
                    if (result.response === 1) {
                        // 打开文档（如果存在）
                        const docPath = path.join(__dirname, '../../docs/DEPENDENCY_INSTALLATION.md');
                        electron_1.shell.openPath(docPath).catch(() => {
                            // 如果文件不存在，打开包含文档的目录
                            electron_1.shell.openPath(path.dirname(docPath));
                        });
                    }
                }).catch((error) => {
                    logger_1.default.error({ error }, 'Failed to show dependency error dialog');
                });
            }
            else {
                // 如果窗口不存在，输出到控制台
                console.error('缺少必需的依赖：', missing);
                console.error(message);
            }
            // 注意：不阻止应用启动，但依赖缺失可能导致服务无法正常工作
            logger_1.default.warn('应用将继续启动，但某些功能可能无法正常工作');
        }
        else {
            logger_1.default.info('所有必需依赖已安装');
        }
    }
    catch (error) {
        logger_1.default.error({ error }, '依赖检查失败，继续启动应用');
    }
}
