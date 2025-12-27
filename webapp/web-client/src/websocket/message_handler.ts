/**
 * WebSocket 消息处理模块
 * 负责处理服务器消息和协议协商
 */

import { ServerMessage, SessionInitAckMessage, BackpressureMessage } from '../types';
import { AudioCodecConfig, createAudioEncoder, AudioEncoder } from '../audio_codec';

export type MessageCallback = (message: ServerMessage) => void;

/**
 * 消息处理器
 */
export class MessageHandler {
  private messageCallback: MessageCallback | null = null;
  private sessionId: string | null = null;
  private useBinaryFrame: boolean = false;
  private negotiatedCodec: string = 'pcm16';
  private audioEncoder: AudioEncoder | null = null;
  private audioCodecConfig: AudioCodecConfig | null = null;

  /**
   * 设置消息回调
   */
  setMessageCallback(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  /**
   * 设置音频编解码器配置
   */
  setAudioCodecConfig(config: AudioCodecConfig): void {
    this.audioCodecConfig = config;
    if (this.audioEncoder) {
      this.audioEncoder.close();
    }
    this.audioEncoder = createAudioEncoder(config);
    console.log('Audio encoder created:', config.codec);
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string | null {
    return this.sessionId;
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
   * 获取音频编码器
   */
  getAudioEncoder(): AudioEncoder | null {
    return this.audioEncoder;
  }

  /**
   * 处理消息
   */
  handleMessage(
    event: MessageEvent,
    onBackpressure?: (message: BackpressureMessage) => void,
    onSessionCreated?: (sessionId: string) => void
  ): void {
    try {
      const message = JSON.parse(event.data);
      
      // 记录所有收到的消息（用于调试）
      console.log(`[MessageHandler] 📨 收到服务器消息:`, {
        type: message.type,
        session_id: message.session_id || this.sessionId,
        has_callback: !!this.messageCallback,
      });

      // 处理会话初始化确认
      if (message.type === 'session_init_ack') {
        console.log('[MessageHandler] 处理 session_init_ack');
        this.handleSessionInitAck(message as SessionInitAckMessage, onSessionCreated);
        return;
      }

      // 处理背压消息
      if (message.type === 'backpressure' && onBackpressure) {
        console.log('[MessageHandler] 处理 backpressure');
        onBackpressure(message as BackpressureMessage);
        return;
      }

      // 处理其他服务器消息
      if (this.messageCallback) {
        // 对于 translation_result 消息，记录详细信息
        if (message.type === 'translation_result') {
          console.log(`[MessageHandler] 📨 收到 translation_result 消息，准备转发:`, {
            utterance_index: message.utterance_index,
            has_tts_audio: !!(message as any).tts_audio,
            tts_audio_length: (message as any).tts_audio?.length || 0,
            trace_id: (message as any).trace_id,
            job_id: (message as any).job_id
          });
        }
        console.log(`[MessageHandler] 转发消息到 callback: ${message.type}`);
        this.messageCallback(message as ServerMessage);
      } else {
        console.warn(`[MessageHandler] ⚠️ 收到消息但无 callback:`, message.type);
      }
    } catch (error) {
      console.error('[MessageHandler] ❌ 解析消息失败:', error, {
        data: event.data,
        data_type: typeof event.data,
        data_length: event.data?.length,
      });
    }
  }

  /**
   * 处理会话初始化确认
   */
  private handleSessionInitAck(ack: SessionInitAckMessage, onSessionCreated?: (sessionId: string) => void): void {
    this.sessionId = ack.session_id;
    
    // 通知外部会话已创建（用于启动心跳等）
    if (onSessionCreated) {
      onSessionCreated(ack.session_id);
    }

    // Phase 2: 协议版本协商
    this.useBinaryFrame = ack.use_binary_frame ?? false;
    this.negotiatedCodec = ack.negotiated_codec || ack.negotiated_audio_format || 'pcm16';

    // 如果协商的编解码器是 opus，确保编码器已初始化
    if (this.negotiatedCodec === 'opus' && !this.audioEncoder) {
      const codecConfig: AudioCodecConfig = {
        codec: 'opus',
        sampleRate: ack.negotiated_sample_rate || 16000,
        channelCount: ack.negotiated_channel_count || 1,
        frameSizeMs: 20,
        application: 'voip',
        bitrate: 24000,
      };
      this.setAudioCodecConfig(codecConfig);
    } else if (this.useBinaryFrame && !this.audioEncoder) {
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

    // 通知消息回调
    if (this.messageCallback) {
      this.messageCallback(ack);
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.sessionId = null;
    this.useBinaryFrame = false;
    this.negotiatedCodec = 'pcm16';
  }
}

