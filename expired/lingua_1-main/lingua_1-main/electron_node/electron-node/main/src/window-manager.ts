import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import logger from './logger';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    resizable: true, // 允许窗口自由缩放
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 开发环境加载 Vite 开发服务器，生产环境加载构建后的文件
  // 判断开发环境：NODE_ENV=development 或 app.isPackaged=false
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  // 检查构建文件是否存在，如果存在则优先使用构建文件
  const distPath = path.join(__dirname, '../../renderer/dist/index.html');
  const fs = require('fs');
  const distExists = fs.existsSync(distPath);

  if (isDev && !distExists) {
    // 开发模式：尝试连接 Vite dev server（默认 5173，如果被占用可能在其他端口）
    const vitePort = process.env.VITE_PORT || '5173';
    const viteUrl = `http://localhost:${vitePort}`;
    logger.info({ viteUrl }, 'Development mode: Loading Vite dev server');
    if (mainWindow) {
      mainWindow.loadURL(viteUrl).catch((error) => {
        logger.error({ error, viteUrl }, 'Failed to load Vite dev server, trying fallback port');
        // 如果 5173 失败，尝试 5174（Vite 自动切换的端口）
        if (mainWindow) {
          mainWindow.loadURL('http://localhost:5174').catch((err) => {
            logger.error({ error: err }, 'Failed to load Vite dev server');
          });
        }
      });
      // 不再自动打开调试工具，用户可以通过菜单或快捷键手动打开
      // mainWindow.webContents.openDevTools();
    }
  } else {
    // 生产模式：加载打包后的文件
    logger.info({ distPath, distExists }, 'Production mode: Loading built files');
    if (mainWindow) {
      mainWindow.loadFile(distPath).catch((error) => {
        logger.error({ error, distPath }, 'Failed to load built files');
      });
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

