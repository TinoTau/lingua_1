import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import logger from './logger';

export interface PythonServiceConfig {
  name: string;
  port: number;
  servicePath: string;
  venvPath: string;
  scriptPath: string;
  workingDir: string;
  logDir: string;
  logFile: string;
  env: Record<string, string>;
}

export interface PythonServiceStatus {
  name: string;
  running: boolean;
  starting: boolean; // 正在启动中
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number; // 参与任务次数
  gpuUsageMs: number; // GPU累计使用时长（毫秒）
}

export class PythonServiceManager {
  private services: Map<string, ChildProcess> = new Map();
  private statuses: Map<string, PythonServiceStatus> = new Map();
  private taskCounts: Map<string, number> = new Map(); // 任务计数
  private gpuUsageMs: Map<string, number> = new Map(); // GPU累计使用时长（毫秒）
  private gpuUsageStartTimes: Map<string, number> = new Map(); // GPU使用开始时间
  private gpuCheckIntervals: Map<string, NodeJS.Timeout> = new Map(); // GPU检查定时器
  private projectRoot: string = '';
  private isDev: boolean;

  constructor() {
    this.isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (this.isDev) {
      // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
      // 在 Electron 中：
      // - process.cwd() 可能是 electron-node 目录或项目根目录
      // - __dirname 是编译后的 JS 文件位置（electron-node/main）
      // - 项目根目录需要包含 electron_node/services 目录

      // 从多个可能的路径查找项目根目录
      const cwd = process.cwd();
      const candidates: string[] = [];

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
          this.projectRoot = candidate;
          logger.info({
            __dirname,
            cwd: process.cwd(),
            projectRoot: this.projectRoot,
          }, 'Python 服务管理器：找到项目根目录');
          break;
        }
      }

      // 如果都没找到，抛出错误
      if (!this.projectRoot) {
        const error = `无法找到项目根目录。已检查的路径：${uniqueCandidates.join(', ')}`;
        logger.error({
          __dirname,
          cwd: process.cwd(),
          candidates: uniqueCandidates,
        }, error);
        throw new Error(error);
      }
    } else {
      this.projectRoot = path.dirname(process.execPath);
    }
  }

  private setupCudaEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};

    const cudaPaths = [
      'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4',
      'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.1',
      'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.8',
    ];

    for (const cudaPath of cudaPaths) {
      if (fs.existsSync(cudaPath)) {
        const cudaBin = path.join(cudaPath, 'bin');
        const cudaLibnvvp = path.join(cudaPath, 'libnvvp');
        const cudaNvcc = path.join(cudaBin, 'nvcc.exe');

        env.CUDA_PATH = cudaPath;
        env.CUDAToolkit_ROOT = cudaPath;
        env.CUDA_ROOT = cudaPath;
        env.CUDA_HOME = cudaPath;
        env.CMAKE_CUDA_COMPILER = cudaNvcc;

        const currentPath = process.env.PATH || '';
        env.PATH = `${cudaBin};${cudaLibnvvp};${currentPath}`;

        logger.info({ cudaPath }, 'CUDA 环境已配置');
        break;
      }
    }

    return env;
  }

  private getServiceConfig(serviceName: 'nmt' | 'tts' | 'yourtts'): PythonServiceConfig | null {
    const baseEnv: Record<string, string> = {
      ...process.env,
      ...this.setupCudaEnvironment(),
      PYTHONIOENCODING: 'utf-8',
    };

    switch (serviceName) {
      case 'nmt': {
        const servicePath = path.join(this.projectRoot, 'electron_node', 'services', 'nmt_m2m100');
        const venvPath = path.join(servicePath, 'venv');
        const venvScripts = path.join(venvPath, 'Scripts');
        const logDir = path.join(servicePath, 'logs');
        const logFile = path.join(logDir, 'nmt-service.log');

        // 确保日志目录存在
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        // 读取 Hugging Face token
        const hfTokenFile = path.join(servicePath, 'hf_token.txt');
        let hfToken = '';
        if (fs.existsSync(hfTokenFile)) {
          try {
            hfToken = fs.readFileSync(hfTokenFile, 'utf-8').trim();
          } catch (error) {
            logger.warn({ error }, '读取 HF token 失败');
          }
        }

        // 配置虚拟环境环境变量
        const currentPath = baseEnv.PATH || '';
        const venvPathEnv = `${venvScripts};${currentPath}`;

        return {
          name: 'NMT',
          port: 5008,
          servicePath,
          venvPath,
          scriptPath: path.join(servicePath, 'nmt_service.py'),
          workingDir: servicePath,
          logDir,
          logFile,
          env: {
            ...baseEnv,
            VIRTUAL_ENV: venvPath,
            PATH: venvPathEnv,
            HF_TOKEN: hfToken,
            HF_LOCAL_FILES_ONLY: 'true',
          },
        };
      }

      case 'tts': {
        const servicePath = path.join(this.projectRoot, 'electron_node', 'services', 'piper_tts');
        const venvPath = path.join(servicePath, 'venv');
        const venvScripts = path.join(venvPath, 'Scripts');
        const logDir = path.join(servicePath, 'logs');
        const logFile = path.join(logDir, 'tts-service.log');

        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        const modelDir = process.env.PIPER_MODEL_DIR
          || path.join(this.projectRoot, 'electron_node', 'services', 'node-inference', 'models', 'tts');

        // 配置虚拟环境环境变量
        const currentPath = baseEnv.PATH || '';
        const venvPathEnv = `${venvScripts};${currentPath}`;

        return {
          name: 'TTS (Piper)',
          port: 5006,
          servicePath,
          venvPath,
          scriptPath: path.join(servicePath, 'piper_http_server.py'),
          workingDir: servicePath,
          logDir,
          logFile,
          env: {
            ...baseEnv,
            VIRTUAL_ENV: venvPath,
            PATH: venvPathEnv,
            // CUDA_PATH 来自 setupCudaEnvironment，这里通过 any 访问避免类型冲突
            PIPER_USE_GPU: (baseEnv as any).CUDA_PATH ? 'true' : 'false',
            PIPER_MODEL_DIR: modelDir,
          },
        };
      }

      case 'yourtts': {
        const servicePath = path.join(this.projectRoot, 'electron_node', 'services', 'your_tts');
        const venvPath = path.join(servicePath, 'venv');
        const venvScripts = path.join(venvPath, 'Scripts');
        const logDir = path.join(servicePath, 'logs');
        const logFile = path.join(logDir, 'yourtts-service.log');

        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        const modelDir = process.env.YOURTTS_MODEL_DIR
          || path.join(this.projectRoot, 'electron_node', 'services', 'node-inference', 'models', 'tts', 'your_tts');

        // 配置虚拟环境环境变量
        const currentPath = baseEnv.PATH || '';
        const venvPathEnv = `${venvScripts};${currentPath}`;

        return {
          name: 'YourTTS',
          port: 5004,
          servicePath,
          venvPath,
          scriptPath: path.join(servicePath, 'yourtts_service.py'),
          workingDir: servicePath,
          logDir,
          logFile,
          env: {
            ...baseEnv,
            VIRTUAL_ENV: venvPath,
            PATH: venvPathEnv,
            YOURTTS_MODEL_DIR: modelDir,
            // CUDA_PATH 来自 setupCudaEnvironment，这里通过 any 访问避免类型冲突
            YOURTTS_USE_GPU: (baseEnv as any).CUDA_PATH ? 'true' : 'false',
          },
        };
      }

      default:
        return null;
    }
  }

  async startService(serviceName: 'nmt' | 'tts' | 'yourtts'): Promise<void> {
    if (this.services.has(serviceName)) {
      logger.warn({ serviceName }, '服务已在运行');
      return;
    }

    const config = this.getServiceConfig(serviceName);
    if (!config) {
      throw new Error(`未知服务: ${serviceName}`);
    }

    // 设置启动中状态
    this.updateStatus(serviceName, {
      running: false,
      starting: true,
      pid: null,
      port: config.port,
      startedAt: null,
      lastError: null,
    });

    // 检查虚拟环境
    const pythonExe = path.join(config.venvPath, 'Scripts', 'python.exe');
    if (!fs.existsSync(pythonExe)) {
      const error = `虚拟环境不存在: ${config.venvPath}`;
      logger.error({ serviceName, venvPath: config.venvPath }, error);
      this.updateStatus(serviceName, {
        running: false,
        starting: false,
        pid: null,
        port: config.port,
        startedAt: null,
        lastError: error,
      });
      throw new Error(error);
    }

    // 检查脚本文件
    if (!fs.existsSync(config.scriptPath)) {
      const error = `服务脚本不存在: ${config.scriptPath}`;
      logger.error({ serviceName, scriptPath: config.scriptPath }, error);
      this.updateStatus(serviceName, {
        running: false,
        starting: false,
        pid: null,
        port: config.port,
        startedAt: null,
        lastError: error,
      });
      throw new Error(error);
    }

    try {
      // 检查端口是否被占用，如果被占用则尝试清理
      try {
        const net = require('net');
        const testServer = net.createServer();
        await new Promise<void>((resolve, reject) => {
          testServer.listen(config.port, '127.0.0.1', () => {
            testServer.close(() => resolve());
          });
          testServer.on('error', async (err: any) => {
            if (err.code === 'EADDRINUSE') {
              logger.warn(
                { serviceName, port: config.port },
                `端口 ${config.port} 已被占用，尝试查找并清理占用该端口的进程...`
              );

              // 尝试查找并清理占用端口的进程（Windows）
              const nodeProcess = require('process');
              if (nodeProcess.platform === 'win32') {
                try {
                  const { exec } = require('child_process');
                  const { promisify } = require('util');
                  const execAsync = promisify(exec);

                  // 使用 netstat 查找占用端口的进程
                  const { stdout } = await execAsync(`netstat -ano | findstr :${config.port}`);
                  const lines = stdout.trim().split('\n');

                  for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 5 && parts[1].includes(`:${config.port}`)) {
                      const pid = parts[parts.length - 1];
                      if (pid && !isNaN(parseInt(pid))) {
                        logger.info(
                          { serviceName, port: config.port, pid },
                          `发现占用端口的进程 PID: ${pid}，尝试终止...`
                        );
                        try {
                          await execAsync(`taskkill /PID ${pid} /F`);
                          logger.info({ serviceName, port: config.port, pid }, '已终止占用端口的进程');
                          // 等待端口释放
                          await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (killError) {
                          logger.warn(
                            { serviceName, port: config.port, pid, error: killError },
                            '终止进程失败，可能进程已不存在'
                          );
                        }
                      }
                    }
                  }
                } catch (cleanupError) {
                  logger.warn(
                    { serviceName, port: config.port, error: cleanupError },
                    '清理占用端口的进程失败，等待端口自然释放...'
                  );
                  // 等待端口释放
                  await new Promise(resolve => setTimeout(resolve, 2000));
                }
              } else {
                // Linux/Mac: 使用 lsof 查找占用端口的进程
                try {
                  const { exec } = require('child_process');
                  const { promisify } = require('util');
                  const execAsync = promisify(exec);

                  const { stdout } = await execAsync(`lsof -ti:${config.port}`);
                  const pids = stdout.trim().split('\n').filter((pid: string) => pid);

                  for (const pid of pids) {
                    logger.info(
                      { serviceName, port: config.port, pid },
                      `发现占用端口的进程 PID: ${pid}，尝试终止...`
                    );
                    try {
                      const nodeProcess = require('process');
                      nodeProcess.kill(parseInt(pid), 'SIGTERM');
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (killError) {
                      logger.warn(
                        { serviceName, port: config.port, pid, error: killError },
                        '终止进程失败'
                      );
                    }
                  }
                } catch (cleanupError) {
                  logger.warn(
                    { serviceName, port: config.port, error: cleanupError },
                    '清理占用端口的进程失败，等待端口自然释放...'
                  );
                  await new Promise(resolve => setTimeout(resolve, 2000));
                }
              }

              // 再次尝试检查端口
              setTimeout(async () => {
                try {
                  const retryServer = net.createServer();
                  retryServer.listen(config.port, '127.0.0.1', () => {
                    retryServer.close(() => resolve());
                  });
                  retryServer.on('error', () => {
                    retryServer.close();
                    logger.warn(
                      { serviceName, port: config.port },
                      '端口仍被占用，但继续启动（可能是端口释放延迟）'
                    );
                    resolve();
                  });
                } catch {
                  resolve();
                }
              }, 1000);
            } else {
              reject(err);
            }
          });
        });
      } catch (portError) {
        logger.warn(
          { serviceName, port: config.port, error: portError },
          '端口检查失败，继续启动（可能是端口已被占用）'
        );
      }

      // 构建启动命令
      let args: string[] = [];
      if (serviceName === 'nmt') {
        // NMT 服务使用 uvicorn
        args = ['-m', 'uvicorn', 'nmt_service:app', '--host', '127.0.0.1', '--port', config.port.toString()];
      } else if (serviceName === 'tts') {
        // Piper TTS 服务
        args = [
          config.scriptPath,
          '--host', '127.0.0.1',
          '--port', config.port.toString(),
          '--model-dir', config.env.PIPER_MODEL_DIR || '',
        ];
      } else if (serviceName === 'yourtts') {
        // YourTTS 服务
        args = [
          config.scriptPath,
          '--host', '127.0.0.1',
          '--port', config.port.toString(),
          '--model-dir', config.env.YOURTTS_MODEL_DIR || '',
        ];
      }

      // 启动进程
      const process = spawn(pythonExe, args, {
        env: config.env,
        cwd: config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'], // 重定向输出到日志文件
        detached: false,
      });

      // 创建日志文件流（使用 UTF-8 编码）
      const logStream = fs.createWriteStream(config.logFile, {
        flags: 'a',
        encoding: 'utf8'
      });

      // 处理输出 - 按行分割并添加时间戳
      let stdoutBuffer = '';
      let stderrBuffer = '';

      // 辅助函数：智能识别日志级别
      const detectLogLevel = (line: string, isStderr: boolean): string => {
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
        if (upperLine.includes('[INFO]') ||
          upperLine.includes('INFO:')) {
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
      };

      // 辅助函数：将缓冲区内容按行写入日志
      const flushLogBuffer = (buffer: string, isStderr: boolean): string => {
        const lines = buffer.split(/\r?\n/);
        // 保留最后一行（可能不完整）在缓冲区
        const completeLines = lines.slice(0, -1);
        const remainingLine = lines[lines.length - 1];

        for (const line of completeLines) {
          if (line.trim()) { // 只记录非空行
            const timestamp = new Date().toISOString();
            const level = detectLogLevel(line, isStderr);
            const logLine = `${timestamp} ${level} ${line}\n`;
            logStream.write(logLine, 'utf8');
          }
        }

        return remainingLine;
      };

      process.stdout?.on('data', (data: Buffer) => {
        // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
        const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
        stdoutBuffer += text;
        stdoutBuffer = flushLogBuffer(stdoutBuffer, false);
      });

      process.stderr?.on('data', (data: Buffer) => {
        // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
        const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
        stderrBuffer += text;
        stderrBuffer = flushLogBuffer(stderrBuffer, true);
        // 同时输出到控制台以便调试
        logger.error({ serviceName, stderr: text }, 'Python service stderr output');
      });

      process.on('error', (error) => {
        logger.error({ error, serviceName }, 'Python 服务进程启动失败');
        logStream.end();
        this.updateStatus(serviceName, {
          running: false,
          starting: false,
          pid: null,
          port: config.port,
          startedAt: null,
          lastError: error.message,
        });
        this.services.delete(serviceName);
      });

      process.on('exit', (code, signal) => {
        // 刷新剩余的缓冲区内容
        if (stdoutBuffer.trim()) {
          const timestamp = new Date().toISOString();
          const level = detectLogLevel(stdoutBuffer, false);
          const logLine = `${timestamp} ${level} ${stdoutBuffer}\n`;
          logStream.write(logLine, 'utf8');
        }
        if (stderrBuffer.trim()) {
          const timestamp = new Date().toISOString();
          const level = detectLogLevel(stderrBuffer, true);
          const logLine = `${timestamp} ${level} ${stderrBuffer}\n`;
          logStream.write(logLine, 'utf8');
        }

        logger.info({ code, signal, serviceName }, 'Python 服务进程已退出');
        if (code !== 0 && code !== null) {
          logger.error({
            code,
            signal,
            serviceName,
            port: config.port,
            logFile: config.logFile
          }, `Python service exited with code ${code}. Check log file for details: ${config.logFile}`);
        }
        logStream.end();

        // 如果进程在启动阶段（waitForServiceReady 之前）退出，记录更详细的错误信息
        // 对于退出码为 1 的情况，可能是端口被占用或模型加载失败
        if (code === 1) {
          logger.warn(
            { serviceName, port: config.port, code, signal },
            '服务进程在启动阶段退出（退出码 1），可能是端口被占用或初始化失败。如果随后启动成功，这可能是正常的（端口释放延迟）'
          );
        }

        this.updateStatus(serviceName, {
          running: false,
          starting: false,
          pid: null,
          port: config.port,
          startedAt: null,
          lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
        });
        this.services.delete(serviceName);
      });

      this.services.set(serviceName, process);

      // 等待服务就绪
      // YourTTS 服务需要更长的启动时间（模型加载需要 30-60 秒）
      const timeout = serviceName === 'yourtts' ? 90000 : 30000;

      // 检查进程是否在等待期间退出
      let processExited = false;
      const exitHandler = () => {
        processExited = true;
      };
      process.once('exit', exitHandler);

      try {
        await this.waitForServiceReady(config.port, timeout, () => {
          // 检查进程是否还在运行
          if (processExited || process.killed || process.exitCode !== null) {
            throw new Error(`服务进程在启动过程中退出（退出码: ${process.exitCode}）`);
          }
        });
      } finally {
        process.removeListener('exit', exitHandler);
      }

      // 初始化统计信息
      if (!this.taskCounts.has(serviceName)) {
        this.taskCounts.set(serviceName, 0);
        this.gpuUsageMs.set(serviceName, 0);
      }

      this.updateStatus(serviceName, {
        running: true,
        starting: false,
        pid: process.pid || null,
        port: config.port,
        startedAt: new Date(),
        lastError: null,
      });

      // 开始GPU使用时间跟踪
      this.startGpuTracking(serviceName);

      logger.info(
        { serviceName, pid: process.pid, port: config.port },
        'Python 服务已启动'
      );
    } catch (error) {
      logger.error({ error, serviceName }, '启动 Python 服务失败');
      this.updateStatus(serviceName, {
        running: false,
        starting: false,
        pid: null,
        port: config.port,
        startedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async stopService(serviceName: 'nmt' | 'tts' | 'yourtts'): Promise<void> {
    const child = this.services.get(serviceName);
    if (!child) {
      const status = this.statuses.get(serviceName);
      logger.info(
        { serviceName, port: status?.port, running: status?.running },
        '服务未在运行，无需停止'
      );
      return;
    }

    const status = this.statuses.get(serviceName);
    const port = status?.port || null;
    const pid = child.pid;

    logger.info(
      { serviceName, pid, port },
      `正在停止 Python 服务 (端口: ${port}, PID: ${pid})...`
    );

    return new Promise((resolve) => {
      child.once('exit', async (code, signal) => {
        logger.info(
          { serviceName, pid, port, code, signal },
          `Python 服务进程已退出 (端口: ${port}, 退出码: ${code})`
        );

        // 停止GPU使用时间跟踪
        this.stopGpuTracking(serviceName);

        this.updateStatus(serviceName, {
          running: false,
          starting: false,
          pid: null,
          port: port,
          startedAt: null,
          lastError: null,
        });
        this.services.delete(serviceName);

        // 验证端口是否已释放
        if (port) {
          await this.verifyPortReleased(serviceName, port);
        }

        resolve();
      });

      if (pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', pid.toString(), '/T', '/F']);
          } else {
            process.kill(pid, 'SIGTERM');
          }
        } catch (error) {
          logger.error({ error, serviceName, pid }, '停止进程失败，尝试强制终止');
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGTERM');
      }

      setTimeout(async () => {
        if (this.services.has(serviceName)) {
          logger.warn(
            { serviceName, pid, port },
            `服务未在 5 秒内停止，强制终止 (端口: ${port}, PID: ${pid})`
          );
          child.kill('SIGKILL');

          // 即使强制终止，也验证端口是否释放
          if (port) {
            await this.verifyPortReleased(serviceName, port);
          }
        }
      }, 5000);
    });
  }

  /**
   * 验证端口是否已释放
   */
  private async verifyPortReleased(serviceName: string, port: number): Promise<void> {
    try {
      const net = require('net');
      const testServer = net.createServer();

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          testServer.close();
          logger.warn(
            { serviceName, port },
            `端口 ${port} 释放验证超时（可能仍被占用）`
          );
          resolve();
        }, 2000);

        testServer.listen(port, '127.0.0.1', () => {
          clearTimeout(timeout);
          testServer.close(() => {
            logger.info(
              { serviceName, port },
              `✅ 端口 ${port} 已成功释放`
            );
            resolve();
          });
        });

        testServer.on('error', (err: any) => {
          clearTimeout(timeout);
          if (err.code === 'EADDRINUSE') {
            logger.error(
              { serviceName, port, error: err },
              `❌ 端口 ${port} 仍被占用，服务可能未正确关闭`
            );

            // 尝试查找占用端口的进程
            this.logPortOccupier(serviceName, port);
          } else {
            logger.warn(
              { serviceName, port, error: err },
              `端口 ${port} 释放验证失败`
            );
          }
          resolve();
        });
      });
    } catch (error) {
      logger.warn(
        { serviceName, port, error },
        `端口 ${port} 释放验证异常`
      );
    }
  }

  /**
   * 记录占用端口的进程信息
   */
  private async logPortOccupier(serviceName: string, port: number): Promise<void> {
    try {
      const nodeProcess = require('process');
      if (nodeProcess.platform === 'win32') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
          const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
          const lines = stdout.trim().split('\n');

          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
              const pid = parts[parts.length - 1];
              logger.warn(
                { serviceName, port, pid },
                `端口 ${port} 被进程 PID ${pid} 占用`
              );
            }
          }
        } catch (error) {
          logger.warn(
            { serviceName, port, error },
            '无法查找占用端口的进程'
          );
        }
      } else {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
          const { stdout } = await execAsync(`lsof -ti:${port}`);
          const pids = stdout.trim().split('\n').filter((pid: string) => pid);
          if (pids.length > 0) {
            logger.warn(
              { serviceName, port, pids },
              `端口 ${port} 被进程 PID ${pids.join(', ')} 占用`
            );
          }
        } catch (error) {
          logger.warn(
            { serviceName, port, error },
            '无法查找占用端口的进程'
          );
        }
      }
    } catch (error) {
      logger.warn(
        { serviceName, port, error },
        '记录端口占用信息失败'
      );
    }
  }

  async stopAllServices(): Promise<void> {
    const serviceNames: Array<'nmt' | 'tts' | 'yourtts'> = ['nmt', 'tts', 'yourtts'];

    // 记录当前运行的服务状态
    const runningServices = serviceNames
      .map(name => {
        const status = this.statuses.get(name);
        return status?.running ? { name, port: status.port, pid: status.pid } : null;
      })
      .filter(s => s !== null);

    logger.info(
      { runningServices, total: runningServices.length },
      `正在停止所有 Python 服务 (运行中的服务: ${runningServices.length})...`
    );

    await Promise.all(serviceNames.map(name => this.stopService(name).catch(err => {
      logger.error({ error: err, serviceName: name }, '停止服务失败');
    })));

    // 验证所有端口是否已释放
    const allPorts = runningServices.map(s => s?.port).filter(p => p !== null) as number[];
    if (allPorts.length > 0) {
      logger.info(
        { ports: allPorts },
        `验证所有服务端口是否已释放: ${allPorts.join(', ')}`
      );

      for (const port of allPorts) {
        // 等待一小段时间让端口完全释放
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.verifyPortReleased('all', port);
      }
    }

    logger.info({}, '所有 Python 服务已停止');
  }

  getServiceStatus(serviceName: 'nmt' | 'tts' | 'yourtts'): PythonServiceStatus | null {
    const status = this.statuses.get(serviceName);
    if (status) {
      // 更新统计信息
      status.taskCount = this.taskCounts.get(serviceName) || 0;
      status.gpuUsageMs = this.gpuUsageMs.get(serviceName) || 0;
    }
    return status || null;
  }

  getAllServiceStatuses(): PythonServiceStatus[] {
    return Array.from(this.statuses.values()).map(status => {
      // 更新统计信息
      status.taskCount = this.taskCounts.get(status.name) || 0;
      status.gpuUsageMs = this.gpuUsageMs.get(status.name) || 0;
      return status;
    });
  }

  /**
   * 增加任务计数
   */
  incrementTaskCount(serviceName: 'nmt' | 'tts' | 'yourtts'): void {
    const current = this.taskCounts.get(serviceName) || 0;
    this.taskCounts.set(serviceName, current + 1);
    const status = this.statuses.get(serviceName);
    if (status) {
      status.taskCount = current + 1;
    }
  }

  /**
   * 开始跟踪GPU使用时间
   */
  startGpuTracking(serviceName: 'nmt' | 'tts' | 'yourtts'): void {
    if (this.gpuCheckIntervals.has(serviceName)) {
      return; // 已经在跟踪
    }

    const startTime = Date.now();
    this.gpuUsageStartTimes.set(serviceName, startTime);

    // 每500ms检查一次GPU使用率
    const interval = setInterval(async () => {
      try {
        const gpuInfo = await this.getGpuUsage();
        const now = Date.now();
        if (gpuInfo && gpuInfo.usage > 0) {
          // GPU正在使用，累计时间
          const startTime = this.gpuUsageStartTimes.get(serviceName);
          if (startTime) {
            const elapsed = now - startTime;
            const current = this.gpuUsageMs.get(serviceName) || 0;
            this.gpuUsageMs.set(serviceName, current + elapsed);
            const status = this.statuses.get(serviceName);
            if (status) {
              status.gpuUsageMs = current + elapsed;
            }
          }
          this.gpuUsageStartTimes.set(serviceName, now); // 重置开始时间
        } else {
          // GPU未使用，重置开始时间
          this.gpuUsageStartTimes.set(serviceName, now);
        }
      } catch (error) {
        // 忽略错误，继续跟踪
      }
    }, 500);

    this.gpuCheckIntervals.set(serviceName, interval);
  }

  /**
   * 停止跟踪GPU使用时间
   */
  stopGpuTracking(serviceName: 'nmt' | 'tts' | 'yourtts'): void {
    const interval = this.gpuCheckIntervals.get(serviceName);
    if (interval) {
      clearInterval(interval);
      this.gpuCheckIntervals.delete(serviceName);
    }

    // 累计最后一次使用时间
    const startTime = this.gpuUsageStartTimes.get(serviceName);
    if (startTime) {
      const now = Date.now();
      const elapsed = now - startTime;
      const current = this.gpuUsageMs.get(serviceName) || 0;
      this.gpuUsageMs.set(serviceName, current + elapsed);
      const status = this.statuses.get(serviceName);
      if (status) {
        status.gpuUsageMs = current + elapsed;
      }
      this.gpuUsageStartTimes.delete(serviceName);
    }
  }

  /**
   * 获取GPU使用率
   */
  private async getGpuUsage(): Promise<{ usage: number; memory: number } | null> {
    try {
      const { spawn } = require('child_process');
      const pythonScript = `
import pynvml
try:
    pynvml.nvmlInit()
    handle = pynvml.nvmlDeviceGetHandleByIndex(0)
    util = pynvml.nvmlDeviceGetUtilizationRates(handle)
    mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
    print(f"{util.gpu},{mem_info.used / mem_info.total * 100}")
    pynvml.nvmlShutdown()
except:
    print("ERROR")
`;

      return new Promise((resolve) => {
        const python = spawn('python', ['-c', pythonScript]);
        let output = '';

        python.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        python.on('close', (code: number) => {
          if (code === 0 && output.trim() !== 'ERROR') {
            const [usage, memory] = output.trim().split(',').map(Number);
            resolve({ usage, memory });
          } else {
            resolve(null);
          }
        });

        python.on('error', () => {
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  private updateStatus(serviceName: string, status: Partial<Omit<PythonServiceStatus, 'name'>>): void {
    const current = this.statuses.get(serviceName);
    const taskCount = this.taskCounts.get(serviceName) || 0;
    const gpuUsageMs = this.gpuUsageMs.get(serviceName) || 0;

    // 合并状态，确保统计信息不被覆盖
    const mergedStatus: PythonServiceStatus = {
      name: serviceName,
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
      ...current,
      ...status,
    };

    // 如果status中没有指定taskCount和gpuUsageMs，使用当前值
    if (status.taskCount === undefined) {
      mergedStatus.taskCount = current?.taskCount ?? taskCount;
    }
    if (status.gpuUsageMs === undefined) {
      mergedStatus.gpuUsageMs = current?.gpuUsageMs ?? gpuUsageMs;
    }

    this.statuses.set(serviceName, mergedStatus);
  }

  private async waitForServiceReady(
    port: number,
    maxWaitMs: number = 30000,
    processCheck?: () => void
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500;
    let lastLogTime = 0;

    return new Promise((resolve, reject) => {
      const checkHealth = async () => {
        // 检查进程状态（如果提供了检查函数）
        if (processCheck) {
          try {
            processCheck();
          } catch (error) {
            reject(error);
            return;
          }
        }
        try {
          const axios = require('axios');
          // 尝试健康检查端点
          const response = await axios.get(`http://localhost:${port}/health`, {
            timeout: 2000, // 增加超时时间到 2 秒
            validateStatus: (status: number) => status < 500, // 接受 2xx, 3xx, 4xx
          });

          if (response.status < 400) {
            logger.info({ port, elapsed: Date.now() - startTime }, '服务健康检查通过');
            resolve();
            return;
          }
        } catch (error: any) {
          const elapsed = Date.now() - startTime;
          // 每 5 秒记录一次等待信息
          if (elapsed - lastLogTime >= 5000) {
            logger.info(
              {
                port,
                elapsed,
                errorCode: error?.code,
                errorMessage: error?.message,
                maxWaitMs
              },
              '等待服务就绪...'
            );
            lastLogTime = elapsed;
          }

          // 如果是连接错误（ECONNREFUSED），服务还未就绪，继续等待
          // 其他错误可能是服务已启动但端点不同，也认为就绪
          if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            // 继续等待
          } else {
            // 其他错误（如 404），可能服务已启动但端点不同，认为就绪
            logger.warn(
              { port, errorCode: error?.code, errorMessage: error?.message },
              '健康检查返回非连接错误，认为服务已就绪'
            );
            resolve();
            return;
          }
        }

        if (Date.now() - startTime > maxWaitMs) {
          // 超时后不拒绝，让服务继续运行（可能健康检查端点不同或服务启动较慢）
          logger.warn(
            { port, maxWaitMs, elapsed: Date.now() - startTime },
            '服务健康检查超时，但继续运行（服务可能已启动但响应较慢）'
          );
          resolve();
          return;
        }

        setTimeout(checkHealth, checkInterval);
      };

      checkHealth();
    });
  }
}
