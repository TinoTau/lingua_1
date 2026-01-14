/**
 * 会话模式 UI 模块
 * 负责渲染和管理会话模式的用户界面
 */

import { App } from '../app';
import { SessionState, FeatureFlags } from '../types';

// 服务模式类型
type ServiceMode = 'personal_voice' | 'voice_translation' | 'original_subtitle' | 'bilingual_subtitle' | 'text_translation';

/**
 * 渲染会话模式界面
 */
export function renderSessionMode(container: HTMLElement, app: App): void {
  container.innerHTML = `
    <div style="max-width: 1200px; margin: 0 auto; padding: 20px;">
      <h1 style="text-align: center; color: #333; margin-bottom: 30px;">Lingua 实时语音翻译</h1>
      
      <!-- 状态栏 -->
      <div id="status" style="margin: 20px 0; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="font-size: 16px; font-weight: bold;">状态: <span id="status-text">准备就绪</span></div>
      </div>


      <!-- 语言配置 -->
      <div id="language-config" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #333;">语言配置：</div>
        <div id="two-way-config" style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
          <div>
            <label style="font-weight: 500; margin-right: 8px;">语言 A:</label>
            <select id="lang-a" style="padding: 8px 12px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer;">
              <option value="zh">中文</option>
              <option value="en">英文</option>
              <option value="ja">日文</option>
              <option value="ko">韩文</option>
            </select>
          </div>
          <div>
            <label style="font-weight: 500; margin-right: 8px;">语言 B:</label>
            <select id="lang-b" style="padding: 8px 12px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer;">
              <option value="en">英文</option>
              <option value="zh">中文</option>
              <option value="ja">日文</option>
              <option value="ko">韩文</option>
            </select>
          </div>
          <div style="width: 100%; margin-top: 10px; padding: 10px; background: #e7f3ff; border-radius: 6px; font-size: 13px; color: #0066cc;">
            💡 双向互译：系统会自动识别语音语言，并翻译到另一种语言
          </div>
        </div>
      </div>

      <!-- 文本输入区域（仅文本翻译模式显示） -->
      <div id="text-input-section" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #333;">文本翻译：</div>
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
          <textarea id="text-input" placeholder="请输入要翻译的文本..." style="flex: 1; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 14px; min-height: 100px; resize: vertical; font-family: inherit;"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end;">
          <button id="text-submit-btn" style="padding: 12px 30px; background: #dc3545; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s;">
            提交翻译
          </button>
        </div>
        <div id="text-translation-result" style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; display: none;">
          <div style="font-weight: bold; margin-bottom: 10px; color: #333;">翻译结果：</div>
          <div id="text-translated-content" style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #ddd; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; min-height: 60px;"></div>
        </div>
      </div>

      <!-- 字幕显示区域 -->
      <div id="subtitle-container" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #333;">实时字幕：</div>
        <div id="asr-subtitle" style="padding: 15px; background: #f8f9fa; border-radius: 8px; min-height: 60px; font-size: 16px; line-height: 1.6; color: #333;"></div>
        <div id="bilingual-subtitle" style="margin-top: 15px; padding: 15px; background: #e7f3ff; border-radius: 8px; min-height: 60px; font-size: 16px; line-height: 1.6; color: #0066cc; display: none;"></div>
      </div>

      <!-- 翻译结果显示区域 -->
      <div id="translation-result-container" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #0066cc;">翻译结果：</div>
        <div style="margin-bottom: 15px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 8px; font-size: 14px;">原文 (ASR):</div>
          <div id="translation-original" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #ddd; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
        <div style="margin-bottom: 15px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 8px; font-size: 14px;">译文 (NMT):</div>
          <div id="translation-translated" style="padding: 15px; background: #e7f3ff; border-radius: 8px; border: 1px solid #b0d4f1; color: #0066cc; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
      </div>

      <!-- 控制按钮 -->
      <div style="margin: 30px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: center; gap: 15px; flex-wrap: wrap; margin-bottom: 15px;">
          <button id="start-btn" style="padding: 12px 24px; background: #28a745; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            开始
          </button>
          <button id="end-btn" style="padding: 12px 24px; background: #dc3545; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            结束
          </button>
        </div>
        <div style="display: flex; justify-content: center; gap: 15px; flex-wrap: wrap;">
          <button id="send-btn" style="padding: 15px 40px; background: #007bff; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            发送
          </button>
          <button id="play-pause-btn" style="padding: 15px 40px; background: #28a745; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            <span id="play-pause-text">播放</span>
          </button>
          <button id="playback-rate-btn" style="padding: 12px 24px; background: #6c757d; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            <span id="playback-rate-text">1x</span>
          </button>
        </div>
      </div>
      
      <div id="tts-audio-info" style="margin: 20px 0; padding: 15px; background: #e7f3ff; border-radius: 8px; display: none;">
        <div style="font-size: 14px; color: #0066cc;">
          可播放音频时长: <span id="tts-duration">0.0</span> 秒
        </div>
      </div>

      <!-- 可选功能（折叠） -->
      <div style="margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <details>
          <summary style="font-weight: bold; font-size: 16px; color: #333; cursor: pointer; padding: 10px;">可选功能（点击展开）</summary>
          <div style="margin-top: 15px;">
            <!-- 服务模式选择 -->
            <div style="margin-bottom: 20px;">
              <div style="font-weight: bold; font-size: 16px; margin-bottom: 15px; color: #333;">选择服务模式：</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                <button id="mode-personal-voice" class="mode-btn" data-mode="personal_voice" style="padding: 15px; background: white; border: 3px solid #667eea; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">🎤</div>
                  <div style="font-weight: bold; font-size: 14px; color: #667eea; margin-bottom: 4px;">个人音色语音转译</div>
                  <div style="font-size: 11px; color: #666;">ASR → NMT → YourTTS</div>
                </button>
                <button id="mode-voice-translation" class="mode-btn" data-mode="voice_translation" style="padding: 15px; background: white; border: 3px solid #28a745; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">🔊</div>
                  <div style="font-weight: bold; font-size: 14px; color: #28a745; margin-bottom: 4px;">语音转译</div>
                  <div style="font-size: 11px; color: #666;">ASR → NMT → TTS</div>
                </button>
                <button id="mode-original-subtitle" class="mode-btn" data-mode="original_subtitle" style="padding: 15px; background: white; border: 3px solid #ffc107; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">📝</div>
                  <div style="font-weight: bold; font-size: 14px; color: #ffc107; margin-bottom: 4px;">原文字幕</div>
                  <div style="font-size: 11px; color: #666;">ASR 仅</div>
                </button>
                <button id="mode-bilingual-subtitle" class="mode-btn" data-mode="bilingual_subtitle" style="padding: 15px; background: white; border: 3px solid #17a2b8; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">🌐</div>
                  <div style="font-weight: bold; font-size: 14px; color: #17a2b8; margin-bottom: 4px;">双语字幕</div>
                  <div style="font-size: 11px; color: #666;">ASR → NMT</div>
                </button>
                <button id="mode-text-translation" class="mode-btn" data-mode="text_translation" style="padding: 15px; background: white; border: 3px solid #dc3545; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">✍️</div>
                  <div style="font-weight: bold; font-size: 14px; color: #dc3545; margin-bottom: 4px;">文本翻译</div>
                  <div style="font-size: 11px; color: #666;">NMT 仅</div>
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>

    <style>
      .mode-btn:hover {
        transform: translateY(-5px);
        box-shadow: 0 6px 12px rgba(0,0,0,0.15) !important;
      }
      .mode-btn.selected {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: white !important;
        border-color: transparent !important;
      }
      .mode-btn.selected div {
        color: white !important;
      }
      button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2) !important;
      }
      button:active:not(:disabled) {
        transform: translateY(0);
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>
  `;

  setupSessionModeEventHandlers(container, app);
}

/**
 * 设置会话模式事件处理器
 */
function setupSessionModeEventHandlers(container: HTMLElement, app: App): void {
  let selectedMode: ServiceMode | null = null;
  
  // 服务模式按钮事件 - 选择模式时自动连接服务器
  const modeButtons = document.querySelectorAll('.mode-btn');
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
