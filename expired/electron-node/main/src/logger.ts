// 日志模块 - 使用 pino 进行结构化日志记录（同时输出到控制台和文件）

import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

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

let logger: pino.Logger;

if (logFormat === 'pretty') {
  // 开发/调试模式：控制台使用 pretty，文件写入 JSON
  logger = pino({
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
} else {
  // 生产模式：仅写入 JSON 文件（结构化日志，便于采集）
  // 注意：使用 transport 时，不能同时使用 formatters 或 timestamp 等顶层配置
  logger = pino({
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

export default logger;
