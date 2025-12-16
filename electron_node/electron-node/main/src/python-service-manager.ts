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
}

export class PythonServiceManager {
  private services: Map<string, ChildProcess> = new Map();
  private statuses: Map<string, PythonServiceStatus> = new Map();
  private projectRoot: string = '';
  private isDev: boolean;

  constructor() {
    this.isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (this.isDev) {
      // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
      // 参考 scripts/start_nmt_service.ps1 等的路径计算逻辑：
      // $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path  (scripts 目录)
      // $projectRoot = Split-Path -Parent $scriptDir  (项目根目录)
      // 
      // 在 Electron 中：
      // - process.cwd() 通常是 electron-node 目录（应用启动目录）
      // - __dirname 是编译后的 JS 文件位置（electron-node/main）
      // - 项目根目录是 electron-node 的父目录

      // 方法1：从 process.cwd() 推断（最可靠，因为应用从 electron-node 目录启动）
      const cwd = process.cwd();
      const possibleRootFromCwd = path.resolve(cwd, '..');

      // 方法2：从 __dirname 推断（编译后是 electron-node/main）
      const possibleRootFromDirname = path.resolve(__dirname, '../..');

      // 检查哪个路径包含 services 目录（这是项目根目录的标志）
      const candidates = [possibleRootFromCwd, possibleRootFromDirname];

      for (const candidate of candidates) {
        const servicesPath = path.join(candidate, 'services');
        if (fs.existsSync(servicesPath)) {
          this.projectRoot = candidate;
          logger.info({
            __dirname,
            cwd: process.cwd(),
            projectRoot: this.projectRoot
          }, 'Python 服务管理器：找到项目根目录');
          break;
        }
      }

      // 如果都没找到，使用从 cwd 向上 1 级的方法（最可能正确）
      if (!this.projectRoot) {
        this.projectRoot = possibleRootFromCwd;
        logger.warn({
          __dirname,
          cwd: process.cwd(),
          projectRoot: this.projectRoot,
          note: '使用默认方法（从 cwd 向上 1 级）'
        }, 'Python 服务管理器：使用默认项目根目录');
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
    const baseEnv = {
      ...process.env,
      ...this.setupCudaEnvironment(),
      PYTHONIOENCODING: 'utf-8',
    };

    switch (serviceName) {
      case 'nmt': {
        const servicePath = path.join(this.projectRoot, 'services', 'nmt_m2m100');
        const venvPath = path.join(servicePath, 'venv');
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
            HF_TOKEN: hfToken,
            HF_LOCAL_FILES_ONLY: 'true',
          },
        };
      }

      case 'tts': {
        const servicePath = path.join(this.projectRoot, 'services', 'piper_tts');
        const venvPath = path.join(servicePath, 'venv');
        const logDir = path.join(servicePath, 'logs');
        const logFile = path.join(logDir, 'tts-service.log');

        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        const modelDir = process.env.PIPER_MODEL_DIR
          || path.join(this.projectRoot, 'node-inference', 'models', 'tts');

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
            // CUDA_PATH 来自 setupCudaEnvironment，这里通过 any 访问避免类型冲突
            PIPER_USE_GPU: (baseEnv as any).CUDA_PATH ? 'true' : 'false',
            PIPER_MODEL_DIR: modelDir,
          },
        };
      }

      case 'yourtts': {
        const servicePath = path.join(this.projectRoot, 'services', 'your_tts');
        const venvPath = path.join(servicePath, 'venv');
        const logDir = path.join(servicePath, 'logs');
        const logFile = path.join(logDir, 'yourtts-service.log');

        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        const modelDir = process.env.YOURTTS_MODEL_DIR
          || path.join(this.projectRoot, 'node-inference', 'models', 'tts', 'your_tts');

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
        pid: null,
        port: config.port,
        startedAt: null,
        lastError: error,
      });
      throw new Error(error);
    }

    try {
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
        ];
      }

      // 启动进程
      const process = spawn(pythonExe, args, {
        env: config.env,
        cwd: config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'], // 重定向输出到日志文件
        detached: false,
      });

      // 创建日志文件流
      const logStream = fs.createWriteStream(config.logFile, { flags: 'a' });

      // 处理输出
      process.stdout?.on('data', (data: Buffer) => {
        const timestamp = new Date().toISOString();
        const line = `${timestamp} ${data.toString()}`;
        logStream.write(line);
      });

      process.stderr?.on('data', (data: Buffer) => {
        const timestamp = new Date().toISOString();
        const line = `${timestamp} ${data.toString()}`;
        logStream.write(line);
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
        logger.info({ code, signal, serviceName }, 'Python 服务进程已退出');
        logStream.end();
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
      await this.waitForServiceReady(config.port, 30000);

      this.updateStatus(serviceName, {
        running: true,
        starting: false,
        pid: process.pid || null,
        port: config.port,
        startedAt: new Date(),
        lastError: null,
      });

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
      return;
    }

    logger.info({ serviceName, pid: child.pid }, '正在停止 Python 服务...');

    return new Promise((resolve) => {
      const pid = child.pid;

      child.once('exit', () => {
        logger.info({ serviceName, pid }, 'Python 服务已停止');
        this.updateStatus(serviceName, {
          running: false,
          starting: false,
          pid: null,
          port: this.statuses.get(serviceName)?.port || null,
          startedAt: null,
          lastError: null,
        });
        this.services.delete(serviceName);
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

      setTimeout(() => {
        if (this.services.has(serviceName)) {
          logger.warn({ serviceName, pid }, '服务未在 5 秒内停止，强制终止');
          child.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  async stopAllServices(): Promise<void> {
    const serviceNames: Array<'nmt' | 'tts' | 'yourtts'> = ['nmt', 'tts', 'yourtts'];
    await Promise.all(serviceNames.map(name => this.stopService(name).catch(err => {
      logger.error({ error: err, serviceName: name }, '停止服务失败');
    })));
  }

  getServiceStatus(serviceName: 'nmt' | 'tts' | 'yourtts'): PythonServiceStatus | null {
    return this.statuses.get(serviceName) || null;
  }

  getAllServiceStatuses(): PythonServiceStatus[] {
    return Array.from(this.statuses.values());
  }

  private updateStatus(serviceName: string, status: Partial<Omit<PythonServiceStatus, 'name'>>): void {
    const current = this.statuses.get(serviceName);
    this.statuses.set(serviceName, {
      name: serviceName,
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      ...current,
      ...status,
    });
  }

  private async waitForServiceReady(port: number, maxWaitMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500;

    return new Promise((resolve, reject) => {
      const checkHealth = async () => {
        try {
          const axios = require('axios');
          // 尝试健康检查端点
          const response = await axios.get(`http://localhost:${port}/health`, {
            timeout: 1000,
            validateStatus: (status: number) => status < 500, // 接受 2xx, 3xx, 4xx
          });

          if (response.status < 400) {
            resolve();
            return;
          }
        } catch (error: any) {
          // 如果是连接错误（ECONNREFUSED），服务还未就绪，继续等待
          // 其他错误可能是服务已启动但端点不同，也认为就绪
          if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            // 继续等待
          } else {
            // 其他错误（如 404），可能服务已启动但端点不同，认为就绪
            resolve();
            return;
          }
        }

        if (Date.now() - startTime > maxWaitMs) {
          // 超时后不拒绝，让服务继续运行（可能健康检查端点不同）
          resolve();
          return;
        }

        setTimeout(checkHealth, checkInterval);
      };

      checkHealth();
    });
  }
}
