/**
 * WebSocket 连接管理模块
 * 负责连接的建立、重连和心跳机制
 */

import { ReconnectConfig, DEFAULT_RECONNECT_CONFIG } from '../types';
import { logger } from '../logger';

export type ReconnectCallback = () => void;

/**
 * 连接管理器
 */
export class ConnectionManager {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectConfig: ReconnectConfig;
  private clientVersion: string;
  private tenantId: string | null = null;

  // 重连相关
  private reconnectAttempts: number = 0;
  private reconnectTimer: number | null = null;
  private isManualDisconnect: boolean = false;
  private reconnectCallback: ReconnectCallback | null = null;

  // 心跳相关
  private heartbeatTimer: number | null = null;
  private heartbeatTimeoutTimer: number | null = null;
  private lastHeartbeatTime: number = 0;
  private sessionId: string | null = null; // 用于心跳

  constructor(url: string, reconnectConfig?: ReconnectConfig, clientVersion?: string) {
    this.url = url;
    this.reconnectConfig = reconnectConfig || DEFAULT_RECONNECT_CONFIG;
    this.clientVersion = clientVersion || 'web-client-v1.0';
  }

  /**
   * 设置租户 ID
   */
  setTenantId(tenantId: string | null): void {
    this.tenantId = tenantId;
  }

  /**
   * 设置重连回调
   */
  setReconnectCallback(callback: ReconnectCallback): void {
    this.reconnectCallback = callback;
  }

  /**
   * 获取 WebSocket 实例
   */
  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 手动断开连接
   */
  disconnect(): void {
    this.isManualDisconnect = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 创建 WebSocket 连接
   */
  async createConnection(
    onOpen: (ws: WebSocket) => void,
    onMessage: (event: MessageEvent) => void,
    onError: (error: Event) => void,
    onClose: () => void
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('ConnectionManager', `Attempting to connect to WebSocket: ${this.url}`);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          logger.info('ConnectionManager', 'WebSocket connected');
          this.reconnectAttempts = 0;
          this.isManualDisconnect = false;
          // 心跳将在设置 sessionId 后启动
          onOpen(this.ws!);
          resolve(this.ws!);
        };

        this.ws.onmessage = onMessage;

        this.ws.onerror = (error) => {
          logger.error('ConnectionManager', `WebSocket error connecting to ${this.url}`, { error, url: this.url, readyState: this.ws?.readyState, reconnectAttempts: this.reconnectAttempts });
          onError(error);
          if (this.reconnectAttempts === 0) {
            reject(new Error(`WebSocket connection failed to ${this.url}: ${error}`));
          }
        };

        this.ws.onclose = (event) => {
          logger.info('ConnectionManager', `WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'}, wasClean: ${event.wasClean})`);
          this.stopHeartbeat();
          onClose();

          // 如果不是手动断开，且启用了重连，则尝试重连
          if (!this.isManualDisconnect && this.reconnectConfig.enabled) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 发送消息
   */
  send(data: string | ArrayBuffer | Blob): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      logger.warn('ConnectionManager', 'WebSocket is not connected, cannot send message');
    }
  }

  /**
   * 设置会话 ID（用于心跳）
   */
  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
    if (sessionId && this.isConnected()) {
      this.startHeartbeat();
    }
  }

  /**
   * 开始心跳
   */
  startHeartbeat(): void {
    this.stopHeartbeat();

    if (!this.reconnectConfig.enabled || !this.sessionId) {
      return;
    }

    this.lastHeartbeatTime = Date.now();
    this.resetHeartbeatTimeout();

    const intervalMs = this.reconnectConfig.heartbeatIntervalMs || 30000;
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
        try {
          // 使用 client_heartbeat 协议
          this.ws.send(JSON.stringify({
            type: 'client_heartbeat',
            session_id: this.sessionId,
            timestamp: Date.now(),
          }));
          this.lastHeartbeatTime = Date.now();
          this.resetHeartbeatTimeout();
        } catch (error) {
          logger.error('ConnectionManager', 'Failed to send heartbeat', { error });
        }
      }
    }, intervalMs);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 重置心跳超时
   */
  resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }

    const timeoutMs = this.reconnectConfig.heartbeatTimeoutMs || 10000;
    this.heartbeatTimeoutTimer = window.setTimeout(() => {
      const now = Date.now();
      if (now - this.lastHeartbeatTime > timeoutMs) {
        logger.warn('ConnectionManager', 'Heartbeat timeout, closing connection');
        if (this.ws) {
          this.ws.close();
        }
      }
    }, timeoutMs);
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // 已经安排了重连
    }

    this.reconnectAttempts++;
    const maxAttempts = this.reconnectConfig.maxRetries === -1 ? Infinity : (this.reconnectConfig.maxRetries || 10);
    const baseDelay = this.reconnectConfig.retryDelayMs || 1000;
    const maxDelay = this.reconnectConfig.retryDelayMs * 30 || 30000; // 使用 retryDelayMs * 30 作为最大延迟

    if (this.reconnectAttempts > maxAttempts) {
      logger.error('ConnectionManager', 'Max reconnect attempts reached');
      return;
    }

    // 指数退避
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), maxDelay);
    logger.info('ConnectionManager', `Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms to ${this.url}`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.reconnectCallback) {
        this.reconnectCallback();
      }
    }, delay);
  }

  /**
   * 获取重连尝试次数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 重置重连状态
   */
  resetReconnectState(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 获取客户端版本
   */
  getClientVersion(): string {
    return this.clientVersion;
  }

  /**
   * 获取租户 ID
   */
  getTenantId(): string | null {
    return this.tenantId;
  }
}

