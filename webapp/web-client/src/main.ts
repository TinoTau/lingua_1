// 立即输出，确认脚本已加载
console.log('[Main] 脚本开始加载...');

import { App } from './app';
import { renderMainMenu, renderRoom, renderSessionMode, renderRoomMode, setUIMode, getUIMode } from './ui/renderers';
import { RoomMember, SessionState, Config } from './types';
import { exposeLogHelper } from './utils/log_helper';
import { initConsoleLoggerBridge } from './utils/console_logger_bridge';

console.log('[Main] 模块导入完成');

// 初始化console日志桥接（延迟执行，确保页面基本加载完成）
// 使用 setTimeout 确保在页面基本结构加载后再初始化
setTimeout(() => {
  try {
    console.log('[Main] 开始初始化console日志桥接...');
    initConsoleLoggerBridge();
    console.log('[Main] console日志桥接初始化完成');
  } catch (error) {
    // 使用原始的 console.error，避免循环依赖
    console.error('[Main] 初始化console日志桥接失败:', error);
  }
}, 0);

// 从URL参数或localStorage读取日志配置
const getLogConfigFromUrl = (): Partial<Config['logConfig']> | undefined => {
  const urlParams = new URLSearchParams(window.location.search);
  const autoSave = urlParams.get('logAutoSave');
  const autoSaveInterval = urlParams.get('logAutoSaveInterval');
  const logPrefix = urlParams.get('logPrefix');
  
  if (autoSave === 'true' || autoSave === '1') {
    return {
      autoSaveToFile: true,
      autoSaveIntervalMs: autoSaveInterval ? parseInt(autoSaveInterval, 10) : 30000,
      logFilePrefix: logPrefix || 'web-client',
    };
  }
  return undefined;
};

// 从localStorage读取日志配置
const getLogConfigFromStorage = (): Partial<Config['logConfig']> | undefined => {
  const saved = localStorage.getItem('logConfig');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

// 合并日志配置（URL参数 > localStorage > 默认值）
const logConfig = getLogConfigFromUrl() || getLogConfigFromStorage() || undefined;
console.log('[Main] 日志配置:', logConfig);

// 初始化应用（传入日志配置）
let app: App;
try {
  console.log('[Main] 开始实例化App...');
  app = new App({
    logConfig: logConfig,
  });
  console.log('[Main] App实例化成功');
} catch (error) {
  console.error('[Main] App实例化失败:', error);
  throw error; // 重新抛出错误，让浏览器显示错误信息
}

// 导出给 UI 使用
(window as any).app = app;

// 暴露日志工具到window对象
exposeLogHelper();

// UI 初始化
function initUI() {
  const container = document.getElementById('app');
  if (!container) {
    console.error('[Main] 找不到 app 容器元素');
    return;
  }

  console.log('[Main] 开始初始化主菜单，app实例:', !!app);
  
  // 初始化主菜单
  renderMainMenu(container, app, () => {
    console.log('[Main] 单会话模式回调被调用');
    try {
      setUIMode('session');
      console.log('[Main] 准备渲染会话模式界面');
      renderSessionMode(container, app);
      console.log('[Main] 会话模式界面渲染完成');
    } catch (error) {
      console.error('[Main] 渲染会话模式界面失败:', error);
      alert('切换到会话模式失败: ' + (error instanceof Error ? error.message : String(error)));
    }
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
}

// 页面加载完成后初始化 UI
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  // DOM 已经加载完成，直接初始化
  initUI();
}
