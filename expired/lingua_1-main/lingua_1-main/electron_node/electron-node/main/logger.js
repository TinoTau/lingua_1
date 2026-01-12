"use strict";
// 日志模块 - 使用 pino 进行结构化日志记录（同时输出到控制台和文件）
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
// 以当前工作目录为根目录创建日志目录
// 开发模式：一般是 electron-node 目录
// 生产模式：一般是应用安装目录
const baseDir = process.cwd();
const logDir = path.join(baseDir, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'electron-main.log');
let logger;
if (logFormat === 'pretty') {
    // 开发/调试模式：控制台使用 pretty，文件写入 JSON
    logger = (0, pino_1.default)({
        level: logLevel,
        transport: {
            targets: [
                {
                    target: 'pino-pretty',
                    level: logLevel,
                    options: {
                        colorize: true,
                        translateTime: 'HH:MM:ss Z',
                        ignore: 'pid,hostname',
                    },
                },
                {
                    target: 'pino/file',
                    level: logLevel,
                    options: {
                        destination: logFile,
                    },
                },
            ],
        },
    });
}
else {
    // 生产模式：仅写入 JSON 文件（结构化日志，便于采集）
    // 注意：使用 transport 时，不能同时使用 formatters 或 timestamp 等顶层配置
    logger = (0, pino_1.default)({
        level: logLevel,
        transport: {
            targets: [
                {
                    target: 'pino/file',
                    level: logLevel,
                    options: {
                        destination: logFile,
                    },
                },
            ],
        },
    });
}
exports.default = logger;
