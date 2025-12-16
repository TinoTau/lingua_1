//! Python 服务配置工具
//! 
//! 提供 Python 服务的配置生成功能

import * as path from 'path';
import * as fs from 'fs';
import { setupCudaEnvironment } from './cuda-env';

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

/**
 * 获取 Python 服务配置
 */
export function getPythonServiceConfig(
  serviceName: 'nmt' | 'tts' | 'yourtts',
  projectRoot: string
): PythonServiceConfig | null {
  const baseEnv: Record<string, string> = {
    ...process.env,
    ...setupCudaEnvironment(),
    PYTHONIOENCODING: 'utf-8',
  };

  switch (serviceName) {
    case 'nmt': {
      const servicePath = path.join(projectRoot, 'electron_node', 'services', 'nmt_m2m100');
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
          // 忽略错误
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
      const servicePath = path.join(projectRoot, 'electron_node', 'services', 'piper_tts');
      const venvPath = path.join(servicePath, 'venv');
      const venvScripts = path.join(venvPath, 'Scripts');
      const logDir = path.join(servicePath, 'logs');
      const logFile = path.join(logDir, 'tts-service.log');

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const modelDir = process.env.PIPER_MODEL_DIR
        || path.join(projectRoot, 'electron_node', 'services', 'node-inference', 'models', 'tts');

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
          PIPER_USE_GPU: (baseEnv as any).CUDA_PATH ? 'true' : 'false',
          PIPER_MODEL_DIR: modelDir,
        },
      };
    }

    case 'yourtts': {
      const servicePath = path.join(projectRoot, 'electron_node', 'services', 'your_tts');
      const venvPath = path.join(servicePath, 'venv');
      const venvScripts = path.join(venvPath, 'Scripts');
      const logDir = path.join(servicePath, 'logs');
      const logFile = path.join(logDir, 'yourtts-service.log');

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const modelDir = process.env.YOURTTS_MODEL_DIR
        || path.join(projectRoot, 'electron_node', 'services', 'node-inference', 'models', 'tts', 'your_tts');

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
          YOURTTS_USE_GPU: (baseEnv as any).CUDA_PATH ? 'true' : 'false',
        },
      };
    }

    default:
      return null;
  }
}

