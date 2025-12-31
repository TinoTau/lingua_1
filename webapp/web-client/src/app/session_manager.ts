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
  async connect(srcLang: string = 'zh', tgtLang: string = 'en', features?: FeatureFlags): Promise<void> {
    // 保存语言配置
    this.currentSrcLang = srcLang;
    this.currentTgtLang = tgtLang;
    // 重置 utterance 索引
    this.currentUtteranceIndex = 0;
    await this.wsClient.connect(srcLang, tgtLang, features);
    await this.recorder.initialize();
  }

  /**
   * 连接服务器（双向模式）
   */
  async connectTwoWay(langA: string = 'zh', langB: string = 'en', features?: FeatureFlags): Promise<void> {
    await this.wsClient.connectTwoWay(langA, langB, features);
    await this.recorder.initialize();
  }

  /**
   * 开始整个会话（持续输入+输出模式）
   */
  async startSession(): Promise<void> {
    const currentState = this.stateMachine.getState();
    console.log('[SessionManager] startSession 被调用，当前状态:', currentState);

    if (currentState === SessionState.INPUT_READY) {
      console.log('[SessionManager] 状态为 INPUT_READY，开始会话');
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
        console.warn(`[SessionManager] ⚠️ 新会话开始，已清空 ${bufferCountBefore} 个未播放的音频块`);
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
      console.warn('[SessionManager] ⚠️ startSession 被调用，但当前状态不是 INPUT_READY，状态:', currentState);
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
    console.log('[SessionManager] sendCurrentUtterance 被调用，当前状态:', currentState, '会话是否活跃:', this.isSessionActive);

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
        
        console.log('[SessionManager] 发送剩余音频数据（audio_chunk）', {
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
        console.log('[SessionManager] 发送 finalize 以触发调度服务器 finalize 已累积的音频块', {
          utteranceIndex: this.currentUtteranceIndex,
          state: currentState,
          isSessionActive: this.isSessionActive,
          audioBufferLength: this.audioBuffer.length,
        });
        this.wsClient.sendFinal();
        this.currentUtteranceIndex++;
        this.hasSentAudioChunksForCurrentUtterance = false; // 重置标志
      } else {
        // 音频缓冲区为空，且没有发送过音频块，不发送 finalize（避免触发调度服务器的空 finalize）
        console.warn('[SessionManager] 音频缓冲区为空，且没有发送过音频块，跳过发送和 finalize', {
          utteranceIndex: this.currentUtteranceIndex,
          state: currentState,
          isSessionActive: this.isSessionActive,
          audioBufferLength: this.audioBuffer.length,
        });
      }

      // 注意：不再切换状态，保持在 INPUT_RECORDING，允许持续输入
      console.log('[SessionManager] 已发送当前话语，继续监听...');
    } else {
      console.warn('[SessionManager] 当前状态不允许发送:', {
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
    // 只在输入状态下处理音频
    if (this.stateMachine.getState() !== SessionState.INPUT_RECORDING) {
      return;
    }

    // 计算音频数据的 RMS（用于日志）
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);

    // 缓存有效音频数据
    this.audioBuffer.push(new Float32Array(audioData));

    // 定期记录音频输入日志（每 50 帧记录一次，约 0.5 秒）
    if (this.audioBuffer.length % 50 === 0) {
      console.log('[SessionManager] 音频输入统计', {
        bufferLength: this.audioBuffer.length,
        totalSamples: this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0),
        estimatedDurationMs: Math.round(this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0) / 16), // 假设 16kHz
        currentFrameRms: rms.toFixed(4),
        utteranceIndex: this.currentUtteranceIndex,
      });
    }

    // 自动发送音频块（每 100ms 发送一次，使用 opus 编码）
    // 假设每 10ms 一帧，10 帧 = 100ms
    // 注意：自动发送会持续发送音频块到调度服务器，调度服务器会累积这些音频块
    // 当用户点击"发送"时，会发送 finalize 来 finalize 已累积的音频块
    // 因此，这里不需要保留帧数，可以持续发送所有音频块
    if (this.audioBuffer.length >= 10) {
      // 当缓冲区有 10 帧时，发送前 10 帧（100ms）
      const chunk = this.concatAudioBuffers(this.audioBuffer.splice(0, 10));
      this.wsClient.sendAudioChunk(chunk, false);
      this.hasSentAudioChunksForCurrentUtterance = true; // 标记已发送过音频块
    }
  }

  /**
   * 处理静音检测
   */
  onSilenceDetected(): void {
    if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
      // 发送剩余的音频数据
      if (this.audioBuffer.length > 0) {
        const chunk = this.concatAudioBuffers(this.audioBuffer);
        this.audioBuffer = [];
        this.wsClient.sendAudioChunk(chunk, false);
        this.hasSentAudioChunksForCurrentUtterance = true; // 标记已发送过音频块
        
        // 只有在有音频数据时才发送结束帧
        this.wsClient.sendFinal();
        this.currentUtteranceIndex++; // 修复：静音检测后也需要递增 utterance_index
        this.hasSentAudioChunksForCurrentUtterance = false; // 重置标志
        console.log('[SessionManager] 静音检测：已发送剩余音频数据和 finalize，utterance_index 已递增');
      } else {
        // 修复：即使音频缓冲区为空，如果之前已发送过音频块，也应该发送 finalize 并递增 utterance_index
        if (this.hasSentAudioChunksForCurrentUtterance) {
          this.wsClient.sendFinal();
          this.currentUtteranceIndex++; // 修复：静音检测后也需要递增 utterance_index
          this.hasSentAudioChunksForCurrentUtterance = false; // 重置标志
          console.log('[SessionManager] 静音检测：音频缓冲区为空，但之前已发送过音频块，发送 finalize 并递增 utterance_index');
        } else {
          console.log('[SessionManager] 静音检测：音频缓冲区为空，且没有发送过音频块，跳过发送和 finalize');
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

