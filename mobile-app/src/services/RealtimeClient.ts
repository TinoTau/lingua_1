/**
 * 实时客户端（WebSocket 通信）
 * 对应 iOS 文档中的 RealtimeClient
 * 封装 WebSocket 通信和消息协议
 */

import { SessionInitMessage, SessionInitAckMessage, TranslationResultMessage, ErrorMessage, LanguageDetectedMessage, ServerHeartbeatMessage } from '../../../shared/protocols/messages';
import { AudioChunk } from '../models/AudioChunk';
import { TranslationSegment } from '../models/TranslationSegment';
import { SessionConfig } from '../models/SessionConfig';

export interface RealtimeClientDelegate {
  onSessionCreated?(sessionId: string): void;
  onTranslationResult?(segment: TranslationSegment): void;
  onLanguageDetected?(lang: string, confidence: number): void;
  onError?(error: string): void;
  onConnectionStatusChanged?(connected: boolean): void;
}

export interface RealtimeClientConfig {
  schedulerUrl?: string;
  platform?: 'android' | 'ios' | 'web';
  clientVersion?: string;
  heartbeatIntervalMs?: number; // 默认 20-30 秒
  reconnectMaxAttempts?: number; // 默认 5 次
  reconnectBaseDelayMs?: number; // 默认 1000ms（指数退避）
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private config: Required<RealtimeClientConfig>;
  private delegate: RealtimeClientDelegate | null = null;
  private sessionId: string | null = null;
  private sessionConfig: SessionConfig | null = null;
  private pairingCode: string | null = null;
  private isConnected = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private utteranceIndex = 0;

  constructor(config: RealtimeClientConfig = {}) {
    this.config = {
      schedulerUrl: config.schedulerUrl || 'ws://localhost:8080/ws/session',
      platform: config.platform || 'ios',
      clientVersion: config.clientVersion || '1.0.0',
      heartbeatIntervalMs: config.heartbeatIntervalMs || 25000,
      reconnectMaxAttempts: config.reconnectMaxAttempts || 5,
      reconnectBaseDelayMs: config.reconnectBaseDelayMs || 1000,
    };
  }

  /**
   * 设置委托
   */
  setDelegate(delegate: RealtimeClientDelegate | null) {
    this.delegate = delegate;
  }

  /**
   * 连接服务器
   */
  async connect(config: SessionConfig, pairingCode?: string): Promise<void> {
    if (this.isConnected) {
      console.warn('WebSocket 已连接');
      return;
    }

    this.sessionConfig = config;
    this.pairingCode = pairingCode || null;
    this.reconnectAttempts = 0;

    await this.doConnect();
  }

  /**
   * 执行连接
   */
  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.config.schedulerUrl);

        ws.onopen = () => {
          console.log('WebSocket 连接已建立');
          this.ws = ws;
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.notifyConnectionStatusChanged(true);

          // 设置消息处理器
          ws.onmessage = (event) => {
            this.handleMessage(event.data);
          };

          // 发送会话初始化消息
          this.sendSessionInit();

          // 启动心跳
          this.startHeartbeat();

          resolve();
        };

        ws.onerror = (error) => {
          console.error('WebSocket 错误:', error);
          this.notifyError('WebSocket 连接错误');
          reject(error);
        };

        ws.onclose = () => {
          console.log('WebSocket 连接已关闭');
          this.ws = null;
          this.isConnected = false;
          this.notifyConnectionStatusChanged(false);
          this.stopHeartbeat();

          // 尝试重连
          if (this.reconnectAttempts < this.config.reconnectMaxAttempts) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        console.error('创建 WebSocket 失败:', error);
        reject(error);
      }
    });
  }

  /**
   * 发送会话初始化消息
   */
  private sendSessionInit(): void {
    if (!this.ws || !this.sessionConfig) {
      return;
    }

    const message: SessionInitMessage = {
      type: 'session_init',
      client_version: this.config.clientVersion,
      platform: this.config.platform,
      src_lang: this.sessionConfig.srcLang,
      tgt_lang: this.sessionConfig.tgtLang,
      dialect: this.sessionConfig.dialect || null,
      features: {
        emotion_detection: this.sessionConfig.enableEmotion || false,
        voice_style_detection: this.sessionConfig.enableVoiceStyle || false,
        speech_rate_detection: this.sessionConfig.enableSpeechRate || false,
        speech_rate_control: this.sessionConfig.enableSpeechRate || false,
        speaker_identification: this.sessionConfig.enableSpeakerIdentification || false,
        persona_adaptation: this.sessionConfig.enablePersonaAdaptation || false,
      },
      pairing_code: this.pairingCode,
      // 自动语种识别相关
      mode: this.sessionConfig.mode,
      lang_a: this.sessionConfig.langA,
      lang_b: this.sessionConfig.langB,
      auto_langs: this.sessionConfig.autoLangs,
    };

    this.sendMessage(message);
  }

  /**
   * 发送音频块
   */
  sendAudioChunk(chunk: AudioChunk, manualCut: boolean = false): void {
    if (!this.ws || !this.sessionId || !this.sessionConfig) {
      console.warn('WebSocket 未连接或会话未创建');
      return;
    }

    // 将 PCM 数据转换为 base64
    const base64Audio = this.arrayBufferToBase64(chunk.pcmData.buffer);

    const message = {
      type: 'utterance' as const,
      session_id: this.sessionId,
      utterance_index: this.utteranceIndex++,
      manual_cut: manualCut,
      src_lang: this.sessionConfig.srcLang,
      tgt_lang: this.sessionConfig.tgtLang,
      dialect: this.sessionConfig.dialect || null,
      features: {
        emotion_detection: this.sessionConfig.enableEmotion || false,
        voice_style_detection: this.sessionConfig.enableVoiceStyle || false,
        speech_rate_detection: this.sessionConfig.enableSpeechRate || false,
        speech_rate_control: this.sessionConfig.enableSpeechRate || false,
        speaker_identification: this.sessionConfig.enableSpeakerIdentification || false,
        persona_adaptation: this.sessionConfig.enablePersonaAdaptation || false,
      },
      audio: base64Audio,
      audio_format: 'pcm16',
      sample_rate: 16000,
    };

    this.sendMessage(message);
  }


  /**
   * 处理接收到的消息
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'session_init_ack': {
          const ack = message as SessionInitAckMessage;
          this.sessionId = ack.session_id;
          console.log('会话创建成功:', ack.session_id);
          if (this.delegate?.onSessionCreated) {
            this.delegate.onSessionCreated(ack.session_id);
          }
          break;
        }

        case 'translation_result': {
          const result = message as TranslationResultMessage;
          this.handleTranslationResult(result);
          break;
        }

        case 'language_detected': {
          const detected = message as LanguageDetectedMessage;
          if (this.delegate?.onLanguageDetected) {
            this.delegate.onLanguageDetected(detected.lang, detected.confidence);
          }
          break;
        }

        case 'server_heartbeat': {
          const heartbeat = message as ServerHeartbeatMessage;
          // 可以记录心跳时间，用于计算延迟
          break;
        }

        case 'error': {
          const error = message as ErrorMessage;
          console.error('收到错误消息:', error.code, error.message);
          this.notifyError(`${error.code}: ${error.message}`);
          break;
        }

        default:
          console.log('收到未知消息类型:', message.type);
      }
    } catch (error) {
      console.error('解析消息失败:', error);
    }
  }

  /**
   * 处理翻译结果
   */
  private handleTranslationResult(result: TranslationResultMessage): void {
    // 解码 TTS 音频（base64）
    let ttsAudio: Uint8Array | undefined;
    if (result.tts_audio) {
      ttsAudio = this.base64ToArrayBuffer(result.tts_audio);
    }

    const segment: TranslationSegment = {
      id: `segment-${result.utterance_index}`,
      sequence: result.utterance_index,
      textSrc: result.text_asr,
      textTgt: result.text_translated,
      timestamp: Date.now(),
      ttsAudio,
      extra: result.extra,
    };

    if (this.delegate?.onTranslationResult) {
      this.delegate.onTranslationResult(segment);
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected && this.sessionId) {
        // 发送心跳消息
        const message = {
          type: 'client_heartbeat' as const,
          session_id: this.sessionId,
          timestamp: Date.now(),
        };
        this.sendMessage(message);
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.config.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`将在 ${delay}ms 后尝试重连 (第 ${this.reconnectAttempts} 次)`);

    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch((error) => {
        console.error('重连失败:', error);
      });
    }, delay);
  }

  /**
   * 发送消息
   */
  private sendMessage(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket 未连接，无法发送消息');
      return;
    }

    try {
      const json = JSON.stringify(message);
      this.ws.send(json);
    } catch (error) {
      console.error('发送消息失败:', error);
    }
  }

  /**
   * 设置 WebSocket 消息处理器
   */
  setupMessageHandler(): void {
    if (this.ws) {
      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      // 发送关闭消息
      if (this.sessionId) {
        const message = {
          type: 'session_close' as const,
          session_id: this.sessionId,
          reason: 'client_disconnect',
        };
        this.sendMessage(message);
      }

      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.sessionId = null;
    this.notifyConnectionStatusChanged(false);
  }

  /**
   * 通知连接状态变化
   */
  private notifyConnectionStatusChanged(connected: boolean): void {
    if (this.delegate?.onConnectionStatusChanged) {
      this.delegate.onConnectionStatusChanged(connected);
    }
  }

  /**
   * 通知错误
   */
  private notifyError(error: string): void {
    if (this.delegate?.onError) {
      this.delegate.onError(error);
    }
  }

  /**
   * 获取连接状态
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * 将 ArrayBuffer 转换为 base64 字符串
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 将 base64 字符串转换为 ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

