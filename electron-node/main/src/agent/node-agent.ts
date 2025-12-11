import WebSocket from 'ws';
import { InferenceService } from '../inference/inference-service';
import * as si from 'systeminformation';
import * as os from 'os';
import type { 
  NodeRegisterMessage, 
  NodeRegisterAckMessage, 
  NodeHeartbeatMessage, 
  JobAssignMessage, 
  JobResultMessage,
  InstalledModel,
  FeatureFlags
} from '../../../shared/protocols/messages';

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

    try {
      // 获取硬件信息
      const hardware = await this.getHardwareInfo();
      
      // 获取已安装的模型
      const installedModels = this.inferenceService.getInstalledModels();
      
      // 获取支持的功能
      const featuresSupported = this.inferenceService.getFeaturesSupported();

      // 对齐协议规范：node_register 消息格式
      const message: NodeRegisterMessage = {
        type: 'node_register',
        node_id: this.nodeId || null, // 首次连接时为 null
        version: '1.0.0', // TODO: 从 package.json 读取
        platform: this.getPlatform(),
        hardware: hardware,
        installed_models: installedModels,
        features_supported: featuresSupported,
        accept_public_jobs: true, // TODO: 从配置读取
      };

      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('注册节点失败:', error);
    }
  }

  private getPlatform(): 'windows' | 'linux' | 'macos' {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
  }

  private async getHardwareInfo(): Promise<{
    cpu_cores: number;
    memory_gb: number;
    gpus?: Array<{ name: string; memory_gb: number }>;
  }> {
    try {
      const mem = await si.mem();
      const cpu = await si.cpu();
      
      // TODO: 获取 GPU 信息（需要额外库，如 nvidia-ml-py 或 systeminformation 的图形卡信息）
      const gpus: Array<{ name: string; memory_gb: number }> = [];
      
      return {
        cpu_cores: cpu.cores || os.cpus().length,
        memory_gb: Math.round(mem.total / (1024 * 1024 * 1024)),
        gpus: gpus.length > 0 ? gpus : undefined,
      };
    } catch (error) {
      console.error('获取硬件信息失败:', error);
      return {
        cpu_cores: os.cpus().length,
        memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
      };
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) return;

      const resources = await this.getSystemResources();
      const installedModels = this.inferenceService.getInstalledModels();

      // 对齐协议规范：node_heartbeat 消息格式
      const message: NodeHeartbeatMessage = {
        type: 'node_heartbeat',
        node_id: this.nodeId,
        timestamp: Date.now(),
        resource_usage: {
          cpu_percent: resources.cpu,
          gpu_percent: resources.gpu || undefined,
          gpu_mem_percent: resources.gpuMem || undefined,
          mem_percent: resources.memory,
          running_jobs: this.inferenceService.getCurrentJobCount(),
        },
        installed_models: installedModels.length > 0 ? installedModels : undefined,
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
      console.error('获取系统资源失败:', error);
      return { cpu: 0, gpu: null, gpuMem: null, memory: 0 };
    }
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'node_register_ack': {
          const ack = message as NodeRegisterAckMessage;
          this.nodeId = ack.node_id;
          console.log('节点注册成功:', this.nodeId);
          break;
        }

        case 'job_assign': {
          const job = message as JobAssignMessage;
          await this.handleJob(job);
          break;
        }

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

  private async handleJob(job: JobAssignMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) return;

    const startTime = Date.now();

    try {
      // 调用推理服务处理任务
      const result = await this.inferenceService.processJob(job);

      // 对齐协议规范：job_result 消息格式
      const response: JobResultMessage = {
        type: 'job_result',
        job_id: job.job_id,
        node_id: this.nodeId,
        session_id: job.session_id,
        utterance_index: job.utterance_index,
        success: true,
        text_asr: result.text_asr,
        text_translated: result.text_translated,
        tts_audio: result.tts_audio,
        tts_format: result.tts_format || 'pcm16',
        extra: result.extra,
        processing_time_ms: Date.now() - startTime,
      };

      this.ws.send(JSON.stringify(response));
    } catch (error) {
      console.error('处理任务失败:', error);
      
      // 对齐协议规范：job_result 错误响应格式
      const errorResponse: JobResultMessage = {
        type: 'job_result',
        job_id: job.job_id,
        node_id: this.nodeId,
        session_id: job.session_id,
        utterance_index: job.utterance_index,
        success: false,
        processing_time_ms: Date.now() - startTime,
        error: {
          code: 'PROCESSING_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
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

