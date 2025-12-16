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
exports.findProjectRoot = findProjectRoot;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const logger_1 = __importDefault(require("../logger"));
/**
 * 查找项目根目录
 */
function findProjectRoot() {
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    if (!isDev) {
        return path.dirname(process.execPath);
    }
    // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
    // 在 Electron 中：
    // - process.cwd() 可能是 electron-node 目录或项目根目录
    // - __dirname 是编译后的 JS 文件位置（electron-node/main）
    // - 项目根目录需要包含 electron_node/services 目录
    // 从多个可能的路径查找项目根目录
    const cwd = process.cwd();
    const candidates = [];
    // 1. 从 cwd 向上查找（最多向上3级）
    let currentPath = cwd;
    for (let i = 0; i <= 3; i++) {
        candidates.push(currentPath);
        currentPath = path.resolve(currentPath, '..');
    }
    // 2. 从 __dirname 向上查找（最多向上3级）
    currentPath = __dirname;
    for (let i = 0; i <= 3; i++) {
        candidates.push(currentPath);
        currentPath = path.resolve(currentPath, '..');
    }
    // 去重并检查哪个路径包含 electron_node/services 目录
    const uniqueCandidates = Array.from(new Set(candidates));
    for (const candidate of uniqueCandidates) {
        const servicesPath = path.join(candidate, 'electron_node', 'services');
        if (fs.existsSync(servicesPath)) {
            logger_1.default.info({
                __dirname,
                cwd: process.cwd(),
                projectRoot: candidate,
            }, 'Python 服务管理器：找到项目根目录');
            return candidate;
        }
    }
    // 如果都没找到，抛出错误
    const error = `无法找到项目根目录。已检查的路径：${uniqueCandidates.join(', ')}`;
    logger_1.default.error({
        __dirname,
        cwd: process.cwd(),
        candidates: uniqueCandidates,
    }, error);
    throw new Error(error);
}
