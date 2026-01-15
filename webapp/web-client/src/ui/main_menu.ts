/**
 * 主菜单 UI 模块
 * 负责渲染主菜单和 UI 状态管理
 */

import { App } from '../app';

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
export function renderMainMenu(container: HTMLElement, app: App, onSessionModeClick: () => void, onRoomModeClick: () => void): void {
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

  // 直接绑定事件（innerHTML 后 DOM 已经更新）
  const sessionBtn = document.getElementById('session-mode-btn');
  const roomBtn = document.getElementById('room-mode-btn');
  
  if (sessionBtn) {
    sessionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[MainMenu] 单会话模式按钮被点击');
      try {
        currentUIMode = 'session';
        onSessionModeClick();
        console.log('[MainMenu] 单会话模式回调执行完成');
      } catch (error) {
        console.error('[MainMenu] 单会话模式回调执行失败:', error);
      }
    });
    console.log('[MainMenu] 单会话模式按钮事件监听器已绑定');
  } else {
    console.error('[MainMenu] 找不到单会话模式按钮');
  }

  if (roomBtn) {
    roomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[MainMenu] 房间模式按钮被点击');
      try {
        currentUIMode = 'room-create';
        onRoomModeClick();
        console.log('[MainMenu] 房间模式回调执行完成');
      } catch (error) {
        console.error('[MainMenu] 房间模式回调执行失败:', error);
      }
    });
    console.log('[MainMenu] 房间模式按钮事件监听器已绑定');
  } else {
    console.error('[MainMenu] 找不到房间模式按钮');
  }
}

