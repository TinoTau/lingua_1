/**
 * 会话管理模块
 * 负责管理会话的生命周期和状态
 */

import { SessionState } from '../types';
import { StateMachine } from '../state_machine';
import { Recorder } from '../recorder';
import { WebSocketClient } from '../websocket_client';
import { TtsPlayer } from '../tts_player';
import { AsrSubtitle } from '../asr_subtitle';
import { FeatureFlags } from '../types';
import { TranslationDisplayManager } from './translation_display';
import { logger } from '../logger';
import { processAudioFrame, type ISessionManagerAudioFrameContext } from './session_manager_audio_frame';

/**
 * 会话管理器
 */
export class SessionManager {
  private stateMachine: StateMachine;
  private recorder: Recorder;
  private wsClient: WebSocketClient;
  private ttsPlayer: TtsPlayer;
  private asrSubtitle: AsrSubtitle;
  private translationDisplay: TranslationDisplayManager;

  // 会话状态
  private isSessionActive: boolean = false;
  private currentSrcLang: string = 'zh';
  private currentTgtLang: string = 'en';
  private currentUtteranceIndex: number = 0;
  private audioBuffer: Float32Array[] = [];
  private currentTraceId: string | null = null;
  private currentGroupId: string | null = null;
  private hasSentAudioChunksForCurrentUtterance: boolean = false; // 跟踪当前 utterance 是否已通过自动发送发送过音频块
  // 当前 utterance 内已发送的 chunk 数量（用于精细日志和排查“半句/丢句”问题）
  private sentChunkCountForCurrentUtterance: number = 0;
  private playbackFinishedTimestamp: number | null = null; // 播放结束的时间戳（用于计算到首次音频发送的延迟）
  private playbackFinishedDelayBuffer: Float32Array[] = []; // 播放完成后延迟发送的音频缓冲区
  private playbackFinishedDelayEndTime: number | null = null; // 播放完成延迟结束时间（毫秒）
  private playbackFinishedDelayStartTime: number | null = null; // 播放完成延迟开始时间（毫秒）
  private readonly PLAYBACK_FINISHED_DELAY_MS = 500; // 播放完成后延迟 500ms 再发送音频 chunk
  private audioFrameSkipCount: number = 0; // 被跳过的音频帧计数（用于诊断）
  private firstAudioFrameAfterPlaybackCallback: ((timestamp: number) => void) | null = null; // 播放完成后首次音频帧回调
  private canSendChunks: boolean = true; // 是否允许向调度服务器发送音频chunk（用于播放完成前的保护期）
  private readonly TARGET_CHUNK_DURATION_MS = 200; // 目标chunk时长（毫秒），约200ms一包
  private samplesPerFrame: number | null = null; // 单帧包含的采样点数（用于推算帧时长）
  private framesPerChunk: number = 10; // 每个chunk包含的帧数，默认10（会在首次收到帧时根据采样率调整）
  private pipelineConfig?: {
    use_asr?: boolean;
    use_nmt?: boolean;
    use_tts?: boolean;
    use_tone?: boolean;
  };

  constructor(
    stateMachine: StateMachine,
    recorder: Recorder,
    wsClient: WebSocketClient,
    ttsPlayer: TtsPlayer,
    asrSubtitle: AsrSubtitle,
    translationDisplay: TranslationDisplayManager
  ) {
    this.stateMachine = stateMachine;
    this.recorder = recorder;
    this.wsClient = wsClient;
    this.ttsPlayer = ttsPlayer;
    this.asrSubtitle = asrSubtitle;
    this.translationDisplay = translationDisplay;
  }

  /**
   * 连接服务器（单向模式）
   */
  async connect(srcLang: string = 'zh', tgtLang: string = 'en', features?: FeatureFlags, pipeline?: {
    use_asr?: boolean;
    use_nmt?: boolean;
    use_tts?: boolean;
    use_tone?: boolean;
  }): Promise<void> {
    // 保存语言配置
    this.currentSrcLang = srcLang;
    this.currentTgtLang = tgtLang;
    this.pipelineConfig = pipeline;
    // 重置 utterance 索引
    this.currentUtteranceIndex = 0;
    this.sentChunkCountForCurrentUtterance = 0;
    await this.wsClient.connect(srcLang, tgtLang, features);
    await this.recorder.initialize();
  }

  /**
   * 连接服务器（双向模式）
   */
  async connectTwoWay(langA: string = 'zh', langB: string = 'en', features?: FeatureFlags, pipeline?: {
    use_asr?: boolean;
    use_nmt?: boolean;
    use_tts?: boolean;
    use_tone?: boolean;
  }): Promise<void> {
    this.pipelineConfig = pipeline;
    await this.wsClient.connectTwoWay(langA, langB, features);
    await this.recorder.initialize();
  }

  /**
   * 开始整个会话（持续输入+输出模式）
   */
  async startSession(): Promise<void> {
    const currentState = this.stateMachine.getState();
    logger.info('SessionManager', 'startSession 被调用', { currentState });

    if (currentState === SessionState.INPUT_READY) {
      logger.info('SessionManager', '状态为 INPUT_READY，开始会话');
      this.isSessionActive = true;
      this.audioBuffer = [];
      this.asrSubtitle.clear();
      // 清空当前的 trace_id 和 group_id（新的会话）
      this.currentTraceId = null;
      this.currentGroupId = null;
      // 重置 utterance 索引和标志
      this.currentUtteranceIndex = 0;
      this.hasSentAudioChunksForCurrentUtterance = false;
      this.sentChunkCountForCurrentUtterance = 0;

      // 清空所有未播放的音频（新会话开始时丢弃之前的音频）
      // 注意：只在真正开始新会话时清空，避免在会话进行中误清空
      const bufferCountBefore = this.ttsPlayer.getBufferCount();
      this.ttsPlayer.clearBuffers();
      if (bufferCountBefore > 0) {
        logger.warn('SessionManager', `⚠️ 新会话开始，已清空 ${bufferCountBefore} 个未播放的音频块`);
      }

      // 清空翻译结果
      this.translationDisplay.clear();
      this.translationDisplay.clearDisplayedTranslationResults();

      // 在用户手势下预初始化 TTS 的 AudioContext，避免后续自动播放因浏览器策略无法 resume
      this.ttsPlayer.prepareAudioContext().catch((err) => {
        logger.warn('SessionManager', 'TTS AudioContext 预初始化失败（可能影响后续播放）', { error: String(err) });
      });

      // 开始会话（状态机会自动进入 INPUT_RECORDING）
      this.stateMachine.startSession();

      // 确保录音器已初始化并开始录音
      if (!this.recorder.getIsRecording()) {
        await this.recorder.start();
      }
    } else {
      logger.warn('SessionManager', '⚠️ startSession 被调用，但当前状态不是 INPUT_READY', { currentState });
    }
  }

  /**
   * 结束整个会话
   */
  async endSession(): Promise<void> {
    logger.info('SessionManager', 'endSession 被调用，会话结束', { current_utterance_index: this.currentUtteranceIndex });
    this.isSessionActive = false;

    // 停止录音
    this.recorder.stop();
    this.recorder.close();

    // 停止播放并清空所有未播放的音频
    this.ttsPlayer.stop();
    this.ttsPlayer.clearBuffers();

    // 清空音频缓冲区
    this.audioBuffer = [];

    // 清空 WebSocket 发送队列（丢弃所有未发送的音频数据）
    this.wsClient.clearSendQueue();

    // 清空翻译结果
    this.translationDisplay.clear();
    this.translationDisplay.clearDisplayedTranslationResults();

    // 结束会话（状态机会回到 INPUT_READY）
    this.stateMachine.endSession();
  }

  /**
   * 发送当前说的话（控制说话节奏）
   */
  async sendCurrentUtterance(): Promise<void> {
    const currentState = this.stateMachine.getState();
    logger.info('SessionManager', 'sendCurrentUtterance 被调用', { currentState, isSessionActive: this.isSessionActive });

    // 允许在 INPUT_RECORDING 状态下随时发送（只要会话活跃）
    if (this.isSessionActive && currentState === SessionState.INPUT_RECORDING) {
      // 修复：无论 audioBuffer 是否为空，都应该发送剩余的音频块（如果有），然后发送 finalize
      // 这样调度服务器可以 finalize 已累积的音频块（来自自动发送），而不是创建新的 job
      if (this.audioBuffer.length > 0) {
        // 发送剩余的音频数据（通过 audio_chunk，而不是 utterance）
        const audioData = this.concatAudioBuffers(this.audioBuffer);
        const totalSamples = audioData.length;
        const estimatedDurationMs = Math.round(totalSamples / 16); // 假设 16kHz
        
        // 计算音频数据的 RMS（用于日志）
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
          sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        
        logger.info('SessionManager', '发送剩余音频数据（audio_chunk）', {
          length: totalSamples,
          estimatedDurationMs,
          rms: rms.toFixed(4),
          utteranceIndex: this.currentUtteranceIndex,
          bufferFramesBeforeClear: this.audioBuffer.length,
        });
        
        // 发送剩余的音频块（通过 audio_chunk，而不是 utterance）
        // 这样调度服务器可以累积这些音频块，然后通过 finalize 一起处理
        await this.wsClient.sendAudioChunk(audioData, false);
        this.hasSentAudioChunksForCurrentUtterance = true;
        
        // 发送完成后再清空缓冲区，准备下一句话
        this.audioBuffer = [];
      }
      
      // 无论 audioBuffer 是否为空，如果之前已通过自动发送发送过音频块，都应该发送 finalize
      if (this.hasSentAudioChunksForCurrentUtterance) {
        logger.info('SessionManager', '发送 finalize 以触发调度服务器 finalize 已累积的音频块', {
          utteranceIndex: this.currentUtteranceIndex,
          state: currentState,
          isSessionActive: this.isSessionActive,
          audioBufferLength: this.audioBuffer.length,
        });
        const sendFinalTimestamp = Date.now();
        logger.info('SessionManager', '📤 发送 finalize（sendCurrentUtterance）', {
          timestamp: sendFinalTimestamp,
          timestampIso: new Date(sendFinalTimestamp).toISOString(),
          utteranceIndex: this.currentUtteranceIndex,
          sentChunkCountForCurrentUtterance: this.sentChunkCountForCurrentUtterance,
          audioBufferLength: this.audioBuffer.length,
          hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
        });
        this.wsClient.sendFinal();
        this.currentUtteranceIndex++;
        this.hasSentAudioChunksForCurrentUtterance = false; // 重置标志
        this.sentChunkCountForCurrentUtterance = 0; // 新的 utterance 从 0 开始计数
      } else {
        // 音频缓冲区为空，且没有发送过音频块，不发送 finalize（避免触发调度服务器的空 finalize）
        logger.warn('SessionManager', '音频缓冲区为空，且没有发送过音频块，跳过发送和 finalize', {
          utteranceIndex: this.currentUtteranceIndex,
          state: currentState,
          isSessionActive: this.isSessionActive,
          audioBufferLength: this.audioBuffer.length,
        });
      }

      // 注意：不再切换状态，保持在 INPUT_RECORDING，允许持续输入
      logger.info('SessionManager', '已发送当前话语，继续监听...');
    } else {
      logger.warn('SessionManager', '当前状态不允许发送', {
        state: currentState,
        isSessionActive: this.isSessionActive,
        expectedState: SessionState.INPUT_RECORDING
      });
    }
  }

  /**
   * 供 processAudioFrame 使用的上下文（不对外暴露）
   */
  private getAudioFrameContext(): ISessionManagerAudioFrameContext {
    const self = this;
    return {
      get stateMachine() { return self.stateMachine; },
      get wsClient() { return self.wsClient; },
      getState: () => self.stateMachine.getState(),
      getIsSessionActive: () => self.isSessionActive,
      getAudioFrameSkipCount: () => self.audioFrameSkipCount,
      setAudioFrameSkipCount: (v) => { self.audioFrameSkipCount = v; },
      getPlaybackFinishedTimestamp: () => self.playbackFinishedTimestamp,
      setPlaybackFinishedTimestamp: (v) => { self.playbackFinishedTimestamp = v; },
      getAudioBuffer: () => self.audioBuffer,
      getFirstAudioFrameAfterPlaybackCallback: () => self.firstAudioFrameAfterPlaybackCallback,
      setFirstAudioFrameAfterPlaybackCallback: (cb) => { self.firstAudioFrameAfterPlaybackCallback = cb; },
      get PLAYBACK_FINISHED_DELAY_MS() { return self.PLAYBACK_FINISHED_DELAY_MS; },
      getCurrentUtteranceIndex: () => self.currentUtteranceIndex,
      getHasSentAudioChunksForCurrentUtterance: () => self.hasSentAudioChunksForCurrentUtterance,
      getPlaybackFinishedDelayBuffer: () => self.playbackFinishedDelayBuffer,
      getPlaybackFinishedDelayEndTime: () => self.playbackFinishedDelayEndTime,
      setPlaybackFinishedDelayEndTime: (v) => { self.playbackFinishedDelayEndTime = v; },
      getPlaybackFinishedDelayStartTime: () => self.playbackFinishedDelayStartTime,
      setPlaybackFinishedDelayStartTime: (v) => { self.playbackFinishedDelayStartTime = v; },
      getCanSendChunks: () => self.canSendChunks,
      get TARGET_CHUNK_DURATION_MS() { return self.TARGET_CHUNK_DURATION_MS; },
      getSamplesPerFrame: () => self.samplesPerFrame,
      setSamplesPerFrame: (v) => { self.samplesPerFrame = v; },
      getFramesPerChunk: () => self.framesPerChunk,
      setFramesPerChunk: (v) => { self.framesPerChunk = v; },
      concatAudioBuffers: (buffers) => self.concatAudioBuffers(buffers),
      sendAudioChunk: (data, isFinal) => self.wsClient.sendAudioChunk(data, isFinal),
      getSentChunkCountForCurrentUtterance: () => self.sentChunkCountForCurrentUtterance,
      setSentChunkCountForCurrentUtterance: (v) => { self.sentChunkCountForCurrentUtterance = v; },
      setHasSentAudioChunksForCurrentUtterance: (v) => { self.hasSentAudioChunksForCurrentUtterance = v; },
    };
  }

  /**
   * 处理音频帧
   */
  onAudioFrame(audioData: Float32Array): void {
    processAudioFrame(this.getAudioFrameContext(), audioData);
  }

  /**
   * 处理静音检测
   */
  onSilenceDetected(): void {
    const silenceDetectedTimestamp = Date.now();
    const currentState = this.stateMachine.getState();
    logger.info('SessionManager', '🔇 静音检测触发', {
      timestamp: silenceDetectedTimestamp,
      timestampIso: new Date(silenceDetectedTimestamp).toISOString(),
      currentState,
      isSessionActive: this.isSessionActive,
      audioBufferLength: this.audioBuffer.length,
      hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
      utteranceIndex: this.currentUtteranceIndex,
    });
    
    if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
      // 发送剩余的音频数据
      if (this.audioBuffer.length > 0) {
        const chunk = this.concatAudioBuffers(this.audioBuffer);
        this.audioBuffer = [];
        this.wsClient.sendAudioChunk(chunk, false);
        this.hasSentAudioChunksForCurrentUtterance = true; // 标记已发送过音频块
        
        // 只有在有音频数据时才发送结束帧
        const sendFinalTimestamp = Date.now();
        logger.info('SessionManager', '📤 发送 finalize（静音检测：有音频数据）', {
          timestamp: sendFinalTimestamp,
          timestampIso: new Date(sendFinalTimestamp).toISOString(),
          utteranceIndex: this.currentUtteranceIndex,
          audioBufferLengthBefore: this.audioBuffer.length,
          hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
        });
        this.wsClient.sendFinal();
        this.currentUtteranceIndex++; // 修复：静音检测后也需要递增 utterance_index
        this.hasSentAudioChunksForCurrentUtterance = false; // 重置标志
        logger.info('SessionManager', '静音检测：已发送剩余音频数据和 finalize，utterance_index 已递增', {
          newUtteranceIndex: this.currentUtteranceIndex,
        });
      } else {
        // 修复：即使音频缓冲区为空，如果之前已发送过音频块，也应该发送 finalize 并递增 utterance_index
        if (this.hasSentAudioChunksForCurrentUtterance) {
          const sendFinalTimestamp = Date.now();
          logger.info('SessionManager', '📤 发送 finalize（静音检测：无音频数据但已发送过chunk）', {
            timestamp: sendFinalTimestamp,
            timestampIso: new Date(sendFinalTimestamp).toISOString(),
            utteranceIndex: this.currentUtteranceIndex,
            audioBufferLength: this.audioBuffer.length,
            hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
          });
          this.wsClient.sendFinal();
          this.currentUtteranceIndex++; // 修复：静音检测后也需要递增 utterance_index
          this.hasSentAudioChunksForCurrentUtterance = false; // 重置标志
          logger.info('SessionManager', '静音检测：音频缓冲区为空，但之前已发送过音频块，发送 finalize 并递增 utterance_index', {
            newUtteranceIndex: this.currentUtteranceIndex,
          });
        } else {
          logger.info('SessionManager', '静音检测：音频缓冲区为空，且没有发送过音频块，跳过发送和 finalize');
        }
      }

      // 停止录音
      this.stateMachine.stopRecording();
    }
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
   * 获取会话是否活跃
   */
  getIsSessionActive(): boolean {
    return this.isSessionActive;
  }


  /**
   * 设置播放结束的时间戳
   */
  setPlaybackFinishedTimestamp(timestamp: number): void {
    this.playbackFinishedTimestamp = timestamp;
    // 设置播放完成延迟，延迟 500ms 后再发送音频 chunk
    // 这样可以确保 RestartTimer 先到达调度服务器
    this.playbackFinishedDelayEndTime = timestamp + this.PLAYBACK_FINISHED_DELAY_MS;
    this.playbackFinishedDelayStartTime = null; // 重置延迟开始时间（将在第一次缓存时设置）
    this.playbackFinishedDelayBuffer = []; // 清空延迟缓冲区
    logger.info('SessionManager', '设置播放结束时间戳和延迟发送', {
      timestamp,
      isoString: new Date(timestamp).toISOString(),
      delayEndTime: this.playbackFinishedDelayEndTime,
      delayMs: this.PLAYBACK_FINISHED_DELAY_MS,
      expectedFirstChunkTime: new Date(this.playbackFinishedDelayEndTime).toISOString(),
      currentUtteranceIndex: this.currentUtteranceIndex,
      hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
    });
  }

  /**
   * 获取当前 utterance 索引
   */
  getCurrentUtteranceIndex(): number {
    return this.currentUtteranceIndex;
  }

  /**
   * 设置当前 trace_id 和 group_id
   */
  setCurrentTraceInfo(traceId: string | null, groupId: string | null): void {
    this.currentTraceId = traceId;
    this.currentGroupId = groupId;
  }

  /**
   * 获取当前 trace_id 和 group_id
   */
  getCurrentTraceInfo(): { traceId: string | null; groupId: string | null } {
    return {
      traceId: this.currentTraceId,
      groupId: this.currentGroupId
    };
  }

  /**
   * 设置是否允许发送音频chunk
   * - 在 TTS 播放期间以及发送 RestartTimer 之前，可以禁用发送，仅在本地缓冲
   * - 在 RestartTimer 之后重新启用发送，避免在播放结束前把新话语的chunk发给调度服务器
   */
  setCanSendChunks(canSend: boolean): void {
    this.canSendChunks = canSend;
  }

  /**
   * 设置播放完成后首次音频帧回调
   * @param callback 回调函数，参数为音频帧时间戳
   */
  setFirstAudioFrameAfterPlaybackCallback(callback: ((timestamp: number) => void) | null): void {
    this.firstAudioFrameAfterPlaybackCallback = callback;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.recorder.close();
    this.wsClient.disconnect();

    // 停止播放并清空所有未播放的音频
    this.ttsPlayer.stop();
    this.ttsPlayer.clearBuffers(); // 确保清空缓冲区
  }
}

