/**
 * Task Router NMT Handler
 * 处理NMT路由相关的逻辑
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import { ServiceType } from '../../../../shared/protocols/messages';
import {
  ServiceEndpoint,
  NMTTask,
  NMTResult,
} from './types';

export class TaskRouterNMTHandler {
  private jobAbortControllers: Map<string, AbortController> = new Map();
  private currentCycleServiceEfficiencies: Map<string, number[]> = new Map();

  constructor(
    private selectServiceEndpoint: (serviceType: ServiceType) => ServiceEndpoint | null,
    private startGpuTrackingForService: (serviceId: string) => void,
    private serviceConnections: Map<string, number>,
    private updateServiceConnections: (serviceId: string, delta: number) => void,
    private recordServiceEfficiency: (serviceId: string, efficiency: number) => void
  ) {}

  /**
   * 路由 NMT 任务
   */
  async routeNMTTask(task: NMTTask): Promise<NMTResult> {
    const endpoint = this.selectServiceEndpoint(ServiceType.NMT);
    if (!endpoint) {
      throw new Error('No available NMT service');
    }

    // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
    this.startGpuTrackingForService(endpoint.serviceId);

    this.updateServiceConnections(endpoint.serviceId, 1);

    try {
      // 创建 AbortController 用于支持任务取消
      // 注意：job_id 是调度服务器发送的，用于任务管理和取消
      // trace_id 用于全链路追踪，不用于任务管理
      if (!task.job_id) {
        logger.warn({}, 'NMT task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

      const httpClient: AxiosInstance = axios.create({
        baseURL: endpoint.baseUrl,
        timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
      });

      const taskStartTime = Date.now();
      
      // 详细记录NMT输入
      logger.info({
        serviceId: endpoint.serviceId,
        jobId: task.job_id,
        sessionId: (task as any).session_id,
        utteranceIndex: (task as any).utterance_index,
        text: task.text,
        textLength: task.text?.length || 0,
        textPreview: task.text?.substring(0, 100),
        srcLang: task.src_lang,
        tgtLang: task.tgt_lang,
        contextText: task.context_text,
        contextTextLength: task.context_text?.length || 0,
        contextTextPreview: task.context_text?.substring(0, 50),
        numCandidates: task.num_candidates,
        timeout: httpClient.defaults.timeout,
      }, 'NMT INPUT: Sending NMT request');
      
      const response = await httpClient.post('/v1/translate', {
        text: task.text,
        src_lang: task.src_lang,
        tgt_lang: task.tgt_lang,
        context_text: task.context_text,
        num_candidates: task.num_candidates, // 传递候选数量（如果指定）
      }, {
        signal: abortController.signal, // 支持任务取消
      });
      
      const requestDuration = Date.now() - taskStartTime;
      
      // 详细记录NMT输出
      const translatedText = response.data?.text || '';
      const candidates = response.data?.candidates || [];
      
      logger.info({
        serviceId: endpoint.serviceId,
        jobId: task.job_id,
        sessionId: (task as any).session_id,
        utteranceIndex: (task as any).utterance_index,
        status: response.status,
        requestDurationMs: requestDuration,
        translatedText: translatedText,
        translatedTextLength: translatedText.length,
        translatedTextPreview: translatedText.substring(0, 100),
        numCandidates: candidates.length,
        candidatesPreview: candidates.slice(0, 3).map((c: string) => c.substring(0, 50)),
      }, 'NMT OUTPUT: NMT request succeeded');
      if (requestDuration > 30000) {
        logger.warn({
          serviceId: endpoint.serviceId,
          jobId: task.job_id,
          requestDurationMs: requestDuration,
          textLength: task.text?.length || 0,
        }, 'NMT request took longer than 30 seconds');
      }

      // OBS-1: 记录 NMT 处理效率
      const taskEndTime = Date.now();
      const processingTimeMs = taskEndTime - taskStartTime;
      const textLength = task.text?.length || 0;
      this.recordNMTEfficiency(endpoint.serviceId, textLength, processingTimeMs);

      logger.debug(
        {
          serviceId: endpoint.serviceId,
          jobId: task.job_id,
          translatedTextLength: translatedText.length,
          translatedTextPreview: translatedText.substring(0, 100),
          sourceTextLength: task.text.length,
          sourceTextPreview: task.text.substring(0, 50),
        },
        'NMT service returned translation'
      );
      
      return {
        text: translatedText,
        confidence: response.data.confidence,
        candidates: response.data.candidates || undefined, // 返回候选列表（如果有）
      };
    } catch (error) {
      logger.error({ error, serviceId: endpoint.serviceId }, 'NMT task failed');
      throw error;
    } finally {
      // 清理 AbortController
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      this.updateServiceConnections(endpoint.serviceId, -1);
    }
  }

  /**
   * OBS-1: 记录 NMT 处理效率（按心跳周期）
   * @param serviceId 服务ID（如 'nmt-m2m100'）
   * @param textLength 文本长度（字符数）
   * @param processingTimeMs NMT 处理时间（毫秒）
   */
  private recordNMTEfficiency(serviceId: string, textLength: number | undefined, processingTimeMs: number): void {
    // 如果文本长度无效，跳过记录
    if (!textLength || textLength <= 0 || processingTimeMs <= 0) {
      return;
    }

    // 计算处理效率 = 文本长度(字符) / 处理时间(ms) * 1000 (转换为字符/秒)
    // 为了与其他指标保持一致（值越大越好），使用字符/秒作为效率指标
    const efficiency = (textLength / processingTimeMs) * 1000;
    this.recordServiceEfficiency(serviceId, efficiency);
  }

  /**
   * OBS-1: 获取当前心跳周期的处理效率指标
   */
  getProcessingMetrics(): Record<string, number> {
    const result: Record<string, number> = {};
    
    for (const [serviceId, efficiencies] of this.currentCycleServiceEfficiencies.entries()) {
      if (efficiencies.length > 0) {
        const sum = efficiencies.reduce((a, b) => a + b, 0);
        const average = sum / efficiencies.length;
        result[serviceId] = average;
      }
    }
    
    return result;
  }

  /**
   * OBS-1: 重置当前心跳周期的统计数据
   */
  resetCycleMetrics(): void {
    this.currentCycleServiceEfficiencies.clear();
  }
}
