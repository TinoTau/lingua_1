import { AudioChunkMessage, ServerMessage, FeatureFlags, RoomCreateMessage, RoomJoinMessage, RoomLeaveMessage, RoomRawVoicePreferenceMessage, SessionInitMessage, BackpressureMessage, ReconnectConfig, DEFAULT_RECONNECT_CONFIG, SessionInitAckMessage } from './types';
import { StateMachine } from './state_machine';
import { encodeAudioChunkFrame, encodeFinalFrame, BinaryFrameType, decodeBinaryFrame, isBinaryFrame, AudioChunkBinaryFrame, FinalBinaryFrame } from './binary_protocol';
import { createAudioEncoder, AudioEncoder, AudioCodecConfig } from './audio_codec';
import { v4 as uuidv4 } from 'uuid';

export type MessageCallback = (message: ServerMessage) => void;
export type ReconnectCallback = () => void;
export type BackpressureStateCallback = (state: BackpressureState) => void;

// 背压状态
export enum BackpressureState {
  NORMAL = 'normal',
  BUSY = 'busy',
  PAUSED = 'paused',
  SLOW_DOWN = 'slow_down',
}

/**
 * WebSocket 客户端
 * 负责 PCM16 上传和 TTS 下载
 * 支持背压处理、自动重连和心跳机制
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private sequence: number = 0;
  private messageCallback: MessageCallback | null = null;
  private reconnectCallback: ReconnectCallback | null = null;
  private backpressureStateCallback: BackpressureStateCallback | null = null;
  private stateMachine: StateMachine;
  private url: string;
  private reconnectConfig: ReconnectConfig;
  private clientVersion: string;
  private tenantId: string | null = null; // 租户 ID（可选）

  // 重连相关
  private reconnectAttempts: number = 0;
  private reconnectTimer: number | null = null;
  private isManualDisconnect: boolean = false;

  // 心跳相关
  private heartbeatTimer: number | null = null;
  private heartbeatTimeoutTimer: number | null = null;
  private lastHeartbeatTime: number = 0;

  // 背压相关
  private backpressureState: BackpressureState = BackpressureState.NORMAL;
  private backpressureResumeTime: number = 0;
  private lastBackpressureMessageTime: number = 0;
  private backpressureDebounceMs: number = 500; // 背压消息去抖间隔（≥500ms）
  private audioSendQueue: Array<{ data: Float32Array; isFinal: boolean }> = [];
  private sendInterval: number | null = null;
  private normalSendIntervalMs: number = 100; // 正常发送间隔（100ms）
  private slowDownSendIntervalMs: number = 500; // 降速发送间隔（500ms）

  // 连接参数（用于重连）
  private pendingConnectParams: {
    srcLang?: string;
    tgtLang?: string;
    langA?: string;
    langB?: string;
    features?: FeatureFlags;
    mode: 'one_way' | 'two_way';
  } | null = null;

  // Phase 2: 协议版本和编解码器
  private useBinaryFrame: boolean = false; // 是否使用 Binary Frame
  private audioEncoder: AudioEncoder | null = null; // 音频编码器
  private audioCodecConfig: AudioCodecConfig | null = null; // 音频编解码器配置
  private negotiatedCodec: string = 'pcm16'; // 协商后的编解码器

  constructor(stateMachine: StateMachine, url: string, reconnectConfig?: ReconnectConfig, clientVersion?: string) {
    this.stateMachine = stateMachine;
    this.url = url;
    this.reconnectConfig = reconnectConfig || DEFAULT_RECONNECT_CONFIG;
    this.clientVersion = clientVersion || 'web-client-v1.0';
  }

  /**
   * 设置音频编解码器配置（Phase 2）
   */
  setAudioCodecConfig(config: AudioCodecConfig): void {
    this.audioCodecConfig = config;
    // 创建编码器
    if (this.audioEncoder) {
      this.audioEncoder.close();
    }
    this.audioEncoder = createAudioEncoder(config);
  }

  /**
   * 获取当前使用的协议版本
   */
  getProtocolVersion(): '1.0' | '2.0' {
    return this.useBinaryFrame ? '2.0' : '1.0';
  }

  /**
   * 获取协商后的编解码器
   */
  getNegotiatedCodec(): string {
    return this.negotiatedCodec;
  }

  /**
   * 设置消息回调
   */
  setMessageCallback(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  /**
   * 设置重连回调
   */
  setReconnectCallback(callback: ReconnectCallback): void {
    this.reconnectCallback = callback;
  }

  /**
   * 设置背压状态变化回调
   */
  setBackpressureStateCallback(callback: BackpressureStateCallback): void {
    this.backpressureStateCallback = callback;
  }

  /**
   * 连接 WebSocket（单向模式）
   * @param srcLang 源语言
   * @param tgtLang 目标语言
   * @param features 可选功能标志（由用户选择）
   */
  async connect(srcLang: string, tgtLang: string, features?: FeatureFlags): Promise<void> {
    this.pendingConnectParams = {
      srcLang,
      tgtLang,
      features,
      mode: 'one_way',
    };
    return this.doConnect();
  }

  /**
   * 执行连接（内部方法）
   */
  private async doConnect(): Promise<void> {
    if (!this.pendingConnectParams) {
      throw new Error('No pending connect parameters');
    }

    return new Promise((resolve, reject) => {
      try {
        this.isManualDisconnect = false;
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;

          // 启动心跳
          this.startHeartbeat();

          // 发送会话初始化消息
          const params = this.pendingConnectParams!;

          // 生成 trace_id（用于追踪）
          const traceId = this.generateTraceId();

          let initMessage: SessionInitMessage;

          if (params.mode === 'one_way') {
            initMessage = {
              type: 'session_init',
              client_version: this.clientVersion,
              platform: 'web',
              src_lang: params.srcLang!,
              tgt_lang: params.tgtLang!,
              dialect: null,
              features: params.features || {},
              pairing_code: null,
              mode: 'one_way',
              // Phase 3: 添加 trace_id 和 tenant_id（与 Scheduler 兼容）
              trace_id: traceId,
              tenant_id: this.tenantId,
            };
          } else {
            initMessage = {
              type: 'session_init',
              client_version: this.clientVersion,
              platform: 'web',
              src_lang: 'auto',
              tgt_lang: params.langB!,
              dialect: null,
              features: params.features || {},
              pairing_code: null,
              mode: 'two_way_auto',
              lang_a: params.langA!,
              lang_b: params.langB!,
              auto_langs: [params.langA!, params.langB!],
              // Phase 3: 添加 trace_id 和 tenant_id（与 Scheduler 兼容）
              trace_id: traceId,
              tenant_id: this.tenantId,
            };
          }

          // 注意：audio_format, sample_rate, channel_count 不在 SessionInit 中发送
          // 这些字段只在 Utterance 消息中使用
          // protocol_version, supports_binary_frame, preferred_codec 也不发送（Scheduler 不支持）

          this.ws!.send(JSON.stringify(initMessage));
        };

        this.ws.onmessage = (event) => {
          try {
            // 重置心跳超时
            this.resetHeartbeatTimeout();

            const message = JSON.parse(event.data);

            // 处理会话初始化确认
            if (message.type === 'session_init_ack') {
              this.sessionId = message.session_id;

              // Phase 2: 协议版本协商
              const ack = message as SessionInitAckMessage;
              this.useBinaryFrame = ack.use_binary_frame ?? false;
              this.negotiatedCodec = ack.negotiated_codec || ack.negotiated_audio_format || 'pcm16';

              // 如果协商使用 Binary Frame，确保编码器已初始化
              if (this.useBinaryFrame && !this.audioEncoder) {
                const codecConfig: AudioCodecConfig = {
                  codec: this.negotiatedCodec as 'pcm16' | 'opus',
                  sampleRate: ack.negotiated_sample_rate || 16000,
                  channelCount: ack.negotiated_channel_count || 1,
                };
                this.setAudioCodecConfig(codecConfig);
              }

              console.log('Session created:', this.sessionId);
              console.log('Protocol negotiation:', {
                protocol_version: ack.protocol_version || '1.0',
                use_binary_frame: this.useBinaryFrame,
                negotiated_codec: this.negotiatedCodec,
                format: ack.negotiated_audio_format,
                sample_rate: ack.negotiated_sample_rate,
                channel_count: ack.negotiated_channel_count,
              });

              resolve();
              return;
            }

            // 处理背压消息
            if (message.type === 'backpressure') {
              this.handleBackpressure(message as BackpressureMessage);
              return;
            }

            // 处理服务器消息
            if (this.messageCallback) {
              this.messageCallback(message as ServerMessage);
            }
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          if (this.reconnectAttempts === 0) {
            // 首次连接失败才 reject
            reject(error);
          }
        };

        this.ws.onclose = () => {
          console.log('WebSocket closed');
          this.stopHeartbeat();
          this.sessionId = null;
          this.backpressureState = BackpressureState.NORMAL;
          this.clearSendQueue();

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
   * 处理背压消息
   */
  private handleBackpressure(message: BackpressureMessage): void {
    const now = Date.now();

    // 去抖：如果距离上次背压消息时间太短，忽略
    if (now - this.lastBackpressureMessageTime < this.backpressureDebounceMs) {
      console.log('Backpressure message ignored (debounce)');
      return;
    }

    this.lastBackpressureMessageTime = now;

    // 更新背压状态
    const oldState = this.backpressureState;
    const action = message.action;
    if (action === 'BUSY' || action === 'PAUSE') {
      this.backpressureState = action === 'BUSY' ? BackpressureState.BUSY : BackpressureState.PAUSED;
    } else if (action === 'SLOW_DOWN') {
      this.backpressureState = BackpressureState.SLOW_DOWN;
    }

    // 设置恢复时间
    if (message.resume_after_ms) {
      this.backpressureResumeTime = now + message.resume_after_ms;
    } else {
      // 如果没有指定恢复时间，默认 5 秒后恢复
      this.backpressureResumeTime = now + 5000;
    }

    console.log(`Backpressure: ${action}, resume after ${message.resume_after_ms || 5000}ms`);

    // 调整发送策略
    this.adjustSendStrategy();

    // 通知背压状态变化回调
    if (this.backpressureStateCallback && oldState !== this.backpressureState) {
      this.backpressureStateCallback(this.backpressureState);
    }

    // 通知消息回调
    if (this.messageCallback) {
      this.messageCallback(message);
    }
  }

  /**
   * 调整发送策略（根据背压状态）
   */
  private adjustSendStrategy(): void {
    // 清除现有定时器
    if (this.sendInterval !== null) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }

    if (this.backpressureState === BackpressureState.PAUSED) {
      // 暂停发送，但仍需要定时器检查恢复时间
      console.log('Audio sending paused');
      // 使用较短的间隔检查恢复（100ms）
      this.sendInterval = window.setInterval(() => {
        this.processSendQueue();
      }, 100);
      return;
    }

    // 只有在BUSY或SLOW_DOWN状态下才需要定时器处理队列
    // NORMAL状态下直接发送，不需要定时器
    if (this.backpressureState === BackpressureState.NORMAL) {
      // 正常状态：立即处理队列中的剩余数据（如果有）
      this.processSendQueue();
      return;
    }

    // BUSY 和 SLOW_DOWN 状态：使用定时器降速发送
    const intervalMs = (this.backpressureState === BackpressureState.SLOW_DOWN ||
      this.backpressureState === BackpressureState.BUSY)
      ? this.slowDownSendIntervalMs
      : this.normalSendIntervalMs;

    // 启动定时发送
    this.sendInterval = window.setInterval(() => {
      this.processSendQueue();
    }, intervalMs);
  }

  /**
   * 处理发送队列
   * 每次只处理一个项目，避免阻塞和无限循环
   */
  private processSendQueue(): void {
    // 检查是否应该恢复
    if (this.backpressureResumeTime > 0 && Date.now() >= this.backpressureResumeTime) {
      console.log('Backpressure recovered');
      const oldState = this.backpressureState;
      this.backpressureState = BackpressureState.NORMAL;
      this.backpressureResumeTime = 0;

      // 清除定时器（恢复正常后不需要定时器）
      if (this.sendInterval !== null) {
        clearInterval(this.sendInterval);
        this.sendInterval = null;
      }

      // 立即处理队列中的剩余数据
      this.flushSendQueue();

      // 通知背压状态变化回调
      if (this.backpressureStateCallback && oldState !== BackpressureState.NORMAL) {
        this.backpressureStateCallback(BackpressureState.NORMAL);
      }
      return;
    }

    // 如果暂停，不发送
    if (this.backpressureState === BackpressureState.PAUSED) {
      return;
    }

    // 发送队列中的数据（每次只处理一个，避免阻塞）
    if (this.audioSendQueue.length > 0) {
      const item = this.audioSendQueue.shift()!;
      this.sendAudioChunkInternal(item.data, item.isFinal).catch(error => {
        console.error('Error sending queued audio chunk:', error);
      });
    } else {
      // 队列为空时，如果是BUSY或SLOW_DOWN状态，停止定时器
      // 下次有数据时会重新启动
      if ((this.backpressureState === BackpressureState.BUSY ||
        this.backpressureState === BackpressureState.SLOW_DOWN) &&
        this.sendInterval !== null) {
        clearInterval(this.sendInterval);
        this.sendInterval = null;
      }
    }
  }

  /**
   * 立即处理发送队列中的所有数据（用于恢复正常状态时）
   */
  private flushSendQueue(): void {
    while (this.audioSendQueue.length > 0) {
      const item = this.audioSendQueue.shift()!;
      this.sendAudioChunkInternal(item.data, item.isFinal).catch(error => {
        console.error('Error flushing queued audio chunk:', error);
      });
    }
  }

  /**
   * 清空发送队列（公开方法，供外部调用）
   */
  public clearSendQueue(): void {
    this.audioSendQueue = [];
    if (this.sendInterval !== null) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
    // 重置背压状态
    this.backpressureState = BackpressureState.NORMAL;
    this.backpressureResumeTime = 0;
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    if (!this.reconnectConfig.enabled) {
      return;
    }

    this.lastHeartbeatTime = Date.now();
    this.resetHeartbeatTimeout();

    // 定期发送心跳
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
        try {
          // 使用 client_heartbeat 而不是 ping，以匹配调度服务器的协议
          // 协议要求：{ type: 'client_heartbeat', session_id: string, timestamp: number }
          this.ws.send(JSON.stringify({
            type: 'client_heartbeat',
            session_id: this.sessionId,
            timestamp: Date.now(),
          }));
          this.lastHeartbeatTime = Date.now();
          this.resetHeartbeatTimeout();
        } catch (error) {
          console.error('Failed to send heartbeat:', error);
        }
      }
    }, this.reconnectConfig.heartbeatIntervalMs);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer !== null) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 重置心跳超时
   */
  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer !== null) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }

    this.heartbeatTimeoutTimer = window.setTimeout(() => {
      const now = Date.now();
      if (now - this.lastHeartbeatTime > this.reconnectConfig.heartbeatTimeoutMs) {
        console.warn('Heartbeat timeout, closing connection');
        if (this.ws) {
          this.ws.close();
        }
      }
    }, this.reconnectConfig.heartbeatTimeoutMs);
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    // 检查重试次数
    if (this.reconnectConfig.maxRetries >= 0 &&
      this.reconnectAttempts >= this.reconnectConfig.maxRetries) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectConfig.retryDelayMs * this.reconnectAttempts;

    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} after ${delay}ms`);

    // 通知重连事件
    if (this.reconnectCallback) {
      this.reconnectCallback();
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect().catch((error) => {
        console.error('Reconnect failed:', error);
        // 继续尝试重连
        this.scheduleReconnect();
      });
    }, delay);
  }

  /**
   * 连接 WebSocket（双向模式）
   * @param langA 语言 A
   * @param langB 语言 B
   * @param features 可选功能标志（由用户选择）
   */
  async connectTwoWay(langA: string, langB: string, features?: FeatureFlags): Promise<void> {
    this.pendingConnectParams = {
      langA,
      langB,
      features,
      mode: 'two_way',
    };
    return this.doConnect();
  }

  /**
   * 发送音频块（外部接口）
   */
  sendAudioChunk(audioData: Float32Array, isFinal: boolean = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      console.warn('WebSocket not connected, cannot send audio chunk');
      return;
    }

    // 根据背压状态决定发送策略
    if (this.backpressureState === BackpressureState.PAUSED) {
      // 暂停状态：非结束帧丢弃，结束帧加入队列等待恢复
      if (isFinal) {
        this.audioSendQueue.push({ data: audioData, isFinal });
        console.log('Final frame queued during pause');
      }
      // 非结束帧在暂停状态下丢弃
      return;
    } else if (this.backpressureState === BackpressureState.NORMAL) {
      // 正常状态：直接发送
      this.sendAudioChunkInternal(audioData, isFinal);
    } else {
      // BUSY 或 SLOW_DOWN 状态：加入队列按间隔发送
      // 结束帧也需要加入队列，确保按顺序发送
      this.audioSendQueue.push({ data: audioData, isFinal });
    }
  }

  /**
   * 发送音频块（内部实现）
   * Phase 2: 支持 Binary Frame 和 Opus 编码
   */
  private async sendAudioChunkInternal(audioData: Float32Array, isFinal: boolean = false): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      return;
    }

    if (this.useBinaryFrame && this.audioEncoder) {
      // Phase 2: 使用 Binary Frame
      try {
        // 编码音频数据
        const encodedAudio = await this.audioEncoder.encode(audioData);

        // 构建二进制帧
        const frame: AudioChunkBinaryFrame = {
          frameType: BinaryFrameType.AUDIO_CHUNK,
          sessionId: this.sessionId,
          seq: this.sequence++,
          timestamp: Date.now(),
          isFinal,
          audioData: encodedAudio,
        };

        // 编码为二进制帧
        const binaryFrame = encodeAudioChunkFrame(frame);

        // 发送二进制数据
        this.ws.send(binaryFrame);
      } catch (error) {
        console.error('Failed to encode/send binary frame, falling back to JSON:', error);
        // 降级到 JSON + base64
        await this.sendAudioChunkJSON(audioData, isFinal);
      }
    } else {
      // Phase 1: 使用 JSON + base64
      await this.sendAudioChunkJSON(audioData, isFinal);
    }
  }

  /**
   * 发送音频块（JSON + base64 格式，Phase 1 兼容）
   */
  private async sendAudioChunkJSON(audioData: Float32Array, isFinal: boolean = false): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      return;
    }

    // 将 Float32Array 转换为 Int16Array (PCM16)
    const int16Array = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // 转换为 base64
    const uint8Array = new Uint8Array(int16Array.buffer);
    const base64 = btoa(String.fromCharCode(...uint8Array));

    const message: AudioChunkMessage = {
      type: 'audio_chunk',
      session_id: this.sessionId,
      seq: this.sequence++,
      is_final: isFinal,
      payload: base64,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送结束帧
   * Phase 2: 支持 Binary Frame
   */
  sendFinal(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      return;
    }

    if (this.useBinaryFrame) {
      // Phase 2: 使用 Binary Frame
      try {
        const frame: FinalBinaryFrame = {
          frameType: BinaryFrameType.FINAL,
          sessionId: this.sessionId,
          seq: this.sequence++,
          timestamp: Date.now(),
        };

        const binaryFrame = encodeFinalFrame(frame);
        this.ws.send(binaryFrame);
      } catch (error) {
        console.error('Failed to send binary final frame, falling back to JSON:', error);
        // 降级到 JSON
        const message: AudioChunkMessage = {
          type: 'audio_chunk',
          session_id: this.sessionId,
          seq: this.sequence++,
          is_final: true,
        };
        this.ws.send(JSON.stringify(message));
      }
    } else {
      // Phase 1: 使用 JSON
      const message: AudioChunkMessage = {
        type: 'audio_chunk',
        session_id: this.sessionId,
        seq: this.sequence++,
        is_final: true,
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.isManualDisconnect = true;

    // 清除重连定时器
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 停止心跳
    this.stopHeartbeat();

    // 清空发送队列
    this.clearSendQueue();

    // 关闭连接
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // 清理编码器
    if (this.audioEncoder) {
      this.audioEncoder.close();
      this.audioEncoder = null;
    }

    this.sessionId = null;
    this.sequence = 0;
    this.reconnectAttempts = 0;
    this.backpressureState = BackpressureState.NORMAL;
    this.pendingConnectParams = null;
    this.useBinaryFrame = false;
    this.negotiatedCodec = 'pcm16';
  }

  /**
   * 获取背压状态
   */
  getBackpressureState(): BackpressureState {
    return this.backpressureState;
  }

  /**
   * 获取重连次数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 发送 TTS_PLAY_ENDED 消息
   */
  sendTtsPlayEnded(traceId: string, groupId: string, tsEndMs: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      console.warn('WebSocket not connected, cannot send TTS_PLAY_ENDED');
      return;
    }

    const message = {
      type: 'tts_play_ended',
      session_id: this.sessionId,
      trace_id: traceId,
      group_id: groupId,
      ts_end_ms: tsEndMs,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 生成追踪 ID
   */
  private generateTraceId(): string {
    return uuidv4();
  }

  /**
   * 设置租户 ID
   */
  setTenantId(tenantId: string | null): void {
    this.tenantId = tenantId;
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 创建房间
   * 创建者自动成为第一个成员
   * @param displayName 显示名称（可选）
   * @param preferredLang 偏好语言（可选）
   */
  createRoom(displayName?: string, preferredLang?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot create room');
      return;
    }

    const message: RoomCreateMessage = {
      type: 'room_create',
      client_ts: Date.now(),
      display_name: displayName,
      preferred_lang: preferredLang,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 加入房间
   */
  joinRoom(roomCode: string, displayName?: string, preferredLang?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot join room');
      return;
    }

    const message: RoomJoinMessage = {
      type: 'room_join',
      room_code: roomCode,
      display_name: displayName,
      preferred_lang: preferredLang,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 退出房间
   */
  leaveRoom(roomCode: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot leave room');
      return;
    }

    const message: RoomLeaveMessage = {
      type: 'room_leave',
      room_code: roomCode,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 设置原声传递偏好
   * @param roomCode 房间码
   * @param targetSessionId 目标成员的 session_id
   * @param receiveRawVoice 是否接收该成员的原声
   */
  setRawVoicePreference(roomCode: string, targetSessionId: string, receiveRawVoice: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot set raw voice preference');
      return;
    }

    const message: RoomRawVoicePreferenceMessage = {
      type: 'room_raw_voice_preference',
      room_code: roomCode,
      target_session_id: targetSessionId,
      receive_raw_voice: receiveRawVoice,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送 WebRTC offer
   */
  sendWebRTCOffer(roomCode: string, to: string, sdp: RTCSessionDescriptionInit): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send WebRTC offer');
      return;
    }

    const message = {
      type: 'webrtc_offer',
      room_code: roomCode,
      to: to,
      sdp: sdp,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送 WebRTC answer
   */
  sendWebRTCAnswer(roomCode: string, to: string, sdp: RTCSessionDescriptionInit): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send WebRTC answer');
      return;
    }

    const message = {
      type: 'webrtc_answer',
      room_code: roomCode,
      to: to,
      sdp: sdp,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送 WebRTC ICE candidate
   */
  sendWebRTCIce(roomCode: string, to: string, candidate: RTCIceCandidateInit): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send WebRTC ICE candidate');
      return;
    }

    const message = {
      type: 'webrtc_ice',
      room_code: roomCode,
      to: to,
      candidate: candidate,
    };

    this.ws.send(JSON.stringify(message));
  }
}

