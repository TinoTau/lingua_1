import * as path from 'path';
import * as fs from 'fs';
import logger from '../logger';

/**
 * 设置 CUDA 环境变量
 */
export function setupCudaEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};

  // 检查 CUDA 安装路径
  const cudaPaths = [
    'C\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4',
    'C\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.1',
    'C\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.8',
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

      // 更新 PATH
      const currentPath = process.env.PATH || '';
      env.PATH = `${cudaBin};${cudaLibnvvp};${currentPath}`;

      logger.info({ cudaPath }, 'CUDA 环境已配置');
      break;
    }
  }

  return env;
}

