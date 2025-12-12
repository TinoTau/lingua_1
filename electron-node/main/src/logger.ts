// 日志模块 - 使用 pino 进行结构化 JSON 日志记录

import pino from 'pino';

// 创建 logger 实例
// 使用环境变量 LOG_LEVEL 控制日志级别（默认：info）
// 使用环境变量 LOG_FORMAT 控制输出格式：json（默认）或 pretty
const logLevel = process.env.LOG_LEVEL || 'info';
const logFormat = process.env.LOG_FORMAT || 'json';

let logger: pino.Logger;

if (logFormat === 'pretty') {
  // Pretty 格式（用于开发调试）
  logger = pino({
    level: logLevel,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  });
} else {
  // JSON 格式（用于生产环境）
  logger = pino({
    level: logLevel,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export default logger;

