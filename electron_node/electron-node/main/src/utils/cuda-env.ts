//! CUDA 环境设置工具
//! 
//! 提供 CUDA 环境变量配置功能

import * as path from 'path';
import * as fs from 'fs';
import logger from '../logger';

/**
 * 设置 CUDA 环境变量
 */
export function setupCudaEnvironment(): Record<string, string> {
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

      // 检查并添加 cuDNN 路径（ONNX Runtime 需要）
      // 优先检查 cuDNN 9.x（用于 CUDA 12.x），然后检查其他版本
      const cudnnPaths = [
        'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin\\12.6', // cuDNN 9.x for CUDA 12.x (优先)
        'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin\\11.8', // cuDNN 9.x for CUDA 11.8
        path.join(cudaPath, 'bin'), // cuDNN 可能在 CUDA bin 目录中
        'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin', // cuDNN 9.x 通用路径
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\cuDNN\\bin',
        'C:\\cudnn\\bin',
      ];

      const foundCudnnPaths: string[] = [];
      const cudnnDlls = ['cudnn_graph64_9.dll', 'cudnn64_9.dll', 'cudnn64_8.dll'];
      
      // 收集所有找到的 cuDNN 路径
      for (const cudnnPath of cudnnPaths) {
        if (fs.existsSync(cudnnPath)) {
          // 检查是否有 cuDNN DLL 文件
          for (const dll of cudnnDlls) {
            const dllPath = path.join(cudnnPath, dll);
            if (fs.existsSync(dllPath)) {
              if (!foundCudnnPaths.includes(cudnnPath)) {
                foundCudnnPaths.push(cudnnPath);
                logger.info({ cudnnPath, dll }, 'Found cuDNN DLL');
              }
              break; // 找到一个 DLL 就足够了
            }
          }
        }
      }

      // 构建 PATH：cuDNN 路径 + CUDA 路径 + 原有 PATH
      const currentPath = process.env.PATH || '';
      const pathParts: string[] = [];
      
      // 添加所有找到的 cuDNN 路径（优先使用 cuDNN 9.x）
      foundCudnnPaths.forEach(p => pathParts.push(p));
      
      // 添加 CUDA 路径
      pathParts.push(cudaBin);
      pathParts.push(cudaLibnvvp);
      
      // 添加原有 PATH
      pathParts.push(currentPath);
      
      env.PATH = pathParts.join(';');
      
      if (foundCudnnPaths.length > 0) {
        // 使用第一个找到的 cuDNN 路径作为 CUDNN_PATH（通常是 9.x for CUDA 12.x）
        env.CUDNN_PATH = path.dirname(foundCudnnPaths[0]);
        logger.info({ 
          cudnnPaths: foundCudnnPaths, 
          cudaPath,
          cudnnPath: env.CUDNN_PATH 
        }, 'CUDA and cuDNN environment configured');
      } else {
        // 即使没有找到 cuDNN，也设置 CUDA 路径（某些库可能只需要 CUDA）
        logger.warn({ cudaPath }, 'CUDA environment configured but cuDNN not found. ONNX Runtime CUDA may not work.');
      }

      break;
    }
  }

  return env;
}

