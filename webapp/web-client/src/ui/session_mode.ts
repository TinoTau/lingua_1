/**
 * 会话模式 UI 模块
 * 负责渲染和管理会话模式的用户界面
 */

import { App } from '../app';
import { SessionState, FeatureFlags } from '../types';
import { getSessionModeTemplate } from './session_mode_template';

// 服务模式类型
type ServiceMode = 'personal_voice' | 'voice_translation' | 'original_subtitle' | 'bilingual_subtitle' | 'text_translation';

/**
 * 渲染会话模式界面
 */
export function renderSessionMode(container: HTMLElement, app: App): void {
  console.log('[SessionMode] renderSessionMode 开始执行', {
    container: !!container,
    app: !!app,
    containerId: container.id,
  });
  
  try {
    container.innerHTML = getSessionModeTemplate();

    // 使用 setTimeout 确保 DOM 已经完全更新后再绑定事件
    setTimeout(() => {
      try {
        setupSessionModeEventHandlers(container, app);
        console.log('[SessionMode] renderSessionMode 执行完成');
      } catch (error) {
        console.error('[SessionMode] setupSessionModeEventHandlers 执行失败:', error);
        throw error;
      }
    }, 0);
  } catch (error) {
    console.error('[SessionMode] renderSessionMode 执行失败:', error);
    throw error;
  }
}

/**
 * 设置会话模式事件处理器
 */
function setupSessionModeEventHandlers(container: HTMLElement, app: App): void {
  console.log('[SessionMode] setupSessionModeEventHandlers 开始执行');
  
  // 清理之前的定时器和事件监听器（如果有）
  // 注意：这里我们需要存储之前的清理函数，但由于每次调用都会创建新的闭包，
  // 所以我们只能在当前作用域内清理
  
  let selectedMode: ServiceMode | null = null;
  
  // 服务模式按钮事件 - 选择模式时自动连接服务器
  // 使用 container.querySelectorAll 而不是 document.querySelectorAll，避免选择到其他页面的元素
  const modeButtons = container.querySelectorAll('.mode-btn');
  console.log('[SessionMode] 找到模式按钮数量:', modeButtons.length);
  modeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      // 移除所有选中状态
      modeButtons.forEach(b => b.classList.remove('selected'));
      // 添加选中状态
      btn.classList.add('selected');
      selectedMode = (btn as HTMLElement).dataset.mode as ServiceMode;
      
      // 根据模式显示/隐藏相关区域
      updateUIForMode(selectedMode);
      
      // 自动连接服务器（始终使用双向模式）
      await connectWithSelectedMode(selectedMode);
    });
  });

  // 根据选择的模式自动连接服务器（始终使用双向模式）
  async function connectWithSelectedMode(mode: ServiceMode) {
    // 根据选择的模式设置 pipeline 配置
    let pipeline: any = {};
    switch (mode) {
      case 'personal_voice':
        pipeline = { use_asr: true, use_nmt: true, use_tts: false, use_tone: true };
        break;
      case 'voice_translation':
        pipeline = { use_asr: true, use_nmt: true, use_tts: true, use_tone: false };
        break;
      case 'original_subtitle':
        pipeline = { use_asr: true, use_nmt: false, use_tts: false, use_tone: false };
        break;
      case 'bilingual_subtitle':
        pipeline = { use_asr: true, use_nmt: true, use_tts: false, use_tone: false };
        break;
      case 'text_translation':
        pipeline = { use_asr: false, use_nmt: true, use_tts: false, use_tone: false };
        break;
    }

    // 存储 pipeline 配置到 App 实例
    (app as any).pipelineConfig = pipeline;

    try {
      statusText.textContent = '正在连接服务器...';
      
      // 始终使用双向互译模式
      const langA = (document.getElementById('lang-a') as HTMLSelectElement)?.value || 'zh';
      const langB = (document.getElementById('lang-b') as HTMLSelectElement)?.value || 'en';
      await app.connectTwoWay(langA, langB, undefined);
      
      statusText.textContent = '已连接';
      if (mode !== 'text_translation') {
        startBtn.disabled = false;
      }
      const isConnected = app.isConnected();
      if (playbackRateBtn) {
        playbackRateBtn.disabled = !isConnected;
      }
    } catch (error: any) {
      statusText.textContent = '连接失败';
      alert('连接失败: ' + (error?.message || error));
    }
  }

  // 更新UI根据选择的模式
  function updateUIForMode(mode: ServiceMode) {
    const languageConfig = document.getElementById('language-config') as HTMLElement;
    const textInputSection = document.getElementById('text-input-section') as HTMLElement;
    const subtitleContainer = document.getElementById('subtitle-container') as HTMLElement;
    const twoWayConfig = document.getElementById('two-way-config') as HTMLElement;
    const bilingualSubtitle = document.getElementById('bilingual-subtitle') as HTMLElement;

    // 重置显示状态
    languageConfig.style.display = 'none';
    textInputSection.style.display = 'none';
    subtitleContainer.style.display = 'none';
    twoWayConfig.style.display = 'none';
    bilingualSubtitle.style.display = 'none';

    switch (mode) {
      case 'text_translation':
        // 文本翻译：只显示文本输入
        languageConfig.style.display = 'block';
        twoWayConfig.style.display = 'flex';
        textInputSection.style.display = 'block';
        break;
      case 'original_subtitle':
        // 原文字幕：显示字幕区域
        languageConfig.style.display = 'block';
        twoWayConfig.style.display = 'flex';
        subtitleContainer.style.display = 'block';
        break;
      case 'bilingual_subtitle':
        // 双语字幕：显示双语字幕区域
        languageConfig.style.display = 'block';
        twoWayConfig.style.display = 'flex';
        subtitleContainer.style.display = 'block';
        bilingualSubtitle.style.display = 'block';
        break;
      case 'voice_translation':
      case 'personal_voice':
        // 语音转译：显示语言配置
        languageConfig.style.display = 'block';
        twoWayConfig.style.display = 'flex';
        break;
    }
  }

  // 按钮事件
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
  const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
  const textSubmitBtn = document.getElementById('text-submit-btn') as HTMLButtonElement;
  const textTranslationResult = document.getElementById('text-translation-result') as HTMLElement;
  const textTranslatedContent = document.getElementById('text-translated-content') as HTMLElement;

  // 文本翻译提交
  textSubmitBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) {
      alert('请输入要翻译的文本');
      return;
    }

    if (!app.isConnected()) {
      alert('请先连接服务器');
      return;
    }

    try {
      textSubmitBtn.disabled = true;
      textSubmitBtn.textContent = '翻译中...';
      
      // TODO: 实现文本翻译API调用
      // 这里需要调用调度服务器的文本翻译接口
      // 暂时显示占位符
      textTranslatedContent.textContent = '文本翻译功能待实现...';
      textTranslationResult.style.display = 'block';
      
      // 模拟延迟
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      alert('翻译失败: ' + error);
    } finally {
      textSubmitBtn.disabled = false;
      textSubmitBtn.textContent = '提交翻译';
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
      // 在播放前，先发送已积累的语音（作为手动截断），然后再播放
      // 这样调度服务器可以finalize已累积的音频块，避免播放期间计时器继续计时导致播放后输入语音被强制截断
      try {
        await app.sendCurrentUtterance();
      } catch (error) {
        console.error('[UI] 发送当前话语失败:', error);
      }
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
            statusText.textContent = isConnected ? '已连接，准备就绪' : '准备就绪';
          }
          const shouldEnableStartBtn = !isSessionActive && isConnected && selectedMode !== 'text_translation';
          startBtn.disabled = !shouldEnableStartBtn;
          sendBtn.disabled = true;
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
