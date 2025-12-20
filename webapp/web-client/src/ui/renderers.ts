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
        <div style="font-weight: bold; margin-bottom: 10px; color: #0066cc;">翻译结果：</div>
        <div style="margin-bottom: 8px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 4px;">原文 (ASR):</div>
          <div id="translation-original" style="padding: 8px; background: white; border-radius: 4px; border: 1px solid #ddd;">等待翻译结果...</div>
        </div>
        <div style="margin-bottom: 8px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 4px;">译文 (NMT):</div>
          <div id="translation-translated" style="padding: 8px; background: white; border-radius: 4px; border: 1px solid #ddd; color: #0066cc;">等待翻译结果...</div>
        </div>
        <div id="translation-timings" style="margin-top: 10px; font-size: 12px; color: #666;"></div>
      </div>

      <div style="margin: 20px 0;">
        <button id="connect-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;">
          连接服务器
        </button>
        <button id="start-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          开始
        </button>
        <button id="send-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          发送
        </button>
        <button id="end-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          结束
        </button>
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
  const endBtn = document.getElementById('end-btn') as HTMLButtonElement;
  const statusText = document.getElementById('status-text') as HTMLElement;

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
    } catch (error) {
      alert('连接失败: ' + error);
    }
  });

  startBtn.addEventListener('click', async () => {
    await app.startSession();
    // 状态变化会通过状态监听自动更新按钮状态，这里不需要手动设置
  });

  sendBtn.addEventListener('click', () => {
    app.sendCurrentUtterance();
    // 状态变化会通过状态监听自动更新按钮状态，这里不需要手动设置
  });

  endBtn.addEventListener('click', async () => {
    await app.endSession();
    // 状态变化会通过状态监听自动更新按钮状态，这里不需要手动设置
  });

  // 状态监听（通过公共方法）
  const stateMachine = app.getStateMachine();
  if (stateMachine) {
    stateMachine.onStateChange((newState: SessionState) => {
      const isSessionActive = stateMachine.getIsSessionActive ? stateMachine.getIsSessionActive() : false;
      
      switch (newState) {
        case SessionState.INPUT_READY:
          if (isSessionActive) {
            statusText.textContent = '会话进行中，准备就绪';
          } else {
            statusText.textContent = '准备就绪';
          }
          // 只有在会话未开始时，开始按钮才可用
          startBtn.disabled = isSessionActive;
          sendBtn.disabled = true;
          endBtn.disabled = !isSessionActive;
          break;
        case SessionState.INPUT_RECORDING:
          statusText.textContent = isSessionActive ? '会话进行中，正在监听...' : '正在录音...';
          startBtn.disabled = true;
          sendBtn.disabled = !isSessionActive; // 只有在会话进行中时，发送按钮才可用
          endBtn.disabled = !isSessionActive; // 只有在会话进行中时，结束按钮才可用
          break;
        case SessionState.WAITING_RESULT:
          statusText.textContent = '等待翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true;
          endBtn.disabled = !isSessionActive;
          break;
        case SessionState.PLAYING_TTS:
          statusText.textContent = '播放翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true;
          endBtn.disabled = !isSessionActive;
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
        <div style="font-weight: bold; margin-bottom: 10px; color: #0066cc;">翻译结果：</div>
        <div style="margin-bottom: 8px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 4px;">原文 (ASR):</div>
          <div id="translation-original" style="padding: 8px; background: white; border-radius: 4px; border: 1px solid #ddd;">等待翻译结果...</div>
        </div>
        <div style="margin-bottom: 8px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 4px;">译文 (NMT):</div>
          <div id="translation-translated" style="padding: 8px; background: white; border-radius: 4px; border: 1px solid #ddd; color: #0066cc;">等待翻译结果...</div>
        </div>
        <div id="translation-timings" style="margin-top: 10px; font-size: 12px; color: #666;"></div>
      </div>

      <div style="margin: 20px 0;">
        <button id="start-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          开始
        </button>
        <button id="send-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          发送
        </button>
        <button id="end-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer;" disabled>
          结束
        </button>
        <button id="leave-room-btn" style="padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer; background: #dc3545; color: white; border: none; border-radius: 8px;">
          退出房间
        </button>
      </div>
    </div>
  `;

  // 房间内按钮事件
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const endBtn = document.getElementById('end-btn') as HTMLButtonElement;
  const leaveRoomBtn = document.getElementById('leave-room-btn') as HTMLButtonElement;
  const statusText = document.getElementById('status-text') as HTMLElement;

  startBtn.addEventListener('click', async () => {
    await app.startSession();
  });

  sendBtn.addEventListener('click', () => {
    app.sendCurrentUtterance();
  });

  endBtn.addEventListener('click', async () => {
    await app.endSession();
  });

  leaveRoomBtn.addEventListener('click', () => {
    app.leaveRoom();
    currentUIMode = 'main';
    renderMainMenu(container, app);
  });

  // 状态监听
  const stateMachine = app.getStateMachine();
  if (stateMachine) {
    stateMachine.onStateChange((newState: SessionState) => {
      const isSessionActive = stateMachine.getIsSessionActive ? stateMachine.getIsSessionActive() : false;
      
      switch (newState) {
        case SessionState.INPUT_READY:
          statusText.textContent = isSessionActive ? '会话进行中，准备就绪' : '准备就绪';
          startBtn.disabled = isSessionActive;
          sendBtn.disabled = true;
          endBtn.disabled = !isSessionActive;
          break;
        case SessionState.INPUT_RECORDING:
          statusText.textContent = isSessionActive ? '会话进行中，正在监听...' : '正在录音...';
          startBtn.disabled = true;
          sendBtn.disabled = !isSessionActive;
          endBtn.disabled = !isSessionActive;
          break;
        case SessionState.WAITING_RESULT:
          statusText.textContent = '等待翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true;
          endBtn.disabled = !isSessionActive;
          break;
        case SessionState.PLAYING_TTS:
          statusText.textContent = '播放翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true;
          endBtn.disabled = !isSessionActive;
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

