/**
 * UI 渲染器主入口
 * 整合所有 UI 模块
 */

// 重新导出 UI 模式类型和函数
export type { UIMode } from './main_menu';
export { setUIMode, getUIMode, renderMainMenu } from './main_menu';
export { renderSessionMode } from './session_mode';
export { renderRoomMode, renderRoom } from './room_mode';
