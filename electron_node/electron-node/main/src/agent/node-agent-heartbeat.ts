/**
 * Node Agent Heartbeat Handler
 * 处理心跳相关的逻辑
 */

import WebSocket from 'ws';
import * as si from 'systeminformation';
import {
  NodeHeartbeatMessage,
  InstalledModel,
  InstalledService,
  CapabilityByType,
} from '../../../../shared/protocols/messages';
import { InferenceService } from '../inference/inference-service';
import { NodeConfig } from '../node-config';
import logger from '../logger';

export class HeartbeatHandler {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatDebounceTimer: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_DEBOUNCE_MS = 2000; // 防抖延迟：2秒内最多触发一次立即心跳

  constructor(
    private ws: WebSocket | null,
    private nodeId: string | null,
    private inferenceService: InferenceService,
    private nodeConfig: NodeConfig,
    private getInstalledServices: () => Promise<InstalledService[]>,
    private getCapabilityByType: (services: InstalledService[]) => Promise<CapabilityByType[]>,
    private shouldCollectRerunMetrics: (services: InstalledService[]) => boolean,
    private shouldCollectASRMetrics: (services: InstalledService[]) => boolean
  ) {}

  /**
   * 启动心跳
   */
  startHeartbeat(): void {
    // 如果 nodeId 已存在（重连场景），立即发送一次心跳
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.nodeId) {
      this.sendHeartbeatOnce().catch((error) => {
        logger.warn({ error }, 'Failed to send initial heartbeat');
      });
    }

    // 设置定时器，每15秒发送一次心跳
    this.heartbeatInterval = setInterval(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) return;

      await this.sendHeartbeatOnce();
    }, 15000); // 每15秒发送一次心跳
  }

  /**
   * 停止心跳
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // 清理防抖定时器
    if (this.heartbeatDebounceTimer) {
      clearTimeout(this.heartbeatDebounceTimer);
      this.heartbeatDebounceTimer = null;
    }
  }

  /**
   * 立即发送一次心跳（用于 node_register_ack 后立刻同步 installed_services/capability_state）
   * 避免等待 15s interval 导致调度端短时间内认为"无可用节点/无服务包"。
   */
  async sendHeartbeatOnce(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) return;

    const resources = await this.getSystemResources();
    const installedModels = await this.inferenceService.getInstalledModels();

    const installedServicesAll = await this.getInstalledServices();
    const capabilityByType = await this.getCapabilityByType(installedServicesAll);

    logger.info({
      nodeId: this.nodeId,
      installedModelsCount: installedModels.length,
      installedServicesCount: installedServicesAll.length,
      capabilityByTypeCount: capabilityByType.length,
      capabilityByType,
      installedServices: installedServicesAll.map(s => `${s.service_id}:${s.type}:${s.status}`),
    }, 'Sending heartbeat with type-level capability');

    // 对齐协议规范：node_heartbeat 消息格式
    // 注意：gpu_percent 必须提供（不能为 undefined），因为调度服务器的健康检查要求所有节点都必须有 GPU
    // 如果无法获取 GPU 使用率，使用 0.0 作为默认值
    const message: NodeHeartbeatMessage = {
      type: 'node_heartbeat',
      node_id: this.nodeId,
      timestamp: Date.now(),
      resource_usage: {
        cpu_percent: resources.cpu,
        gpu_percent: resources.gpu ?? 0.0, // 如果为 null，使用 0.0 作为默认值
        gpu_mem_percent: resources.gpuMem || undefined,
        mem_percent: resources.memory,
        running_jobs: this.inferenceService.getCurrentJobCount(),
      },
      installed_models: installedModels.length > 0 ? installedModels : undefined,
      installed_services: installedServicesAll,
      capability_by_type: capabilityByType,
    };

    // 方案1+方案2：基于配置和服务状态的动态指标收集（支持热插拔）
    const metricsConfig = this.nodeConfig.metrics;
    const metricsEnabled = metricsConfig?.enabled !== false; // 默认启用（向后兼容）

    if (metricsEnabled) {
      // 检查 Rerun 指标（Gate-B）
      const rerunMetricsEnabled = metricsConfig?.metrics?.rerun !== false; // 默认启用
      if (rerunMetricsEnabled && this.shouldCollectRerunMetrics(installedServicesAll)) {
        const rerunMetrics = this.inferenceService.getRerunMetrics?.();
        if (rerunMetrics) {
          message.rerun_metrics = rerunMetrics;
        }
      }

      // 检查处理效率指标（OBS-1）
      const asrMetricsEnabled = metricsConfig?.metrics?.asr !== false; // 默认启用
      if (asrMetricsEnabled && this.shouldCollectASRMetrics(installedServicesAll)) {
        // 获取按服务ID分组的处理效率指标
        // 注意：在发送心跳前获取，因为心跳发送后会重置数据
        const serviceEfficiencies = this.inferenceService.getProcessingMetrics?.();
        if (serviceEfficiencies && Object.keys(serviceEfficiencies).length > 0) {
          message.processing_metrics = {
            serviceEfficiencies,
          };
        }
        // 向后兼容：保留 asr_metrics
        const asrMetrics = this.inferenceService.getASRMetrics?.();
        if (asrMetrics) {
          message.asr_metrics = asrMetrics;
        }
      }
    }

    const messageStr = JSON.stringify(message);
    logger.debug({ message: messageStr }, 'Heartbeat message content');
    this.ws.send(messageStr);

    // OBS-1: 心跳发送后重置周期数据，为下一个周期做准备
    // 注意：在消息发送之后重置，确保 UI 可以获取到当前周期的数据
    const asrMetricsEnabled = this.nodeConfig.metrics?.metrics?.asr !== false;
    if (asrMetricsEnabled && this.shouldCollectASRMetrics(installedServicesAll)) {
      this.inferenceService.resetProcessingMetrics?.();
    }
  }

  /**
   * 触发立即心跳（带防抖机制）
   * 避免在短时间内多次触发导致心跳过于频繁
   */
  triggerImmediateHeartbeat(): void {
    // 如果已有待发送的立即心跳，取消它
    if (this.heartbeatDebounceTimer) {
      clearTimeout(this.heartbeatDebounceTimer);
    }

    // 设置新的防抖定时器
    this.heartbeatDebounceTimer = setTimeout(async () => {
      this.heartbeatDebounceTimer = null;
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.nodeId) {
        logger.debug({}, 'Triggering immediate heartbeat due to service state change');
        await this.sendHeartbeatOnce();
      }
    }, this.HEARTBEAT_DEBOUNCE_MS);
  }

  /**
   * 获取系统资源
   */
  private async getSystemResources(): Promise<{
    cpu: number;
    gpu: number | null;
    gpuMem: number | null;
    memory: number
  }> {
    try {
      const [cpu, mem] = await Promise.all([
        si.currentLoad(),
        si.mem(),
      ]);

      // TODO: 获取 GPU 使用率（需要额外库，如 nvidia-ml-py）
      return {
        cpu: cpu.currentLoad || 0,
        gpu: null,
        gpuMem: null,
        memory: (mem.used / mem.total) * 100,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get system resources');
      return { cpu: 0, gpu: null, gpuMem: null, memory: 0 };
    }
  }

  /**
   * 更新 WebSocket 和 nodeId（用于重连场景）
   */
  updateConnection(ws: WebSocket | null, nodeId: string | null): void {
    this.ws = ws;
    this.nodeId = nodeId;
  }
}
