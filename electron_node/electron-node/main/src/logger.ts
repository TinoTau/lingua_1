// 日志模块 - 使用 pino 写入项目根 logs/ 下单一日志文件
// 约定：main/logger.js 为从 main/ 树直接加载时的副本，路径与行为须与本文件一致。

import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const logFormat = process.env.LOG_FORMAT || 'json';

// 日志路径：项目根/logs/electron-main.log（测试环境为 electron-main.test.log）
function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (; ;) {
    try {
      if (
        fs.existsSync(path.join(dir, 'package.json')) &&
        fs.existsSync(path.join(dir, 'main'))
      ) {
        return dir;
      }
    } catch {
      /* ignore */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
const baseDir =
  typeof __dirname !== 'undefined'
    ? findProjectRoot(__dirname)
    : process.cwd();
const logDir = path.join(baseDir, 'logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const isTestEnv = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
const logFile = path.join(logDir, isTestEnv ? 'electron-main.test.log' : 'electron-main.log');

// 启动时打印日志路径，便于排查。
console.log('[Logger] Log file:', logFile);

function createLoggerWithFile(): pino.Logger {
  if (logFormat === 'pretty') {
    return pino({
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
            options: { destination: logFile },
          },
        ],
      },
    });
  }
  return pino({
    level: logLevel,
    transport: {
      targets: [
        {
          target: 'pino/file',
          level: logLevel,
          options: { destination: logFile },
        },
      ],
    },
  });
}

let logger: pino.Logger;
try {
  logger = createLoggerWithFile();
} catch (err: any) {
  // 文件被占用或权限不足时，不退出进程，回退到仅写 stdout，便于排查
  console.error(
    '[Logger] Failed to open log file (file may be locked by another process). Falling back to stdout. Path:',
    logFile,
    'Error:',
    err?.message || err
  );
  logger = pino({
    level: logLevel,
    transport:
      logFormat === 'pretty'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  });
}

export default logger;
