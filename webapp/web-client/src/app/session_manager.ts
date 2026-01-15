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
          audioBufferLength: this.audioBuffer.length,
          hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
        });
        this.wsClient.sendFinal();
        this.currentUtteranceIndex++;
        this.hasSentAudioChunksForCurrentUtterance = false; // 重置标志
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
   * 处理音频帧
   */
  onAudioFrame(audioData: Float32Array): void {
    const audioFrameTimestamp = Date.now();
    const currentState = this.stateMachine.getState();
    
    // 只在输入状态下处理音频
    if (currentState !== SessionState.INPUT_RECORDING) {
      // 记录被跳过的音频帧（用于诊断）
      this.audioFrameSkipCount++;
      if (this.audioFrameSkipCount === 1 || this.audioFrameSkipCount % 100 === 0) {
        logger.warn('SessionManager', '收到音频帧，但状态不是 INPUT_RECORDING，跳过处理', {
          timestamp: audioFrameTimestamp,
          timestampIso: new Date(audioFrameTimestamp).toISOString(),
          currentState,
          isSessionActive: this.isSessionActive,
          skippedFrames: this.audioFrameSkipCount,
        });
      }
      return;
    }
    
    // 重置跳过计数（如果之前有跳过）
    if (this.audioFrameSkipCount > 0) {
      logger.info('SessionManager', '状态已恢复为 INPUT_RECORDING，开始处理音频帧', {
        timestamp: audioFrameTimestamp,
        timestampIso: new Date(audioFrameTimestamp).toISOString(),
        previouslySkippedFrames: this.audioFrameSkipCount,
        playbackFinishedTimestamp: this.playbackFinishedTimestamp,
        playbackFinishedTimestampIso: this.playbackFinishedTimestamp ? new Date(this.playbackFinishedTimestamp).toISOString() : null,
        timeSincePlaybackFinishedMs: this.playbackFinishedTimestamp ? audioFrameTimestamp - this.playbackFinishedTimestamp : null,
      });
      this.audioFrameSkipCount = 0;
    }
    
    // 如果是播放完成后首次接收到的音频帧，记录详细信息并触发回调
    if (this.playbackFinishedTimestamp !== null && this.audioFrameSkipCount === 0 && this.audioBuffer.length === 0) {
      const timeSincePlaybackFinishedMs = audioFrameTimestamp - this.playbackFinishedTimestamp;
      logger.info('SessionManager', '🎙️ 播放完成后首次接收到音频帧', {
        audioFrameTimestamp,
        audioFrameTimestampIso: new Date(audioFrameTimestamp).toISOString(),
        playbackFinishedTimestamp: this.playbackFinishedTimestamp,
        playbackFinishedTimestampIso: new Date(this.playbackFinishedTimestamp).toISOString(),
        timeSincePlaybackFinishedMs,
        timeSincePlaybackFinishedSeconds: (timeSincePlaybackFinishedMs / 1000).toFixed(2),
        expectedDelayMs: this.PLAYBACK_FINISHED_DELAY_MS,
        currentUtteranceIndex: this.currentUtteranceIndex,
        hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
      });
      
      // 触发回调，通知 App 已收到第一帧音频
      if (this.firstAudioFrameAfterPlaybackCallback) {
        try {
          this.firstAudioFrameAfterPlaybackCallback(audioFrameTimestamp);
        } catch (error) {
          logger.error('SessionManager', '首次音频帧回调执行失败', { error });
        }
        // 清除回调（只触发一次）
        this.firstAudioFrameAfterPlaybackCallback = null;
      }
    }


    // 计算音频数据的 RMS（用于日志）
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);

    // 缓存有效音频数据
    this.audioBuffer.push(new Float32Array(audioData));

    // 初始化帧与 chunk 配置（基于首帧推算）
    if (this.samplesPerFrame === null) {
      this.samplesPerFrame = audioData.length;
      const frameDurationMs = this.samplesPerFrame / 16; // 16kHz -> 每毫秒16个采样点
      const framesPerChunk = Math.max(
        1,
        Math.round(this.TARGET_CHUNK_DURATION_MS / frameDurationMs)
      );
      this.framesPerChunk = framesPerChunk;
      logger.info('SessionManager', '初始化chunk切分参数', {
        samplesPerFrame: this.samplesPerFrame,
        frameDurationMs: frameDurationMs.toFixed(2),
        targetChunkDurationMs: this.TARGET_CHUNK_DURATION_MS,
        framesPerChunk: this.framesPerChunk,
      });
    }

    // 定期记录音频输入日志（每 50 帧记录一次，约 0.5 秒）
    if (this.audioBuffer.length % 50 === 0) {
      logger.debug('SessionManager', '音频输入统计', {
        bufferLength: this.audioBuffer.length,
        totalSamples: this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0),
        estimatedDurationMs: Math.round(this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0) / 16), // 假设 16kHz
        currentFrameRms: rms.toFixed(4),
        utteranceIndex: this.currentUtteranceIndex,
      });
    }

    // 检查是否在播放完成延迟期间
    const now = Date.now();
    if (this.playbackFinishedDelayEndTime !== null && now < this.playbackFinishedDelayEndTime) {
      // 在延迟期间，缓存音频数据，不发送
      this.playbackFinishedDelayBuffer.push(new Float32Array(audioData));
      
      // 只在第一次进入延迟时打印日志
      if (this.playbackFinishedDelayStartTime === null) {
        this.playbackFinishedDelayStartTime = now;
        const remainingDelayMs = this.playbackFinishedDelayEndTime - now;
        logger.info('SessionManager', '开始播放完成延迟期间，缓存音频数据', {
          delayStartTime: now,
          delayStartTimeIso: new Date(now).toISOString(),
          delayEndTime: this.playbackFinishedDelayEndTime,
          delayEndTimeIso: new Date(this.playbackFinishedDelayEndTime).toISOString(),
          delayMs: this.PLAYBACK_FINISHED_DELAY_MS,
          remainingDelayMs,
          playbackFinishedTimestamp: this.playbackFinishedTimestamp,
          playbackFinishedTimestampIso: this.playbackFinishedTimestamp ? new Date(this.playbackFinishedTimestamp).toISOString() : null,
          currentUtteranceIndex: this.currentUtteranceIndex,
          hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
        });
      }
      return;
    }

    // 延迟期间结束，先发送缓存的音频数据
    if (this.playbackFinishedDelayBuffer.length > 0) {
      const actualDelayMs = now - (this.playbackFinishedDelayStartTime || now);
      const totalCachedSamples = this.playbackFinishedDelayBuffer.reduce((sum, buf) => sum + buf.length, 0);
      const estimatedCachedDurationMs = Math.round(totalCachedSamples / 16); // 假设 16kHz
      
      logger.info('SessionManager', '播放完成延迟结束，发送缓存的音频数据', {
        delayStartTime: this.playbackFinishedDelayStartTime,
        delayStartTimeIso: this.playbackFinishedDelayStartTime ? new Date(this.playbackFinishedDelayStartTime).toISOString() : null,
        delayEndTime: now,
        delayEndTimeIso: new Date(now).toISOString(),
        expectedDelayMs: this.PLAYBACK_FINISHED_DELAY_MS,
        actualDelayMs,
        cachedFrames: this.playbackFinishedDelayBuffer.length,
        cachedSamples: totalCachedSamples,
        estimatedCachedDurationMs,
        audioBufferLengthBefore: this.audioBuffer.length,
        playbackFinishedTimestamp: this.playbackFinishedTimestamp,
        playbackFinishedTimestampIso: this.playbackFinishedTimestamp ? new Date(this.playbackFinishedTimestamp).toISOString() : null,
        timeSincePlaybackFinishedMs: this.playbackFinishedTimestamp ? now - this.playbackFinishedTimestamp : null,
        currentUtteranceIndex: this.currentUtteranceIndex,
        hasSentAudioChunks: this.hasSentAudioChunksForCurrentUtterance,
      });
      
      // 将缓存的音频数据合并到 audioBuffer 中
      this.audioBuffer.unshift(...this.playbackFinishedDelayBuffer);
      
      logger.debug('SessionManager', '缓存音频数据已合并到audioBuffer', {
        audioBufferLengthAfter: this.audioBuffer.length,
        mergedFrames: this.playbackFinishedDelayBuffer.length,
      });
      
      this.playbackFinishedDelayBuffer = [];
      this.playbackFinishedDelayEndTime = null;
      this.playbackFinishedDelayStartTime = null;
    }

    // 如果当前不允许发送chunk（例如 TTS 播放期间或 RestartTimer 之前），仅缓存音频数据，不发送
    if (!this.canSendChunks) {
      return;
    }

    // 自动发送音频块（目标约 200ms 一包，使用 opus 编码）
    // 基于首帧推算的 framesPerChunk 进行切分
    if (this.audioBuffer.length >= this.framesPerChunk) {
      // 当缓冲区达到目标帧数时，发送前 framesPerChunk 帧
      const chunk = this.concatAudioBuffers(this.audioBuffer.splice(0, this.framesPerChunk));
      
      // 如果是首次发送音频chunk，且之前有播放结束的时间戳，记录延迟
      const isFirstChunkAfterPlayback = !this.hasSentAudioChunksForCurrentUtterance && this.playbackFinishedTimestamp !== null;
      if (isFirstChunkAfterPlayback && this.playbackFinishedTimestamp !== null) {
        const delayFromPlaybackEndMs = now - this.playbackFinishedTimestamp;
        // 检查延迟是否异常（超过预期延迟太多，说明可能是旧的 playbackFinishedTimestamp）
        const isAbnormalDelay = delayFromPlaybackEndMs > this.PLAYBACK_FINISHED_DELAY_MS * 2; // 超过预期延迟的2倍视为异常
        logger.info('SessionManager', '🎤 首次发送音频chunk（播放结束后）', {
          playbackFinishedTimestamp: this.playbackFinishedTimestamp,
          playbackFinishedTimestampIso: new Date(this.playbackFinishedTimestamp).toISOString(),
          firstChunkSentTimestamp: now,
          firstChunkSentTimestampIso: new Date(now).toISOString(),
          delayFromPlaybackEndMs,
          delayFromPlaybackEndSeconds: (delayFromPlaybackEndMs / 1000).toFixed(2),
          chunkSize: chunk.length,
          utteranceIndex: this.currentUtteranceIndex,
          expectedDelayMs: this.PLAYBACK_FINISHED_DELAY_MS,
          isAbnormalDelay,
          warning: isAbnormalDelay ? '⚠️ 延迟异常，可能是旧的 playbackFinishedTimestamp' : undefined,
        });
        // 清除播放结束时间戳（只记录首次发送的延迟）
        this.playbackFinishedTimestamp = null;
      }
      
      // 记录每次发送音频chunk的详细信息（特别是第一批chunk）
      if (isFirstChunkAfterPlayback) {
        logger.info('SessionManager', '📤 发送第一批音频chunk到调度服务器', {
          chunkSize: chunk.length,
          utteranceIndex: this.currentUtteranceIndex,
          timestamp: now,
          timestampIso: new Date(now).toISOString(),
          isFirstChunk: true,
          playbackFinishedTimestamp: this.playbackFinishedTimestamp,
          playbackFinishedTimestampIso: this.playbackFinishedTimestamp ? new Date(this.playbackFinishedTimestamp).toISOString() : null,
          timeSincePlaybackFinishedMs: this.playbackFinishedTimestamp ? now - this.playbackFinishedTimestamp : null,
        });
      } else {
        // 记录非首次chunk的发送（每10个chunk记录一次，减少日志量）
        if (this.audioBuffer.length % 10 === 0) {
          logger.debug('SessionManager', '发送音频chunk', {
            chunkSize: chunk.length,
            utteranceIndex: this.currentUtteranceIndex,
            timestamp: now,
            timestampIso: new Date(now).toISOString(),
            audioBufferLength: this.audioBuffer.length,
          });
        }
      }
      
      const sendChunkStartTimestamp = Date.now();
      this.wsClient.sendAudioChunk(chunk, false);
      const sendChunkEndTimestamp = Date.now();
      if (isFirstChunkAfterPlayback) {
        logger.info('SessionManager', '✅ 第一批音频chunk已调用sendAudioChunk', {
          sendStartTimestamp: sendChunkStartTimestamp,
          sendEndTimestamp: sendChunkEndTimestamp,
          sendDurationMs: sendChunkEndTimestamp - sendChunkStartTimestamp,
          timestampIso: new Date(sendChunkEndTimestamp).toISOString(),
        });
      }
      this.hasSentAudioChunksForCurrentUtterance = true; // 标记已发送过音频块
    }
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

