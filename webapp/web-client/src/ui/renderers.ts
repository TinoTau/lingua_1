import { App } from '../app';
import { SessionState, FeatureFlags } from '../types';

// UI 状态管理
export type UIMode = 'main' | 'session' | 'room-create' | 'room-join' | 'room';

// UI 状态（通过闭包共享）
let currentUIMode: UIMode = 'main';

/**
 * 设置当前 UI 模式
 */
export function setUIMode(mode: UIMode): void {
  currentUIMode = mode;
}

/**
 * 获取当前 UI 模式
 */
export function getUIMode(): UIMode {
  return currentUIMode;
}

/**
 * 渲染主菜单
 */
export function renderMainMenu(container: HTMLElement, app: App): void {
  container.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <h1>Lingua 实时语音翻译</h1>
      
      <div style="margin: 40px 0;">
        <h2>选择模式</h2>
        <div style="display: flex; gap: 20px; justify-content: center; margin-top: 30px;">
          <button id="session-mode-btn" style="padding: 20px 40px; font-size: 18px; cursor: pointer; border: 2px solid #007bff; background: white; border-radius: 8px;">
            单会话模式
          </button>
          <button id="room-mode-btn" style="padding: 20px 40px; font-size: 18px; cursor: pointer; border: 2px solid #28a745; background: white; border-radius: 8px;">
            房间模式
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('session-mode-btn')?.addEventListener('click', () => {
    currentUIMode = 'session';
    renderSessionMode(container, app);
  });

  document.getElementById('room-mode-btn')?.addEventListener('click', () => {
    currentUIMode = 'room-create';
    renderRoomMode(container, app);
  });
}

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
      if (mode === 'two_way_auto') {
        // 双向模式
        await app.connectTwoWay(langA, langB, featuresToSend);
      } else {
        // 单向模式
        await app.connect(srcLang, tgtLang, featuresToSend);
      }
      statusText.textContent = '已连接';
      connectBtn.disabled = true;
      startBtn.disabled = false;
      // 连接成功后，立即启用倍速按钮
      const isConnected = app.isConnected();
      console.log('[UI] 连接成功:', {
        isConnected,
        playbackRateBtnExists: !!playbackRateBtn
      });
      if (playbackRateBtn) {
        playbackRateBtn.disabled = !isConnected;
        console.log('[UI] 连接后更新倍速按钮:', {
          isConnected,
          disabled: playbackRateBtn.disabled
        });
      }
    } catch (error) {
      alert('连接失败: ' + error);
    }
  });

  startBtn.addEventListener('click', async () => {
    console.log('[UI] 开始按钮被点击，当前状态:', {
      state: app.getStateMachine()?.getState(),
      isSessionActive: app.getStateMachine()?.getIsSessionActive(),
      isConnected: app.isConnected()
    });
    try {
      await app.startSession();
      console.log('[UI] startSession 调用完成，新状态:', app.getStateMachine()?.getState());
    } catch (error) {
      console.error('[UI] startSession 失败:', error);
      alert('开始会话失败: ' + error);
    }
    // 状态变化会通过状态监听自动更新按钮状态，这里不需要手动设置
  });

  sendBtn.addEventListener('click', () => {
    // 添加动态效果：点击反馈
    sendBtn.style.transform = 'scale(0.95)';
    sendBtn.style.opacity = '0.8';
    sendBtn.style.transition = 'all 0.1s ease';

    // 执行发送操作
    app.sendCurrentUtterance();

    // 恢复按钮样式（延迟恢复，让用户看到反馈）
    setTimeout(() => {
      sendBtn.style.transform = 'scale(1)';
      sendBtn.style.opacity = '1';
    }, 150);

    // 添加闪烁效果（可选）
    sendBtn.style.boxShadow = '0 0 10px rgba(0, 123, 255, 0.5)';
    setTimeout(() => {
      sendBtn.style.boxShadow = '';
    }, 300);
  });

  playPauseBtn.addEventListener('click', async () => {
    const isPlaying = app.isTtsPlaying();
    if (isPlaying) {
      // 暂停播放
      app.pauseTtsPlayback();
    } else {
      // 开始播放
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
    // 状态变化会通过状态监听自动更新按钮状态，这里不需要手动设置
  });

  // 定期更新播放按钮的时长显示（在 INPUT_RECORDING 状态时）
  let durationUpdateInterval: number | null = null;
  const startDurationUpdate = () => {
    if (durationUpdateInterval) {
      clearInterval(durationUpdateInterval);
    }
    durationUpdateInterval = window.setInterval(() => {
      if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
        const hasPendingAudio = app.hasPendingTtsAudio();
        if (hasPendingAudio && playPauseText) {
          const duration = app.getTtsAudioDuration();
          playPauseText.textContent = `播放 (${duration.toFixed(1)}s)`;
        }
      }
    }, 500); // 每500ms更新一次
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
    }, 500); // 每500ms闪烁一次
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
      console.log('[UI] 内存压力变化:', pressure);

      if (pressure === 'warning') {
        // 内存压力50%：开始闪烁提醒
        if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
          const hasPendingAudio = app.hasPendingTtsAudio();
          if (hasPendingAudio && !app.isTtsPlaying()) {
            startBlink();
          }
        }
      } else if (pressure === 'critical') {
        // 内存压力80%：停止闪烁（因为会自动播放）
        stopBlink();
        // 显示紧急提示
        if (statusText) {
          // const originalText = statusText.textContent; // 保留用于未来可能的恢复功能
          statusText.textContent = '⚠️ 内存压力过高，自动播放中...';
          statusText.style.color = '#dc3545';
          setTimeout(() => {
            if (statusText) {
              statusText.style.color = '';
            }
          }, 3000);
        }
      } else {
        // 正常：停止闪烁
        stopBlink();
      }
    };
  }

  // 状态监听（通过公共方法）
  const stateMachine = app.getStateMachine();
  if (stateMachine) {
    stateMachine.onStateChange((newState: SessionState, oldState?: SessionState) => {
      const isSessionActive = stateMachine.getIsSessionActive ? stateMachine.getIsSessionActive() : false;
      const isConnected = app.isConnected(); // 在 switch 之前声明，所有 case 都可以使用

      // 如果是状态不变的通知（UI 更新），记录日志
      const isUIUpdate = oldState === newState;
      if (isUIUpdate) {
        console.log('[UI] UI 更新通知（状态未变化）:', {
          state: newState,
          isSessionActive,
          isConnected,
          hasPendingAudio: app.hasPendingTtsAudio(),
          duration: app.getTtsAudioDuration()
        });
      } else {
        console.log('[UI] 状态变化:', {
          newState,
          oldState,
          isSessionActive,
          isConnected,
          playbackRateBtnExists: !!playbackRateBtn
        });
      }

      switch (newState) {
        case SessionState.INPUT_READY:
          // 停止定期更新播放按钮时长
          stopDurationUpdate();
          if (isSessionActive) {
            statusText.textContent = '会话进行中，准备就绪';
          } else {
            statusText.textContent = '准备就绪';
          }
          // 只有在会话未开始时，开始按钮才可用
          // 同时需要确保 WebSocket 已连接
          const shouldEnableStartBtn = !isSessionActive && isConnected;
          startBtn.disabled = !shouldEnableStartBtn;
          console.log('[UI] INPUT_READY: 开始按钮状态', {
            isSessionActive,
            isConnected,
            shouldEnableStartBtn,
            disabled: startBtn.disabled
          });
          sendBtn.disabled = true;
          playPauseBtn.disabled = true;
          // 倍速按钮：连接建立后即可使用（作为配置）
          if (playbackRateBtn) {
            const shouldEnable = isConnected;
            playbackRateBtn.disabled = !shouldEnable;
            console.log('[UI] INPUT_READY: 倍速按钮状态', {
              isConnected,
              isSessionActive,
              shouldEnable,
              disabled: playbackRateBtn.disabled
            });
          }
          endBtn.disabled = !isSessionActive;
          // 隐藏 TTS 音频信息
          ttsAudioInfo.style.display = 'none';
          break;
        case SessionState.INPUT_RECORDING:
          statusText.textContent = isSessionActive ? '会话进行中，正在监听...' : '正在录音...';
          startBtn.disabled = true;
          sendBtn.disabled = !isSessionActive; // 只有在会话进行中时，发送按钮才可用
          console.log('[UI] INPUT_RECORDING: sendBtn 状态', {
            isSessionActive,
            sendBtnDisabled: sendBtn.disabled
          });
          // 开始定期更新播放按钮时长
          startDurationUpdate();
          // 播放按钮：只有在有待播放音频时才可用
          const hasPendingAudio = app.hasPendingTtsAudio();
          playPauseBtn.disabled = !hasPendingAudio;
          // 倍速按钮：连接建立后即可使用（作为配置）
          if (playbackRateBtn) {
            const shouldEnable = isConnected;
            playbackRateBtn.disabled = !shouldEnable;
            console.log('[UI] INPUT_RECORDING: 倍速按钮状态', {
              isConnected,
              isSessionActive,
              shouldEnable,
              disabled: playbackRateBtn.disabled
            });
          }
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          if (hasPendingAudio) {
            // INPUT_RECORDING状态：播放按钮显示可播放音频时长（秒）
            const duration = app.getTtsAudioDuration();
            playPauseText.textContent = `播放 (${duration.toFixed(1)}s)`;
            ttsAudioInfo.style.display = 'block';
            ttsDuration.textContent = duration.toFixed(1);
          } else {
            playPauseText.textContent = '播放';
            ttsAudioInfo.style.display = 'none';
          }
          endBtn.disabled = !isSessionActive; // 只有在会话进行中时，结束按钮才可用
          break;
        case SessionState.PLAYING_TTS:
          // 停止定期更新播放按钮时长
          stopDurationUpdate();
          // 停止闪烁（因为正在播放）
          stopBlink();
          statusText.textContent = '播放翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true; // 播放时禁用发送按钮
          playPauseBtn.disabled = false; // 播放按钮可用（用于暂停）
          // PLAYING_TTS状态：播放按钮变为暂停按钮，不显示时长
          playPauseText.textContent = '暂停';
          if (playbackRateBtn) {
            playbackRateBtn.disabled = false; // 播放时倍速按钮可用
          }
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          endBtn.disabled = !isSessionActive;
          // 显示 TTS 音频信息（但不显示在播放按钮上）
          ttsAudioInfo.style.display = 'block';
          const duration = app.getTtsAudioDuration();
          ttsDuration.textContent = duration.toFixed(1);
          console.log('[UI] PLAYING_TTS: sendBtn 已禁用', {
            isSessionActive,
            sendBtnDisabled: sendBtn.disabled
          });
          break;
      }
    });
  }
}

/**
 * 渲染房间模式界面
 */
export function renderRoomMode(container: HTMLElement, app: App): void {
  container.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <h1>房间模式</h1>
      
      <div style="margin: 40px 0;">
        <button id="back-to-main-btn" style="padding: 10px 20px; margin: 10px; font-size: 14px; cursor: pointer;">
          返回主菜单
        </button>
      </div>

      <div style="margin: 40px 0;">
        <h2>创建或加入房间</h2>
        
        <div style="margin: 30px 0;">
          <button id="create-room-btn" style="padding: 15px 30px; margin: 10px; font-size: 16px; cursor: pointer; background: #28a745; color: white; border: none; border-radius: 8px;">
            创建房间
          </button>
        </div>

        <div style="margin: 30px 0;">
          <h3>加入房间</h3>
          <div style="margin: 20px 0;">
            <input type="text" id="room-code-input" placeholder="输入6位房间码" maxlength="6" style="padding: 10px; font-size: 16px; width: 200px; text-align: center; letter-spacing: 5px;">
          </div>
          <div style="margin: 20px 0;">
            <input type="text" id="display-name-input" placeholder="显示名称（可选）" style="padding: 10px; font-size: 14px; width: 200px;">
          </div>
          <button id="join-room-btn" style="padding: 15px 30px; margin: 10px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 8px;">
            加入房间
          </button>
        </div>

        <div id="room-status" style="margin: 20px 0; padding: 10px; background: #f0f0f0; border-radius: 8px; display: none;">
          <span id="room-status-text"></span>
        </div>
      </div>
    </div>
  `;

  document.getElementById('back-to-main-btn')?.addEventListener('click', () => {
    currentUIMode = 'main';
    renderMainMenu(container, app);
  });

  document.getElementById('create-room-btn')?.addEventListener('click', async () => {
    // 先连接服务器（如果未连接）
    const wsClient = (app as any).wsClient;
    if (!wsClient || !wsClient.isConnected()) {
      try {
        const srcLang = 'zh';
        const tgtLang = 'en';
        await app.connect(srcLang, tgtLang);
      } catch (error) {
        alert('连接服务器失败: ' + error);
        return;
      }
    }

    app.createRoom();
    const statusDiv = document.getElementById('room-status');
    const statusText = document.getElementById('room-status-text');
    if (statusDiv && statusText) {
      statusDiv.style.display = 'block';
      statusText.textContent = '正在创建房间...';
    }
  });

  document.getElementById('join-room-btn')?.addEventListener('click', async () => {
    // 先连接服务器（如果未连接）
    const wsClient = (app as any).wsClient;
    if (!wsClient || !wsClient.isConnected()) {
      try {
        const srcLang = 'zh';
        const tgtLang = 'en';
        await app.connect(srcLang, tgtLang);
      } catch (error) {
        alert('连接服务器失败: ' + error);
        return;
      }
    }

    const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
    const displayNameInput = document.getElementById('display-name-input') as HTMLInputElement;
    const roomCode = roomCodeInput.value.trim();
    const displayName = displayNameInput.value.trim() || undefined;

    if (!/^\d{6}$/.test(roomCode)) {
      alert('房间码必须是6位数字');
      return;
    }

    app.joinRoom(roomCode, displayName);
    const statusDiv = document.getElementById('room-status');
    const statusText = document.getElementById('room-status-text');
    if (statusDiv && statusText) {
      statusDiv.style.display = 'block';
      statusText.textContent = '正在加入房间...';
    }
  });
}

/**
 * 渲染房间界面
 */
export function renderRoom(container: HTMLElement, app: App): void {
  const roomCode = app.getCurrentRoomCode() || '';
  const members = app.getRoomMembers();

  container.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <h1>房间模式</h1>
      
      <div style="margin: 20px 0; padding: 15px; background: #e7f3ff; border-radius: 8px;">
        <h2>房间码: <span id="room-code-display">${roomCode}</span></h2>
      </div>

      <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
        <h3>成员列表 (${members.length})</h3>
        <div id="members-list" style="margin-top: 10px; text-align: left;">
          ${members.map((m, idx) => {
    const memberId = m.session_id || m.participant_id;
    const memberName = m.display_name || memberId;
    const isSelf = memberId === app.getSessionId();
    // 获取当前用户对该成员的原声接收偏好（默认 true）
    const currentSessionId = app.getSessionId();
    const rawVoicePrefs = m.raw_voice_preferences || {};
    const receiveRawVoice = currentSessionId ? (rawVoicePrefs[currentSessionId] !== false) : true;

    if (isSelf) {
      return `<div style="padding: 8px; border-bottom: 1px solid #ddd;">
                <strong>${memberName}</strong> <span style="color: #666;">(我)</span>
              </div>`;
    } else {
      return `<div style="padding: 8px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
                <span>${memberName}</span>
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                  <input type="checkbox" 
                         id="raw-voice-${idx}" 
                         data-target-session-id="${memberId}"
                         ${receiveRawVoice ? 'checked' : ''}
                         style="cursor: pointer;">
                  <span style="font-size: 12px; color: #666;">接收原声</span>
                </label>
              </div>`;
    }
  }).join('')}
        </div>
      </div>

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
        <button id="start-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          开始
        </button>
        <button id="send-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          发送
        </button>
        <button id="play-pause-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer; background: #28a745; color: white; border: none; border-radius: 8px;" disabled>
          <span id="play-pause-text">播放</span>
        </button>
        <button id="end-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          结束
        </button>
        <button id="leave-room-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer; background: #dc3545; color: white; border: none; border-radius: 8px;">
          退出房间
        </button>
      </div>
      
      <div id="tts-audio-info" style="margin: 10px 0; padding: 10px; background: #e7f3ff; border-radius: 8px; display: none;">
        <div style="font-size: 14px; color: #0066cc;">
          可播放音频时长: <span id="tts-duration">0.0</span> 秒
        </div>
      </div>
    </div>
  `;

  // 房间内按钮事件
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const playPauseBtn = document.getElementById('play-pause-btn') as HTMLButtonElement;
  const playPauseText = document.getElementById('play-pause-text') as HTMLElement;
  const playbackRateBtn = document.getElementById('playback-rate-btn') as HTMLButtonElement;
  const playbackRateText = document.getElementById('playback-rate-text') as HTMLElement;
  const endBtn = document.getElementById('end-btn') as HTMLButtonElement;
  const leaveRoomBtn = document.getElementById('leave-room-btn') as HTMLButtonElement;
  const statusText = document.getElementById('status-text') as HTMLElement;
  const ttsAudioInfo = document.getElementById('tts-audio-info') as HTMLElement;
  const ttsDuration = document.getElementById('tts-duration') as HTMLElement;

  startBtn.addEventListener('click', async () => {
    console.log('[UI-房间] 开始按钮被点击');
    await app.startSession();
    // 状态变化会通过状态监听自动更新按钮状态，这里不需要手动设置
    // 手动触发一次状态检查，确保倍速按钮状态更新
    setTimeout(() => {
      const isConnected = app.isConnected();
      if (playbackRateBtn) {
        playbackRateBtn.disabled = !isConnected;
        console.log('[UI-房间] 开始会话后更新倍速按钮:', {
          isConnected,
          disabled: playbackRateBtn.disabled
        });
      }
    }, 100);
  });

  sendBtn.addEventListener('click', () => {
    // 添加动态效果：点击反馈
    sendBtn.style.transform = 'scale(0.95)';
    sendBtn.style.opacity = '0.8';
    sendBtn.style.transition = 'all 0.1s ease';

    // 执行发送操作
    app.sendCurrentUtterance();

    // 恢复按钮样式（延迟恢复，让用户看到反馈）
    setTimeout(() => {
      sendBtn.style.transform = 'scale(1)';
      sendBtn.style.opacity = '1';
    }, 150);

    // 添加闪烁效果（可选）
    sendBtn.style.boxShadow = '0 0 10px rgba(0, 123, 255, 0.5)';
    setTimeout(() => {
      sendBtn.style.boxShadow = '';
    }, 300);
  });

  playPauseBtn.addEventListener('click', async () => {
    const isPlaying = app.isTtsPlaying();
    if (isPlaying) {
      // 暂停播放
      app.pauseTtsPlayback();
    } else {
      // 开始播放
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

  leaveRoomBtn.addEventListener('click', () => {
    app.leaveRoom();
    currentUIMode = 'main';
    renderMainMenu(container, app);
  });

  // 定期更新播放按钮的时长显示（在 INPUT_RECORDING 状态时）- 会议室模式
  let roomDurationUpdateInterval: number | null = null;
  const startRoomDurationUpdate = () => {
    if (roomDurationUpdateInterval) {
      clearInterval(roomDurationUpdateInterval);
    }
    roomDurationUpdateInterval = window.setInterval(() => {
      if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
        const hasPendingAudio = app.hasPendingTtsAudio();
        if (hasPendingAudio && playPauseText) {
          const duration = app.getTtsAudioDuration();
          playPauseText.textContent = `播放 (${duration.toFixed(1)}s)`;
        }
      }
    }, 500); // 每500ms更新一次
  };
  const stopRoomDurationUpdate = () => {
    if (roomDurationUpdateInterval) {
      clearInterval(roomDurationUpdateInterval);
      roomDurationUpdateInterval = null;
    }
  };

  // 播放按钮闪烁效果（内存压力警告）- 会议室模式
  let roomBlinkInterval: number | null = null;
  let isRoomBlinking = false;
  const startRoomBlink = () => {
    if (isRoomBlinking) return;
    isRoomBlinking = true;
    let blinkState = false;
    roomBlinkInterval = window.setInterval(() => {
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
  const stopRoomBlink = () => {
    if (roomBlinkInterval) {
      clearInterval(roomBlinkInterval);
      roomBlinkInterval = null;
    }
    isRoomBlinking = false;
    if (playPauseBtn) {
      playPauseBtn.style.boxShadow = '';
      playPauseBtn.style.backgroundColor = '#28a745';
    }
  };

  // 监听内存压力变化（会议室模式）
  if (typeof window !== 'undefined') {
    const originalOnMemoryPressure = (window as any).onMemoryPressure;
    (window as any).onMemoryPressure = (pressure: 'normal' | 'warning' | 'critical') => {
      if (originalOnMemoryPressure) {
        originalOnMemoryPressure(pressure);
      }

      console.log('[UI-房间] 内存压力变化:', pressure);

      if (pressure === 'warning') {
        if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
          const hasPendingAudio = app.hasPendingTtsAudio();
          if (hasPendingAudio && !app.isTtsPlaying()) {
            startRoomBlink();
          }
        }
      } else if (pressure === 'critical') {
        stopRoomBlink();
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
        stopRoomBlink();
      }
    };
  }

  // 状态监听
  const stateMachine = app.getStateMachine();
  if (stateMachine) {
    stateMachine.onStateChange((newState: SessionState) => {
      const isSessionActive = stateMachine.getIsSessionActive ? stateMachine.getIsSessionActive() : false;
      const isConnected = app.isConnected(); // 在 switch 之前声明，所有 case 都可以使用

      switch (newState) {
        case SessionState.INPUT_READY:
          // 停止定期更新播放按钮时长
          stopRoomDurationUpdate();
          statusText.textContent = isSessionActive ? '会话进行中，准备就绪' : '准备就绪';
          startBtn.disabled = isSessionActive;
          sendBtn.disabled = true;
          if (playPauseBtn) playPauseBtn.disabled = true;
          // 倍速按钮：连接建立且会话建立后可用（作为配置）
          if (playbackRateBtn) playbackRateBtn.disabled = !(isConnected && isSessionActive);
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          endBtn.disabled = !isSessionActive;
          // 隐藏 TTS 音频信息
          if (ttsAudioInfo) ttsAudioInfo.style.display = 'none';
          break;
        case SessionState.INPUT_RECORDING:
          // 开始定期更新播放按钮时长
          startRoomDurationUpdate();
          statusText.textContent = isSessionActive ? '会话进行中，正在监听...' : '正在录音...';
          startBtn.disabled = true;
          sendBtn.disabled = !isSessionActive;
          // 播放按钮：只有在有待播放音频时才可用
          const hasPendingAudio = app.hasPendingTtsAudio();
          if (playPauseBtn) {
            playPauseBtn.disabled = !hasPendingAudio;
            // INPUT_RECORDING状态：播放按钮显示可播放音频时长（秒）
            if (hasPendingAudio && playPauseText) {
              const duration = app.getTtsAudioDuration();
              playPauseText.textContent = `播放 (${duration.toFixed(1)}s)`;
            } else if (playPauseText) {
              playPauseText.textContent = '播放';
            }
          }
          // 倍速按钮：连接建立后即可使用（作为配置）
          if (playbackRateBtn) {
            const shouldEnable = isConnected;
            playbackRateBtn.disabled = !shouldEnable;
            console.log('[UI-房间] INPUT_RECORDING: 倍速按钮状态', {
              isConnected,
              isSessionActive,
              shouldEnable,
              disabled: playbackRateBtn.disabled
            });
          }
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          if (hasPendingAudio && ttsAudioInfo && ttsDuration) {
            ttsAudioInfo.style.display = 'block';
            const duration = app.getTtsAudioDuration();
            ttsDuration.textContent = duration.toFixed(1);
          } else if (ttsAudioInfo) {
            ttsAudioInfo.style.display = 'none';
          }
          endBtn.disabled = !isSessionActive;
          break;
        case SessionState.PLAYING_TTS:
          // 停止定期更新播放按钮时长
          stopRoomDurationUpdate();
          // 停止闪烁（因为正在播放）
          stopRoomBlink();
          statusText.textContent = '播放翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true; // 播放时禁用发送按钮
          if (playPauseBtn && playPauseText) {
            playPauseBtn.disabled = false; // 播放按钮可用（用于暂停）
            // PLAYING_TTS状态：播放按钮变为暂停按钮，不显示时长
            playPauseText.textContent = '暂停';
          }
          if (playbackRateBtn) {
            playbackRateBtn.disabled = false; // 播放时倍速按钮可用
          }
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          endBtn.disabled = !isSessionActive;
          // 显示 TTS 音频信息（但不显示在播放按钮上）
          if (ttsAudioInfo && ttsDuration) {
            ttsAudioInfo.style.display = 'block';
            const duration = app.getTtsAudioDuration();
            ttsDuration.textContent = duration.toFixed(1);
          }
          break;
      }
    });
  }

  // 监听成员列表更新
  const checkMembers = setInterval(() => {
    if (!app.getIsInRoom()) {
      clearInterval(checkMembers);
      return;
    }
    const currentMembers = app.getRoomMembers();
    const membersList = document.getElementById('members-list');
    if (membersList) {
      const currentSessionId = app.getSessionId();
      membersList.innerHTML = currentMembers.map((m, idx) => {
        const memberId = m.session_id || m.participant_id;
        const memberName = m.display_name || memberId;
        const isSelf = memberId === currentSessionId;
        const rawVoicePrefs = m.raw_voice_preferences || {};
        const receiveRawVoice = currentSessionId ? (rawVoicePrefs[currentSessionId] !== false) : true;

        if (isSelf) {
          return `<div style="padding: 8px; border-bottom: 1px solid #ddd;">
            <strong>${memberName}</strong> <span style="color: #666;">(我)</span>
          </div>`;
        } else {
          return `<div style="padding: 8px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
            <span>${memberName}</span>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
              <input type="checkbox" 
                     id="raw-voice-${idx}" 
                     data-target-session-id="${memberId}"
                     ${receiveRawVoice ? 'checked' : ''}
                     style="cursor: pointer;">
              <span style="font-size: 12px; color: #666;">接收原声</span>
            </label>
          </div>`;
        }
      }).join('');

      // 重新绑定开关事件
      currentMembers.forEach((m, idx) => {
        const memberId = m.session_id || m.participant_id;
        if (memberId !== currentSessionId) {
          const checkbox = document.getElementById(`raw-voice-${idx}`) as HTMLInputElement;
          if (checkbox) {
            checkbox.addEventListener('change', () => {
              const receiveRawVoice = checkbox.checked;
              app.setRawVoicePreference(roomCode, memberId, receiveRawVoice);
            });
          }
        }
      });
    }
  }, 1000);

  // 初始绑定开关事件
  members.forEach((m, idx) => {
    const memberId = m.session_id || m.participant_id;
    const currentSessionId = app.getSessionId();
    if (memberId !== currentSessionId) {
      const checkbox = document.getElementById(`raw-voice-${idx}`) as HTMLInputElement;
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          const receiveRawVoice = checkbox.checked;
          app.setRawVoicePreference(roomCode, memberId, receiveRawVoice);
        });
      }
    }
  });
}

