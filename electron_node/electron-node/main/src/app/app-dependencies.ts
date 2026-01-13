/**
 * 应用依赖检查模块
 * 负责检查系统依赖并显示错误对话框
 */

import { BrowserWindow, dialog, shell } from 'electron';
import * as path from 'path';
import logger from '../logger';
import { checkAllDependencies, validateRequiredDependencies } from '../utils/dependency-checker';

/**
 * 检查依赖并显示对话框
 */
export function checkDependenciesAndShowDialog(mainWindow: BrowserWindow | null): void {
  try {
    const dependencies = checkAllDependencies();
    const { valid, missing } = validateRequiredDependencies();

    if (!valid) {
      logger.error({ missing }, 'Required dependencies are missing');

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
            } else if (dep.name === 'ffmpeg') {
              installGuide = '• ffmpeg\n  Windows: 下载 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip\n  解压到 C:\\ffmpeg，并将 C:\\ffmpeg\\bin 添加到系统 PATH';
            }
            return `${dep.name}:\n  ${dep.message}\n  ${installGuide}`;
          })
          .join('\n\n') +
        '\n\n详细安装指南请查看：electron_node/electron-node/docs/DEPENDENCY_INSTALLATION.md';

      // 显示错误对话框
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
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
            shell.openPath(docPath).catch(() => {
              // 如果文件不存在，打开包含文档的目录
              shell.openPath(path.dirname(docPath));
            });
          }
        }).catch((error) => {
          logger.error({ error }, 'Failed to show dependency error dialog');
        });
      } else {
        // 如果窗口不存在，输出到控制台
        console.error('缺少必需的依赖：', missing);
        console.error(message);
      }

      // 注意：不阻止应用启动，但依赖缺失可能导致服务无法正常工作
      logger.warn('应用将继续启动，但某些功能可能无法正常工作');
    } else {
      logger.info('所有必需依赖已安装');
    }
  } catch (error) {
    logger.error({ error }, '依赖检查失败，继续启动应用');
  }
}
