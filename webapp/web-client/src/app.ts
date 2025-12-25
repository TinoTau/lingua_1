import { StateMachine } from './state_machine';
import { SessionState, RoomMember } from './types';
import { Recorder } from './recorder';
import { WebSocketClient } from './websocket_client';
import { TtsPlayer } from './tts_player';
import { AsrSubtitle } from './asr_subtitle';
import { AudioMixer } from './audio_mixer';
import { Config, DEFAULT_CONFIG, ServerMessage, FeatureFlags } from './types';
import { ObservabilityManager } from './observability';
import { AudioCodecConfig } from './audio_codec';

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
  private displayName: string = 'User'; // 在 createRoom 中被设置
  private isInRoom: boolean = false;
  // WebRTC 连接管理（key: 目标成员的 session_id, value: RTCPeerConnection）
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  // 本地音频流（用于 WebRTC）
  private localStream: MediaStream | null = null;
  // 音频混控器输出流（用于播放）
  private audioMixerOutput: HTMLAudioElement | null = null;
  // 可观测性管理器
  private observability: ObservabilityManager | null = null;
  // 翻译结果计数器（用于给每条结果编号，在 resetSession 中被重置）
  private translationResultCount: number = 0;
  // 翻译结果映射（key: utterance_index, value: 翻译结果）- 用于文本显示同步
  private translationResults: Map<number, {
    originalText: string;
    translatedText: string;
    serviceTimings?: { asr_ms?: number; nmt_ms?: number; tts_ms?: number; total_ms?: number };
    networkTimings?: { web_to_scheduler_ms?: number; scheduler_to_node_ms?: number; node_to_scheduler_ms?: number; scheduler_to_web_ms?: number };
    schedulerSentAtMs?: number;
  }> = new Map();
  // 已显示的 utterance_index 集合（用于去重，防止重复显示）
  private displayedUtteranceIndices: Set<number> = new Set();
  // 待显示的翻译结果队列（只有播放时才显示）- 保留用于兼容性
  private pendingTranslationResults: Array<{
    originalText: string;
    translatedText: string;
    serviceTimings?: { asr_ms?: number; nmt_ms?: number; tts_ms?: number; total_ms?: number };
    networkTimings?: { web_to_scheduler_ms?: number; scheduler_to_node_ms?: number; node_to_scheduler_ms?: number; scheduler_to_web_ms?: number };
    schedulerSentAtMs?: number;
  }> = [];
  // 已显示的翻译结果数量（用于跟踪哪些结果已显示）
  private displayedTranslationCount: number = 0;
  // 当前会话的语言配置
  private currentSrcLang: string = 'zh';
  private currentTgtLang: string = 'en';
  // 当前 utterance 索引
  private currentUtteranceIndex: number = 0;

  constructor(config: Partial<Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化可观测性管理器（如果配置了上报 URL）
    if (this.config.observabilityReportUrl) {
      this.observability = new ObservabilityManager(
        this.config.observabilityReportUrl,
        this.config.observabilityReportIntervalMs || 60000
      );
    }

    // 初始化模块
    this.stateMachine = new StateMachine();
    this.recorder = new Recorder(this.stateMachine, this.config);
    this.wsClient = new WebSocketClient(
      this.stateMachine,
      this.config.schedulerUrl,
      this.config.reconnectConfig,
      this.config.clientVersion
    );

    // Phase 2: 设置音频编解码器配置
    // 使用 opus 编码以减小传输数据量
    const codecConfig: AudioCodecConfig = this.config.audioCodecConfig || {
      codec: 'opus', // 使用 Opus 编码
      sampleRate: 16000,
      channelCount: 1,
      frameSizeMs: 20, // 默认 20ms 帧
      application: 'voip', // VOIP 模式，适合实时语音通信
      bitrate: 24000, // 设置 24 kbps for VOIP（推荐值，平衡质量和带宽）
    };
    this.wsClient.setAudioCodecConfig(codecConfig);
    console.log('Audio codec config set:', codecConfig.codec);

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

    // WebSocket 重连回调
    this.wsClient.setReconnectCallback(() => {
      if (this.observability) {
        this.observability.recordReconnect();
      }
    });

    // TTS 播放回调
    this.ttsPlayer.setPlaybackFinishedCallback(() => {
      this.onPlaybackFinished();
    });

    // TTS 播放索引变化回调（用于文本显示同步）
    this.ttsPlayer.setPlaybackIndexChangeCallback((utteranceIndex) => {
      this.onPlaybackIndexChange(utteranceIndex);
    });

    // 内存压力回调
    this.ttsPlayer.setMemoryPressureCallback((pressure) => {
      this.onMemoryPressure(pressure);
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
    } else if (newState === SessionState.PLAYING_TTS) {
      // 播放模式：屏蔽麦克风输入，避免声学回响
      if (this.isSessionActive) {
        // 会话进行中：停止录音（不关闭），屏蔽输入
        this.recorder.stop();
        console.log('播放模式：已屏蔽麦克风输入，避免声学回响');
      } else {
        // 会话未开始：关闭麦克风
        this.recorder.stop();
        this.recorder.close();
      }
    }

    // 从播放状态回到录音状态时，恢复录音
    if (newState === SessionState.INPUT_RECORDING && oldState === SessionState.PLAYING_TTS) {
      if (this.isSessionActive) {
        // 会话进行中：恢复录音
        if (!this.recorder.getIsRecording()) {
          this.recorder.start().catch((error) => {
            console.error('恢复录音失败:', error);
          });
        }
        console.log('已恢复录音，可以继续说话');
      }
    }
  }

  /**
   * 音频帧处理
   * 注意：静音过滤在 Recorder 中处理，这里只接收有效语音帧
   * 只有有效语音才会被缓存和发送，静音片段完全不发送
   */
  private onAudioFrame(audioData: Float32Array): void {
    // 只在输入状态下处理音频
    if (this.stateMachine.getState() !== SessionState.INPUT_RECORDING) {
      return;
    }

    // Recorder 已经过滤了静音，这里收到的都是有效语音
    // 缓存有效音频数据
    this.audioBuffer.push(new Float32Array(audioData));

    // 自动发送音频块（每 100ms 发送一次，使用 opus 编码）
    // 假设每 10ms 一帧，10 帧 = 100ms
    if (this.audioBuffer.length >= 10) {
      const chunk = this.concatAudioBuffers(this.audioBuffer.splice(0, 10));
      // 使用 sendAudioChunk，它会根据配置使用 opus 编码（Binary Frame 模式）或 PCM16（JSON 模式）
      this.wsClient.sendAudioChunk(chunk, false);
      // 记录音频块发送
      if (this.observability) {
        this.observability.recordAudioChunkSent();
      }
    }
  }

  /**
   * 静音检测处理（静音超时）
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
        // 如果会话已结束，丢弃 ASR 部分结果
        if (!this.isSessionActive) {
          console.log('[App] 会话已结束，丢弃 ASR 部分结果:', message.text);
          return;
        }
        if (message.is_final) {
          this.asrSubtitle.updateFinal(message.text);
        } else {
          this.asrSubtitle.updatePartial(message.text);
        }
        break;

      case 'translation':
        // 如果会话已结束，丢弃翻译消息
        if (!this.isSessionActive) {
          console.log('[App] 会话已结束，丢弃翻译消息:', message.text);
          return;
        }
        // 翻译文本可以显示在另一个区域
        console.log('Translation:', message.text);
        break;

      case 'missing_result':
        // Missing 占位结果：静默丢弃，但记录 debug 日志
        // 这表示某个 utterance_index 的结果超时或丢失，但系统继续运行
        console.debug('[App] Missing result received (silently discarded):', {
          utterance_index: message.utterance_index,
          reason: message.reason,
          created_at_ms: message.created_at_ms,
          trace_id: message.trace_id,
        });
        // 不显示给用户，不缓存，直接返回
        return;

      case 'backpressure':
        // 背压消息已在 WebSocketClient 中处理，这里可以记录日志或更新 UI
        // 注意：背压消息与会话状态无关，不应该被过滤
        console.log('Backpressure received:', message);
        // 记录背压事件
        if (this.observability) {
          this.observability.recordBackpressureEvent(message.action);
        }
        break;

      case 'translation_result':
        // 详细日志：记录收到的消息
        console.log('[App] 📥 收到 translation_result 消息:', {
          utterance_index: message.utterance_index,
          has_text_asr: !!message.text_asr,
          text_asr_length: message.text_asr?.length || 0,
          has_text_translated: !!message.text_translated,
          text_translated_length: message.text_translated?.length || 0,
          has_tts_audio: !!message.tts_audio,
          tts_audio_length: message.tts_audio?.length || 0,
          is_session_active: this.isSessionActive,
          trace_id: message.trace_id,
          job_id: message.job_id
        });

        // 如果会话已结束，丢弃翻译结果
        if (!this.isSessionActive) {
          console.warn('[App] ⚠️ 会话已结束，丢弃翻译结果:', {
            utterance_index: message.utterance_index,
            text_asr: message.text_asr,
            text_translated: message.text_translated,
            trace_id: message.trace_id
          });
          return;
        }

        // 检查结果是否为空（空文本不应该进入待播放缓存区）
        const asrEmpty = !message.text_asr || message.text_asr.trim() === '';
        const translatedEmpty = !message.text_translated || message.text_translated.trim() === '';
        const ttsEmpty = !message.tts_audio || message.tts_audio.length === 0;

        if (asrEmpty && translatedEmpty && ttsEmpty) {
          console.log('[App] ⚠️ 收到空文本结果（静音检测），跳过缓存和播放:', {
            utterance_index: message.utterance_index,
            trace_id: message.trace_id,
            job_id: message.job_id
          });
          // 不缓存，不播放，直接返回
          return;
        }

        // 保存 trace_id 和 group_id，用于后续发送 TTS_PLAY_ENDED
        this.currentTraceId = message.trace_id;
        this.currentGroupId = message.group_id || null;

        // 显示翻译结果（原文、译文和处理时间）
        console.log('=== 翻译结果 ===');
        console.log('原文 (ASR):', message.text_asr);
        console.log('译文 (NMT):', message.text_translated);
        console.log('当前状态:', this.stateMachine.getState());
        console.log('是否有 TTS 音频:', !!message.tts_audio, message.tts_audio ? `长度: ${message.tts_audio.length}` : '无');

        if (message.service_timings) {
          const timings = message.service_timings;
          console.log('服务耗时:', {
            ASR: timings.asr_ms ? `${timings.asr_ms}ms` : 'N/A',
            NMT: timings.nmt_ms ? `${timings.nmt_ms}ms` : 'N/A',
            TTS: timings.tts_ms ? `${timings.tts_ms}ms` : 'N/A',
            Total: timings.total_ms ? `${timings.total_ms}ms` : 'N/A'
          });
        }
        if (message.network_timings) {
          const network = message.network_timings;
          const networkInfo: any = {};
          if (network.web_to_scheduler_ms !== undefined) networkInfo['Web→调度'] = `${network.web_to_scheduler_ms}ms`;
          if (network.scheduler_to_node_ms !== undefined) networkInfo['调度→节点'] = `${network.scheduler_to_node_ms}ms`;
          if (network.node_to_scheduler_ms !== undefined) networkInfo['节点→调度'] = `${network.node_to_scheduler_ms}ms`;
          if (message.scheduler_sent_at_ms) {
            const nowMs = Date.now();
            const schedulerToWebMs = nowMs - message.scheduler_sent_at_ms;
            if (schedulerToWebMs >= 0) {
              networkInfo['调度→Web'] = `${schedulerToWebMs}ms`;
            }
          } else if (network.scheduler_to_web_ms !== undefined) {
            networkInfo['调度→Web'] = `${network.scheduler_to_web_ms}ms`;
          }
          if (Object.keys(networkInfo).length > 0) {
            console.log('网络传输耗时:', networkInfo);
          }
        }
        console.log('===============');

        // 保存翻译结果到 Map（用于播放时同步显示）
        // 使用 utterance_index 作为 key，用于文本显示同步
        if (message.text_asr || message.text_translated) {
          this.translationResults.set(message.utterance_index, {
            originalText: message.text_asr,
            translatedText: message.text_translated,
            serviceTimings: message.service_timings,
            networkTimings: message.network_timings,
            schedulerSentAtMs: message.scheduler_sent_at_ms
          });
          console.log('[App] 翻译结果已保存到 Map，utterance_index:', message.utterance_index);

          // 立即显示翻译结果（确保所有文本都能显示，不依赖播放回调）
          // 如果已经显示过，跳过（避免重复）
          if (this.displayedUtteranceIndices.has(message.utterance_index)) {
            console.log('[App] 翻译结果已显示过，跳过重复显示，utterance_index:', message.utterance_index);
          } else {
            // 尝试显示文本，如果成功显示，才标记为已显示
            const displayed = this.displayTranslationResult(
              message.text_asr,
              message.text_translated,
              message.service_timings,
              message.network_timings,
              message.scheduler_sent_at_ms
            );
            // 只有成功显示（返回 true）才标记为已显示
            if (displayed) {
              this.displayedUtteranceIndices.add(message.utterance_index);
              console.log('[App] 翻译结果已立即显示，utterance_index:', message.utterance_index);
            } else {
              console.warn('[App] 翻译结果显示失败（可能被过滤），utterance_index:', message.utterance_index, {
                text_asr: message.text_asr?.substring(0, 50),
                text_translated: message.text_translated?.substring(0, 50)
              });
            }
          }
        }

        // 处理 TTS 音频（如果存在）
        // 注意：不再自动播放，而是累积到缓冲区，等待用户手动触发播放
        if (message.tts_audio && message.tts_audio.length > 0) {
          console.log('[App] 🎵 准备添加 TTS 音频到缓冲区:', {
            utterance_index: message.utterance_index,
            base64_length: message.tts_audio.length,
            is_in_room: this.isInRoom
          });

          if (this.isInRoom) {
            // 房间模式：使用音频混控器（房间模式可能需要不同的处理）
            console.log('[App] 🏠 房间模式：使用音频混控器');
            this.handleTtsAudioForRoomMode(message.tts_audio);
            // 触发 UI 更新，显示播放按钮和时长
            this.notifyTtsAudioAvailable();
          } else {
            // 单会话模式：累积到 TtsPlayer，不自动播放
            // 传递 utterance_index 和 tts_format 用于文本显示同步和格式解码
            console.log('[App] 🎧 单会话模式：添加到 TtsPlayer');
            const ttsFormat = message.tts_format || 'pcm16'; // 默认使用 pcm16
            this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index, ttsFormat).then(() => {
              console.log('[App] ✅ TTS 音频块已成功添加到缓冲区:', {
                utterance_index: message.utterance_index,
                buffer_size: this.ttsPlayer.hasPendingAudio() ? '有音频' : '无音频'
              });
              // 触发 UI 更新，显示播放按钮和时长
              this.notifyTtsAudioAvailable();
            }).catch((error) => {
              console.error('[App] ❌ 添加 TTS 音频块失败:', {
                utterance_index: message.utterance_index,
                error: error,
                error_message: error?.message,
                error_stack: error?.stack
              });
            });
          }
        } else {
          console.warn('[App] ⚠️ 翻译结果中没有 TTS 音频:', {
            utterance_index: message.utterance_index,
            has_tts_audio: !!message.tts_audio,
            tts_audio_length: message.tts_audio?.length || 0
          });
        }
        break;

      case 'tts_audio':
        // 如果会话已结束，丢弃 TTS 音频
        if (!this.isSessionActive) {
          console.log('[App] 会话已结束，丢弃 TTS 音频消息，payload长度:', message.payload?.length || 0);
          return;
        }
        console.log('收到单独的 TTS 音频消息，当前状态:', this.stateMachine.getState(), 'payload长度:', message.payload?.length || 0);
        // 注意：单独的 tts_audio 消息可能没有 utterance_index，使用 -1 作为占位符
        const ttsUtteranceIndex = (message as any).utterance_index ?? -1;
        const ttsFormat = (message as any).tts_format || 'pcm16'; // 默认使用 pcm16
        if (this.isInRoom) {
          // 房间模式：使用音频混控器
          this.handleTtsAudioForRoomMode(message.payload);
          // 触发 UI 更新，显示播放按钮和时长
          this.notifyTtsAudioAvailable();
        } else {
          // 单会话模式：累积到 TtsPlayer，不自动播放
          // 等待音频添加到缓冲区后再触发 UI 更新
          // 注意：单独的 tts_audio 消息可能没有 utterance_index，使用 -1 作为占位符
          this.ttsPlayer.addAudioChunk(message.payload, ttsUtteranceIndex, ttsFormat).then(() => {
            console.log('[App] TTS 音频块已添加到缓冲区（单独消息），utterance_index:', ttsUtteranceIndex, '触发 UI 更新');
            // 触发 UI 更新，显示播放按钮和时长
            this.notifyTtsAudioAvailable();
          }).catch((error) => {
            console.error('添加 TTS 音频块失败:', error);
          });
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
   * 播放索引变化回调（用于文本显示同步）
   * 当播放到某个音频段时，显示对应的文本
   */
  private onPlaybackIndexChange(utteranceIndex: number): void {
    console.log('[App] 播放索引变化，显示 utterance_index:', utteranceIndex);

    // 如果 utterance_index 为 -1，说明是单独的 tts_audio 消息，不显示文本
    if (utteranceIndex === -1) {
      console.log('[App] utterance_index 为 -1，跳过文本显示');
      return;
    }

    // 检查是否已经显示过（去重）
    if (this.displayedUtteranceIndices.has(utteranceIndex)) {
      console.log('[App] utterance_index 已显示过，跳过重复显示:', utteranceIndex);
      return;
    }

    // 从 Map 中获取对应的翻译结果
    const result = this.translationResults.get(utteranceIndex);
    if (result) {
      console.log('[App] 找到对应的翻译结果，显示文本，utterance_index:', utteranceIndex);
      const displayed = this.displayTranslationResult(
        result.originalText,
        result.translatedText,
        result.serviceTimings,
        result.networkTimings,
        result.schedulerSentAtMs
      );
      // 只有成功显示（返回 true）才标记为已显示
      if (displayed) {
        this.displayedUtteranceIndices.add(utteranceIndex);
        console.log('[App] 播放时文本已显示，utterance_index:', utteranceIndex);
      } else {
        console.warn('[App] 播放时文本显示失败（可能被过滤），utterance_index:', utteranceIndex);
      }
    } else {
      console.warn('[App] 未找到 utterance_index 对应的翻译结果:', utteranceIndex, {
        availableIndices: Array.from(this.translationResults.keys()).sort((a, b) => a - b),
        translationResultsSize: this.translationResults.size
      });
    }
  }

  /**
   * 内存压力处理
   */
  private onMemoryPressure(pressure: 'normal' | 'warning' | 'critical'): void {
    console.log(`[App] 内存压力: ${pressure}`);

    // 触发UI更新（内存压力变化）
    if (typeof window !== 'undefined' && (window as any).onMemoryPressure) {
      (window as any).onMemoryPressure(pressure);
    }

    // 如果内存压力过高，自动开始播放（打断用户发言）
    if (pressure === 'critical') {
      const currentState = this.stateMachine.getState();
      const hasPendingAudio = this.ttsPlayer.hasPendingAudio();

      // 只有在输入状态且有待播放音频时才自动播放
      if (currentState === SessionState.INPUT_RECORDING && hasPendingAudio && !this.ttsPlayer.getIsPlaying()) {
        console.warn('[App] 内存压力过高，自动开始播放以释放内存');
        this.startTtsPlayback().catch((error) => {
          console.error('[App] 自动播放失败:', error);
        });
      }
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
   * 通知 UI TTS 音频可用（累积中）
   */
  private notifyTtsAudioAvailable(): void {
    const duration = this.ttsPlayer.getTotalDuration();
    const hasPendingAudio = this.ttsPlayer.hasPendingAudio();
    console.log('[App] TTS 音频可用，总时长:', duration.toFixed(2), '秒', 'hasPendingAudio:', hasPendingAudio);

    // 触发 UI 更新（如果存在回调）
    if (typeof window !== 'undefined' && (window as any).onTtsAudioAvailable) {
      (window as any).onTtsAudioAvailable(duration);
    }

    // 如果当前在 INPUT_RECORDING 状态，需要更新播放按钮文本（显示时长）
    const currentState = this.stateMachine.getState();
    if (currentState === SessionState.INPUT_RECORDING) {
      // 触发 UI 更新（不改变状态）
      // 这会触发状态变化回调，让 UI 重新检查 hasPendingAudio 并更新播放按钮
      console.log('[App] 触发 UI 更新（不改变状态），当前状态:', currentState, 'hasPendingAudio:', hasPendingAudio);
      this.stateMachine.notifyUIUpdate();
    } else {
      console.log('[App] 当前状态不是 INPUT_RECORDING，不触发 UI 更新。当前状态:', currentState);
    }
  }

  /**
   * 手动开始播放 TTS（用户点击播放按钮）
   */
  async startTtsPlayback(): Promise<void> {
    if (!this.ttsPlayer.hasPendingAudio()) {
      console.warn('没有待播放的音频');
      return;
    }

    console.log('用户手动触发播放，当前状态:', this.stateMachine.getState());

    // 在开始播放时，显示待显示的翻译结果
    this.displayPendingTranslationResults();

    await this.ttsPlayer.startPlayback();
  }

  /**
   * 暂停播放 TTS（用户点击暂停按钮）
   */
  pauseTtsPlayback(): void {
    if (this.ttsPlayer.getIsPlaying()) {
      console.log('用户手动暂停播放');
      this.ttsPlayer.pausePlayback();

      // 如果会话进行中，恢复录音
      if (this.isSessionActive && this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
        if (!this.recorder.getIsRecording()) {
          this.recorder.start().catch((error) => {
            console.error('恢复录音失败:', error);
          });
        }
      }
    }
  }

  /**
   * 获取 TTS 音频总时长（秒）
   */
  getTtsAudioDuration(): number {
    return this.ttsPlayer.getTotalDuration();
  }

  /**
   * 检查是否有待播放的 TTS 音频
   */
  hasPendingTtsAudio(): boolean {
    return this.ttsPlayer.hasPendingAudio();
  }

  /**
   * 检查 TTS 是否正在播放
   */
  isTtsPlaying(): boolean {
    return this.ttsPlayer.getIsPlaying();
  }

  /**
   * 获取当前内存压力状态
   */
  getMemoryPressure(): 'normal' | 'warning' | 'critical' {
    return this.ttsPlayer.getMemoryPressure();
  }

  /**
   * 检查 TTS 是否已暂停
   */
  isTtsPaused(): boolean {
    return this.ttsPlayer.getIsPaused();
  }

  /**
   * 切换 TTS 播放倍速
   */
  toggleTtsPlaybackRate(): number {
    return this.ttsPlayer.togglePlaybackRate();
  }

  /**
   * 获取当前 TTS 播放倍速
   */
  getTtsPlaybackRate(): number {
    return this.ttsPlayer.getPlaybackRate();
  }

  /**
   * 获取当前 TTS 播放倍速的显示文本
   */
  getTtsPlaybackRateText(): string {
    return this.ttsPlayer.getPlaybackRateText();
  }

  /**
   * 显示翻译结果到 UI（追加方式，不替换已有内容）
   * @param originalText 原文（ASR）
   * @param translatedText 译文（NMT）
   * @param serviceTimings 服务耗时信息
   * @param networkTimings 网络传输耗时信息
   * @param schedulerSentAtMs 调度服务器发送结果到Web端的时间戳（毫秒，UTC时区）
   */
  private displayTranslationResult(
    originalText: string,
    translatedText: string,
    _serviceTimings?: { asr_ms?: number; nmt_ms?: number; tts_ms?: number; total_ms?: number },
    _networkTimings?: { web_to_scheduler_ms?: number; scheduler_to_node_ms?: number; node_to_scheduler_ms?: number; scheduler_to_web_ms?: number },
    _schedulerSentAtMs?: number
  ): boolean {
    // 如果原文和译文都为空，不显示
    if ((!originalText || originalText.trim() === '') && (!translatedText || translatedText.trim() === '')) {
      console.log('[App] displayTranslationResult: 文本为空，跳过显示');
      return false;
    }

    // 查找或创建翻译结果显示容器
    let resultContainer = document.getElementById('translation-result-container');
    if (!resultContainer) {
      resultContainer = document.createElement('div');
      resultContainer.id = 'translation-result-container';
      resultContainer.style.cssText = `
        margin: 20px 0;
        padding: 15px;
        background: #f0f8ff;
        border-radius: 8px;
        border: 1px solid #b0d4f1;
      `;

      // 插入到 ASR 字幕容器之后
      const asrContainer = document.getElementById('asr-subtitle-container');
      if (asrContainer && asrContainer.parentElement) {
        asrContainer.parentElement.insertBefore(resultContainer, asrContainer.nextSibling);
      } else {
        // 如果找不到 ASR 容器，添加到 app 容器
        const appContainer = document.getElementById('app');
        if (appContainer) {
          appContainer.appendChild(resultContainer);
        }
      }

      // 创建标题和文本框结构
      resultContainer.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 12px; color: #0066cc; font-size: 16px;">翻译结果：</div>
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 6px; font-size: 14px;">原文 (ASR):</div>
          <div id="translation-original" style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #ddd; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 6px; font-size: 14px;">译文 (NMT):</div>
          <div id="translation-translated" style="padding: 12px; background: #f0f8ff; border-radius: 6px; border: 1px solid #b0d4f1; color: #0066cc; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
      `;
    }

    // 显示容器
    resultContainer.style.display = 'block';

    // 获取原文和译文文本框
    const originalDiv = document.getElementById('translation-original');
    const translatedDiv = document.getElementById('translation-translated');

    if (!originalDiv || !translatedDiv) {
      console.error('无法找到翻译结果文本框');
      return false;
    }

    // 获取当前文本内容
    const currentOriginal = originalDiv.textContent || '';
    const currentTranslated = translatedDiv.textContent || '';

    // 检查是否重复（避免重复追加相同的文本）
    // 使用更严格的检查：检查文本是否作为完整段落存在（以换行分隔或开头/结尾）
    const originalTrimmed = originalText?.trim() || '';
    const translatedTrimmed = translatedText?.trim() || '';

    // 检查原文是否已经作为完整段落存在于当前文本中
    // 检查方式：文本在开头、结尾，或者被 \n\n 包围
    const originalPattern = originalTrimmed ? new RegExp(`(^|\\n\\n)${originalTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n\\n|$)`, 'm') : null;
    const translatedPattern = translatedTrimmed ? new RegExp(`(^|\\n\\n)${translatedTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n\\n|$)`, 'm') : null;

    const originalAlreadyExists = originalPattern ? originalPattern.test(currentOriginal) : false;
    const translatedAlreadyExists = translatedPattern ? translatedPattern.test(currentTranslated) : false;

    // 如果原文和译文都已存在，跳过追加（避免重复）
    if (originalAlreadyExists && translatedAlreadyExists) {
      console.log('[App] 文本已存在（完整段落匹配），跳过重复追加:', {
        utterance_index: 'N/A',
        originalText: originalText?.substring(0, 50),
        translatedText: translatedText?.substring(0, 50),
        currentOriginalLength: currentOriginal.length,
        currentTranslatedLength: currentTranslated.length
      });
      return false; // 返回 false 表示未成功显示
    }

    // 追加新文本（如果当前有内容，先添加换行和分隔符）
    let newOriginal = currentOriginal;
    let newTranslated = currentTranslated;

    if (originalText && originalText.trim() !== '' && !originalAlreadyExists) {
      if (newOriginal) {
        newOriginal += '\n\n' + originalText;
      } else {
        newOriginal = originalText;
      }
    }

    if (translatedText && translatedText.trim() !== '' && !translatedAlreadyExists) {
      if (newTranslated) {
        newTranslated += '\n\n' + translatedText;
      } else {
        newTranslated = translatedText;
      }
    }

    // 更新文本框内容
    originalDiv.textContent = newOriginal;
    translatedDiv.textContent = newTranslated;

    // 自动滚动到底部，显示最新内容
    originalDiv.scrollTop = originalDiv.scrollHeight;
    translatedDiv.scrollTop = translatedDiv.scrollHeight;

    // 返回 true 表示成功显示
    return true;
  }

  /**
   * 显示待显示的翻译结果（在开始播放时调用）
   * 注意：这个方法现在主要用于兼容性，实际文本显示通过 onPlaybackIndexChange 回调进行
   */
  private displayPendingTranslationResults(): void {
    // 显示所有待显示的翻译结果（从 pendingTranslationResults 数组）
    for (const result of this.pendingTranslationResults) {
      this.displayTranslationResult(
        result.originalText,
        result.translatedText,
        result.serviceTimings,
        result.networkTimings,
        result.schedulerSentAtMs
      );
    }
    // 更新已显示的数量
    this.displayedTranslationCount += this.pendingTranslationResults.length;
    // 清空待显示队列（已显示的结果不再需要保留）
    this.pendingTranslationResults = [];

    // 同时显示所有已保存但未显示的翻译结果（从 translationResults Map）
    // 按 utterance_index 排序，确保按顺序显示
    const sortedIndices = Array.from(this.translationResults.keys()).sort((a, b) => a - b);
    let displayedCount = 0;
    for (const utteranceIndex of sortedIndices) {
      // 如果已经显示过，跳过
      if (this.displayedUtteranceIndices.has(utteranceIndex)) {
        continue;
      }
      const result = this.translationResults.get(utteranceIndex);
      if (result) {
        this.displayTranslationResult(
          result.originalText,
          result.translatedText,
          result.serviceTimings,
          result.networkTimings,
          result.schedulerSentAtMs
        );
        this.displayedUtteranceIndices.add(utteranceIndex);
        displayedCount++;
      }
    }

    console.log('[App] 已显示所有待显示的翻译结果，已显示总数:', this.displayedTranslationCount, '本次新增:', displayedCount);
  }

  /**
   * 清空已显示的翻译结果文本
   */
  private clearDisplayedTranslationResults(): void {
    const originalDiv = document.getElementById('translation-original');
    const translatedDiv = document.getElementById('translation-translated');

    if (originalDiv) {
      originalDiv.textContent = '';
    }
    if (translatedDiv) {
      translatedDiv.textContent = '';
    }

    // 隐藏翻译结果容器
    const resultContainer = document.getElementById('translation-result-container');
    if (resultContainer) {
      resultContainer.style.display = 'none';
    }

    console.log('[App] 已清空显示的翻译结果');
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
    try {
      // 保存语言配置
      this.currentSrcLang = srcLang;
      this.currentTgtLang = tgtLang;
      // 重置 utterance 索引
      this.currentUtteranceIndex = 0;
      await this.wsClient.connect(srcLang, tgtLang, features);
      await this.recorder.initialize();
      // 记录连接成功
      if (this.observability) {
        this.observability.recordConnectionSuccess();
      }
    } catch (error) {
      // 记录连接失败
      if (this.observability) {
        this.observability.recordConnectionFailure();
      }
      throw error;
    }
  }

  /**
   * 连接服务器（双向模式）
   * @param langA 语言 A
   * @param langB 语言 B
   * @param features 可选功能标志（由用户选择）
   */
  async connectTwoWay(langA: string = 'zh', langB: string = 'en', features?: FeatureFlags): Promise<void> {
    try {
      await this.wsClient.connectTwoWay(langA, langB, features);
      await this.recorder.initialize();
      // 记录连接成功
      if (this.observability) {
        this.observability.recordConnectionSuccess();
      }
    } catch (error) {
      // 记录连接失败
      if (this.observability) {
        this.observability.recordConnectionFailure();
      }
      throw error;
    }
  }

  /**
   * 开始整个会话（持续输入+输出模式）
   */
  async startSession(): Promise<void> {
    const currentState = this.stateMachine.getState();
    console.log('[App] startSession 被调用，当前状态:', currentState);

    if (currentState === SessionState.INPUT_READY) {
      console.log('[App] 状态为 INPUT_READY，开始会话');
      this.isSessionActive = true;
      this.audioBuffer = [];
      this.asrSubtitle.clear();
      // 清空当前的 trace_id 和 group_id（新的会话）
      this.currentTraceId = null;
      this.currentGroupId = null;
      // 重置 utterance 索引
      this.currentUtteranceIndex = 0;

      // 清空所有未播放的音频（新会话开始时丢弃之前的音频）
      this.ttsPlayer.clearBuffers();

      // 重置翻译结果计数器
      this.translationResultCount = 0;

      // 清空翻译结果 Map 和待显示的翻译结果队列
      this.translationResults.clear();
      this.displayedUtteranceIndices.clear();
      this.pendingTranslationResults = [];
      this.displayedTranslationCount = 0;

      // 清空翻译结果显示（但保留容器结构）
      this.clearDisplayedTranslationResults();
      const originalDiv = document.getElementById('translation-original');
      const translatedDiv = document.getElementById('translation-translated');
      if (originalDiv) {
        originalDiv.textContent = '';
      }
      if (translatedDiv) {
        translatedDiv.textContent = '';
      }

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

    // 停止播放并清空所有未播放的音频
    this.ttsPlayer.stop();
    this.ttsPlayer.clearBuffers(); // 确保清空缓冲区

    // 清空音频缓冲区
    this.audioBuffer = [];

    // 清空 WebSocket 发送队列（丢弃所有未发送的音频数据）
    this.wsClient.clearSendQueue();

    // 清空翻译结果 Map 和待显示的翻译结果队列
    this.translationResults.clear();
    this.pendingTranslationResults = [];
    this.displayedTranslationCount = 0;

    // 清空已显示的翻译结果文本
    this.clearDisplayedTranslationResults();

    // 结束会话（状态机会回到 INPUT_READY）
    this.stateMachine.endSession();
  }

  /**
   * 发送当前说的话（控制说话节奏）
   * 发送后继续监听（保持在 INPUT_RECORDING 状态）
   * 使用 Utterance 消息，支持 opus 编码
   */
  async sendCurrentUtterance(): Promise<void> {
    const currentState = this.stateMachine.getState();
    console.log('sendCurrentUtterance 被调用，当前状态:', currentState, '会话是否活跃:', this.isSessionActive);

    // 允许在 INPUT_RECORDING 状态下随时发送（只要会话活跃）
    if (this.isSessionActive && currentState === SessionState.INPUT_RECORDING) {
      // 发送剩余的音频数据
      if (this.audioBuffer.length > 0) {
        const audioData = this.concatAudioBuffers(this.audioBuffer);
        console.log('发送音频数据，长度:', audioData.length, 'samples');
        this.audioBuffer = []; // 清空缓冲区，准备下一句话

        // 使用 Utterance 消息发送（opus 编码）
        await this.wsClient.sendUtterance(
          audioData,
          this.currentUtteranceIndex,
          this.currentSrcLang,
          this.currentTgtLang,
          this.currentTraceId || undefined
        );
        // 递增 utterance 索引
        this.currentUtteranceIndex++;
        console.log('已发送 Utterance 消息（opus 编码），utterance_index:', this.currentUtteranceIndex - 1);
      } else {
        console.log('音频缓冲区为空，跳过发送');
      }

      // 修复：用户手动点击发送按钮时，立即触发 finalize
      // 发送 is_final=true 的 audio_chunk 消息，确保调度服务器立即 finalize 当前正在累积的 audio_chunk
      this.wsClient.sendFinal();
      console.log('已发送 is_final=true，触发调度服务器立即 finalize');

      // 注意：不再切换状态，保持在 INPUT_RECORDING，允许持续输入
      // 录音继续，用户可以继续说话
      console.log('已发送当前话语，继续监听...');
    } else {
      console.warn('当前状态不允许发送:', {
        state: currentState,
        isSessionActive: this.isSessionActive,
        expectedState: SessionState.INPUT_RECORDING
      });
    }
  }

  /**
   * 更新静音过滤配置
   */
  updateSilenceFilterConfig(config: Partial<import('./types').SilenceFilterConfig>): void {
    this.recorder.updateSilenceFilterConfig(config);
  }

  /**
   * 获取静音过滤配置
   */
  getSilenceFilterConfig(): import('./types').SilenceFilterConfig {
    return this.recorder.getSilenceFilterConfig();
  }

  /**
   * 获取背压状态
   */
  getBackpressureState(): import('./websocket_client').BackpressureState {
    return this.wsClient.getBackpressureState();
  }

  /**
   * 获取重连次数
   */
  getReconnectAttempts(): number {
    return this.wsClient.getReconnectAttempts();
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

    // 停止播放并清空所有未播放的音频
    this.ttsPlayer.stop();
    this.ttsPlayer.clearBuffers(); // 确保清空缓冲区

    // 销毁可观测性管理器
    if (this.observability) {
      this.observability.destroy();
      this.observability = null;
    }
  }

  /**
   * 获取可观测性指标
   */
  getObservabilityMetrics(): Readonly<import('./observability').ObservabilityMetrics> | null {
    return this.observability ? this.observability.getMetrics() : null;
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
   * 检查 WebSocket 是否已连接
   */
  isConnected(): boolean {
    const connected = this.wsClient.isConnected();
    console.log('[App] isConnected() 调用:', connected);
    return connected;
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
  private async ensurePeerConnection(_roomCode: string, targetSessionId: string): Promise<void> {
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
  private async handleWebRTCOffer(_roomCode: string, fromSessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
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

