import { App } from './app';
import { renderMainMenu, renderRoom, renderSessionMode, renderRoomMode, setUIMode, getUIMode } from './ui/renderers';
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
  renderMainMenu(container, app, () => {
    setUIMode('session');
    renderSessionMode(container, app);
  }, () => {
    setUIMode('room-create');
    renderRoomMode(container, app, () => {
      setUIMode('main');
      renderMainMenu(container, app, () => {
        setUIMode('session');
        renderSessionMode(container, app);
      }, () => {
        setUIMode('room-create');
        renderRoomMode(container, app, () => {
          setUIMode('main');
          renderMainMenu(container, app, () => {
            setUIMode('session');
            renderSessionMode(container, app);
          }, () => {
            setUIMode('room-create');
            renderRoomMode(container, app, () => { });
          });
        });
      });
    });
  });

  // 监听房间状态变化
  setInterval(() => {
    if (app.getIsInRoom() && getUIMode() !== 'room') {
      setUIMode('room');
      renderRoom(container, app, () => {
        setUIMode('main');
        renderMainMenu(container, app, () => {
          setUIMode('session');
          renderSessionMode(container, app);
        }, () => {
          setUIMode('room-create');
          renderRoomMode(container, app, () => {
            setUIMode('main');
            renderMainMenu(container, app, () => {
              setUIMode('session');
              renderSessionMode(container, app);
            }, () => {
              setUIMode('room-create');
              renderRoomMode(container, app, () => { });
            });
          });
        });
      });
    } else if (!app.getIsInRoom() && getUIMode() === 'room') {
      setUIMode('main');
      renderMainMenu(container, app, () => {
        setUIMode('session');
        renderSessionMode(container, app);
      }, () => {
        setUIMode('room-create');
        renderRoomMode(container, app, () => {
          setUIMode('main');
          renderMainMenu(container, app, () => {
            setUIMode('session');
            renderSessionMode(container, app);
          }, () => {
            setUIMode('room-create');
            renderRoomMode(container, app, () => { });
          });
        });
      });
    }
  }, 500);

  // 注册全局回调（用于房间状态变化时更新 UI）
  (window as any).onRoomCreated = (_roomCode: string) => {
    if (getUIMode() === 'room-create' || getUIMode() === 'room-join') {
      setUIMode('room');
      renderRoom(container, app, () => {
        setUIMode('main');
        renderMainMenu(container, app, () => {
          setUIMode('session');
          renderSessionMode(container, app);
        }, () => {
          setUIMode('room-create');
          renderRoomMode(container, app, () => {
            setUIMode('main');
            renderMainMenu(container, app, () => {
              setUIMode('session');
              renderSessionMode(container, app);
            }, () => {
              setUIMode('room-create');
              renderRoomMode(container, app, () => { });
            });
          });
        });
      });
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
    renderMainMenu(container, app, () => {
      setUIMode('session');
      renderSessionMode(container, app);
    }, () => {
      setUIMode('room-create');
      renderRoomMode(container, app, () => {
        setUIMode('main');
        renderMainMenu(container, app, () => {
          setUIMode('session');
          renderSessionMode(container, app);
        }, () => {
          setUIMode('room-create');
          renderRoomMode(container, app, () => { });
        });
      });
    });
  };

  // 注册 TTS 音频可用回调（用于更新 UI）
  // 注意：此回调只在 INPUT_RECORDING 状态下更新播放按钮
  // 状态变化回调会在状态变为 INPUT_RECORDING 时检查 hasPendingAudio 并更新播放按钮
  (window as any).onTtsAudioAvailable = (duration: number) => {
    console.log('[Main] onTtsAudioAvailable 回调被调用，duration:', duration.toFixed(2));
    // 更新播放按钮和时长显示
    const playPauseBtn = document.getElementById('play-pause-btn') as HTMLButtonElement;
    const playPauseText = document.getElementById('play-pause-text') as HTMLElement;
    const ttsAudioInfo = document.getElementById('tts-audio-info') as HTMLElement;
    const ttsDuration = document.getElementById('tts-duration') as HTMLElement;

    if (playPauseBtn && playPauseText && ttsAudioInfo && ttsDuration) {
      // 只有在 INPUT_RECORDING 状态下才启用播放按钮（与备份代码逻辑一致）
      const stateMachine = app.getStateMachine();
      if (stateMachine && stateMachine.getState() === SessionState.INPUT_RECORDING) {
        playPauseBtn.disabled = false;
        playPauseText.textContent = '播放';
        ttsAudioInfo.style.display = 'block';
        ttsDuration.textContent = duration.toFixed(1);
        console.log('[Main] ✅ 播放按钮已启用（INPUT_RECORDING 状态），时长:', duration.toFixed(1));
      } else {
        const currentState = stateMachine ? stateMachine.getState() : null;
        console.log('[Main] ⏸️ 当前状态不是 INPUT_RECORDING，不启用播放按钮。当前状态:', currentState);
        console.log('[Main] 💡 提示：当状态变为 INPUT_RECORDING 时，状态变化回调会自动检查 hasPendingAudio 并更新播放按钮');
      }
    } else {
      console.warn('[Main] ⚠️ 找不到播放按钮相关元素:', {
        playPauseBtn: !!playPauseBtn,
        playPauseText: !!playPauseText,
        ttsAudioInfo: !!ttsAudioInfo,
        ttsDuration: !!ttsDuration
      });
    }
  };
});
