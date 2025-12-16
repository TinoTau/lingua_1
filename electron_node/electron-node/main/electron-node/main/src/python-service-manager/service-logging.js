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
exports.detectLogLevel = detectLogLevel;
exports.flushLogBuffer = flushLogBuffer;
exports.createLogStream = createLogStream;
const fs = __importStar(require("fs"));
/**
 * 智能识别日志级别
 */
function detectLogLevel(line, isStderr) {
    const upperLine = line.toUpperCase();
    // 检查是否包含明确的错误标记
    if (upperLine.includes('[ERROR]') ||
        upperLine.includes('ERROR:') ||
        upperLine.includes('EXCEPTION:') ||
        upperLine.includes('TRACEBACK') ||
        (upperLine.includes('FAILED') && !upperLine.includes('WARNING'))) {
        return '[ERROR]';
    }
    // 检查是否包含警告标记
    if (upperLine.includes('[WARN]') ||
        upperLine.includes('WARNING:') ||
        upperLine.includes('FUTUREWARNING') ||
        upperLine.includes('DEPRECATIONWARNING') ||
        upperLine.includes('USERWARNING')) {
        return '[WARN]';
    }
    // 检查是否包含信息标记
    if (upperLine.includes('[INFO]') || upperLine.includes('INFO:')) {
        return '[INFO]';
    }
    // 检查 Flask/服务器相关的正常信息
    if (upperLine.includes('RUNNING ON') ||
        upperLine.includes('SERVING FLASK APP') ||
        upperLine.includes('DEBUG MODE:') ||
        upperLine.includes('PRESS CTRL+C') ||
        upperLine.includes('PRESS CTRL+C TO QUIT') ||
        upperLine.includes('THIS IS A DEVELOPMENT SERVER')) {
        return '[INFO]';
    }
    // 默认：stderr 作为警告，stdout 作为信息
    return isStderr ? '[WARN]' : '[INFO]';
}
/**
 * 将缓冲区内容按行写入日志
 */
function flushLogBuffer(buffer, isStderr, logStream) {
    const lines = buffer.split(/\r?\n/);
    // 保留最后一行（可能不完整）在缓冲区
    const completeLines = lines.slice(0, -1);
    const remainingLine = lines[lines.length - 1];
    for (const line of completeLines) {
        if (line.trim()) {
            // 只记录非空行
            const timestamp = new Date().toISOString();
            const level = detectLogLevel(line, isStderr);
            const logLine = `${timestamp} ${level} ${line}\n`;
            logStream.write(logLine, 'utf8');
        }
    }
    return remainingLine;
}
/**
 * 创建日志写入流
 */
function createLogStream(logFile) {
    return fs.createWriteStream(logFile, {
        flags: 'a',
        encoding: 'utf8',
    });
}
