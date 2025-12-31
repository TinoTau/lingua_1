/**
 * Task Router TONE Handler
 * 处理TONE路由相关的逻辑
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import { ServiceType } from '../../../../shared/protocols/messages';
import {
  ServiceEndpoint,
  TONETask,
  TONEResult,
} from './types';

export class TaskRouterTONEHandler {
  private jobAbortControllers: Map<string, AbortController> = new Map();

  constructor(
    private selectServiceEndpoint: (serviceType: ServiceType) => ServiceEndpoint | null,
    private serviceConnections: Map<string, number>,
    private updateServiceConnections: (serviceId: string, delta: number) => void
  ) {}

  /**
   * 路由 TONE 任务
   */
  async routeTONETask(task: TONETask): Promise<TONEResult> {
    const endpoint = this.selectServiceEndpoint(ServiceType.TONE);
    if (!endpoint) {
      throw new Error('No available TONE service');
    }

    this.updateServiceConnections(endpoint.serviceId, 1);

    try {
      // 创建 AbortController 用于支持任务取消
      // 注意：job_id 是调度服务器发送的，用于任务管理和取消
      // trace_id 用于全链路追踪，不用于任务管理
      if (!task.job_id) {
        logger.warn({}, 'TONE task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

      const httpClient: AxiosInstance = axios.create({
        baseURL: endpoint.baseUrl,
        timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
      });

      const endpointPath = task.action === 'embed' ? '/v1/tone/embed' : '/v1/tone/clone';
      const response = await httpClient.post(endpointPath, {
        audio: task.audio,
        audio_format: task.audio_format,
        sample_rate: task.sample_rate,
        speaker_id: task.speaker_id,
      }, {
        signal: abortController.signal, // 支持任务取消
      });

      return {
        embedding: response.data.embedding,
        speaker_id: response.data.speaker_id,
        audio: response.data.audio,
      };
    } catch (error) {
      logger.error({ error, serviceId: endpoint.serviceId }, 'TONE task failed');
      throw error;
    } finally {
      // 清理 AbortController
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      this.updateServiceConnections(endpoint.serviceId, -1);
    }
  }
}
