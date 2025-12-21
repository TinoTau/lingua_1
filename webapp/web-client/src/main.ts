import { App } from './app';
import { renderMainMenu, renderRoomMode, renderRoom, setUIMode, getUIMode } from './ui/renderers';
import { RoomMember, SessionState } from './types';

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

  // 初始化主菜单
  renderMainMenu(container, app);

  // 监听房间状态变化
  const checkRoomStatus = setInterval(() => {
    if (app.getIsInRoom() && getUIMode() !== 'room') {
      setUIMode('room');
      renderRoom(container, app);
    } else if (!app.getIsInRoom() && getUIMode() === 'room') {
      setUIMode('main');
      renderMainMenu(container, app);
    }
  }, 500);

  // 注册全局回调（用于房间状态变化时更新 UI）
  (window as any).onRoomCreated = (roomCode: string) => {
    if (getUIMode() === 'room-create' || getUIMode() === 'room-join') {
      setUIMode('room');
      renderRoom(container, app);
    }
  };

  (window as any).onRoomMembersUpdated = (members: RoomMember[]) => {
    if (getUIMode() === 'room') {
      const membersList = document.getElementById('members-list');
      const roomCode = app.getCurrentRoomCode() || '';
      if (membersList) {
        const currentSessionId = app.getSessionId();
        membersList.innerHTML = members.map((m, idx) => {
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
        members.forEach((m, idx) => {
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
    }
  };

  (window as any).onRoomExpired = () => {
    setUIMode('main');
    renderMainMenu(container, app);
  };

  // 注册 TTS 音频可用回调（用于更新 UI）
  (window as any).onTtsAudioAvailable = (duration: number) => {
    // 更新播放按钮和时长显示
    const playPauseBtn = document.getElementById('play-pause-btn') as HTMLButtonElement;
    const playPauseText = document.getElementById('play-pause-text') as HTMLElement;
    const ttsAudioInfo = document.getElementById('tts-audio-info') as HTMLElement;
    const ttsDuration = document.getElementById('tts-duration') as HTMLElement;
    
    if (playPauseBtn && playPauseText && ttsAudioInfo && ttsDuration) {
      // 只有在 INPUT_RECORDING 状态下才启用播放按钮
      const stateMachine = app.getStateMachine();
      if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
        playPauseBtn.disabled = false;
        playPauseText.textContent = '播放';
        ttsAudioInfo.style.display = 'block';
        ttsDuration.textContent = duration.toFixed(1);
      }
    }
  };
});
