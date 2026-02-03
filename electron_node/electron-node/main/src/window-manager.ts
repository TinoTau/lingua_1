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

  // 仅加载已构建的 renderer（renderer/dist），不依赖 Vite
  // 编译后 __dirname = dist/main/electron-node/main/src，上溯 5 层到项目根
  const distPath = path.join(__dirname, '../../../../../renderer/dist/index.html');
  const fs = require('fs');
  const distExists = fs.existsSync(distPath);

  logger.info({ distExists, distPath }, 'Window load: renderer/dist');

  if (mainWindow) {
    if (distExists) {
      mainWindow.loadFile(distPath).then(() => {
        logger.info({ distPath }, '✅ Loaded renderer/dist');
      }).catch((error) => {
        logger.error({ error, distPath }, 'Failed to load renderer');
      });
    } else {
      logger.error({ distPath }, 'renderer/dist not found, run: npm run build:renderer');
      mainWindow.loadURL('data:text/html,<html><body><h1>Renderer not built</h1><p>Run: npm run build:renderer</p></body></html>');
    }
  }

  // 添加窗口加载事件监听，用于调试
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      logger.info({}, '✅ Window content loaded successfully');
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      logger.error({ errorCode, errorDescription, validatedURL }, '❌ Window content failed to load');
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

