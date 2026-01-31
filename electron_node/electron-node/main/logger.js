"use strict";
// 日志模块 - 与 main/src/logger.ts 路径与行为一致；从 main/ 树加载时使用本文件。
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
const pino_1 = __importDefault(require("pino"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 使用环境变量 LOG_LEVEL 控制日志级别（默认：info）
// 使用环境变量 LOG_FORMAT 控制控制台输出格式：json（默认）或 pretty
const logLevel = process.env.LOG_LEVEL || 'info';
const logFormat = process.env.LOG_FORMAT || 'json';
// 日志路径：固定为「electron-node 项目根/logs」，与 main/src/logger.ts 及脚本一致
function findProjectRoot(startDir) {
    let dir = path.resolve(startDir);
    for (;;) {
        try {
            if (fs.existsSync(path.join(dir, 'package.json')) &&
                fs.existsSync(path.join(dir, 'main'))) {
                return dir;
            }
        }
        catch (_) { /* ignore */ }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return process.cwd();
}
const baseDir = typeof __dirname !== 'undefined' ? findProjectRoot(__dirname) : process.cwd();
const logDir = path.join(baseDir, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}
const isTestEnv = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
const logFile = path.join(logDir, isTestEnv ? 'electron-main.test.log' : 'electron-main.log');
console.log('[Logger] Log file:', logFile);
let logger;
if (logFormat === 'pretty') {
    logger = (0, pino_1.default)({
        level: logLevel,
        transport: {
            targets: [
                { target: 'pino-pretty', level: logLevel, options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' } },
                { target: 'pino/file', level: logLevel, options: { destination: logFile } },
            ],
        },
    });
}
else {
    logger = (0, pino_1.default)({
        level: logLevel,
        transport: {
            targets: [
                { target: 'pino/file', level: logLevel, options: { destination: logFile } },
            ],
        },
    });
}
exports.default = logger;
