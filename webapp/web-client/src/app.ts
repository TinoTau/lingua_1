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
import { TranslationDisplayManager } from './app/translation_display';
import { SessionManager } from './app/session_manager';
import { RoomManager } from './app/room_manager';
import { WebRTCManager } from './app/webrtc_manager';

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
  // 注意：audioBuffer 已移至 SessionManager
  // 当前 utterance 的 trace_id 和 group_id（用于 TTS_PLAY_ENDED）
  private currentTraceId: string | null = null;
  private currentGroupId: string | null = null;
  // 音频混控器输出流（用于播放）
  private audioMixerOutput: HTMLAudioElement | null = null;
  // 可观测性管理器
  private observability: ObservabilityManager | null = null;
  
  // 新模块
  private translationDisplay: TranslationDisplayManager;
  private sessionManager: SessionManager;
  private roomManager: RoomManager;
  private webrtcManager: WebRTCManager;

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

    // 初始化新模块
    this.translationDisplay = new TranslationDisplayManager();
    this.roomManager = new RoomManager(this.wsClient, this.audioMixer);
    this.webrtcManager = new WebRTCManager(this.wsClient, this.audioMixer);
    this.sessionManager = new SessionManager(
      this.stateMachine,
      this.recorder,
      this.wsClient,
      this.ttsPlayer,
      this.asrSubtitle,
      this.translationDisplay
    );

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

    // 录音回调 - 委托给 SessionManager 处理
    this.recorder.setAudioFrameCallback((audioData) => {
      this.sessionManager.onAudioFrame(audioData);
    });

    this.recorder.setSilenceDetectedCallback(() => {
      this.sessionManager.onSilenceDetected();
    });

    // WebSocket 回调
    this.wsClient.setMessageCallback((message) => {
      console.log(`[App] 🔔 收到消息回调:`, {
        type: message.type,
        session_id: (message as any).session_id,
      });
      this.onServerMessage(message).catch((error) => {
        console.error('[App] ❌ 处理服务器消息时出错:', error, {
          message_type: message.type,
        });
      });
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
      if (this.sessionManager.getIsSessionActive()) {
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
      if (this.sessionManager.getIsSessionActive()) {
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
      if (this.sessionManager.getIsSessionActive()) {
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
  // 注意：音频帧处理和静音检测已移至 SessionManager
  // 回调已直接委托给 SessionManager，这里不再需要处理

  /**
   * 服务器消息处理
   */
  private async onServerMessage(message: ServerMessage): Promise<void> {
    console.log(`[App] 🔄 开始处理服务器消息:`, {
      type: message.type,
      session_id: (message as any).session_id,
    });
    
    switch (message.type) {
      case 'asr_partial':
        // 如果会话已结束，丢弃 ASR 部分结果
        if (!this.sessionManager.getIsSessionActive()) {
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
        if (!this.sessionManager.getIsSessionActive()) {
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

      case 'error':
        // 处理服务器错误消息
        const errorMsg = message as import('./types').ErrorMessage;
        const errorTraceId = (errorMsg as any).trace_id;
        console.error('[App] ❌ 收到服务器错误消息:', {
          code: errorMsg.code,
          message: errorMsg.message,
          details: errorMsg.details,
          trace_id: errorTraceId,
        });
        
        // 检查是否已经有对应的翻译结果（通过 trace_id 匹配）
        // 如果已经有结果，说明错误可能是后续处理失败，不应该弹窗打断用户
        const hasResultForTrace = errorTraceId && this.currentTraceId === errorTraceId;
        
        // 检查是否已经有其他翻译结果（通过检查 translationResults Map）
        const hasOtherResults = this.translationDisplay.getTranslationResult(0) !== undefined || 
                                this.translationDisplay.getTranslationResult(1) !== undefined;
        
        if (hasResultForTrace) {
          // 已经有对应结果，只记录日志，不弹窗
          console.warn('[App] ⚠️ 收到错误消息，但已有对应的翻译结果，不弹窗:', {
            trace_id: errorTraceId,
            error_code: errorMsg.code,
            error_message: errorMsg.message,
          });
        } else if (errorMsg.code === 'PROCESSING_ERROR' && hasOtherResults) {
          // PROCESSING_ERROR 且已有其他结果，可能是某个job失败，但不影响整体流程
          console.warn('[App] ⚠️ 收到 PROCESSING_ERROR，但已有其他翻译结果，不弹窗:', {
            trace_id: errorTraceId,
            error_message: errorMsg.message,
          });
        } else {
          // 没有对应结果，可能是关键错误，需要通知用户
          // 但对于某些非关键错误，也可以选择不弹窗
          const isNonCriticalError = errorMsg.code === 'PROCESSING_ERROR' || 
                                     errorMsg.code === 'NMT_TIMEOUT' || 
                                     errorMsg.code === 'TTS_TIMEOUT';
          
          if (isNonCriticalError && hasOtherResults) {
            // 非关键错误且已有结果，只记录日志
            console.warn('[App] ⚠️ 收到非关键错误，但已有其他翻译结果，不弹窗:', {
              trace_id: errorTraceId,
              error_code: errorMsg.code,
              error_message: errorMsg.message,
            });
          } else {
            // 显示错误提示给用户
            alert(`服务器错误: ${errorMsg.message || errorMsg.code || 'Unknown error'}`);
          }
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
          tts_audio_preview: message.tts_audio ? message.tts_audio.substring(0, 50) + '...' : 'null',
          is_session_active: this.sessionManager.getIsSessionActive(),
          current_state: this.stateMachine.getState(),
          trace_id: message.trace_id,
          job_id: message.job_id
        });

        // 如果会话已结束，丢弃翻译结果
        if (!this.sessionManager.getIsSessionActive()) {
          console.warn('[App] ⚠️ 会话已结束，丢弃翻译结果（包括TTS音频）:', {
            utterance_index: message.utterance_index,
            text_asr: message.text_asr,
            text_translated: message.text_translated,
            has_tts_audio: !!message.tts_audio,
            tts_audio_length: message.tts_audio?.length || 0,
            trace_id: message.trace_id,
            job_id: message.job_id
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
          this.translationDisplay.saveTranslationResult(message.utterance_index, {
            originalText: message.text_asr,
            translatedText: message.text_translated,
            serviceTimings: message.service_timings,
            networkTimings: message.network_timings,
            schedulerSentAtMs: message.scheduler_sent_at_ms
          });
          console.log('[App] 翻译结果已保存到 Map，utterance_index:', message.utterance_index);

          // 立即显示翻译结果（确保所有文本都能显示，不依赖播放回调）
          // 如果已经显示过，跳过（避免重复）
          if (this.translationDisplay.isDisplayed(message.utterance_index)) {
            console.log('[App] 翻译结果已显示过，跳过重复显示，utterance_index:', message.utterance_index);
          } else {
            // 尝试显示文本，如果成功显示，才标记为已显示
            const displayed = this.translationDisplay.displayTranslationResult(
              message.text_asr,
              message.text_translated,
              message.service_timings,
              message.network_timings,
              message.scheduler_sent_at_ms
            );
            // 只有成功显示（返回 true）才标记为已显示
            if (displayed) {
              this.translationDisplay.markAsDisplayed(message.utterance_index);
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
        console.log('[App] 🔍 检查 TTS 音频:', {
          utterance_index: message.utterance_index,
          has_tts_audio: !!message.tts_audio,
          tts_audio_length: message.tts_audio?.length || 0,
          tts_audio_type: typeof message.tts_audio,
          tts_audio_is_string: typeof message.tts_audio === 'string',
          tts_format: message.tts_format
        });
        
        if (message.tts_audio && message.tts_audio.length > 0) {
          console.log('[App] 🎵 准备添加 TTS 音频到缓冲区:', {
            utterance_index: message.utterance_index,
            base64_length: message.tts_audio.length,
            is_in_room: this.roomManager.getIsInRoom(),
            is_session_active: this.sessionManager.getIsSessionActive(),
            buffer_count_before: this.ttsPlayer.getBufferCount(),
            current_state: this.stateMachine.getState()
          });

          // 再次检查会话状态（防止在异步操作期间会话被结束）
          if (!this.sessionManager.getIsSessionActive()) {
            console.warn('[App] ⚠️ 会话已结束，丢弃 TTS 音频（在添加到缓冲区之前）:', {
              utterance_index: message.utterance_index,
              base64_length: message.tts_audio.length
            });
            return;
          }

          if (this.roomManager.getIsInRoom()) {
            // 房间模式：使用音频混控器（房间模式可能需要不同的处理）
            console.log('[App] 🏠 房间模式：使用音频混控器');
            this.handleTtsAudioForRoomMode(message.tts_audio);
            // 触发 UI 更新，显示播放按钮和时长
            this.notifyTtsAudioAvailable();
          } else {
            // 单会话模式：累积到 TtsPlayer
            // 传递 utterance_index 和 tts_format 用于文本显示同步和格式解码
            console.log('[App] 🎧 单会话模式：添加到 TtsPlayer');
            const ttsFormat = message.tts_format || 'pcm16'; // 默认使用 pcm16
            
            // 估算音频时长（PCM16格式）
            // base64解码后的字节数 ≈ base64长度 * 3/4
            // PCM16: 每个样本2字节，sampleRate=16000，所以时长 = 字节数 / (sampleRate * 2)
            const sampleRate = 16000; // TTS播放器的采样率
            const estimatedDurationSeconds = (message.tts_audio.length * 3 / 4) / (sampleRate * 2);
            const maxBufferDuration = this.ttsPlayer.getMaxBufferDuration();
            const currentDuration = this.ttsPlayer.getTotalDuration() || 0; // 防御性检查
            const willExceedLimit = (currentDuration + estimatedDurationSeconds) > maxBufferDuration;
            
            // 如果添加大音频会导致超过缓存限制，在添加之前触发自动播放
            // 注意：即使没有pending audio，也应该触发播放，以便为新音频腾出空间
            if (willExceedLimit && !this.ttsPlayer.getIsPlaying()) {
              const currentState = this.stateMachine.getState();
              const hasPendingAudio = this.ttsPlayer.hasPendingAudio();
              
              // 如果当前有音频或即将添加的音频会导致超过限制，触发自动播放
              if (currentState === SessionState.INPUT_RECORDING && (hasPendingAudio || currentDuration > 0)) {
                console.warn('[App] ⚠️ 检测到大音频，在添加前触发自动播放以释放缓存空间:', {
                  utterance_index: message.utterance_index,
                  estimated_duration: (estimatedDurationSeconds || 0).toFixed(2) + '秒',
                  current_duration: (currentDuration || 0).toFixed(2) + '秒',
                  max_duration: (maxBufferDuration || 0) + '秒',
                  has_pending_audio: hasPendingAudio
                });
                this.startTtsPlayback().catch((error) => {
                  console.error('[App] 自动播放失败:', error);
                });
              }
            }
            
            this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index, ttsFormat).then(() => {
              // 再次检查会话状态（防止在异步操作期间会话被结束）
              if (!this.sessionManager.getIsSessionActive()) {
                console.warn('[App] ⚠️ 会话已结束，但音频已添加到缓冲区:', {
                  utterance_index: message.utterance_index,
                  buffer_count: this.ttsPlayer.getBufferCount()
                });
                // 注意：不清空缓冲区，因为可能还有其他音频需要播放
                return;
              }
              
              const bufferCount = this.ttsPlayer.getBufferCount();
              const hasPendingAudio = this.ttsPlayer.hasPendingAudio();
              const totalDuration = this.ttsPlayer.getTotalDuration() || 0; // 防御性检查
              
              console.log('[App] ✅ TTS 音频块已成功添加到缓冲区:', {
                utterance_index: message.utterance_index,
                buffer_size: hasPendingAudio ? '有音频' : '无音频',
                buffer_count: bufferCount,
                total_duration: (totalDuration || 0).toFixed(2) + '秒',
                is_playing: this.ttsPlayer.getIsPlaying(),
                current_state: this.stateMachine.getState(),
                memory_pressure: this.ttsPlayer.getMemoryPressure()
              });
              
              // 检查音频是否被丢弃（buffer_count为0或hasPendingAudio为false）
              if (!hasPendingAudio || bufferCount === 0) {
                console.warn('[App] ⚠️ 音频被缓存清理丢弃，显示文本并标记[播放失败]:', {
                  utterance_index: message.utterance_index,
                  buffer_count: bufferCount,
                  total_duration: (totalDuration || 0).toFixed(2) + '秒'
                });
                
                // 即使音频被丢弃，也显示文本并标记[播放失败]
                if (message.text_asr || message.text_translated) {
                  const failedOriginalText = message.text_asr ? `[播放失败] ${message.text_asr}` : '';
                  const failedTranslatedText = message.text_translated ? `[播放失败] ${message.text_translated}` : '';
                  
                  // 保存翻译结果（标记为失败）
                  this.translationDisplay.saveTranslationResult(message.utterance_index, {
                    originalText: failedOriginalText,
                    translatedText: failedTranslatedText,
                    serviceTimings: message.service_timings,
                    networkTimings: message.network_timings,
                    schedulerSentAtMs: message.scheduler_sent_at_ms
                  });
                  
                  // 显示翻译结果（带[播放失败]标记）
                  if (!this.translationDisplay.isDisplayed(message.utterance_index)) {
                    const displayed = this.translationDisplay.displayTranslationResult(
                      failedOriginalText,
                      failedTranslatedText,
                      message.service_timings,
                      message.network_timings,
                      message.scheduler_sent_at_ms
                    );
                    if (displayed) {
                      this.translationDisplay.markAsDisplayed(message.utterance_index);
                      console.log('[App] 翻译结果已显示（带[播放失败]标记），utterance_index:', message.utterance_index);
                    }
                  }
                }
              } else {
                // 音频成功添加，正常处理
                const currentState = this.stateMachine.getState();
                const isFirstAudio = message.utterance_index === 0;
                const bufferCount = this.ttsPlayer.getBufferCount();
                
                // 如果是第一段音频（utterance_index === 0）且当前状态为 INPUT_RECORDING，自动播放
                if (isFirstAudio && currentState === SessionState.INPUT_RECORDING && bufferCount === 1) {
                  console.log('[App] 🎵 第一段音频已添加，自动开始播放');
                  // 延迟一小段时间，确保UI已更新
                  setTimeout(() => {
                    this.startTtsPlayback().catch((error) => {
                      console.error('[App] 第一段音频自动播放失败:', error);
                    });
                  }, 100);
                } else {
                  // 不自动播放，等待用户手动触发或内存压力过高时自动播放
                  // 注意：自动播放只在内存压力 >= 80% (critical) 时触发（见 onMemoryPressure 方法）
                  console.log('[App] ⏸️ 音频已添加到缓冲区，等待用户手动播放或内存压力过高时自动播放');
                }
                
                // 触发 UI 更新，显示播放按钮和时长
                this.notifyTtsAudioAvailable();
                
                // 注意：如果文本已经显示（在440-474行），这里不会再次显示
                // 如果后续播放失败，会在播放失败的回调中处理
              }
            }).catch((error) => {
              console.error('[App] ❌ 添加 TTS 音频块失败:', {
                utterance_index: message.utterance_index,
                error: error,
                error_message: error?.message,
                error_stack: error?.stack,
                base64_length: message.tts_audio.length,
                tts_format: message.tts_format
              });
              
              // 即使添加失败，也显示文本并标记[播放失败]
              if (message.text_asr || message.text_translated) {
                const failedOriginalText = message.text_asr ? `[播放失败] ${message.text_asr}` : '';
                const failedTranslatedText = message.text_translated ? `[播放失败] ${message.text_translated}` : '';
                
                // 保存翻译结果（标记为失败）
                this.translationDisplay.saveTranslationResult(message.utterance_index, {
                  originalText: failedOriginalText,
                  translatedText: failedTranslatedText,
                  serviceTimings: message.service_timings,
                  networkTimings: message.network_timings,
                  schedulerSentAtMs: message.scheduler_sent_at_ms
                });
                
                // 显示翻译结果（带[播放失败]标记）
                if (!this.translationDisplay.isDisplayed(message.utterance_index)) {
                  const displayed = this.translationDisplay.displayTranslationResult(
                    failedOriginalText,
                    failedTranslatedText,
                    message.service_timings,
                    message.network_timings,
                    message.scheduler_sent_at_ms
                  );
                  if (displayed) {
                    this.translationDisplay.markAsDisplayed(message.utterance_index);
                    console.log('[App] 翻译结果已显示（带[播放失败]标记），utterance_index:', message.utterance_index);
                  }
                }
              }
            });
          }
        } else {
          console.warn('[App] ⚠️ 翻译结果中没有 TTS 音频:', {
            utterance_index: message.utterance_index,
            has_tts_audio: !!message.tts_audio,
            tts_audio_length: message.tts_audio?.length || 0,
            trace_id: message.trace_id,
            job_id: message.job_id
          });
        }
        break;

      case 'tts_audio':
        // 如果会话已结束，丢弃 TTS 音频
        if (!this.sessionManager.getIsSessionActive()) {
          console.log('[App] 会话已结束，丢弃 TTS 音频消息，payload长度:', message.payload?.length || 0);
          return;
        }
        console.log('收到单独的 TTS 音频消息，当前状态:', this.stateMachine.getState(), 'payload长度:', message.payload?.length || 0);
        // 注意：单独的 tts_audio 消息可能没有 utterance_index，使用 -1 作为占位符
        const ttsUtteranceIndex = (message as any).utterance_index ?? -1;
        const ttsFormat = (message as any).tts_format || 'pcm16'; // 默认使用 pcm16
        if (this.roomManager.getIsInRoom()) {
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
        this.roomManager.setRoomCode(message.room_code);
        this.webrtcManager.setRoomInfo(message.room_code, []);
        console.log('Room created:', message.room_code);
        // 触发 UI 更新（如果当前在房间模式界面）
        if (typeof window !== 'undefined' && (window as any).onRoomCreated) {
          (window as any).onRoomCreated(message.room_code);
        }
        break;

      case 'room_members':
        // 更新成员列表
        if (message.room_code === this.roomManager.getCurrentRoomCode()) {
          this.roomManager.updateMembers(message.members);
          this.webrtcManager.setRoomInfo(message.room_code, message.members);
          console.log('Room members updated:', message.members);

          // 同步 WebRTC 连接状态
          this.webrtcManager.syncPeerConnections();

          // 触发 UI 更新
          if (typeof window !== 'undefined' && (window as any).onRoomMembersUpdated) {
            (window as any).onRoomMembersUpdated(message.members);
          }
        }
        break;

      case 'webrtc_offer':
        // 处理 WebRTC offer
        await this.webrtcManager.handleWebRTCOffer(message.room_code, message.to, message.sdp);
        break;

      case 'webrtc_answer':
        // 处理 WebRTC answer
        await this.webrtcManager.handleWebRTCAnswer(message.to, message.sdp);
        break;

      case 'webrtc_ice':
        // 处理 WebRTC ICE candidate
        await this.webrtcManager.handleWebRTCIce(message.to, message.candidate);
        break;

      case 'room_error':
        console.error('Room error:', message.code, message.message);
        // 可以触发 UI 错误提示
        break;

      case 'room_expired':
        // 房间过期，退出房间
        if (message.room_code === this.roomManager.getCurrentRoomCode()) {
          console.log('Room expired:', message.message);
          alert('房间已过期: ' + message.message);
          this.leaveRoom();
          // 触发 UI 更新
          if (typeof window !== 'undefined' && (window as any).onRoomExpired) {
            (window as any).onRoomExpired();
          }
        }
        break;

      default:
        // 捕获未处理的消息类型
        console.warn(`[App] ⚠️ 收到未处理的消息类型:`, {
          type: (message as any).type,
          message: message,
        });
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
    if (this.translationDisplay.isDisplayed(utteranceIndex)) {
      console.log('[App] utterance_index 已显示过，跳过重复显示:', utteranceIndex);
      return;
    }

    // 从 Map 中获取对应的翻译结果
    const result = this.translationDisplay.getTranslationResult(utteranceIndex);
    if (result) {
      console.log('[App] 找到对应的翻译结果，显示文本，utterance_index:', utteranceIndex);
      const displayed = this.translationDisplay.displayTranslationResult(
        result.originalText,
        result.translatedText,
        result.serviceTimings,
        result.networkTimings,
        result.schedulerSentAtMs
      );
      // 只有成功显示（返回 true）才标记为已显示
      if (displayed) {
        this.translationDisplay.markAsDisplayed(utteranceIndex);
        console.log('[App] 播放时文本已显示，utterance_index:', utteranceIndex);
      } else {
        console.warn('[App] 播放时文本显示失败（可能被过滤），utterance_index:', utteranceIndex);
      }
    } else {
      console.warn('[App] 未找到 utterance_index 对应的翻译结果:', utteranceIndex);
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
    const bufferCount = this.ttsPlayer.getBufferCount();
    const currentState = this.stateMachine.getState();
    const isSessionActive = this.sessionManager.getIsSessionActive();
    
    const safeDuration = duration || 0; // 防御性检查
    console.log('[App] 📢 TTS 音频可用通知:', {
      duration: safeDuration.toFixed(2) + '秒',
      hasPendingAudio: hasPendingAudio,
      bufferCount: bufferCount,
      currentState: currentState,
      isSessionActive: isSessionActive,
      isPlaying: this.ttsPlayer.getIsPlaying()
    });

    // 触发 UI 更新（如果存在回调）
    if (typeof window !== 'undefined' && (window as any).onTtsAudioAvailable) {
      console.log('[App] 调用 onTtsAudioAvailable 回调，duration:', safeDuration.toFixed(2));
      (window as any).onTtsAudioAvailable(safeDuration);
    } else {
      console.warn('[App] ⚠️ onTtsAudioAvailable 回调不存在');
    }

    // 无论当前状态如何，都触发 UI 更新（让 UI 重新检查 hasPendingAudio 并更新播放按钮）
    // 这样即使状态不是 INPUT_RECORDING，也能在状态变化时正确显示播放按钮
    console.log('[App] 触发 UI 更新（通知状态机），当前状态:', currentState, 'hasPendingAudio:', hasPendingAudio);
    this.stateMachine.notifyUIUpdate();
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
      if (this.sessionManager.getIsSessionActive() && this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
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
    // 注意：这个方法现在主要用于兼容性，实际文本显示通过 onPlaybackIndexChange 回调进行
    // 由于翻译结果现在由 TranslationDisplayManager 管理，这里不再需要处理
    console.log('[App] displayPendingTranslationResults 已弃用，使用 TranslationDisplayManager 管理');
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
      await this.sessionManager.connect(srcLang, tgtLang, features);
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
      await this.sessionManager.connectTwoWay(langA, langB, features);
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
    await this.sessionManager.startSession();
  }

  /**
   * 结束整个会话
   */
  async endSession(): Promise<void> {
    await this.sessionManager.endSession();
  }

  /**
   * 发送当前说的话（控制说话节奏）
   * 发送后继续监听（保持在 INPUT_RECORDING 状态）
   * 使用 Utterance 消息，支持 opus 编码
   */
  async sendCurrentUtterance(): Promise<void> {
    await this.sessionManager.sendCurrentUtterance();
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
    if (this.sessionManager.getIsSessionActive()) {
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
    if (this.roomManager.getIsInRoom() && this.roomManager.getCurrentRoomCode()) {
      this.leaveRoom();
    }

    // 关闭所有 WebRTC 连接
    this.webrtcManager.closeAllConnections();

    // 停止音频混控器
    this.audioMixer.stop();

    // 移除音频混控器输出元素
    if (this.audioMixerOutput) {
      this.audioMixerOutput.remove();
      this.audioMixerOutput = null;
    }

    this.sessionManager.disconnect();

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
    this.roomManager.createRoom(displayName, preferredLang);
  }

  /**
   * 加入房间
   * @param roomCode 房间码（6位数字）
   * @param displayName 显示名称（可选）
   * @param preferredLang 偏好语言（可选）
   */
  joinRoom(roomCode: string, displayName?: string, preferredLang?: string): void {
    this.roomManager.joinRoom(roomCode, displayName, preferredLang);
  }

  /**
   * 退出房间
   */
  leaveRoom(): void {
    // 如果会话正在进行，先结束会话
    if (this.sessionManager.getIsSessionActive()) {
      this.sessionManager.endSession();
    }

    // 关闭所有 WebRTC 连接
    this.webrtcManager.closeAllConnections();

    // 退出房间
    this.roomManager.leaveRoom();
  }

  /**
   * 获取当前房间码
   */
  getCurrentRoomCode(): string | null {
    return this.roomManager.getCurrentRoomCode();
  }

  /**
   * 获取房间成员列表
   */
  getRoomMembers(): RoomMember[] {
    return this.roomManager.getRoomMembers();
  }

  /**
   * 检查是否在房间中
   */
  getIsInRoom(): boolean {
    return this.roomManager.getIsInRoom();
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
    // WebRTCManager 会通过 syncPeerConnections 自动管理连接
    this.webrtcManager.syncPeerConnections();
  }

  // WebRTC 相关方法已移至 WebRTCManager

  /**
   * 更新房间成员列表并同步 WebRTC 连接
   */
  // syncPeerConnections 已移至 WebRTCManager

  /**
   * 获取当前状态
   */
  getState(): SessionState {
    return this.stateMachine.getState();
  }

  // 注意：concatAudioBuffers 已移至 SessionManager

  /**
   * 获取状态机实例（用于 UI 访问）
   * @internal
   */
  getStateMachine(): StateMachine {
    return this.stateMachine;
  }
}

