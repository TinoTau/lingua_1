/**
 * 会话模式 UI 模块
 * 负责渲染和管理会话模式的用户界面
 */

import { App } from '../app';
import { SessionState, FeatureFlags } from '../types';

/**
 * 渲染会话模式界面
 */
export function renderSessionMode(container: HTMLElement, app: App): void {
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

      <div id="translation-result-container" style="margin: 20px 0; padding: 15px; background: #f0f8ff; border-radius: 8px; border: 1px solid #b0d4f1; display: none;">
        <div style="font-weight: bold; margin-bottom: 12px; color: #0066cc; font-size: 16px;">翻译结果：</div>
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 6px; font-size: 14px;">原文 (ASR):</div>
          <div id="translation-original" style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #ddd; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 6px; font-size: 14px;">译文 (NMT):</div>
          <div id="translation-translated" style="padding: 12px; background: #f0f8ff; border-radius: 6px; border: 1px solid #b0d4f1; color: #0066cc; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
      </div>

      <div style="margin: 20px 0;">
        <!-- 第一行：连接服务器、开始、结束 -->
        <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 10px;">
          <button id="connect-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">
            连接服务器
          </button>
          <button id="start-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer;" disabled>
            开始
          </button>
          <button id="end-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer;" disabled>
            结束
          </button>
        </div>
        <!-- 第二行：发送、播放（放大1.5倍）、倍速 -->
        <div style="display: flex; justify-content: center; gap: 10px; align-items: center;">
          <button id="send-btn" style="padding: 15px 30px; margin: 0; font-size: 24px; cursor: pointer;" disabled>
            发送
          </button>
          <button id="play-pause-btn" style="padding: 15px 30px; margin: 0; font-size: 24px; cursor: pointer; background: #28a745; color: white; border: none; border-radius: 8px;" disabled>
            <span id="play-pause-text">播放</span>
          </button>
          <button id="playback-rate-btn" style="padding: 10px 20px; margin: 0; font-size: 16px; cursor: pointer; background: #6c757d; color: white; border: none; border-radius: 8px;" disabled>
            <span id="playback-rate-text">1x</span>
          </button>
        </div>
      </div>
      
      <div id="tts-audio-info" style="margin: 10px 0; padding: 10px; background: #e7f3ff; border-radius: 8px; display: none;">
        <div style="font-size: 14px; color: #0066cc;">
          可播放音频时长: <span id="tts-duration">0.0</span> 秒
        </div>
      </div>

      <div style="margin: 20px 0; padding: 15px; background: #e7f3ff; border-radius: 8px;">
        <div style="font-weight: bold; margin-bottom: 10px;">翻译模式：</div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="radio" name="translation-mode" id="mode-one-way" value="one_way" checked style="margin-right: 8px; cursor: pointer;">
            <span>单向模式</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="radio" name="translation-mode" id="mode-two-way" value="two_way_auto" style="margin-right: 8px; cursor: pointer;">
            <span>双向模式（自动语言检测）</span>
          </label>
        </div>
      </div>

      <div id="one-way-config" style="margin: 20px 0;">
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

      <div id="two-way-config" style="margin: 20px 0; display: none;">
        <div style="margin-bottom: 10px;">
          <label>
            语言 A: 
            <select id="lang-a" style="padding: 5px; margin: 5px;">
              <option value="zh">中文</option>
              <option value="en">英文</option>
            </select>
          </label>
        </div>
        <div>
          <label>
            语言 B: 
            <select id="lang-b" style="padding: 5px; margin: 5px;">
              <option value="en">英文</option>
              <option value="zh">中文</option>
            </select>
          </label>
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-radius: 5px; font-size: 12px; color: #856404;">
          💡 双向模式：系统会自动检测说话语言，并翻译成另一种语言。两人可以自由切换语言，无需手动切换。
        </div>
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

  setupSessionModeEventHandlers(container, app);
}

/**
 * 设置会话模式事件处理器
 */
function setupSessionModeEventHandlers(container: HTMLElement, app: App): void {
  // 按钮事件
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const playPauseBtn = document.getElementById('play-pause-btn') as HTMLButtonElement;
  const playPauseText = document.getElementById('play-pause-text') as HTMLElement;
  const playbackRateBtn = document.getElementById('playback-rate-btn') as HTMLButtonElement;
  const playbackRateText = document.getElementById('playback-rate-text') as HTMLElement;
  const endBtn = document.getElementById('end-btn') as HTMLButtonElement;
  const statusText = document.getElementById('status-text') as HTMLElement;
  const ttsAudioInfo = document.getElementById('tts-audio-info') as HTMLElement;
  const ttsDuration = document.getElementById('tts-duration') as HTMLElement;

  // 翻译模式切换事件
  const oneWayRadio = document.getElementById('mode-one-way') as HTMLInputElement;
  const twoWayRadio = document.getElementById('mode-two-way') as HTMLInputElement;
  const oneWayConfig = document.getElementById('one-way-config') as HTMLElement;
  const twoWayConfig = document.getElementById('two-way-config') as HTMLElement;

  oneWayRadio.addEventListener('change', () => {
    if (oneWayRadio.checked) {
      oneWayConfig.style.display = 'block';
      twoWayConfig.style.display = 'none';
    }
  });

  twoWayRadio.addEventListener('change', () => {
    if (twoWayRadio.checked) {
      oneWayConfig.style.display = 'none';
      twoWayConfig.style.display = 'block';
    }
  });

  connectBtn.addEventListener('click', async () => {
    const mode = (document.querySelector('input[name="translation-mode"]:checked') as HTMLInputElement)?.value || 'one_way';
    const srcLang = (document.getElementById('src-lang') as HTMLSelectElement).value;
    const tgtLang = (document.getElementById('tgt-lang') as HTMLSelectElement).value;
    const langA = (document.getElementById('lang-a') as HTMLSelectElement)?.value || 'zh';
    const langB = (document.getElementById('lang-b') as HTMLSelectElement)?.value || 'en';

    // 收集用户选择的功能
    const features: FeatureFlags = {};
    const emotionCheckbox = (document.getElementById('feature-emotion') as HTMLInputElement);
    const voiceStyleCheckbox = (document.getElementById('feature-voice-style') as HTMLInputElement);
    const speechRateDetectionCheckbox = (document.getElementById('feature-speech-rate-detection') as HTMLInputElement);
    const speechRateControlCheckbox = (document.getElementById('feature-speech-rate-control') as HTMLInputElement);
    const speakerIdCheckbox = (document.getElementById('feature-speaker-id') as HTMLInputElement);
    const personaCheckbox = (document.getElementById('feature-persona') as HTMLInputElement);

    if (emotionCheckbox.checked) features.emotion_detection = true;
    if (voiceStyleCheckbox.checked) features.voice_style_detection = true;
    if (speechRateDetectionCheckbox.checked) features.speech_rate_detection = true;
    if (speechRateControlCheckbox.checked) features.speech_rate_control = true;
    if (speakerIdCheckbox.checked) features.speaker_identification = true;
    if (personaCheckbox.checked) features.persona_adaptation = true;

    const featuresToSend = Object.keys(features).length > 0 ? features : undefined;

    try {
      if (mode === 'two_way_auto') {
        await app.connectTwoWay(langA, langB, featuresToSend);
      } else {
        await app.connect(srcLang, tgtLang, featuresToSend);
      }
      statusText.textContent = '已连接';
      connectBtn.disabled = true;
      startBtn.disabled = false;
      const isConnected = app.isConnected();
      if (playbackRateBtn) {
        playbackRateBtn.disabled = !isConnected;
      }
    } catch (error) {
      alert('连接失败: ' + error);
    }
  });

  startBtn.addEventListener('click', async () => {
    try {
      await app.startSession();
    } catch (error) {
      alert('开始会话失败: ' + error);
    }
  });

  sendBtn.addEventListener('click', () => {
    sendBtn.style.transform = 'scale(0.95)';
    sendBtn.style.opacity = '0.8';
    sendBtn.style.transition = 'all 0.1s ease';
    app.sendCurrentUtterance();
    setTimeout(() => {
      sendBtn.style.transform = 'scale(1)';
      sendBtn.style.opacity = '1';
    }, 150);
    sendBtn.style.boxShadow = '0 0 10px rgba(0, 123, 255, 0.5)';
    setTimeout(() => {
      sendBtn.style.boxShadow = '';
    }, 300);
  });

  playPauseBtn.addEventListener('click', async () => {
    const isPlaying = app.isTtsPlaying();
    if (isPlaying) {
      app.pauseTtsPlayback();
    } else {
      await app.startTtsPlayback();
    }
  });

  playbackRateBtn.addEventListener('click', () => {
    const newRate = app.toggleTtsPlaybackRate();
    if (playbackRateText) {
      playbackRateText.textContent = `${newRate}x`;
    }
  });

  endBtn.addEventListener('click', async () => {
    await app.endSession();
  });

  // 定期更新播放按钮的时长显示
  let durationUpdateInterval: number | null = null;
  const startDurationUpdate = () => {
    if (durationUpdateInterval) {
      clearInterval(durationUpdateInterval);
    }
    durationUpdateInterval = window.setInterval(() => {
      const stateMachine = app.getStateMachine();
      if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
        const hasPendingAudio = app.hasPendingTtsAudio();
        if (hasPendingAudio && playPauseText) {
          const duration = app.getTtsAudioDuration();
          playPauseText.textContent = `播放 (${duration.toFixed(1)}s)`;
        }
      }
    }, 500);
  };
  const stopDurationUpdate = () => {
    if (durationUpdateInterval) {
      clearInterval(durationUpdateInterval);
      durationUpdateInterval = null;
    }
  };

  // 播放按钮闪烁效果（内存压力警告）
  let blinkInterval: number | null = null;
  let isBlinking = false;
  const startBlink = () => {
    if (isBlinking) return;
    isBlinking = true;
    let blinkState = false;
    blinkInterval = window.setInterval(() => {
      if (playPauseBtn) {
        blinkState = !blinkState;
        if (blinkState) {
          playPauseBtn.style.boxShadow = '0 0 20px rgba(255, 193, 7, 0.8)';
          playPauseBtn.style.backgroundColor = '#ffc107';
        } else {
          playPauseBtn.style.boxShadow = '';
          playPauseBtn.style.backgroundColor = '#28a745';
        }
      }
    }, 500);
  };
  const stopBlink = () => {
    if (blinkInterval) {
      clearInterval(blinkInterval);
      blinkInterval = null;
    }
    isBlinking = false;
    if (playPauseBtn) {
      playPauseBtn.style.boxShadow = '';
      playPauseBtn.style.backgroundColor = '#28a745';
    }
  };

  // 监听内存压力变化
  if (typeof window !== 'undefined') {
    (window as any).onMemoryPressure = (pressure: 'normal' | 'warning' | 'critical') => {
      if (pressure === 'warning') {
        const stateMachine = app.getStateMachine();
        if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
          const hasPendingAudio = app.hasPendingTtsAudio();
          if (hasPendingAudio && !app.isTtsPlaying()) {
            startBlink();
          }
        }
      } else if (pressure === 'critical') {
        stopBlink();
        if (statusText) {
          statusText.textContent = '⚠️ 内存压力过高，自动播放中...';
          statusText.style.color = '#dc3545';
          setTimeout(() => {
            if (statusText) {
              statusText.style.color = '';
            }
          }, 3000);
        }
      } else {
        stopBlink();
      }
    };
  }

  // 状态监听
  const stateMachine = app.getStateMachine();
  if (stateMachine) {
    stateMachine.onStateChange((newState: SessionState, oldState?: SessionState) => {
      const isSessionActive = stateMachine.getIsSessionActive ? stateMachine.getIsSessionActive() : false;
      const isConnected = app.isConnected();

      const isUIUpdate = oldState === newState;
      if (isUIUpdate) {
        console.log('[UI] UI 更新通知（状态未变化）');
      }

      switch (newState) {
        case SessionState.INPUT_READY:
          stopDurationUpdate();
          if (isSessionActive) {
            statusText.textContent = '会话进行中，准备就绪';
          } else {
            statusText.textContent = '准备就绪';
          }
          const shouldEnableStartBtn = !isSessionActive && isConnected;
          startBtn.disabled = !shouldEnableStartBtn;
          sendBtn.disabled = true;
          // INPUT_READY 状态下播放按钮禁用（与备份代码逻辑一致）
          // 当状态变为 INPUT_RECORDING 时，状态变化回调会检查 hasPendingAudio 并更新播放按钮
          playPauseBtn.disabled = true;
          playPauseText.textContent = '播放';
          if (playbackRateBtn) {
            playbackRateBtn.disabled = !isConnected;
          }
          endBtn.disabled = !isSessionActive;
          ttsAudioInfo.style.display = 'none';
          break;
        case SessionState.INPUT_RECORDING:
          statusText.textContent = isSessionActive ? '会话进行中，正在监听...' : '正在录音...';
          startBtn.disabled = true;
          sendBtn.disabled = !isSessionActive;
          startDurationUpdate();
          const hasPendingAudio = app.hasPendingTtsAudio();
          playPauseBtn.disabled = !hasPendingAudio;
          if (playbackRateBtn) {
            playbackRateBtn.disabled = !isConnected;
          }
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          if (hasPendingAudio) {
            const duration = app.getTtsAudioDuration();
            playPauseText.textContent = `播放 (${duration.toFixed(1)}s)`;
            ttsAudioInfo.style.display = 'block';
            ttsDuration.textContent = duration.toFixed(1);
          } else {
            playPauseText.textContent = '播放';
            ttsAudioInfo.style.display = 'none';
          }
          endBtn.disabled = !isSessionActive;
          break;
        case SessionState.PLAYING_TTS:
          stopDurationUpdate();
          stopBlink();
          statusText.textContent = '播放翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true;
          playPauseBtn.disabled = false;
          playPauseText.textContent = '暂停';
          if (playbackRateBtn) {
            playbackRateBtn.disabled = false;
          }
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          endBtn.disabled = !isSessionActive;
          ttsAudioInfo.style.display = 'block';
          const duration = app.getTtsAudioDuration();
          ttsDuration.textContent = duration.toFixed(1);
          break;
      }
    });
  }
}

