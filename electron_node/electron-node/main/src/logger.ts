// 日志模块 - 使用 pino 进行结构化日志记录（同时输出到控制台和文件）

import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

// 使用环境变量 LOG_LEVEL 控制日志级别（默认：info）
// 使用环境变量 LOG_FORMAT 控制控制台输出格式：json（默认）或 pretty
const logLevel = process.env.LOG_LEVEL || 'info';
const logFormat = process.env.LOG_FORMAT || 'json';

// 日志路径：固定为「electron-node 项目根/logs」，与脚本/文档一致，避免与编译输出目录混淆
// 编译后 logger 在 dist/main/main/src/，用 __dirname 的上一级会得到 dist/main/main/logs（错误）
// 因此向上查找「含 package.json 且含 main 目录」的项目根，再取 projectRoot/logs
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

// 测试环境使用独立日志文件，避免单测/集成测试输出混入生产日志（杜绝「幽灵 NMT」等误判）
const isTestEnv = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
const logFile = path.join(logDir, isTestEnv ? 'electron-main.test.log' : 'electron-main.log');

// 输出日志文件路径（用于调试，便于找不到日志时对照）
if (isTestEnv) {
  console.log('[Logger] Test env: using', logFile, '(production log unchanged)');
} else {
  console.log('[Logger] Log file path:', logFile);
}
console.log('[Logger] Log directory:', logDir);
console.log('[Logger] Project root (log base):', baseDir);

let logger: pino.Logger;

// 诊断：检查是否是 Electron 环境
const isElectron = typeof process !== 'undefined' && process.versions && process.versions.electron;
console.log('[Logger] Environment check:', {
  isElectron,
  electronVersion: process.versions?.electron,
  nodeVersion: process.versions?.node,
});

try {
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
    console.log('[Logger] Initialized with pretty format + file transport');
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
    console.log('[Logger] Initialized with file transport only');
  }

  // 诊断：测试日志是否真的工作（延迟测试，因为 transport 是异步初始化的）
  setTimeout(() => {
    try {
      logger.info({ diagnostic: true, timestamp: Date.now() }, 'Logger diagnostic test');
      console.log('[Logger] Diagnostic test log sent, check if it appears in log file');
    } catch (testError) {
      console.error('[Logger] Failed to write diagnostic test log:', testError);
    }
  }, 2000);

} catch (error) {
  console.error('[Logger] ❌ CRITICAL: Failed to initialize pino logger:', error);
  console.error('[Logger] Error details:', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  // 回退到基本 logger（只输出到控制台）
  console.warn('[Logger] Falling back to basic logger (console only)');
  logger = pino({ level: logLevel });
}

export default logger;
