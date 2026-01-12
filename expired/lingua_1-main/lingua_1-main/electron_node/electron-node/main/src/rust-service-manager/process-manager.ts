import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import logger from '../logger';
import { verifyPortReleased } from '../utils/port-manager';
import { setupCudaEnvironment } from './cuda-setup';

export interface ProcessHandlers {
  onProcessError: (error: Error) => void;
  onProcessExit: (code: number | null, signal: string | null) => void;
}

/**
 * 启动 Rust 服务进程
 */
export function startRustProcess(
  servicePath: string,
  projectRoot: string,
  port: number,
  logFile: string,
  handlers: ProcessHandlers
): ChildProcess {
  // 检查可执行文件是否存在
  if (!fs.existsSync(servicePath)) {
    const error = `Rust service executable does not exist: ${servicePath}`;
    logger.error({ servicePath }, error);
    throw new Error(error);
  }

  // 配置 CUDA 环境变量（如果 CUDA 已安装）
  const cudaEnv = setupCudaEnvironment();

  // 设置环境变量
  // Rust 服务期望在 electron_node/services/node-inference 目录下运行
  const workingDir = path.join(projectRoot, 'electron_node', 'services', 'node-inference');
  const modelsDir = process.env.MODELS_DIR || path.join(workingDir, 'models');

  const env = {
    ...process.env,
    ...cudaEnv,
    INFERENCE_SERVICE_PORT: port.toString(),
    RUST_LOG: process.env.RUST_LOG || 'info',
    LOG_FORMAT: process.env.LOG_FORMAT || 'json',
    MODELS_DIR: modelsDir,
  };

  if (!fs.existsSync(workingDir)) {
    fs.mkdirSync(workingDir, { recursive: true });
  }
  // 确保 logs / models 目录存在
  const logsDir = path.join(workingDir, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const modelsDirOnDisk = path.join(workingDir, 'models');
  if (!fs.existsSync(modelsDirOnDisk)) {
    fs.mkdirSync(modelsDirOnDisk, { recursive: true });
  }

  // 启动 Rust 服务进程
  // 使用 'pipe' 重定向输出到日志文件，确保完全后台运行（不会打开额外终端窗口）
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const childProcess = spawn(servicePath, [], {
    env,
    cwd: workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // 处理输出（带时间戳）
  childProcess.stdout?.on('data', (data: Buffer) => {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${data.toString()}`;
    logStream.write(line);
  });

  childProcess.stderr?.on('data', (data: Buffer) => {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${data.toString()}`;
    logStream.write(line);
  });

  childProcess.on('error', (error: Error) => {
    const errorMsg = `Failed to start Rust service process: ${error.message}`;
    logger.error({ error, servicePath, workingDir }, errorMsg);
    logStream.end();
    handlers.onProcessError(new Error(errorMsg));
  });

  childProcess.on('exit', (code: number | null, signal: string | null) => {
    logger.info({ code, signal, pid: childProcess?.pid }, 'Rust service process exited');
    logStream.end();
    handlers.onProcessExit(code, signal);
  });

  return childProcess;
}

/**
 * 停止服务进程
 */
export async function stopRustProcess(
  childProcess: ChildProcess | null,
  port: number
): Promise<void> {
  if (!childProcess) {
    logger.info({ port }, `Rust service is not running (port: ${port}), no need to stop`);
    return;
  }

  const pid = childProcess.pid;

  logger.info({ pid, port }, `Stopping Rust service (port: ${port}, PID: ${pid})...`);

  return new Promise(async (resolve) => {
    if (!childProcess) {
      resolve();
      return;
    }

    childProcess.once('exit', async (code, signal) => {
      // 使用 taskkill /F 强制终止时，退出码可能为 1，这是正常的，不应该视为错误
      if (code === 1 && process.platform === 'win32') {
        logger.info({ pid, port, code, signal }, `Rust service process exited (port: ${port}, PID: ${pid}) - normal termination via taskkill`);
      } else {
        logger.info({ pid, port, code, signal }, `Rust service process exited (port: ${port}, PID: ${pid})`);
      }

      // 验证端口是否已释放
      await verifyPortReleased(port, 'rust');

      resolve();
    });

    // 尝试优雅关闭
    if (pid) {
      try {
        // Windows: 使用 taskkill
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', pid.toString(), '/T', '/F']);
        } else {
          // Linux/Mac: 使用 kill
          process.kill(pid, 'SIGTERM');
        }
      } catch (error) {
        logger.error({ error, pid }, 'Failed to stop process, attempting force kill');
        if (childProcess) {
          childProcess.kill('SIGKILL');
        }
      }
    } else {
      childProcess.kill('SIGTERM');
    }

    // 超时强制终止
    setTimeout(async () => {
      if (childProcess && childProcess.exitCode === null && !childProcess.killed) {
        logger.warn({ pid, port }, `Service did not stop within 5 seconds, forcing termination (port: ${port}, PID: ${pid})`);
        childProcess.kill('SIGKILL');

        // 即使强制终止，也验证端口是否释放
        await verifyPortReleased(port, 'rust');
      }
    }, 5000);
  });
}

