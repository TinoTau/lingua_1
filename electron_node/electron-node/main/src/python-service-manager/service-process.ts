import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import logger from '../logger';
import { cleanupPortProcesses, verifyPortReleased } from '../utils/port-manager';
import { PythonServiceConfig } from './types';
import { PythonServiceName } from './types';
import { createLogStream, flushLogBuffer, detectLogLevel } from './service-logging';
import { waitForServiceReady } from './service-health';
import { PythonServiceConfig as PythonServiceConfigType } from '../utils/python-service-config';
import { ensureVenvSetup } from './venv-setup';

export interface ServiceProcessHandlers {
  onProcessError: (error: Error) => void;
  onProcessExit: (code: number | null, signal: string | null) => void;
}

/**
 * 检测 CUDA 是否可用（通过 Python 脚本，带重试机制）
 * 因为启动时GPU可能被其他服务占用，需要重试
 * 使用多种方法检测：优先使用 torch，如果失败则尝试 onnxruntime
 */
async function checkCudaAvailable(pythonExe: string): Promise<boolean> {
  const maxRetries = 5; // 增加重试次数到5次
  const retryDelay = 2000; // 增加重试延迟到2秒
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 方法1：尝试使用 torch 检测
    const torchResult = await new Promise<boolean>((resolve) => {
      const checkScript = 'import torch; exit(0 if torch.cuda.is_available() else 1)';
      const python = spawn(pythonExe, ['-c', checkScript], {
        stdio: 'ignore',
      });

      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          python.kill();
        }
      };

      // 超时保护
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 5000); // 增加超时时间到5秒

      python.on('close', (code: number | null) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(code === 0);
        }
      });

      python.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(false);
        }
      });
    });
    
    if (torchResult) {
      return true; // CUDA可用，立即返回
    }
    
    // 方法2：如果 torch 检测失败，尝试使用 onnxruntime 检测（TTS服务使用onnxruntime）
    const onnxResult = await new Promise<boolean>((resolve) => {
      const checkScript = 'import onnxruntime as ort; providers = ort.get_available_providers(); exit(0 if "CUDAExecutionProvider" in providers else 1)';
      const python = spawn(pythonExe, ['-c', checkScript], {
        stdio: 'ignore',
      });

      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          python.kill();
        }
      };

      // 超时保护
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 5000);

      python.on('close', (code: number | null) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(code === 0);
        }
      });

      python.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(false);
        }
      });
    });
    
    if (onnxResult) {
      return true; // CUDA可用（通过onnxruntime检测到）
    }
    
    // 如果检测失败且还有重试机会，等待后重试
    if (attempt < maxRetries - 1) {
      logger.debug({ attempt: attempt + 1, maxRetries }, 'CUDA detection failed (both torch and onnxruntime), retrying...');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  // 所有重试都失败，返回false
  return false;
}

/**
 * 构建服务启动参数
 */
export async function buildServiceArgs(
  serviceName: PythonServiceName,
  config: PythonServiceConfig,
  pythonExe?: string
): Promise<string[]> {
  // 检测 CUDA 是否可用（如果提供了 pythonExe）
  let cudaAvailable = false;
  if (pythonExe) {
    try {
      cudaAvailable = await checkCudaAvailable(pythonExe);
      if (cudaAvailable) {
        logger.info({ serviceName }, 'CUDA detected, GPU acceleration will be enabled');
      } else {
        logger.info({ serviceName }, 'CUDA not available, using CPU');
      }
    } catch (error) {
      logger.warn({ error, serviceName }, 'Failed to check CUDA availability, assuming CPU');
    }
  }

  if (serviceName === 'nmt') {
    // NMT 服务使用 uvicorn，自动检测 GPU（在服务内部）
    return ['-m', 'uvicorn', 'nmt_service:app', '--host', '127.0.0.1', '--port', config.port.toString()];
  } else if (serviceName === 'tts') {
    // Piper TTS 服务：通过环境变量启用 GPU
    const args = [
      config.scriptPath,
      '--host', '127.0.0.1',
      '--port', config.port.toString(),
      '--model-dir', config.env.PIPER_MODEL_DIR || '',
    ];
    // 强制使用GPU：TTS服务必须使用GPU
    // 注意：即使Node.js端检测失败，也设置PIPER_USE_GPU=true，让服务内部验证
    // 因为TTS服务使用onnxruntime，而检测可能使用torch，检测结果可能不准确
    if (config.env) {
      config.env.PIPER_USE_GPU = 'true';
      if (cudaAvailable) {
        logger.info({ serviceName }, 'Piper TTS: GPU enabled via PIPER_USE_GPU environment variable (CUDA detected)');
      } else {
        logger.warn({ serviceName }, 'Piper TTS: CUDA detection failed in Node.js, but setting PIPER_USE_GPU=true anyway. Service will verify GPU availability internally.');
      }
    }
    return args;
  } else if (serviceName === 'yourtts') {
    // YourTTS 服务：通过 --gpu 参数启用 GPU
    const args = [
      config.scriptPath,
      '--host', '127.0.0.1',
      '--port', config.port.toString(),
      '--model-dir', config.env.YOURTTS_MODEL_DIR || '',
    ];
    if (cudaAvailable) {
      args.push('--gpu');
      logger.info({ serviceName }, 'YourTTS: GPU enabled via --gpu flag');
    }
    return args;
  } else if (serviceName === 'speaker_embedding') {
    // Speaker Embedding 服务：通过 --gpu 参数启用 GPU
    const args = [
      config.scriptPath,
      '--host', '127.0.0.1',
      '--port', config.port.toString(),
    ];
    if (cudaAvailable) {
      args.push('--gpu');
      logger.info({ serviceName }, 'Speaker Embedding: GPU enabled via --gpu flag');
    }
    return args;
  } else if (serviceName === 'faster_whisper_vad') {
    // Faster Whisper VAD 服务：通过环境变量启用 GPU（已在 python-service-config.ts 中设置）
    // 注意：不要在 service-process.ts 中覆盖 ASR_DEVICE，因为 python-service-config.ts 已经根据 CUDA_PATH 正确设置了
    // 如果这里覆盖，会忽略 python-service-config.ts 中的 CUDA 检测逻辑
    const args = [
      config.scriptPath,
    ];
    // ASR_DEVICE 和 ASR_COMPUTE_TYPE 已在 python-service-config.ts 中根据 CUDA_PATH 正确设置
    // 这里只记录日志，不覆盖配置
    if (config.env?.ASR_DEVICE) {
      logger.info({ 
        serviceName, 
        asrDevice: config.env.ASR_DEVICE,
        asrComputeType: config.env.ASR_COMPUTE_TYPE,
        cudaPath: config.env.CUDA_PATH 
      }, 'Faster Whisper VAD: Device configuration from python-service-config.ts');
    }
    return args;
  }
  return [];
}

/**
 * 启动服务进程
 */
export async function startServiceProcess(
  serviceName: PythonServiceName,
  config: PythonServiceConfig,
  handlers: ServiceProcessHandlers
): Promise<ChildProcess> {
  // 确保虚拟环境已设置（如果不存在则自动创建并安装依赖）
  try {
    await ensureVenvSetup(config, serviceName);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        serviceName,
        venvPath: config.venvPath,
        error: errorMessage,
      },
      'Failed to setup virtual environment'
    );
    throw error;
  }

  // 检查虚拟环境（应该已经存在）
  const pythonExe = path.join(config.venvPath, 'Scripts', 'python.exe');
  if (!fs.existsSync(pythonExe)) {
    const error = `Virtual environment does not exist after setup: ${config.venvPath}`;
    logger.error(
      {
        serviceName,
        venvPath: config.venvPath,
        pythonExe,
        venvExists: fs.existsSync(config.venvPath),
        scriptPath: config.scriptPath,
        scriptExists: fs.existsSync(config.scriptPath),
      },
      error
    );
    throw new Error(error);
  }

  // 检查脚本文件
  if (!fs.existsSync(config.scriptPath)) {
    const error = `Service script does not exist: ${config.scriptPath}`;
    logger.error({ serviceName, scriptPath: config.scriptPath }, error);
    throw new Error(error);
  }

  // 检查端口是否被占用，如果被占用则尝试清理
  const { checkPortAvailable } = require('../utils/port-manager');
  const portAvailable = await checkPortAvailable(config.port);

  if (!portAvailable) {
    logger.warn(
      { serviceName, port: config.port },
      `Port ${config.port} is already in use, attempting to cleanup...`
    );
    await cleanupPortProcesses(config.port, serviceName);
    // 等待端口释放
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 构建启动命令（需要检测 CUDA）
  const args = await buildServiceArgs(serviceName, config, pythonExe);

  // 启动进程
  const process = spawn(pythonExe, args, {
    env: config.env,
    cwd: config.workingDir,
    stdio: ['ignore', 'pipe', 'pipe'], // 重定向输出到日志文件
    detached: false,
  });

  // 创建日志文件流（使用 UTF-8 编码）
  const logStream = createLogStream(config.logFile);

  // 处理输出 - 按行分割并添加时间戳
  let stdoutBuffer = '';
  let stderrBuffer = '';

  process.stdout?.on('data', (data: Buffer) => {
    // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
    const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    stdoutBuffer += text;
    stdoutBuffer = flushLogBuffer(stdoutBuffer, false, logStream);
  });

  process.stderr?.on('data', (data: Buffer) => {
    // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
    const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    stderrBuffer += text;
    stderrBuffer = flushLogBuffer(stderrBuffer, true, logStream);
    // 同时输出到控制台以便调试
    logger.error({ serviceName, stderr: text }, 'Python service stderr output');
  });

  process.on('error', (error) => {
    logger.error({ error, serviceName }, 'Failed to start Python service process');
    logStream.end();
    handlers.onProcessError(error);
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

    logger.info({ code, signal, serviceName }, 'Python service process exited');
    if (code !== 0 && code !== null) {
      logger.error(
        {
          code,
          signal,
          serviceName,
          port: config.port,
          logFile: config.logFile,
        },
        `Python service exited with code ${code}. Check log file for details: ${config.logFile}`
      );
    }
    logStream.end();

    // 如果进程在启动阶段（waitForServiceReady 之前）退出，记录更详细的错误信息
    // 对于退出码为 1 的情况，可能是端口被占用或模型加载失败
    if (code === 1) {
      logger.warn(
        { serviceName, port: config.port, code, signal },
        'Service process exited during startup (exit code 1), possibly due to port conflict or initialization failure. If startup succeeds subsequently, this may be normal (port release delay)'
      );
    }

    handlers.onProcessExit(code, signal);
  });

  return process;
}

/**
 * 停止服务进程
 */
export async function stopServiceProcess(
  serviceName: PythonServiceName,
  child: ChildProcess,
  port: number | null
): Promise<void> {
  const pid = child.pid;

  logger.info(
    { serviceName, pid, port },
    `Stopping Python service (port: ${port}, PID: ${pid})...`
  );

  return new Promise((resolve) => {
    child.once('exit', async (code, signal) => {
      logger.info(
        { serviceName, pid, port, code, signal },
        `Python service process exited (port: ${port}, exit code: ${code})`
      );

      // 验证端口是否已释放
      if (port) {
        await verifyPortReleased(port, serviceName);
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
        logger.error({ error, serviceName, pid }, 'Failed to stop process, attempting force kill');
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGTERM');
    }

    // 增加超时时间到10秒，并添加更严格的进程验证
    const timeoutId = setTimeout(async () => {
      if (child.exitCode === null && !child.killed) {
        logger.warn(
          { serviceName, pid, port },
          `Service did not stop within 10 seconds, forcing termination (port: ${port}, PID: ${pid})`
        );
        
        // 在 Windows 上，使用更强制的方式终止进程树
        if (process.platform === 'win32' && pid) {
          try {
            // 使用 taskkill /T /F 强制终止进程树
            const killProcess = spawn('taskkill', ['/PID', pid.toString(), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true,
            });
            
            killProcess.on('exit', async (code) => {
              if (code === 0) {
                logger.info({ serviceName, pid, port }, 'Process tree terminated successfully');
              } else {
                logger.warn({ serviceName, pid, port, code }, 'taskkill returned non-zero exit code');
              }
              
              // 验证端口是否释放
              if (port) {
                await verifyPortReleased(port, serviceName);
              }
              resolve();
            });
            
            killProcess.on('error', async (error) => {
              logger.error({ error, serviceName, pid, port }, 'Failed to execute taskkill, using child.kill');
              child.kill('SIGKILL');
              if (port) {
                await verifyPortReleased(port, serviceName);
              }
              resolve();
            });
          } catch (error) {
            logger.error({ error, serviceName, pid, port }, 'Exception during force kill');
            child.kill('SIGKILL');
            if (port) {
              await verifyPortReleased(port, serviceName);
            }
            resolve();
          }
        } else {
          // 非 Windows 平台使用 SIGKILL
          child.kill('SIGKILL');
          if (port) {
            await verifyPortReleased(port, serviceName);
          }
          resolve();
        }
      }
    }, 10000); // 从 5 秒增加到 10 秒
    
    // 如果进程正常退出，清除超时定时器
    child.once('exit', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * 等待服务就绪（带进程检查）
 */
export async function waitForServiceReadyWithProcessCheck(
  port: number,
  process: ChildProcess,
  serviceName: PythonServiceName
): Promise<void> {
  // YourTTS 服务需要更长的启动时间（模型加载需要 30-60 秒）
  const timeout = serviceName === 'yourtts' ? 90000 : 30000;

  // 检查进程是否在等待期间退出
  let processExited = false;
  const exitHandler = () => {
    processExited = true;
  };
  process.once('exit', exitHandler);

  try {
    await waitForServiceReady(
      port,
      timeout,
      () => {
        // 检查进程是否还在运行
        if (processExited || process.killed || process.exitCode !== null) {
          throw new Error(`Service process exited during startup (exit code: ${process.exitCode})`);
        }
      }
    );
  } finally {
    process.removeListener('exit', exitHandler);
  }
}

