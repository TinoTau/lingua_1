import { AudioChunkMessage, ServerMessage, FeatureFlags } from './types';
import { StateMachine, SessionState } from './state_machine';

export type MessageCallback = (message: ServerMessage) => void;

/**
 * WebSocket 客户端
 * 负责 PCM16 上传和 TTS 下载
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private sequence: number = 0;
  private messageCallback: MessageCallback | null = null;
  private stateMachine: StateMachine;
  private url: string;

  constructor(stateMachine: StateMachine, url: string) {
    this.stateMachine = stateMachine;
    this.url = url;
  }

  /**
   * 设置消息回调
   */
  setMessageCallback(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  /**
   * 连接 WebSocket
   * @param srcLang 源语言
   * @param tgtLang 目标语言
   * @param features 可选功能标志（由用户选择）
   */
  async connect(srcLang: string, tgtLang: string, features?: FeatureFlags): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          
          // 发送会话初始化消息
          const initMessage = {
            type: 'session_init',
            client_version: 'web-client-v1.0',
            platform: 'web',
            src_lang: srcLang,
            tgt_lang: tgtLang,
            dialect: null,
            features: features || {},
            pairing_code: null,
          };

          this.ws!.send(JSON.stringify(initMessage));
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // 处理会话初始化确认
            if (message.type === 'session_init_ack') {
              this.sessionId = message.session_id;
              console.log('Session created:', this.sessionId);
              resolve();
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
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('WebSocket closed');
          this.sessionId = null;
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 发送音频块
   */
  sendAudioChunk(audioData: Float32Array, isFinal: boolean = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      console.warn('WebSocket not connected, cannot send audio chunk');
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
      seq: this.sequence++,
      is_final: isFinal,
      payload: base64,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送结束帧
   */
  sendFinal(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: AudioChunkMessage = {
      type: 'audio_chunk',
      seq: this.sequence++,
      is_final: true,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
    this.sequence = 0;
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
}

