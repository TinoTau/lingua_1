import { StateMachine, SessionState } from './state_machine';
import { Recorder } from './recorder';
import { WebSocketClient } from './websocket_client';
import { TtsPlayer } from './tts_player';
import { AsrSubtitle } from './asr_subtitle';
import { Config, DEFAULT_CONFIG, ServerMessage, FeatureFlags } from './types';

/**
 * 主应用类
 * 整合所有模块
 */
class App {
  private stateMachine: StateMachine;
  private recorder: Recorder;
  private wsClient: WebSocketClient;
  private ttsPlayer: TtsPlayer;
  private asrSubtitle: AsrSubtitle;
  private config: Config;
  private audioBuffer: Float32Array[] = [];
  // 当前 utterance 的 trace_id 和 group_id（用于 TTS_PLAY_ENDED）
  private currentTraceId: string | null = null;
  private currentGroupId: string | null = null;

  constructor(config: Partial<Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 初始化模块
    this.stateMachine = new StateMachine();
    this.recorder = new Recorder(this.stateMachine, this.config);
    this.wsClient = new WebSocketClient(this.stateMachine, this.config.schedulerUrl);
    this.ttsPlayer = new TtsPlayer(this.stateMachine);
    this.asrSubtitle = new AsrSubtitle('app');

    // 设置回调
    this.setupCallbacks();
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
      if (oldState === SessionState.PLAYING_TTS || oldState === SessionState.WAITING_RESULT) {
        // 从输出模式切换到输入模式，重新初始化录音
        this.recorder.initialize().then(() => {
          if (newState === SessionState.INPUT_RECORDING) {
            this.recorder.start();
          }
        });
      }
    } else if (newState === SessionState.WAITING_RESULT || newState === SessionState.PLAYING_TTS) {
      // 输出模式：关闭麦克风
      this.recorder.stop();
      this.recorder.close();
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
  private onServerMessage(message: ServerMessage): void {
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
          // 将完整的 TTS 音频拆分成多个块发送给 TtsPlayer
          // 这里简化处理，直接发送整个音频
          this.ttsPlayer.addAudioChunk(message.tts_audio);
        }
        break;
      
      case 'tts_audio':
        this.ttsPlayer.addAudioChunk(message.payload);
        break;
    }
  }

  /**
   * 播放完成处理
   */
  private onPlaybackFinished(): void {
    // 状态机会自动切换到 INPUT_READY
    console.log('Playback finished');
    
    // 发送 TTS_PLAY_ENDED 消息（如果 trace_id 和 group_id 存在）
    if (this.currentTraceId && this.currentGroupId) {
      const tsEndMs = Date.now();
      this.wsClient.sendTtsPlayEnded(this.currentTraceId, this.currentGroupId, tsEndMs);
      console.log(`Sent TTS_PLAY_ENDED: trace_id=${this.currentTraceId}, group_id=${this.currentGroupId}, ts_end_ms=${tsEndMs}`);
    } else {
      console.warn('Cannot send TTS_PLAY_ENDED: missing trace_id or group_id');
    }
  }

  /**
   * 连接服务器
   * @param srcLang 源语言
   * @param tgtLang 目标语言
   * @param features 可选功能标志（由用户选择）
   */
  async connect(srcLang: string = 'zh', tgtLang: string = 'en', features?: FeatureFlags): Promise<void> {
    await this.wsClient.connect(srcLang, tgtLang, features);
    await this.recorder.initialize();
  }

  /**
   * 开始录音
   */
  async startRecording(): Promise<void> {
    if (this.stateMachine.getState() === SessionState.INPUT_READY) {
      this.audioBuffer = [];
      this.asrSubtitle.clear();
      // 清空当前的 trace_id 和 group_id（新的 utterance）
      this.currentTraceId = null;
      this.currentGroupId = null;
      this.stateMachine.startRecording();
      await this.recorder.start();
    }
  }

  /**
   * 停止录音（Send 按钮）
   */
  stopRecording(): void {
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
      this.recorder.stop();
      this.stateMachine.stopRecording();
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.recorder.close();
    this.wsClient.disconnect();
    this.ttsPlayer.stop();
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
}

// 初始化应用
const app = new App();

// 导出给 UI 使用
(window as any).app = app;

// UI 初始化
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('app');
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <h1>Lingua 实时语音翻译</h1>
      
      <div id="status" style="margin: 20px 0; padding: 10px; background: #f0f0f0; border-radius: 8px;">
        状态: <span id="status-text">准备就绪</span>
      </div>

      <div id="asr-subtitle-container" style="margin: 20px 0;">
        <div style="font-weight: bold; margin-bottom: 10px;">ASR 字幕：</div>
        <div id="asr-subtitle"></div>
      </div>

      <div style="margin: 20px 0;">
        <button id="connect-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;">
          连接服务器
        </button>
        <button id="start-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          开始录音
        </button>
        <button id="send-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          结束本轮 (Send)
        </button>
      </div>

      <div style="margin: 20px 0;">
        <label>
          源语言: 
          <select id="src-lang" style="padding: 5px; margin: 5px;">
            <option value="zh">中文</option>
            <option value="en">英文</option>
          </select>
        </label>
        <label>
          目标语言: 
          <select id="tgt-lang" style="padding: 5px; margin: 5px;">
            <option value="en">英文</option>
            <option value="zh">中文</option>
          </select>
        </label>
      </div>

      <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
        <div style="font-weight: bold; margin-bottom: 10px;">可选功能：</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="feature-emotion" style="margin-right: 8px; cursor: pointer;">
            <span>情感检测</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="feature-voice-style" style="margin-right: 8px; cursor: pointer;">
            <span>音色风格检测</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="feature-speech-rate-detection" style="margin-right: 8px; cursor: pointer;">
            <span>语速检测</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="feature-speech-rate-control" style="margin-right: 8px; cursor: pointer;">
            <span>语速控制</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="feature-speaker-id" style="margin-right: 8px; cursor: pointer;">
            <span>音色识别</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="feature-persona" style="margin-right: 8px; cursor: pointer;">
            <span>个性化适配</span>
          </label>
        </div>
      </div>
    </div>
  `;

  // 初始化字幕
  const asrSubtitle = new AsrSubtitle('asr-subtitle-container');

  // 按钮事件
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const statusText = document.getElementById('status-text') as HTMLElement;

  connectBtn.addEventListener('click', async () => {
    const srcLang = (document.getElementById('src-lang') as HTMLSelectElement).value;
    const tgtLang = (document.getElementById('tgt-lang') as HTMLSelectElement).value;
    
    // 收集用户选择的功能（只包含选中的功能）
    const features: FeatureFlags = {};
    
    const emotionCheckbox = (document.getElementById('feature-emotion') as HTMLInputElement);
    const voiceStyleCheckbox = (document.getElementById('feature-voice-style') as HTMLInputElement);
    const speechRateDetectionCheckbox = (document.getElementById('feature-speech-rate-detection') as HTMLInputElement);
    const speechRateControlCheckbox = (document.getElementById('feature-speech-rate-control') as HTMLInputElement);
    const speakerIdCheckbox = (document.getElementById('feature-speaker-id') as HTMLInputElement);
    const personaCheckbox = (document.getElementById('feature-persona') as HTMLInputElement);
    
    if (emotionCheckbox.checked) {
      features.emotion_detection = true;
    }
    if (voiceStyleCheckbox.checked) {
      features.voice_style_detection = true;
    }
    if (speechRateDetectionCheckbox.checked) {
      features.speech_rate_detection = true;
    }
    if (speechRateControlCheckbox.checked) {
      features.speech_rate_control = true;
    }
    if (speakerIdCheckbox.checked) {
      features.speaker_identification = true;
    }
    if (personaCheckbox.checked) {
      features.persona_adaptation = true;
    }
    
    // 如果没有任何功能被选中，传递 undefined（或空对象）
    const featuresToSend = Object.keys(features).length > 0 ? features : undefined;
    
    try {
      await app.connect(srcLang, tgtLang, featuresToSend);
      statusText.textContent = '已连接';
      connectBtn.disabled = true;
      startBtn.disabled = false;
    } catch (error) {
      alert('连接失败: ' + error);
    }
  });

  startBtn.addEventListener('click', async () => {
    await app.startRecording();
    statusText.textContent = '正在录音...';
    startBtn.disabled = true;
    sendBtn.disabled = false;
  });

  sendBtn.addEventListener('click', () => {
    app.stopRecording();
    statusText.textContent = '等待结果...';
    sendBtn.disabled = true;
  });

  // 状态监听（通过公共方法）
  const stateMachine = (app as any).stateMachine;
  if (stateMachine) {
    stateMachine.onStateChange((newState: SessionState) => {
    switch (newState) {
      case SessionState.INPUT_READY:
        statusText.textContent = '准备就绪';
        startBtn.disabled = false;
        sendBtn.disabled = true;
        break;
      case SessionState.INPUT_RECORDING:
        statusText.textContent = '正在录音...';
        startBtn.disabled = true;
        sendBtn.disabled = false;
        break;
      case SessionState.WAITING_RESULT:
        statusText.textContent = '等待结果...';
        startBtn.disabled = true;
        sendBtn.disabled = true;
        break;
      case SessionState.PLAYING_TTS:
        statusText.textContent = '播放中...';
        startBtn.disabled = true;
        sendBtn.disabled = true;
        break;
    }
    });
  }
});

