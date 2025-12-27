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

  document.getElementById('session-mode-btn')?.addEventListener('click', () => {
    currentUIMode = 'session';
    onSessionModeClick();
  });

  document.getElementById('room-mode-btn')?.addEventListener('click', () => {
    currentUIMode = 'room-create';
    onRoomModeClick();
  });
}

