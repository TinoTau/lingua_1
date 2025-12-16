import logger from '../logger';

/**
 * 等待服务就绪（通过健康检查）
 */
export async function waitForServiceReady(
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
              maxWaitMs,
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

