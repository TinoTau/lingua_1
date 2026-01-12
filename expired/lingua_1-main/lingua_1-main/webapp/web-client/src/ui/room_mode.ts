/**
 * 房间模式 UI 模块
 * 负责渲染和管理房间模式的用户界面
 */

import { App } from '../app';
import { SessionState, RoomMember } from '../types';
import { renderMainMenu, setUIMode } from './main_menu';

/**
 * 渲染房间模式界面（创建/加入）
 */
export function renderRoomMode(container: HTMLElement, app: App, onBackToMain: () => void): void {
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
    setUIMode('main');
    onBackToMain();
  });

  document.getElementById('create-room-btn')?.addEventListener('click', async () => {
    const wsClient = (app as any).wsClient;
    if (!wsClient || !wsClient.isConnected()) {
      try {
        await app.connect('zh', 'en');
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
    const wsClient = (app as any).wsClient;
    if (!wsClient || !wsClient.isConnected()) {
      try {
        await app.connect('zh', 'en');
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
 * 渲染房间界面（房间内）
 */
export function renderRoom(container: HTMLElement, app: App, onBackToMain: () => void): void {
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

  setupRoomEventHandlers(container, app, roomCode, members, onBackToMain);
}

/**
 * 设置房间事件处理器
 */
function setupRoomEventHandlers(container: HTMLElement, app: App, roomCode: string, members: RoomMember[], onBackToMain: () => void): void {
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
    await app.startSession();
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

  if (playbackRateBtn) {
    playbackRateBtn.addEventListener('click', () => {
      const newRate = app.toggleTtsPlaybackRate();
      if (playbackRateText) {
        playbackRateText.textContent = `${newRate}x`;
      }
    });
  }

  endBtn.addEventListener('click', async () => {
    await app.endSession();
  });

  leaveRoomBtn.addEventListener('click', () => {
    app.leaveRoom();
    setUIMode('main');
    onBackToMain();
  });

  // 定期更新播放按钮的时长显示
  let roomDurationUpdateInterval: number | null = null;
  const startRoomDurationUpdate = () => {
    if (roomDurationUpdateInterval) {
      clearInterval(roomDurationUpdateInterval);
    }
    roomDurationUpdateInterval = window.setInterval(() => {
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
  const stopRoomDurationUpdate = () => {
    if (roomDurationUpdateInterval) {
      clearInterval(roomDurationUpdateInterval);
      roomDurationUpdateInterval = null;
    }
  };

  // 播放按钮闪烁效果（内存压力警告）
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

  // 监听内存压力变化
  if (typeof window !== 'undefined') {
    const originalOnMemoryPressure = (window as any).onMemoryPressure;
    (window as any).onMemoryPressure = (pressure: 'normal' | 'warning' | 'critical') => {
      if (originalOnMemoryPressure) {
        originalOnMemoryPressure(pressure);
      }

      if (pressure === 'warning') {
        const stateMachine = app.getStateMachine();
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
      const isConnected = app.isConnected();

      switch (newState) {
        case SessionState.INPUT_READY:
          stopRoomDurationUpdate();
          statusText.textContent = isSessionActive ? '会话进行中，准备就绪' : '准备就绪';
          startBtn.disabled = isSessionActive;
          sendBtn.disabled = true;
          if (playPauseBtn) playPauseBtn.disabled = true;
          if (playbackRateBtn) playbackRateBtn.disabled = !(isConnected && isSessionActive);
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          endBtn.disabled = !isSessionActive;
          if (ttsAudioInfo) ttsAudioInfo.style.display = 'none';
          break;
        case SessionState.INPUT_RECORDING:
          startRoomDurationUpdate();
          statusText.textContent = isSessionActive ? '会话进行中，正在监听...' : '正在录音...';
          startBtn.disabled = true;
          sendBtn.disabled = !isSessionActive;
          const hasPendingAudio = app.hasPendingTtsAudio();
          if (playPauseBtn) {
            playPauseBtn.disabled = !hasPendingAudio;
            if (hasPendingAudio && playPauseText) {
              const duration = app.getTtsAudioDuration();
              playPauseText.textContent = `播放 (${duration.toFixed(1)}s)`;
            } else if (playPauseText) {
              playPauseText.textContent = '播放';
            }
          }
          if (playbackRateBtn) {
            playbackRateBtn.disabled = !isConnected;
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
          stopRoomDurationUpdate();
          stopRoomBlink();
          statusText.textContent = '播放翻译结果...';
          startBtn.disabled = true;
          sendBtn.disabled = true;
          if (playPauseBtn && playPauseText) {
            playPauseBtn.disabled = false;
            playPauseText.textContent = '暂停';
          }
          if (playbackRateBtn) {
            playbackRateBtn.disabled = false;
          }
          if (playbackRateText) {
            playbackRateText.textContent = app.getTtsPlaybackRateText();
          }
          endBtn.disabled = !isSessionActive;
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

