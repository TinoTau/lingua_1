/**
 * 预先配置 CUDA/cuDNN 环境路径到 PATH
 * 在任何子进程启动前执行，确保 ONNX Runtime 能找到 CUDA/cuDNN DLLs
 */
import * as path from 'path';

export function setupCudaPath(): void {
  const cudaPath = process.env.CUDA_PATH || 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4';
  const cudnnBasePath = 'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin';
  const cudnnPath = path.join(cudnnBasePath, '12.6');

  const cudaPaths = [
    path.join(cudaPath, 'bin'),
    path.join(cudaPath, 'libnvvp'),
    cudnnPath,
    cudnnBasePath,
  ];

  const existingPath = process.env.PATH || '';
  process.env.PATH = [...cudaPaths, existingPath].join(path.delimiter);

  console.log('✅ CUDA/cuDNN paths configured in PATH:');
  cudaPaths.forEach((p) => console.log(`   - ${p}`));
  console.log('');
}
