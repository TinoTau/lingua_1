/**
 * Node Agent Hardware Info Handler
 * 处理硬件信息获取相关的逻辑
 */

import * as si from 'systeminformation';
import * as os from 'os';
import logger from '../logger';

export class HardwareInfoHandler {
  /**
   * 获取平台信息
   */
  getPlatform(): 'windows' | 'linux' | 'macos' {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
  }

  /**
   * 获取硬件信息
   */
  async getHardwareInfo(): Promise<{
    cpu_cores: number;
    memory_gb: number;
    gpus?: Array<{ name: string; memory_gb: number }>;
  }> {
    try {
      const mem = await si.mem();
      const cpu = await si.cpu();

      // 获取 GPU 硬件信息（使用 nvidia-smi）
      const gpus = await this.getGpuHardwareInfo();

      return {
        cpu_cores: cpu.cores || os.cpus().length,
        memory_gb: Math.round(mem.total / (1024 * 1024 * 1024)),
        gpus: gpus.length > 0 ? gpus : undefined,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get hardware info');
      return {
        cpu_cores: os.cpus().length,
        memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
      };
    }
  }

  /**
   * 获取 GPU 硬件信息（名称和显存大小）
   * 使用 nvidia-smi 命令获取
   */
  async getGpuHardwareInfo(): Promise<Array<{ name: string; memory_gb: number }>> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      // nvidia-smi 命令：获取GPU名称和显存大小
      const nvidiaSmi = spawn('nvidia-smi', [
        '--query-gpu=name,memory.total',
        '--format=csv,noheader,nounits'
      ]);

      let output = '';
      let errorOutput = '';

      nvidiaSmi.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      nvidiaSmi.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      nvidiaSmi.on('close', (code: number) => {
        if (code === 0 && output.trim()) {
          try {
            const lines = output.trim().split('\n');
            const gpus: Array<{ name: string; memory_gb: number }> = [];

            for (const line of lines) {
              // 格式: "GPU Name, Memory Total (MB)"
              const parts = line.split(',');
              if (parts.length >= 2) {
                const name = parts[0].trim();
                const memoryMb = parseFloat(parts[1].trim());
                const memoryGb = Math.round(memoryMb / 1024);

                if (!isNaN(memoryGb) && name) {
                  gpus.push({ name, memory_gb: memoryGb });
                }
              }
            }

            if (gpus.length > 0) {
              logger.info({ gpus }, 'Successfully fetched GPU hardware info');
              resolve(gpus);
            } else {
              logger.warn({ output }, 'Failed to parse GPU hardware info');
              resolve([]);
            }
          } catch (parseError) {
            logger.warn({ parseError, output }, 'Failed to parse nvidia-smi output');
            resolve([]);
          }
        } else {
          logger.warn({ code, errorOutput: errorOutput.trim() }, 'nvidia-smi command failed or no GPU found');
          resolve([]);
        }
      });

      nvidiaSmi.on('error', (error: Error) => {
        // nvidia-smi 命令不存在或无法执行
        logger.warn({ error: error.message }, 'nvidia-smi command not available');
        resolve([]);
      });
    });
  }
}
