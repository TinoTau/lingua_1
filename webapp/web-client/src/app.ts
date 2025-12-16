import { StateMachine } from './state_machine';
import { SessionState, RoomMember } from './types';
import { Recorder } from './recorder';
import { WebSocketClient } from './websocket_client';
import { TtsPlayer } from './tts_player';
import { AsrSubtitle } from './asr_subtitle';
import { AudioMixer } from './audio_mixer';
import { Config, DEFAULT_CONFIG, ServerMessage, FeatureFlags } from './types';

/**
 * 主应用类
 * 整合所有模块
 */
export class App {
  private stateMachine: StateMachine;
  private recorder: Recorder;
  private wsClient: WebSocketClient;
  private ttsPlayer: TtsPlayer;
  private asrSubtitle: AsrSubtitle;
  private audioMixer: AudioMixer;
  private config: Config;
  private audioBuffer: Float32Array[] = [];
  // 当前 utterance 的 trace_id 和 group_id（用于 TTS_PLAY_ENDED）
  private currentTraceId: string | null = null;
  private currentGroupId: string | null = null;
  // 会话状态
  private isSessionActive: boolean = false;
  // 房间状态
  private currentRoomCode: string | null = null;
  private roomMembers: RoomMember[] = [];
  private displayName: string = 'User';
  private isInRoom: boolean = false;
  // WebRTC 连接管理（key: 目标成员的 session_id, value: RTCPeerConnection）
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  // 本地音频流（用于 WebRTC）
  private localStream: MediaStream | null = null;
  // 音频混控器输出流（用于播放）
  private audioMixerOutput: HTMLAudioElement | null = null;

  constructor(config: Partial<Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 初始化模块
    this.stateMachine = new StateMachine();
    this.recorder = new Recorder(this.stateMachine, this.config);
    this.wsClient = new WebSocketClient(this.stateMachine, this.config.schedulerUrl);
    this.ttsPlayer = new TtsPlayer(this.stateMachine);
    this.asrSubtitle = new AsrSubtitle('app');
    this.audioMixer = new AudioMixer();

    // 初始化音频混控器输出
    this.initAudioMixerOutput();

    // 设置回调
    this.setupCallbacks();
  }

  /**
   * 初始化音频混控器输出
   */
  private initAudioMixerOutput(): void {
    // 创建隐藏的 audio 元素用于播放混控后的音频
    this.audioMixerOutput = document.createElement('audio');
    this.audioMixerOutput.autoplay = true;
    this.audioMixerOutput.style.display = 'none';
    document.body.appendChild(this.audioMixerOutput);

    // 定期更新输出流
    const updateOutput = async () => {
      if (this.audioMixer && this.audioMixerOutput) {
        const stream = this.audioMixer.getOutputStream();
        if (stream) {
          // 如果流已更改，更新 audio 元素
          if (this.audioMixerOutput.srcObject !== stream) {
            this.audioMixerOutput.srcObject = stream;
          }
        }
      }
    };

    // 每 100ms 检查一次
    setInterval(updateOutput, 100);
  }

  /**
   * 设置回调
   */
  private setupCallbacks(): void {
    // 状态机回调
    this.stateMachine.onStateChange((newState, oldState) => {
      this.onStateChange(newState, oldState);
    });

    // 录音回调
    this.recorder.setAudioFrameCallback((audioData) => {
      this.onAudioFrame(audioData);
    });

    this.recorder.setSilenceDetectedCallback(() => {
      this.onSilenceDetected();
    });

    // WebSocket 回调
    this.wsClient.setMessageCallback((message) => {
      this.onServerMessage(message);
    });

    // TTS 播放回调
    this.ttsPlayer.setPlaybackFinishedCallback(() => {
      this.onPlaybackFinished();
    });
  }

  /**
   * 状态变化处理
   */
  private onStateChange(newState: SessionState, oldState: SessionState): void {
    console.log(`State changed: ${oldState} -> ${newState}`);

    // 根据状态控制录音
    if (newState === SessionState.INPUT_READY || newState === SessionState.INPUT_RECORDING) {
      // 输入模式：确保麦克风开启
      if (this.isSessionActive) {
        // 会话进行中：确保录音器运行
        if (newState === SessionState.INPUT_RECORDING) {
          // 如果录音器未运行，启动它（start() 方法会自动检查并初始化）
          if (!this.recorder.getIsRecording()) {
            this.recorder.start().catch((error) => {
              console.error('Failed to start recorder:', error);
            });
          }
        }
      } else {
        // 会话未开始：只在 INPUT_RECORDING 时启动录音
        if (newState === SessionState.INPUT_RECORDING && oldState === SessionState.INPUT_READY) {
          // start() 方法会自动检查并初始化录音器
          this.recorder.start().catch((error) => {
            console.error('Failed to start recorder:', error);
          });
        }
      }
    } else if (newState === SessionState.WAITING_RESULT || newState === SessionState.PLAYING_TTS) {
      // 输出模式：如果会话未开始，关闭麦克风；如果会话进行中，只停止录音（不关闭）
      if (!this.isSessionActive) {
        // 会话未开始：关闭麦克风
        this.recorder.stop();
        this.recorder.close();
      } else {
        // 会话进行中：只停止录音（不关闭），等待播放完成后继续监听
        this.recorder.stop();
      }
    }
  }

  /**
   * 音频帧处理
   */
  private onAudioFrame(audioData: Float32Array): void {
    if (this.stateMachine.getState() !== SessionState.INPUT_RECORDING) {
      return;
    }

    // 缓存音频数据
    this.audioBuffer.push(new Float32Array(audioData));

    // 发送音频块（每 100ms 发送一次）
    // 这里简化处理，实际应该按时间间隔发送
    if (this.audioBuffer.length >= 10) { // 假设每 10ms 一帧，10 帧 = 100ms
      const chunk = this.concatAudioBuffers(this.audioBuffer.splice(0, 10));
      this.wsClient.sendAudioChunk(chunk, false);
    }
  }

  /**
   * 静音检测处理
   */
  private onSilenceDetected(): void {
    if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
      // 发送剩余的音频数据
      if (this.audioBuffer.length > 0) {
        const chunk = this.concatAudioBuffers(this.audioBuffer);
        this.audioBuffer = [];
        this.wsClient.sendAudioChunk(chunk, false);
      }
      
      // 发送结束帧
      this.wsClient.sendFinal();
      
      // 停止录音
      this.stateMachine.stopRecording();
    }
  }

  /**
   * 服务器消息处理
   */
  private async onServerMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case 'asr_partial':
        if (message.is_final) {
          this.asrSubtitle.updateFinal(message.text);
        } else {
          this.asrSubtitle.updatePartial(message.text);
        }
        break;
      
      case 'translation':
        // 翻译文本可以显示在另一个区域
        console.log('Translation:', message.text);
        break;
      
      case 'translation_result':
        // 保存 trace_id 和 group_id，用于后续发送 TTS_PLAY_ENDED
        this.currentTraceId = message.trace_id;
        this.currentGroupId = message.group_id || null;
        
        // 处理 TTS 音频（如果存在）
        if (message.tts_audio) {
          if (this.isInRoom) {
            // 房间模式：使用音频混控器
            this.handleTtsAudioForRoomMode(message.tts_audio);
          } else {
            // 单会话模式：使用 TtsPlayer
            this.ttsPlayer.addAudioChunk(message.tts_audio);
          }
        }
        break;
      
      case 'tts_audio':
        if (this.isInRoom) {
          // 房间模式：使用音频混控器
          this.handleTtsAudioForRoomMode(message.payload);
        } else {
          // 单会话模式：使用 TtsPlayer
          this.ttsPlayer.addAudioChunk(message.payload);
        }
        break;
      
      case 'room_create_ack':
        // 房间创建成功，保存房间码
        this.currentRoomCode = message.room_code;
        this.isInRoom = true;
        console.log('Room created:', message.room_code);
        // 触发 UI 更新（如果当前在房间模式界面）
        if (typeof window !== 'undefined' && (window as any).onRoomCreated) {
          (window as any).onRoomCreated(message.room_code);
        }
        break;
      
      case 'room_members':
        // 更新成员列表
        if (message.room_code === this.currentRoomCode) {
          this.roomMembers = message.members;
          this.isInRoom = true; // 确保标记为在房间中
          console.log('Room members updated:', message.members);
          
          // 同步 WebRTC 连接状态
          this.syncPeerConnections();
          
          // 触发 UI 更新
          if (typeof window !== 'undefined' && (window as any).onRoomMembersUpdated) {
            (window as any).onRoomMembersUpdated(message.members);
          }
        }
        break;
      
      case 'webrtc_offer':
        // 处理 WebRTC offer
        await this.handleWebRTCOffer(message.room_code, message.to, message.sdp);
        break;
      
      case 'webrtc_answer':
        // 处理 WebRTC answer
        await this.handleWebRTCAnswer(message.to, message.sdp);
        break;
      
      case 'webrtc_ice':
        // 处理 WebRTC ICE candidate
        await this.handleWebRTCIce(message.to, message.candidate);
        break;
      
      case 'room_error':
        console.error('Room error:', message.code, message.message);
        // 可以触发 UI 错误提示
        break;
      
      case 'room_expired':
        // 房间过期，退出房间
        if (message.room_code === this.currentRoomCode) {
          console.log('Room expired:', message.message);
          alert('房间已过期: ' + message.message);
          this.leaveRoom();
          // 触发 UI 更新
          if (typeof window !== 'undefined' && (window as any).onRoomExpired) {
            (window as any).onRoomExpired();
          }
        }
        break;
    }
  }

  /**
   * 播放完成处理
   */
  private onPlaybackFinished(): void {
    console.log('Playback finished');
    
    // 发送 TTS_PLAY_ENDED 消息（如果 trace_id 和 group_id 存在）
    if (this.currentTraceId && this.currentGroupId) {
      const tsEndMs = Date.now();
      this.wsClient.sendTtsPlayEnded(this.currentTraceId, this.currentGroupId, tsEndMs);
      console.log(`Sent TTS_PLAY_ENDED: trace_id=${this.currentTraceId}, group_id=${this.currentGroupId}, ts_end_ms=${tsEndMs}`);
    } else {
      console.warn('Cannot send TTS_PLAY_ENDED: missing trace_id or group_id');
    }
    
    // 清空当前的 trace_id 和 group_id（准备下一句话）
    this.currentTraceId = null;
    this.currentGroupId = null;
    
    // 状态机会根据会话状态自动切换到 INPUT_RECORDING（会话进行中）或 INPUT_READY（会话未开始）
    // 状态切换会触发 onStateChange，在那里处理录音器的重新启动
  }

  /**
   * 处理房间模式下的 TTS 音频
   * @param base64Audio base64 编码的音频数据
   */
  private async handleTtsAudioForRoomMode(base64Audio: string): Promise<void> {
    try {
      // 解码 base64
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 转换为 Int16Array
      const int16Array = new Int16Array(bytes.buffer);

      // 转换为 Float32Array
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // 添加到音频混控器
      await this.audioMixer.addTtsAudio(float32Array);
    } catch (error) {
      console.error('处理 TTS 音频失败:', error);
    }
  }

  /**
   * 连接服务器（单向模式）
   * @param srcLang 源语言
   * @param tgtLang 目标语言
   * @param features 可选功能标志（由用户选择）
   */
  async connect(srcLang: string = 'zh', tgtLang: string = 'en', features?: FeatureFlags): Promise<void> {
    await this.wsClient.connect(srcLang, tgtLang, features);
    await this.recorder.initialize();
  }

  /**
   * 连接服务器（双向模式）
   * @param langA 语言 A
   * @param langB 语言 B
   * @param features 可选功能标志（由用户选择）
   */
  async connectTwoWay(langA: string = 'zh', langB: string = 'en', features?: FeatureFlags): Promise<void> {
    await this.wsClient.connectTwoWay(langA, langB, features);
    await this.recorder.initialize();
  }

  /**
   * 开始整个会话（持续输入+输出模式）
   */
  async startSession(): Promise<void> {
    if (this.stateMachine.getState() === SessionState.INPUT_READY) {
      this.isSessionActive = true;
      this.audioBuffer = [];
      this.asrSubtitle.clear();
      // 清空当前的 trace_id 和 group_id（新的会话）
      this.currentTraceId = null;
      this.currentGroupId = null;
      
      // 开始会话（状态机会自动进入 INPUT_RECORDING）
      this.stateMachine.startSession();
      
      // 确保录音器已初始化并开始录音
      if (!this.recorder.getIsRecording()) {
        await this.recorder.start();
      }
    }
  }

  /**
   * 结束整个会话
   */
  async endSession(): Promise<void> {
    this.isSessionActive = false;
    
    // 停止录音
    this.recorder.stop();
    this.recorder.close();
    
    // 停止播放
    this.ttsPlayer.stop();
    
    // 清空缓冲区
    this.audioBuffer = [];
    
    // 结束会话（状态机会回到 INPUT_READY）
    this.stateMachine.endSession();
  }

  /**
   * 发送当前说的话（控制说话节奏）
   * 发送后继续监听（不停止录音）
   */
  sendCurrentUtterance(): void {
    if (this.stateMachine.getState() === SessionState.INPUT_RECORDING && this.isSessionActive) {
      // 发送剩余的音频数据
      if (this.audioBuffer.length > 0) {
        const chunk = this.concatAudioBuffers(this.audioBuffer);
        this.audioBuffer = []; // 清空缓冲区，准备下一句话
        this.wsClient.sendAudioChunk(chunk, false);
      }
      
      // 发送结束帧（标记当前 utterance 结束）
      this.wsClient.sendFinal();
      
      // 切换到等待结果状态
      // 注意：状态切换会触发 onStateChange，在那里会根据会话状态决定是否停止录音
      // 会话进行中：只停止录音（不关闭），等待播放完成后继续监听
      // 会话未开始：停止并关闭录音
      this.stateMachine.stopRecording();
    }
  }

  /**
   * 开始录音（保留此方法以兼容旧代码，但推荐使用 startSession）
   * @deprecated 使用 startSession() 代替
   */
  async startRecording(): Promise<void> {
    await this.startSession();
  }

  /**
   * 停止录音（保留此方法以兼容旧代码，但推荐使用 sendCurrentUtterance 或 endSession）
   * @deprecated 使用 sendCurrentUtterance() 或 endSession() 代替
   */
  stopRecording(): void {
    if (this.isSessionActive) {
      // 如果会话进行中，使用 sendCurrentUtterance
      this.sendCurrentUtterance();
    } else {
      // 如果会话未开始，直接停止
      if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
        this.recorder.stop();
        this.stateMachine.stopRecording();
      }
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    // 如果正在房间中，先退出房间
    if (this.isInRoom && this.currentRoomCode) {
      this.leaveRoom();
    }
    
    // 关闭所有 WebRTC 连接
    for (const [memberId] of this.peerConnections.entries()) {
      this.closePeerConnection(memberId);
    }
    
    // 停止本地音频流
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    // 停止音频混控器
    this.audioMixer.stop();
    
    // 移除音频混控器输出元素
    if (this.audioMixerOutput) {
      this.audioMixerOutput.remove();
      this.audioMixerOutput = null;
    }
    
    this.recorder.close();
    this.wsClient.disconnect();
    this.ttsPlayer.stop();
  }

  /**
   * 创建房间
   * 创建者自动成为第一个成员
   * @param displayName 显示名称（可选）
   * @param preferredLang 偏好语言（可选）
   */
  createRoom(displayName?: string, preferredLang?: string): void {
    if (!this.wsClient.isConnected()) {
      console.error('WebSocket not connected, cannot create room');
      return;
    }
    
    this.wsClient.createRoom(displayName, preferredLang);
  }

  /**
   * 加入房间
   * @param roomCode 房间码（6位数字）
   * @param displayName 显示名称（可选）
   * @param preferredLang 偏好语言（可选）
   */
  joinRoom(roomCode: string, displayName?: string, preferredLang?: string): void {
    if (!this.wsClient.isConnected()) {
      console.error('WebSocket not connected, cannot join room');
      return;
    }
    
    // 验证房间码格式（6位数字）
    if (!/^\d{6}$/.test(roomCode)) {
      console.error('Invalid room code format, must be 6 digits');
      return;
    }
    
    this.displayName = displayName || 'User';
    this.wsClient.joinRoom(roomCode, displayName, preferredLang);
  }

  /**
   * 退出房间
   */
  leaveRoom(): void {
    if (!this.isInRoom || !this.currentRoomCode) {
      return;
    }
    
    // 如果会话正在进行，先结束会话
    if (this.isSessionActive) {
      this.endSession();
    }
    
    // 关闭所有 WebRTC 连接
    for (const [memberId] of this.peerConnections.entries()) {
      this.closePeerConnection(memberId);
    }
    this.peerConnections.clear();
    
    // 停止音频混控器（但不清除，因为可能还会重新加入房间）
    // 注意：这里不调用 stop()，因为 stop() 会关闭 AudioContext
    // 只需要移除所有远程流即可
    for (const member of this.roomMembers) {
      const memberId = member.session_id || member.participant_id;
      if (memberId !== this.wsClient.getSessionId()) {
        this.audioMixer.removeRemoteStream(memberId);
      }
    }
    
    this.wsClient.leaveRoom(this.currentRoomCode);
    
    // 清理房间状态
    this.currentRoomCode = null;
    this.roomMembers = [];
    this.isInRoom = false;
  }

  /**
   * 获取当前房间码
   */
  getCurrentRoomCode(): string | null {
    return this.currentRoomCode;
  }

  /**
   * 获取房间成员列表
   */
  getRoomMembers(): RoomMember[] {
    return this.roomMembers;
  }

  /**
   * 检查是否在房间中
   */
  getIsInRoom(): boolean {
    return this.isInRoom;
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string | null {
    return this.wsClient.getSessionId();
  }
  
  /**
   * 设置原声传递偏好
   */
  setRawVoicePreference(roomCode: string, targetSessionId: string, receiveRawVoice: boolean): void {
    this.wsClient.setRawVoicePreference(roomCode, targetSessionId, receiveRawVoice);
    
    // 实时切换 WebRTC 连接
    if (receiveRawVoice) {
      // 切换到接收：建立连接
      this.ensurePeerConnection(roomCode, targetSessionId);
    } else {
      // 切换到不接收：断开连接
      this.closePeerConnection(targetSessionId);
    }
  }
  
  /**
   * 确保与目标成员的 WebRTC 连接存在
   */
  private async ensurePeerConnection(roomCode: string, targetSessionId: string): Promise<void> {
    // 如果连接已存在，直接返回
    if (this.peerConnections.has(targetSessionId)) {
      return;
    }
    
    try {
      // 获取本地音频流（如果还没有）
      if (!this.localStream) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }
      
      // 创建 RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });
      
      // 添加本地音频轨道
      this.localStream.getAudioTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
      
      // 处理远程音频流
      pc.ontrack = async (event) => {
        const remoteStream = event.streams[0];
        console.log('收到远程音频流:', targetSessionId, remoteStream);
        
        // 将远程流添加到音频混控器
        try {
          await this.audioMixer.addRemoteStream(targetSessionId, remoteStream);
        } catch (error) {
          console.error('添加远程音频流到混控器失败:', error);
        }
      };
      
      // 处理 ICE candidate
      pc.onicecandidate = (event) => {
        if (event.candidate && this.currentRoomCode) {
          this.wsClient.sendWebRTCIce(this.currentRoomCode, targetSessionId, event.candidate);
        }
      };
      
      // 存储连接
      this.peerConnections.set(targetSessionId, pc);
      
      // 创建 offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      // 发送 offer
      if (this.currentRoomCode) {
        this.wsClient.sendWebRTCOffer(this.currentRoomCode, targetSessionId, offer);
      }
      
      console.log('WebRTC 连接已建立:', targetSessionId);
    } catch (error) {
      console.error('建立 WebRTC 连接失败:', error);
    }
  }
  
  /**
   * 关闭与目标成员的 WebRTC 连接
   */
  private closePeerConnection(targetSessionId: string): void {
    const pc = this.peerConnections.get(targetSessionId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(targetSessionId);
      
      // 从音频混控器中移除远程流
      this.audioMixer.removeRemoteStream(targetSessionId);
      
      console.log('WebRTC 连接已关闭:', targetSessionId);
    }
  }
  
  /**
   * 处理 WebRTC offer
   */
  private async handleWebRTCOffer(roomCode: string, fromSessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      // 检查是否应该接收该成员的原声
      const shouldReceive = this.shouldReceiveRawVoice(fromSessionId);
      if (!shouldReceive) {
        console.log('忽略 WebRTC offer: 已屏蔽该成员的原声', fromSessionId);
        return;
      }
      
      // 获取或创建连接
      let pc = this.peerConnections.get(fromSessionId);
      if (!pc) {
        // 获取本地音频流（如果还没有）
        if (!this.localStream) {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }
        
        // 创建 RTCPeerConnection
        pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
          ],
        });
        
        // 添加本地音频轨道
        this.localStream.getAudioTracks().forEach(track => {
          pc!.addTrack(track, this.localStream!);
        });
        
        // 处理远程音频流
        pc.ontrack = async (event) => {
          const remoteStream = event.streams[0];
          console.log('收到远程音频流:', fromSessionId, remoteStream);
          
          // 将远程流添加到音频混控器
          try {
            await this.audioMixer.addRemoteStream(fromSessionId, remoteStream);
          } catch (error) {
            console.error('添加远程音频流到混控器失败:', error);
          }
        };
        
        // 处理 ICE candidate
        pc.onicecandidate = (event) => {
          if (event.candidate && this.currentRoomCode) {
            this.wsClient.sendWebRTCIce(this.currentRoomCode, fromSessionId, event.candidate);
          }
        };
        
        this.peerConnections.set(fromSessionId, pc);
      }
      
      // 设置远程描述
      await pc.setRemoteDescription(sdp);
      
      // 创建 answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      // 发送 answer
      if (this.currentRoomCode) {
        this.wsClient.sendWebRTCAnswer(this.currentRoomCode, fromSessionId, answer);
      }
    } catch (error) {
      console.error('处理 WebRTC offer 失败:', error);
    }
  }
  
  /**
   * 处理 WebRTC answer
   */
  private async handleWebRTCAnswer(fromSessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(fromSessionId);
    if (pc) {
      try {
        await pc.setRemoteDescription(sdp);
        console.log('WebRTC answer 已处理:', fromSessionId);
      } catch (error) {
        console.error('处理 WebRTC answer 失败:', error);
      }
    }
  }
  
  /**
   * 处理 WebRTC ICE candidate
   */
  private async handleWebRTCIce(fromSessionId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(fromSessionId);
    if (pc) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('处理 WebRTC ICE candidate 失败:', error);
      }
    }
  }
  
  /**
   * 检查是否应该接收某个成员的原声
   */
  private shouldReceiveRawVoice(targetSessionId: string): boolean {
    const currentSessionId = this.wsClient.getSessionId();
    if (!currentSessionId) {
      return false;
    }
    
    // 查找目标成员
    const targetMember = this.roomMembers.find(
      m => (m.session_id || m.participant_id) === targetSessionId
    );
    
    if (!targetMember) {
      return false;
    }
    
    // 检查偏好设置（默认接收）
    const rawVoicePrefs = targetMember.raw_voice_preferences || {};
    return rawVoicePrefs[currentSessionId] !== false;
  }
  
  /**
   * 更新房间成员列表并同步 WebRTC 连接
   */
  private syncPeerConnections(): void {
    if (!this.currentRoomCode || !this.isInRoom) {
      return;
    }
    
    const currentSessionId = this.wsClient.getSessionId();
    if (!currentSessionId) {
      return;
    }
    
    // 遍历所有成员，确保连接状态与偏好一致
    for (const member of this.roomMembers) {
      const memberId = member.session_id || member.participant_id;
      
      // 跳过自己
      if (memberId === currentSessionId) {
        continue;
      }
      
      const shouldReceive = this.shouldReceiveRawVoice(memberId);
      const hasConnection = this.peerConnections.has(memberId);
      
      if (shouldReceive && !hasConnection) {
        // 应该接收但没有连接：建立连接
        this.ensurePeerConnection(this.currentRoomCode, memberId);
      } else if (!shouldReceive && hasConnection) {
        // 不应该接收但有连接：断开连接
        this.closePeerConnection(memberId);
      }
    }
    
    // 清理已离开的成员的连接
    const activeMemberIds = new Set(
      this.roomMembers.map(m => m.session_id || m.participant_id)
    );
    for (const [memberId] of this.peerConnections.entries()) {
      if (!activeMemberIds.has(memberId)) {
        this.closePeerConnection(memberId);
      }
    }
  }

  /**
   * 获取当前状态
   */
  getState(): SessionState {
    return this.stateMachine.getState();
  }

  /**
   * 合并音频缓冲区
   */
  private concatAudioBuffers(buffers: Float32Array[]): Float32Array {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    return result;
  }

  /**
   * 获取状态机实例（用于 UI 访问）
   * @internal
   */
  getStateMachine(): StateMachine {
    return this.stateMachine;
  }
}

