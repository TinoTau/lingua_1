import logger from './logger';

// 获取 GPU 使用率（多种方法尝试，带超时保护）
export async function getGpuUsage(): Promise<{ usage: number; memory: number } | null> {
  const GPU_FETCH_TIMEOUT = 2000; // 2秒超时，避免阻塞界面
  
  logger.debug({}, 'Starting to fetch GPU usage');

  // 使用 Promise.race 确保不会超过超时时间
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => {
      logger.debug({}, 'GPU usage fetch timeout, returning null');
      resolve(null);
    }, GPU_FETCH_TIMEOUT);
  });

  const fetchPromise = (async () => {
    // 方法1: 尝试使用 nvidia-smi (Windows/Linux, 如果可用)
    try {
      logger.debug({}, 'Attempting to fetch GPU info via nvidia-smi');
      const result = await getGpuUsageViaNvidiaSmi();
      if (result) {
        logger.debug({ result }, 'Successfully fetched GPU info via nvidia-smi');
        return result;
      }
    } catch (error) {
      logger.debug({ error }, 'nvidia-smi method failed, trying alternative');
    }

    // 方法2: 尝试使用 Python + pynvml
    try {
      logger.debug({}, 'Attempting to fetch GPU info via Python pynvml');
      const result = await getGpuUsageViaPython();
      if (result) {
        logger.debug({ result }, 'Successfully fetched GPU info via Python pynvml');
        return result;
      }
    } catch (error) {
      logger.debug({ error }, 'Python pynvml method failed');
    }

    logger.debug({}, 'All GPU info fetch methods failed, GPU info will not be displayed');
    return null;
  })();

  // 如果超过超时时间，立即返回 null，不阻塞
  return await Promise.race([fetchPromise, timeoutPromise]);
}

// 方法1: 使用 nvidia-smi 命令获取 GPU 信息（带超时保护）
async function getGpuUsageViaNvidiaSmi(): Promise<{ usage: number; memory: number } | null> {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    // nvidia-smi 命令：获取GPU利用率和内存使用率
    const nvidiaSmi = spawn('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits'
    ]);

    // 设置超时（1.5秒），避免命令挂起
    const timeout = setTimeout(() => {
      nvidiaSmi.kill();
      logger.debug({}, 'nvidia-smi command timeout, killed process');
      resolve(null);
    }, 1500);

    let output = '';
    let errorOutput = '';

    nvidiaSmi.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    nvidiaSmi.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    nvidiaSmi.on('close', (code: number) => {
      clearTimeout(timeout);
      if (code === 0 && output.trim()) {
        try {
          // 输出格式: "utilization.gpu, memory.used, memory.total"
          const parts = output.trim().split(',');
          // 降低nvidia-smi相关日志级别为debug，减少终端输出
          logger.debug({ code, output: output.trim(), parts }, 'nvidia-smi command executed successfully, starting to parse output');
          if (parts.length >= 3) {
            const usage = parseFloat(parts[0].trim());
            const memUsed = parseFloat(parts[1].trim());
            const memTotal = parseFloat(parts[2].trim());
            const memPercent = (memUsed / memTotal) * 100;

            logger.debug({ usage, memUsed, memTotal, memPercent }, 'Parsed GPU info');
            if (!isNaN(usage) && !isNaN(memPercent)) {
              // 降低nvidia-smi成功日志级别为debug，减少终端输出
              logger.debug({ usage, memory: memPercent }, 'nvidia-smi successfully returned GPU usage');
              resolve({ usage, memory: memPercent });
              return;
            } else {
              logger.warn({ usage, memPercent }, 'Parsed values are invalid (NaN)');
            }
          } else {
            logger.warn({ partsLength: parts.length, parts }, 'nvidia-smi output format incorrect, insufficient parts');
          }
        } catch (parseError) {
          logger.warn({ parseError, output }, 'Failed to parse nvidia-smi output');
        }
      } else {
        logger.warn({ code, output: output.trim(), errorOutput: errorOutput.trim() }, 'nvidia-smi command execution failed or output is empty');
      }
      resolve(null);
    });

    nvidiaSmi.on('error', (error: Error) => {
      clearTimeout(timeout);
      // nvidia-smi 命令不存在或无法执行
      logger.debug({ error: error.message }, 'nvidia-smi command execution error (command may not exist)');
      resolve(null);
    });
  });
}

// 方法2: 使用 Python + pynvml 获取 GPU 信息（带超时保护）
async function getGpuUsageViaPython(): Promise<{ usage: number; memory: number } | null> {
  return new Promise((resolve) => {
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
    print("ERROR")
`;

    // 尝试 python3 或 python
    const pythonCommands = ['python3', 'python'];
    let currentIndex = 0;
    let timeout: NodeJS.Timeout | null = null;

    const tryNextPython = () => {
      if (currentIndex >= pythonCommands.length) {
        if (timeout) clearTimeout(timeout);
        resolve(null);
        return;
      }

      const python = spawn(pythonCommands[currentIndex], ['-c', pythonScript]);
      
      // 设置超时（1秒），避免 Python 脚本挂起
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        python.kill();
        logger.debug({ command: pythonCommands[currentIndex] }, 'Python GPU script timeout, killed process');
        currentIndex++;
        tryNextPython();
      }, 1000);

      let output = '';
      let errorOutput = '';

      python.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      python.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      python.on('close', (code: number) => {
        if (timeout) clearTimeout(timeout);
        if (code === 0 && output.trim() !== 'ERROR') {
          try {
            const [usage, memory] = output.trim().split(',').map(Number);
            if (!isNaN(usage) && !isNaN(memory)) {
              resolve({ usage, memory });
              return;
            }
          } catch (parseError) {
            logger.debug({ parseError, output }, 'Failed to parse Python output');
          }
        }
        // 当前命令失败，尝试下一个
        currentIndex++;
        tryNextPython();
      });

      python.on('error', () => {
        if (timeout) clearTimeout(timeout);
        // 当前命令不存在，尝试下一个
        currentIndex++;
        tryNextPython();
      });
    };

    tryNextPython();
  });
}

