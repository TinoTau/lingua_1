import { AudioChunkMessage, ServerMessage, FeatureFlags, RoomCreateMessage, RoomJoinMessage, RoomLeaveMessage, RoomRawVoicePreferenceMessage } from './types';
import { StateMachine } from './state_machine';

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
   * 连接 WebSocket（单向模式）
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
          
          // 发送会话初始化消息（单向模式）
          const initMessage = {
            type: 'session_init',
            client_version: 'web-client-v1.0',
            platform: 'web',
            src_lang: srcLang,
            tgt_lang: tgtLang,
            dialect: null,
            features: features || {},
            pairing_code: null,
            mode: 'one_way',
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
   * 连接 WebSocket（双向模式）
   * @param langA 语言 A
   * @param langB 语言 B
   * @param features 可选功能标志（由用户选择）
   */
  async connectTwoWay(langA: string, langB: string, features?: FeatureFlags): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected (two-way mode)');
          
          // 发送会话初始化消息（双向模式）
          const initMessage = {
            type: 'session_init',
            client_version: 'web-client-v1.0',
            platform: 'web',
            src_lang: 'auto', // 双向模式使用自动检测
            tgt_lang: langB, // 临时目标语言（实际会根据检测结果自动切换）
            dialect: null,
            features: features || {},
            pairing_code: null,
            mode: 'two_way_auto',
            lang_a: langA,
            lang_b: langB,
            auto_langs: [langA, langB], // 限制识别范围
          };

          this.ws!.send(JSON.stringify(initMessage));
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // 处理会话初始化确认
            if (message.type === 'session_init_ack') {
              this.sessionId = message.session_id;
              console.log('Session created (two-way mode):', this.sessionId);
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

