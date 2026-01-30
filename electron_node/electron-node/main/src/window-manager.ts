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
  // 如果 NODE_ENV=production，强制使用生产模式（即使 app.isPackaged=false）
  const isProduction = process.env.NODE_ENV === 'production';
  // 只有在非生产环境且未打包时，才使用开发模式
  const isDev = !isProduction && !app.isPackaged;
  
  // 检查构建文件是否存在
  // 编译后输出到 dist/main/electron-node/main/src/window-manager.js
  // 需要: ../../../../../renderer/dist/index.html
  const distPath = path.join(__dirname, '../../../../../renderer/dist/index.html');
  const fs = require('fs');
  const distExists = fs.existsSync(distPath);

  logger.info({ 
    isProduction, 
    isDev, 
    appIsPackaged: app.isPackaged, 
    nodeEnv: process.env.NODE_ENV,
    distExists, 
    distPath 
  }, 'Window loading mode decision');

  // 生产模式：直接加载构建文件，不尝试Vite
  if (isProduction) {
    logger.info({ distPath, distExists }, 'Production mode: Loading built files');
    if (mainWindow) {
      if (distExists) {
        // 使用 loadFile，它应该能正确处理相对路径（如果 Vite 配置了 base: './'）
        mainWindow.loadFile(distPath).then(() => {
          logger.info({ distPath }, '✅ Successfully loaded built files');
        }).catch((error) => {
          logger.error({ error, distPath }, 'Failed to load built files');
        });
      } else {
        logger.error({ distPath }, '❌ CRITICAL: Production mode but renderer/dist not found! Please build renderer first: npm run build:renderer');
        mainWindow.loadURL('data:text/html,<html><body><h1>Renderer not built</h1><p>Please run: npm run build:renderer</p></body></html>');
      }
    }
  } else if (isDev) {
    // 开发模式：优先尝试 Vite，失败后回退到构建文件
    // 开发模式：优先尝试连接 Vite dev server
    const vitePort = process.env.VITE_PORT || '5173';
    const viteUrl = `http://localhost:${vitePort}`;
    logger.info({ viteUrl, distExists }, 'Development mode: Trying Vite dev server first');
    
    // 尝试多个可能的端口
    const tryPorts = async (ports: string[]) => {
      for (const port of ports) {
        try {
          const url = `http://localhost:${port}`;
          await mainWindow?.loadURL(url);
          logger.info({ url }, '✅ Successfully loaded Vite dev server');
          return true;
        } catch (error) {
          logger.debug({ port }, `Vite not available on port ${port}, trying next...`);
        }
      }
      return false;
    };
    
    if (mainWindow) {
      // 尝试 Vite，失败则回退到构建文件
      tryPorts(['5173', '5174', '5175', '5176', '5177', '5178']).then((success) => {
        if (!success && distExists) {
          logger.info({ distPath }, 'Vite not available, falling back to built files');
          mainWindow?.loadFile(distPath).catch((error) => {
            logger.error({ error, distPath }, 'Failed to load built files');
          });
        } else if (!success) {
          logger.error({}, '❌ CRITICAL: No Vite server and no built files found!');
        }
      }).catch((err) => {
        logger.error({ error: err }, '❌ CRITICAL: Failed to load UI!');
      });
    }
  } else {
    // 既不是生产模式也不是开发模式（可能是已打包但NODE_ENV未设置）
    // 默认使用构建文件
    logger.info({ distPath, distExists, isProduction, isDev, appIsPackaged: app.isPackaged }, 'Fallback mode: Loading built files');
    if (mainWindow) {
      if (distExists) {
        mainWindow.loadFile(distPath).catch((error) => {
          logger.error({ error, distPath }, 'Failed to load built files');
        });
      } else {
        logger.error({ distPath }, '❌ CRITICAL: renderer/dist not found! Please build renderer first: npm run build:renderer');
        mainWindow.loadURL('data:text/html,<html><body><h1>Renderer not built</h1><p>Please run: npm run build:renderer</p></body></html>');
      }
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

