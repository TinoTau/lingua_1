//! GPU 跟踪工具
//! 
//! 提供 GPU 使用率监控和累计使用时间跟踪功能

import logger from '../logger';

export interface GpuUsageInfo {
  usage: number;
  memory: number;
}

/**
 * 获取 GPU 使用率（通过 Python pynvml）
 */
export async function getGpuUsage(): Promise<GpuUsageInfo | null> {
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
except Exception as e:
    print(f"ERROR:{str(e)}")
`;

    return new Promise((resolve) => {
      const python = spawn('python', ['-c', pythonScript]);
      let output = '';
      let errorOutput = '';

      python.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      python.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      python.on('close', (code: number) => {
        if (code === 0 && output.trim() && !output.trim().startsWith('ERROR')) {
          try {
            const [usage, memory] = output.trim().split(',').map(Number);
            if (!isNaN(usage) && !isNaN(memory)) {
              logger.debug({ usage, memory }, 'GPU usage retrieved successfully');
              resolve({ usage, memory });
            } else {
              logger.warn({ output: output.trim() }, 'Failed to parse GPU usage output');
              resolve(null);
            }
          } catch (error) {
            logger.warn({ error, output: output.trim() }, 'Error parsing GPU usage');
            resolve(null);
          }
        } else {
          if (output.trim().startsWith('ERROR:')) {
            logger.warn({ error: output.trim(), code }, 'GPU usage check failed');
          } else {
            logger.debug({ code, output: output.trim(), errorOutput: errorOutput.trim() }, 'GPU usage check returned no data');
          }
          resolve(null);
        }
      });

      python.on('error', (error: Error) => {
        logger.warn({ error }, 'Failed to spawn Python process for GPU usage check');
        resolve(null);
      });
    });
  } catch (error) {
    return null;
  }
}

/**
 * GPU 使用时间跟踪器
 * 只在GPU实际被使用时累计时间
 */
export class GpuUsageTracker {
  private gpuUsageMs: number = 0; // 累计的GPU使用时间（毫秒）
  private gpuUsageStartTime: number | null = null; // 当前GPU使用时段的开始时间
  private gpuCheckInterval: NodeJS.Timeout | null = null;
  private checkIntervalMs: number = 500;
  private isGpuInUse: boolean = false; // 当前是否正在使用GPU

  /**
   * 开始跟踪 GPU 使用时间
   */
  startTracking(): void {
    if (this.gpuCheckInterval) {
      logger.debug({}, 'GPU tracking already started, skipping');
      return; // 已经在跟踪
    }

    // 定期检查 GPU 使用率
    this.gpuCheckInterval = setInterval(async () => {
      try {
        const gpuInfo = await getGpuUsage();
        const now = Date.now();
        
        if (gpuInfo && gpuInfo.usage > 0) {
          // GPU 正在使用
          if (!this.isGpuInUse) {
            // 从非使用状态变为使用状态，记录开始时间
            this.isGpuInUse = true;
            this.gpuUsageStartTime = now;
            logger.debug({ usage: gpuInfo.usage, memory: gpuInfo.memory }, 'GPU usage detected, starting tracking');
          }
          // 如果已经在使用状态，继续等待下次检查，不累计时间
          // 时间会在检测到GPU停止使用时累计，或者在getGpuUsageMs时实时计算
        } else {
          // GPU 未使用
          if (this.isGpuInUse && this.gpuUsageStartTime) {
            // 从使用状态变为非使用状态，累计这段时间
            const elapsed = now - this.gpuUsageStartTime;
            this.gpuUsageMs += elapsed;
            logger.debug({ elapsed, totalMs: this.gpuUsageMs }, 'GPU usage stopped, accumulated time');
          }
          this.isGpuInUse = false;
          this.gpuUsageStartTime = null;
        }
      } catch (error) {
        logger.warn({ error }, 'Error checking GPU usage');
        // 忽略错误，继续跟踪
        // 如果出错，保守处理：如果有开始时间，累计到当前
        if (this.isGpuInUse && this.gpuUsageStartTime) {
          const now = Date.now();
          const elapsed = now - this.gpuUsageStartTime;
          this.gpuUsageMs += elapsed;
          this.gpuUsageStartTime = now; // 重置开始时间，避免重复累计
        }
      }
    }, this.checkIntervalMs);
    
    logger.info({}, 'GPU tracking started');
  }

  /**
   * 停止跟踪 GPU 使用时间
   */
  stopTracking(): void {
    if (this.gpuCheckInterval) {
      clearInterval(this.gpuCheckInterval);
      this.gpuCheckInterval = null;
    }

    // 如果GPU还在使用中，累计最后一次使用时间
    if (this.isGpuInUse && this.gpuUsageStartTime) {
      const now = Date.now();
      const elapsed = now - this.gpuUsageStartTime;
      this.gpuUsageMs += elapsed;
      logger.debug({ elapsed, totalMs: this.gpuUsageMs }, 'GPU tracking stopped, final accumulation');
    }
    
    this.isGpuInUse = false;
    this.gpuUsageStartTime = null;
    logger.info({ totalMs: this.gpuUsageMs }, 'GPU tracking stopped');
  }

  /**
   * 获取累计 GPU 使用时间（毫秒）
   * 返回的是固定累计值，不会时高时低
   */
  getGpuUsageMs(): number {
    // 如果当前GPU正在使用中，需要加上从开始使用到现在的时间
    if (this.isGpuInUse && this.gpuUsageStartTime) {
      const now = Date.now();
      const elapsed = now - this.gpuUsageStartTime;
      return this.gpuUsageMs + elapsed;
    }
    // 如果GPU未使用或已停止跟踪，返回累计值
    return this.gpuUsageMs;
  }

  /**
   * 重置累计时间
   */
  reset(): void {
    this.gpuUsageMs = 0;
    this.gpuUsageStartTime = null;
    this.isGpuInUse = false;
  }
}

