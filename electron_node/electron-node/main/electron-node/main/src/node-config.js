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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNodeConfig = loadNodeConfig;
exports.saveNodeConfig = saveNodeConfig;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_CONFIG = {
    servicePreferences: {
        rustEnabled: true, // 默认启用推理服务
        nmtEnabled: true, // 默认启用 NMT
        ttsEnabled: true, // 默认启用 Piper TTS
        yourttsEnabled: false, // 默认关闭 YourTTS（资源较重）
    },
    scheduler: {
        url: 'ws://127.0.0.1:5010/ws/node', // 默认本地地址，使用 127.0.0.1 避免 IPv6 解析问题
    },
};
function getConfigPath() {
    const userData = electron_1.app.getPath('userData');
    return path.join(userData, 'electron-node-config.json');
}
function loadNodeConfig() {
    try {
        const configPath = getConfigPath();
        if (!fs.existsSync(configPath)) {
            return { ...DEFAULT_CONFIG };
        }
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 简单合并，避免缺字段
        return {
            servicePreferences: {
                ...DEFAULT_CONFIG.servicePreferences,
                ...(parsed.servicePreferences || {}),
            },
            scheduler: {
                ...DEFAULT_CONFIG.scheduler,
                ...(parsed.scheduler || {}),
            },
        };
    }
    catch (error) {
        // 读取失败时使用默认配置
        return { ...DEFAULT_CONFIG };
    }
}
function saveNodeConfig(config) {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
