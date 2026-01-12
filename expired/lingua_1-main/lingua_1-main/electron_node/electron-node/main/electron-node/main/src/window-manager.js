"use strict";
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
exports.getMainWindow = getMainWindow;
exports.createWindow = createWindow;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("./logger"));
let mainWindow = null;
function getMainWindow() {
    return mainWindow;
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    // 检查构建文件是否存在，如果存在则优先使用构建文件
    const distPath = path.join(__dirname, '../../renderer/dist/index.html');
    const fs = require('fs');
    const distExists = fs.existsSync(distPath);
    if (isDev && !distExists) {
        // 开发模式：尝试连接 Vite dev server（默认 5173，如果被占用可能在其他端口）
        const vitePort = process.env.VITE_PORT || '5173';
        const viteUrl = `http://localhost:${vitePort}`;
        logger_1.default.info({ viteUrl }, 'Development mode: Loading Vite dev server');
        if (mainWindow) {
            mainWindow.loadURL(viteUrl).catch((error) => {
                logger_1.default.error({ error, viteUrl }, 'Failed to load Vite dev server, trying fallback port');
                // 如果 5173 失败，尝试 5174（Vite 自动切换的端口）
                if (mainWindow) {
                    mainWindow.loadURL('http://localhost:5174').catch((err) => {
                        logger_1.default.error({ error: err }, 'Failed to load Vite dev server');
                    });
                }
            });
            // 不再自动打开调试工具，用户可以通过菜单或快捷键手动打开
            // mainWindow.webContents.openDevTools();
        }
    }
    else {
        // 生产模式：加载打包后的文件
        logger_1.default.info({ distPath, distExists }, 'Production mode: Loading built files');
        if (mainWindow) {
            mainWindow.loadFile(distPath).catch((error) => {
                logger_1.default.error({ error, distPath }, 'Failed to load built files');
            });
        }
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
