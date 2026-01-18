/**
 * WebSocket 客户端（重构版）
 * 使用模块化设计，整合连接管理、消息处理、背压管理和音频发送
 */

import { StateMachine } from './state_machine';
import { 
  ServerMessage, 
  FeatureFlags, 
  RoomCreateMessage, 
  RoomJoinMessage, 
  RoomLeaveMessage, 
  RoomRawVoicePreferenceMessage,
  SessionInitMessage,
  BackpressureMessage,
  ReconnectConfig,
  DEFAULT_RECONNECT_CONFIG,
  SessionInitAckMessage
} from './types';
import { AudioCodecConfig } from './audio_codec';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';

// 导入模块
import { ConnectionManager } from './websocket/connection_manager';
import { MessageHandler } from './websocket/message_handler';
import { BackpressureManager, BackpressureState, BackpressureStateCallback } from './websocket/backpressure_manager';
import { AudioSender } from './websocket/audio_sender';

export type MessageCallback = (message: ServerMessage) => void;
export type ReconnectCallback = () => void;

// 重新导出 BackpressureState
export { BackpressureState } from './websocket/backpressure_manager';

/**
 * WebSocket 客户端
 * 负责 PCM16 上传和 TTS 下载
 * 支持背压处理、自动重连和心跳机制
 */
export class WebSocketClient {
  private _stateMachine: StateMachine;
  private connectionManager: ConnectionManager;
  private messageHandler: MessageHandler;
  private backpressureManager: BackpressureManager;
  private audioSender: AudioSender;
  
  private messageCallback: MessageCallback | null = null;
  private reconnectCallback: ReconnectCallback | null = null;
  private backpressureStateCallback: BackpressureStateCallback | null = null;

  // 连接参数（用于重连）
  private pendingConnectParams: {
    srcLang?: string;
    tgtLang?: string;
    langA?: string;
    langB?: string;
    features?: FeatureFlags;
    mode: 'one_way' | 'two_way';
  } | null = null;

  constructor(
    stateMachine: StateMachine,
    url: string,
    reconnectConfig?: ReconnectConfig,
    clientVersion?: string
  ) {
    this._stateMachine = stateMachine;
    
    // 初始化模块
    this.connectionManager = new ConnectionManager(url, reconnectConfig, clientVersion);
    this.messageHandler = new MessageHandler();
    this.backpressureManager = new BackpressureManager();
    this.audioSender = new AudioSender(
      this.backpressureManager,
      (data: string | ArrayBuffer) => this.connectionManager.send(data)
    );

    // 设置背压管理器的回调
    this.backpressureManager.setBackpressureStateCallback((state) => {
      if (this.backpressureStateCallback) {
        this.backpressureStateCallback(state);
      }
    });

    // 设置背压管理器的发送回调
    this.backpressureManager.setSendCallback(this.audioSender.getSendCallback());

    // 设置连接管理器的重连回调
    this.connectionManager.setReconnectCallback(() => {
      if (this.reconnectCallback) {
        this.reconnectCallback();
      }
      // 自动重连
      if (this.pendingConnectParams) {
        this.doConnect().catch((error) => {
          logger.error('WebSocketClient', 'Reconnect failed', error);
        });
      }
    });
  }

  /**
   * 设置音频编解码器配置
   */
  setAudioCodecConfig(config: AudioCodecConfig): void {
    this.messageHandler.setAudioCodecConfig(config);
    this.audioSender.setAudioCodecConfig(config);
  }

  /**
   * 获取当前使用的协议版本
   */
  getProtocolVersion(): '1.0' | '2.0' {
    return this.messageHandler.getProtocolVersion();
  }

  /**
   * 获取协商后的编解码器
   */
  getNegotiatedCodec(): string {
    return this.messageHandler.getNegotiatedCodec();
  }

  /**
   * 设置消息回调
   */
  setMessageCallback(callback: MessageCallback): void {
    logger.info('WebSocketClient', '设置消息回调');
    this.messageCallback = callback;
    this.messageHandler.setMessageCallback(callback);
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
   */
  async connect(srcLang: string, tgtLang: string, features?: FeatureFlags): Promise<void> {
    logger.info('WebSocketClient', `connect called: srcLang=${srcLang}, tgtLang=${tgtLang}`);
    this.pendingConnectParams = {
      srcLang,
      tgtLang,
      features,
      mode: 'one_way',
    };
    return this.doConnect();
  }

  /**
   * 连接 WebSocket（双向模式）
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
   * 执行连接（内部方法）
   */
  private async doConnect(): Promise<void> {
    if (!this.pendingConnectParams) {
      throw new Error('No pending connect parameters');
    }

    const params = this.pendingConnectParams;
    const traceId = uuidv4();
    logger.info('WebSocketClient', `doConnect: mode=${params.mode}, traceId=${traceId}`);

    // 创建连接
    await this.connectionManager.createConnection(
      async (ws) => {
        // 发送会话初始化消息
        let initMessage: SessionInitMessage;

        if (params.mode === 'one_way') {
          initMessage = {
            type: 'session_init',
            client_version: this.connectionManager.getClientVersion(),
            platform: 'web',
            src_lang: params.srcLang!,
            tgt_lang: params.tgtLang!,
            dialect: null,
            features: params.features || {},
            pairing_code: null,
            mode: 'one_way',
            trace_id: traceId,
            tenant_id: this.connectionManager.getTenantId(),
          };
        } else {
          initMessage = {
            type: 'session_init',
            client_version: this.connectionManager.getClientVersion(),
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
            trace_id: traceId,
            tenant_id: this.connectionManager.getTenantId(),
          };
        }

        ws.send(JSON.stringify(initMessage));
      },
      (event) => {
        // 重置心跳超时
        this.connectionManager.resetHeartbeatTimeout();

        // 记录原始消息（用于调试）
        const dataLength = event.data instanceof Blob ? event.data.size : (typeof event.data === 'string' ? event.data.length : 'unknown');
        const dataPreview = typeof event.data === 'string' ? (event.data.length > 200 ? event.data.substring(0, 200) + '...' : event.data) : 'binary';
        
        // 尝试解析消息类型（如果是JSON）
        let messageType = 'unknown';
        if (typeof event.data === 'string') {
          try {
            const parsed = JSON.parse(event.data);
            messageType = parsed.type || 'unknown';
          } catch (e) {
            // 不是JSON，忽略
          }
        }
        
        logger.debug('WebSocketClient', '📥 收到 WebSocket 消息', {
          message_type: messageType,
          data_type: typeof event.data,
          data_length: dataLength,
          is_binary: event.data instanceof ArrayBuffer || event.data instanceof Blob,
          data_preview: messageType === 'translation_result' ? dataPreview.substring(0, 100) : '...'
        });

        // 处理消息
        this.messageHandler.handleMessage(
          event,
          (message: BackpressureMessage) => {
            // 处理背压消息
            logger.debug('WebSocketClient', '处理背压消息');
            this.backpressureManager.handleBackpressure(message);
            // 通知消息回调
            if (this.messageCallback) {
              this.messageCallback(message);
            }
          },
          (sessionId: string) => {
            // 会话创建后，设置 sessionId 并启动心跳
            logger.info('WebSocketClient', `会话已创建: ${sessionId}`);
            this.connectionManager.setSessionId(sessionId);
            this.audioSender.setSessionId(sessionId);
            this.connectionManager.startHeartbeat();
            
            // 更新协议配置和编码器（延迟执行，确保 messageHandler 已处理完 session_init_ack）
            setTimeout(() => {
              this.audioSender.setProtocolConfig(
                this.messageHandler.getProtocolVersion() === '2.0',
                this.messageHandler.getNegotiatedCodec()
              );
              // 同步编码器
              this.audioSender.setAudioEncoder(this.messageHandler.getAudioEncoder());
            }, 0);
          }
        );
      },
      (error) => {
        logger.error('WebSocketClient', 'WebSocket error', error);
      },
      () => {
        // 连接关闭
        this.messageHandler.reset();
        this.audioSender.setSessionId(null);
        this.backpressureManager.clearSendQueue();
      }
    );
  }

  /**
   * 发送音频块
   */
  sendAudioChunk(audioData: Float32Array, isFinal: boolean = false): void {
    if (!this.connectionManager.isConnected() || !this.messageHandler.getSessionId()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot send audio chunk');
      return;
    }

    this.audioSender.sendAudioChunk(audioData, isFinal);
  }

  /**
   * 发送最终帧
   */
  sendFinal(): void {
    if (!this.connectionManager.isConnected() || !this.messageHandler.getSessionId()) {
      return;
    }

    this.audioSender.sendFinal();
  }

  /**
   * 发送 Utterance 消息
   */
  async sendUtterance(
    audioData: Float32Array,
    utteranceIndex: number,
    srcLang: string,
    tgtLang: string,
    traceId?: string,
    pipeline?: {
      use_asr?: boolean;
      use_nmt?: boolean;
      use_tts?: boolean;
      use_tone?: boolean;
    }
  ): Promise<void> {
    if (!this.connectionManager.isConnected() || !this.messageHandler.getSessionId()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot send utterance');
      return;
    }

    await this.audioSender.sendUtterance(audioData, utteranceIndex, srcLang, tgtLang, traceId, pipeline);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.connectionManager.disconnect();
    this.messageHandler.reset();
    this.audioSender.setSessionId(null);
    // 清理音频编码器（避免资源泄露）
    this.audioSender.setAudioEncoder(null);
    this.audioSender.resetSequence();
    this.backpressureManager.clearSendQueue();
    this.pendingConnectParams = null;
  }

  /**
   * 获取背压状态
   */
  getBackpressureState(): BackpressureState {
    return this.backpressureManager.getBackpressureState();
  }

  /**
   * 获取重连次数
   */
  getReconnectAttempts(): number {
    return this.connectionManager.getReconnectAttempts();
  }

  /**
   * 发送 TTS_STARTED 消息
   */
  sendTtsStarted(traceId: string, groupId: string, tsStartMs: number): void {
    if (!this.connectionManager.isConnected() || !this.messageHandler.getSessionId()) {
      logger.warn('WebSocketClient', 'WebSocket未连接，无法发送 TTS_STARTED');
      return;
    }

    const sessionId = this.messageHandler.getSessionId();
    const message = {
      type: 'tts_started',
      session_id: sessionId,
      trace_id: traceId,
      group_id: groupId,
      ts_start_ms: tsStartMs,
    };

    logger.info('WebSocketClient', '发送 TTS_STARTED 消息', {
      session_id: sessionId,
      trace_id: traceId,
      group_id: groupId,
      ts_start_ms: tsStartMs,
      ts_start_ms_iso: new Date(tsStartMs).toISOString(),
      message_type: 'tts_started',
    });

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 发送 TTS_PLAY_ENDED 消息
   */
  sendTtsPlayEnded(traceId: string, groupId: string, tsEndMs: number): void {
    if (!this.connectionManager.isConnected() || !this.messageHandler.getSessionId()) {
      logger.warn('WebSocketClient', 'WebSocket未连接，无法发送 TTS_PLAY_ENDED');
      return;
    }

    const sessionId = this.messageHandler.getSessionId();
    const message = {
      type: 'tts_play_ended',
      session_id: sessionId,
      trace_id: traceId,
      group_id: groupId,
      ts_end_ms: tsEndMs,
    };

    logger.info('WebSocketClient', '发送 TTS_PLAY_ENDED 消息', {
      session_id: sessionId,
      trace_id: traceId,
      group_id: groupId,
      ts_end_ms: tsEndMs,
      ts_end_ms_iso: new Date(tsEndMs).toISOString(),
      message_type: 'tts_play_ended',
    });

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 设置租户 ID
   */
  setTenantId(tenantId: string | null): void {
    this.connectionManager.setTenantId(tenantId);
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string | null {
    return this.messageHandler.getSessionId();
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connectionManager.isConnected();
  }

  /**
   * 创建房间
   */
  createRoom(displayName?: string, preferredLang?: string): void {
    if (!this.connectionManager.isConnected()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot create room');
      return;
    }

    const message: RoomCreateMessage = {
      type: 'room_create',
      client_ts: Date.now(),
      display_name: displayName,
      preferred_lang: preferredLang,
    };

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 加入房间
   */
  joinRoom(roomCode: string, displayName?: string, preferredLang?: string): void {
    if (!this.connectionManager.isConnected()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot join room');
      return;
    }

    const message: RoomJoinMessage = {
      type: 'room_join',
      room_code: roomCode,
      display_name: displayName,
      preferred_lang: preferredLang,
    };

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 退出房间
   */
  leaveRoom(roomCode: string): void {
    if (!this.connectionManager.isConnected()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot leave room');
      return;
    }

    const message: RoomLeaveMessage = {
      type: 'room_leave',
      room_code: roomCode,
    };

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 设置原声传递偏好
   */
  setRawVoicePreference(roomCode: string, targetSessionId: string, receiveRawVoice: boolean): void {
    if (!this.connectionManager.isConnected()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot set raw voice preference');
      return;
    }

    const message: RoomRawVoicePreferenceMessage = {
      type: 'room_raw_voice_preference',
      room_code: roomCode,
      target_session_id: targetSessionId,
      receive_raw_voice: receiveRawVoice,
    };

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 发送 WebRTC offer
   */
  sendWebRTCOffer(roomCode: string, to: string, sdp: RTCSessionDescriptionInit): void {
    if (!this.connectionManager.isConnected()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot send WebRTC offer');
      return;
    }

    const message = {
      type: 'webrtc_offer',
      room_code: roomCode,
      to: to,
      sdp: sdp,
    };

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 发送 WebRTC answer
   */
  sendWebRTCAnswer(roomCode: string, to: string, sdp: RTCSessionDescriptionInit): void {
    if (!this.connectionManager.isConnected()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot send WebRTC answer');
      return;
    }

    const message = {
      type: 'webrtc_answer',
      room_code: roomCode,
      to: to,
      sdp: sdp,
    };

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 发送 WebRTC ICE candidate
   */
  sendWebRTCIce(roomCode: string, to: string, candidate: RTCIceCandidateInit): void {
    if (!this.connectionManager.isConnected()) {
      logger.warn('WebSocketClient', 'WebSocket not connected, cannot send WebRTC ICE candidate');
      return;
    }

    const message = {
      type: 'webrtc_ice',
      room_code: roomCode,
      to: to,
      candidate: candidate,
    };

    this.connectionManager.send(JSON.stringify(message));
  }

  /**
   * 清空发送队列（公开方法）
   */
  clearSendQueue(): void {
    this.backpressureManager.clearSendQueue();
  }
}

