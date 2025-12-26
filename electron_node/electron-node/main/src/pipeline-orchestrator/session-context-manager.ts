/**
 * Gate-A: Session Context Manager
 * 管理会话级别的上下文重置
 */

import logger from '../logger';
import axios, { AxiosInstance } from 'axios';

export interface SessionContextResetRequest {
  sessionId: string;
  reason: string;
  jobId?: string;
}

export interface ContextResetResult {
  success: boolean;
  asrContextReset: boolean;
  translationContextReset: boolean;
  consecutiveLowQualityCountReset: boolean;
  error?: string;
}

/**
 * Session Context Manager
 * 负责管理会话级别的上下文重置
 */
export class SessionContextManager {
  private contextResetMetrics = {
    totalResets: 0,
    asrContextResets: 0,
    translationContextResets: 0,
    consecutiveLowQualityCountResets: 0,
    errors: 0,
  };
  private taskRouter?: any; // TaskRouter 实例（用于获取 ASR 端点）

  /**
   * 设置 TaskRouter 实例（用于获取 ASR 服务端点）
   */
  setTaskRouter(taskRouter: any): void {
    this.taskRouter = taskRouter;
  }

  /**
   * 获取 ASR 服务端点列表
   */
  private async getASREndpoints(): Promise<string[]> {
    if (!this.taskRouter) {
      logger.warn('Gate-A: TaskRouter not set, cannot get ASR endpoints');
      return [];
    }

    try {
      // 通过 TaskRouter 获取 ASR 服务端点
      // 注意：这里需要访问 TaskRouter 的私有方法，可能需要添加公共方法
      // 暂时返回空数组，等待 TaskRouter 添加公共方法
      // TODO: 在 TaskRouter 中添加 getASREndpoints() 公共方法
      logger.warn('Gate-A: getASREndpoints not yet implemented, need TaskRouter.getASREndpoints()');
      return [];
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
        },
        'Gate-A: Failed to get ASR endpoints'
      );
      return [];
    }
  }

  /**
   * Gate-A: 重置会话上下文
   * 
   * 执行以下操作：
   * 1. 清空该 session 的 ASR prompt/context buffer
   * 2. 清空 translation context（如有）
   * 3. 重置 consecutiveLowQualityCount（由 TaskRouter 处理）
   * 4. 记录一次 context_reset_event 指标
   * 
   * @param request 重置请求
   * @param taskRouter TaskRouter 实例（用于重置 consecutiveLowQualityCount）
   * @returns 重置结果
   */
  async resetContext(
    request: SessionContextResetRequest,
    taskRouter?: any
  ): Promise<ContextResetResult> {
    const { sessionId, reason, jobId } = request;
    
    logger.info(
      {
        sessionId,
        reason,
        jobId,
      },
      'Gate-A: Starting context reset'
    );

    const result: ContextResetResult = {
      success: true,
      asrContextReset: false,
      translationContextReset: false,
      consecutiveLowQualityCountReset: false,
    };

    try {
      // 1. 清空 ASR prompt/context buffer
      // 通过调用 ASR 服务的 /reset 端点来清空
      try {
        // 获取 ASR 服务端点
        const asrEndpoints = taskRouter ? taskRouter.getASREndpoints() : [];
        
        if (asrEndpoints.length === 0) {
          logger.warn(
            {
              sessionId,
              reason,
            },
            'Gate-A: No ASR endpoints available for context reset'
          );
        } else {
          // 调用所有 ASR 服务的 reset 端点（因为 context 是全局的）
          const resetPromises = asrEndpoints.map(async (endpoint: string) => {
            try {
              const response = await axios.post(`${endpoint}/reset`, {
                reset_context: true,
                reset_text_context: true,
              }, {
                timeout: 2000, // 2 秒超时
              });
              return { endpoint, success: true };
            } catch (error: any) {
              logger.warn(
                {
                  sessionId,
                  reason,
                  endpoint,
                  error: error.message,
                },
                'Gate-A: Failed to reset ASR context for endpoint'
              );
              return { endpoint, success: false, error: error.message };
            }
          });
          
          const resetResults = await Promise.allSettled(resetPromises);
          const successCount = resetResults.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
          
          if (successCount > 0) {
            result.asrContextReset = true;
            logger.info(
              {
                sessionId,
                reason,
                successCount,
                totalEndpoints: asrEndpoints.length,
              },
              'Gate-A: ASR context reset completed'
            );
          } else {
            logger.warn(
              {
                sessionId,
                reason,
              },
              'Gate-A: All ASR context reset attempts failed'
            );
            result.success = false;
            result.error = 'All ASR context reset attempts failed';
          }
        }
      } catch (error: any) {
        logger.error(
          {
            sessionId,
            reason,
            error: error.message,
          },
          'Gate-A: Failed to reset ASR context'
        );
        result.success = false;
        result.error = `ASR context reset failed: ${error.message}`;
      }

      // 2. 清空 translation context
      // 注意：translation context 在 GroupManager 中管理
      // 这里我们记录日志，提示需要在 GroupManager 中实现
      try {
        // TODO: 在 GroupManager 中添加 reset 方法
        logger.warn(
          {
            sessionId,
            reason,
          },
          'Gate-A: Translation context reset not yet implemented (needs GroupManager.resetContext)'
        );
        // result.translationContextReset = true; // 暂时标记为成功，等待实现
      } catch (error: any) {
        logger.error(
          {
            sessionId,
            reason,
            error: error.message,
          },
          'Gate-A: Failed to reset translation context'
        );
        result.success = false;
        result.error = result.error 
          ? `${result.error}; Translation context reset failed: ${error.message}`
          : `Translation context reset failed: ${error.message}`;
      }

      // 3. 重置 consecutiveLowQualityCount（由 TaskRouter 处理）
      if (taskRouter && typeof taskRouter.resetConsecutiveLowQualityCount === 'function') {
        try {
          taskRouter.resetConsecutiveLowQualityCount(sessionId);
          result.consecutiveLowQualityCountReset = true;
          logger.info(
            {
              sessionId,
              reason,
            },
            'Gate-A: Reset consecutiveLowQualityCount'
          );
        } catch (error: any) {
          logger.error(
            {
              sessionId,
              reason,
              error: error.message,
            },
            'Gate-A: Failed to reset consecutiveLowQualityCount'
          );
          result.success = false;
          result.error = result.error 
            ? `${result.error}; ConsecutiveLowQualityCount reset failed: ${error.message}`
            : `ConsecutiveLowQualityCount reset failed: ${error.message}`;
        }
      } else {
        logger.warn(
          {
            sessionId,
            reason,
          },
          'Gate-A: TaskRouter.resetConsecutiveLowQualityCount not available'
        );
      }

      // 4. 记录 context_reset_event 指标
      this.contextResetMetrics.totalResets++;
      if (result.asrContextReset) {
        this.contextResetMetrics.asrContextResets++;
      }
      if (result.translationContextReset) {
        this.contextResetMetrics.translationContextResets++;
      }
      if (result.consecutiveLowQualityCountReset) {
        this.contextResetMetrics.consecutiveLowQualityCountResets++;
      }
      if (!result.success) {
        this.contextResetMetrics.errors++;
      }

      logger.info(
        {
          sessionId,
          reason,
          result,
          metrics: this.contextResetMetrics,
        },
        'Gate-A: Context reset completed'
      );

      return result;
    } catch (error: any) {
      logger.error(
        {
          sessionId,
          reason,
          error: error.message,
          stack: error.stack,
        },
        'Gate-A: Context reset failed with exception'
      );
      
      this.contextResetMetrics.errors++;
      this.contextResetMetrics.totalResets++;
      
      return {
        success: false,
        asrContextReset: false,
        translationContextReset: false,
        consecutiveLowQualityCountReset: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取上下文重置指标
   */
  getMetrics() {
    return { ...this.contextResetMetrics };
  }
}

