import WebSocket from 'ws';
import { InferenceService } from '../inference/inference-service';
import * as si from 'systeminformation';

export interface NodeStatus {
  online: boolean;
  nodeId: string | null;
  connected: boolean;
  lastHeartbeat: Date | null;
}

export class NodeAgent {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private schedulerUrl: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private inferenceService: InferenceService;

  constructor(inferenceService: InferenceService) {
    this.schedulerUrl = process.env.SCHEDULER_URL || 'ws://localhost:8080/ws/node';
    this.inferenceService = inferenceService;
  }

  async start(): Promise<void> {
    try {
      this.ws = new WebSocket(this.schedulerUrl);
      
      this.ws.on('open', () => {
        console.log('已连接到调度服务器');
        this.registerNode();
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket 错误:', error);
      });

      this.ws.on('close', () => {
        console.log('与调度服务器的连接已关闭');
        this.stopHeartbeat();
        // 尝试重连
        setTimeout(() => this.start(), 5000);
      });
    } catch (error) {
      console.error('启动 Node Agent 失败:', error);
    }
  }

  stop(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async registerNode(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'register',
      name: require('os').hostname(),
      capabilities: {
        asr: true,
        nmt: true,
        tts: true,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const resources = await this.getSystemResources();
      const installedModels = this.inferenceService.getInstalledModels();

      const message = {
        type: 'heartbeat',
        node_id: this.nodeId,
        cpu_usage: resources.cpu,
        gpu_usage: resources.gpu,
        memory_usage: resources.memory,
        installed_models: installedModels,
        current_jobs: this.inferenceService.getCurrentJobCount(),
      };

      this.ws.send(JSON.stringify(message));
    }, 15000); // 每15秒发送一次心跳
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async getSystemResources(): Promise<{ cpu: number; gpu: number | null; memory: number }> {
    try {
      const [cpu, mem] = await Promise.all([
        si.currentLoad(),
        si.mem(),
      ]);

      // TODO: 获取 GPU 使用率（需要额外库）
      return {
        cpu: cpu.currentLoad || 0,
        gpu: null,
        memory: (mem.used / mem.total) * 100,
      };
    } catch (error) {
      console.error('获取系统资源失败:', error);
      return { cpu: 0, gpu: null, memory: 0 };
    }
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'registered':
          this.nodeId = message.node_id;
          console.log('节点注册成功:', this.nodeId);
          break;

        case 'job':
          await this.handleJob(message);
          break;

        case 'pairing_code':
          // 配对码已生成，通过 IPC 通知渲染进程
          break;

        default:
          console.warn('未知消息类型:', message.type);
      }
    } catch (error) {
      console.error('处理消息失败:', error);
    }
  }

  private async handleJob(job: any): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // 调用推理服务处理任务
      const result = await this.inferenceService.processJob(job);

      // 发送结果回调度服务器
      const response = {
        type: 'job_result',
        job_id: job.job_id,
        result: result,
      };

      this.ws.send(JSON.stringify(response));
    } catch (error) {
      console.error('处理任务失败:', error);
      
      // 发送错误响应
      const errorResponse = {
        type: 'job_error',
        job_id: job.job_id,
        error: String(error),
      };

      this.ws.send(JSON.stringify(errorResponse));
    }
  }

  getStatus(): NodeStatus {
    return {
      online: this.ws?.readyState === WebSocket.OPEN,
      nodeId: this.nodeId,
      connected: this.ws?.readyState === WebSocket.OPEN || false,
      lastHeartbeat: new Date(),
    };
  }

  async generatePairingCode(): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;

    return new Promise((resolve) => {
      const handler = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'pairing_code') {
            this.ws?.off('message', handler);
            resolve(message.code);
          }
        } catch (error) {
          // 忽略解析错误
        }
      };

      this.ws?.on('message', handler);
      this.ws?.send(JSON.stringify({ type: 'request_pairing_code' }));

      // 超时处理
      setTimeout(() => {
        this.ws?.off('message', handler);
        resolve(null);
      }, 5000);
    });
  }
}

